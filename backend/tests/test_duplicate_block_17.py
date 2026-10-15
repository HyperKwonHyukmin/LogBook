"""17 — 완전 동일 BDF 업로드 차단: 웹 업로드 마무리·워커 배치 처리·확정 재검사, 권한(15)·LV3 강제·서명 없는 옛 모델.

합성 데이터만(가상 호선 9999/9001/9002, 가상 사번).
"""
import hashlib
import os
from dataclasses import replace

import pytest

from app import models
from app.bdf.deck import DeckReader
from app.bdf.signature import compute_signature
from app.convert.job import set_signature
from app.entries.service import auto_merge_batch
from app.ingest.process import process_batch
from app.storage.paths import to_long
from app.uploads import service as upload_service

OCTET = {"Content-Type": "application/octet-stream"}


def deck(*, thick="10.", load="1.", n=3, style="free", extra=""):
    """합성 BDF — n×n 쉘 판. style 'fixed' 는 같은 모델을 고정 형식·다른 카드 순서·주석으로 쓴다."""
    grids = [(i * n + j + 1, j * 100.0, i * 100.0) for i in range(n) for j in range(n)]
    quads = []
    eid = 1
    for i in range(n - 1):
        for j in range(n - 1):
            a = i * n + j + 1
            quads.append((eid, a, a + 1, a + n + 1, a + n))
            eid += 1
    head = ["SOL 101", "CEND", "SUBCASE 1", "  LOAD = 1", "  SPC = 1", "BEGIN BULK"]
    if style == "free":
        body = [f"GRID,{g},,{x},{y},0." for g, x, y in grids]
        body += [f"CQUAD4,{e},1,{a},{b},{c},{d}" for e, a, b, c, d in quads]
        body += [f"PSHELL,1,1,{thick}", "MAT1,1,2.06+5,,0.3", f"FORCE,1,{n * n},,{load},0.,0.,-1.", "SPC1,1,123456,1"]
    else:
        f8 = lambda *v: "".join(f"{str(x):<8}" for x in v)  # noqa: E731
        body = ["$ 같은 모델, 다른 형식(고정 8칸)·순서·주석"]
        body += [f8("PSHELL", 1, 1, thick), f8("MAT1", 1, "206000.", "", ".3")]
        body += [f8("CQUAD4", e, 1, a, b, c, d) for e, a, b, c, d in reversed(quads)]
        body += [f8("GRID", g, "", f"{x:.1f}", f"{y:.1f}", "0.0") for g, x, y in reversed(grids)]
        body += [f8("SPC1", 1, 123456, 1), f8("FORCE", 1, n * n, "", load, "0.", "0.", "-1.")]
    if extra:
        body.append(extra)
    return ("\n".join(head + body + ["ENDDATA"]) + "\n").encode()


def sig_of(data: bytes, rel="m.bdf", files=None):
    files = {rel: data, **(files or {})}
    r = DeckReader(lambda x: files[x])
    cards = r.read(rel)
    return compute_signature(cards, r.control, r.sol)


@pytest.fixture
def existing(db, make_entry_file):
    """이미 있는 BDF(확정·초안·휴지통) + 서명(변환이 남긴 것과 같은 값). signed=False 면 12 이전 변환(서명 없음)."""

    def _make(data, *, status="confirmed", name="9001_old/model.bdf", uploaded_by="B200001", title="9001 기존 검토",
              signed=True, access="normal", state="done"):
        entry, f = make_entry_file(status=status, title=title, hulls=("9001",), name=name, kind="model",
                                   uploaded_by=uploaded_by, sha=hashlib.sha256(data).hexdigest())
        entry.access = access
        row = models.ModelSummary(file_id=f.id, state=state, includes=[], missing=[])
        if signed:
            set_signature(row, sig_of(data))
        db.add(row)
        db.commit()
        return entry, f

    return _make


def upload(client, h, files: dict[str, bytes], *, force=False, target=None):
    r = client.post("/api/uploads", json={"name": "9999_시험", "target_entry_id": target}, headers=h)
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    for rel, data in files.items():
        r = client.put(f"/api/uploads/{key}/chunk", params={"path": rel, "offset": 0}, content=data,
                       headers={**h, **OCTET})
        assert r.status_code == 200, r.text
    r = client.post(f"/api/uploads/{key}/finish", headers=h, json={
        "files": [{"rel_path": rel, "size": len(d)} for rel, d in files.items()], "rejected": [], "force": force})
    return key, r


def staged(storage, key, rel):
    return os.path.exists(to_long(storage.staging / key / rel))


# ---- 1. 웹 업로드 마무리 ----

def test_identical_bdf_with_other_name_is_blocked(client, db, storage, make_user, auth_headers, existing):
    make_user("A100001", level=2)
    make_user("B200001", name="박가상", level=2)
    e, _f = existing(deck())
    h = auth_headers("A100001")
    # 이름·형식(고정 필드·카드 순서·주석)이 달라도 4범주 서명이 같다 → 막는다
    key, r = upload(client, h, {"9999_새/renamed_copy.bdf": deck(style="fixed")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "blocked" and body["key"] is None
    [b] = body["blocked"]
    assert b["name"] == "9999_새/renamed_copy.bdf" and b["reason"] == "duplicate_model" and b["scope"] == "existing"
    assert b["hidden"] is False and b["total"] == 1
    m = b["matches"][0]
    assert (m["entry_id"], m["entry_title"], m["entry_status"]) == (e.entry_id, "9001 기존 검토", "confirmed")
    assert m["rel_path"] == "9001_old/model.bdf" and m["uploaded_by"] == "B200001" and m["uploaded_by_name"] == "박가상"
    # 남는 파일이 없으면 배치를 만들지 않고 업로드 폴더도 지운다
    assert db.query(models.Batch).filter_by(key=key).count() == 0
    assert not os.path.exists(to_long(storage.web_inbox / key))
    assert not os.path.exists(to_long(storage.staging / key))
    log = db.query(models.AuditLog).filter_by(action="UPLOAD_DUPLICATE_BLOCKED", target_id=key).one()
    assert log.after["files"] == ["9999_새/renamed_copy.bdf"]
    assert e.entry_id not in str(log.after)   # 감사에는 대상 자료를 적지 않는다


def test_same_geometry_only_is_not_blocked(client, db, storage, make_user, auth_headers, existing):
    make_user("A100001")
    existing(deck())
    h = auth_headers("A100001")
    key, r = upload(client, h, {"9999_새/thicker.bdf": deck(thick="12."), "9999_새/heavier.bdf": deck(load="2.")})
    body = r.json()
    assert body["state"] == "staged" and body["blocked"] == [] and body["key"] == key
    assert staged(storage, key, "9999_새/thicker.bdf") and staged(storage, key, "9999_새/heavier.bdf")


def test_duplicate_inside_one_upload_keeps_first(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    key, r = upload(client, h, {"9999_새/a.bdf": deck(), "9999_새/b_copy.bdf": deck(style="fixed")})
    body = r.json()
    assert body["state"] == "staged"
    [b] = body["blocked"]
    assert (b["name"], b["scope"], b["same_as"], b["matches"]) == ("9999_새/b_copy.bdf", "same_upload", "9999_새/a.bdf", [])
    assert staged(storage, key, "9999_새/a.bdf") and not staged(storage, key, "9999_새/b_copy.bdf")
    batch = db.query(models.Batch).filter_by(key=key).one()
    assert [x["reason"] for x in batch.excluded] == ["duplicate_model"]


def test_mixed_upload_other_files_go_through(client, db, storage, make_user, auth_headers, existing):
    make_user("A100001")
    existing(deck())
    h = auth_headers("A100001")
    key, r = upload(client, h, {"9999_새/dup.bdf": deck(), "9999_새/new.bdf": deck(n=4),
                                "9999_새/run.f06": b"F06 RESULT", "9999_새/note.log": b"log"})
    body = r.json()
    assert body["state"] == "staged" and [b["name"] for b in body["blocked"]] == ["9999_새/dup.bdf"]
    for rel in ("9999_새/new.bdf", "9999_새/run.f06", "9999_새/note.log"):
        assert staged(storage, key, rel)
    assert not staged(storage, key, "9999_새/dup.bdf")
    # 배치 처리 뒤 초안에는 남은 파일만, 정리 대기 카드의 제외 목록에 이유와 대상
    batch = db.query(models.Batch).filter_by(key=key).one()
    process_batch(db, storage, batch)
    names = sorted(f.name for f in db.query(models.File).filter_by(batch_id=batch.id))
    assert names == ["new.bdf", "note.log", "run.f06"]
    lst = client.get("/api/batches", headers=h).json()
    [x] = [x for x in lst[0]["excluded"] if x["reason"] == "duplicate_model"]
    assert x["matches"][0]["entry_status"] == "confirmed" and "same_as_files" not in x


def test_mixed_upload_with_pdf_report(client, db, storage, make_user, auth_headers, existing, skip_if_local_drm):
    make_user("A100001")
    existing(deck())
    key, r = upload(client, auth_headers("A100001"), {"9999_새/dup.bdf": deck(), "9999_새/report.pdf": b"%PDF-1.4 x"})
    assert r.json()["state"] == "staged" and staged(storage, key, "9999_새/report.pdf")


def test_byte_identical_old_model_without_signature_is_blocked(client, db, storage, make_user, auth_headers, existing):
    make_user("A100001")
    data = deck()
    e, _f = existing(data, signed=False)          # 12 이전 변환 — 서명 없음
    h = auth_headers("A100001")
    _key, r = upload(client, h, {"9999_새/same_bytes.bdf": data})
    assert r.json()["state"] == "blocked" and r.json()["blocked"][0]["matches"][0]["entry_id"] == e.entry_id
    # 형식만 다른 같은 모델은 서명이 없는 상대와 비교할 수 없다(운영 화면이 --missing-signature 를 안내)
    _key, r = upload(client, h, {"9999_새/reformatted.bdf": deck(style="fixed")})
    assert r.json()["state"] == "staged"


def test_byte_rule_not_used_when_bdf_has_include(client, db, storage, make_user, auth_headers, existing):
    make_user("A100001")
    main = b"SOL 101\nCEND\nBEGIN BULK\nINCLUDE 'mesh.bdf'\nENDDATA\n"
    existing(main, signed=False)   # 바이트가 같은 본 파일 — 그러나 끌어오는 조각은 다를 수 있다
    _key, r = upload(client, auth_headers("A100001"),
                     {"9999_새/main.bdf": main, "9999_새/mesh.bdf": deck().split(b"BEGIN BULK\n")[1]})
    assert r.json()["state"] == "staged" and r.json()["blocked"] == []


def test_include_fragment_is_judged_with_main_and_blocked_together(client, db, storage, make_user, auth_headers,
                                                                   existing):
    make_user("A100001")
    whole = deck()
    existing(whole)
    head, bulk = whole.split(b"BEGIN BULK\n")
    main = head + b"BEGIN BULK\nINCLUDE 'mesh.bdf'\nENDDATA\n"
    key, r = upload(client, auth_headers("A100001"),
                    {"9999_새/main.bdf": main, "9999_새/mesh.bdf": bulk, "9999_새/memo.f06": b"x"})
    body = r.json()
    [b] = body["blocked"]
    assert b["name"] == "9999_새/main.bdf" and b["includes"] == ["9999_새/mesh.bdf"]
    assert not staged(storage, key, "9999_새/mesh.bdf") and staged(storage, key, "9999_새/memo.f06")


def test_trashed_material_is_not_a_target(client, db, storage, make_user, auth_headers, existing):
    make_user("A100001")
    existing(deck(), status="trashed")
    _key, r = upload(client, auth_headers("A100001"), {"9999_새/a.bdf": deck()})
    assert r.json()["state"] == "staged" and r.json()["blocked"] == []


def test_draft_in_inbox_is_a_target(client, db, storage, make_user, auth_headers, existing):
    make_user("A100001")
    e, _f = existing(deck(), status="draft", uploaded_by="A100001")
    _key, r = upload(client, auth_headers("A100001"), {"9999_새/again.bdf": deck()})
    m = r.json()["blocked"][0]["matches"][0]
    assert (m["entry_id"], m["entry_status"]) == (e.entry_id, "draft")


def test_target_hidden_from_uploader_is_blocked_anonymously(client, db, storage, make_user, auth_headers, existing):
    make_user("G100001", level=1)                  # LV1 — 남의 '일반' 자료를 볼 수 없다
    e, _f = existing(deck(), access="normal", uploaded_by="B200001", title="9002 비공개 검토")
    key, r = upload(client, auth_headers("G100001"), {"9999_새/a.bdf": deck()})
    body = r.json()
    assert body["state"] == "blocked"
    [b] = body["blocked"]
    assert b["hidden"] is True and b["matches"] == [] and b["total"] == 0
    for secret in (e.entry_id, "9002 비공개 검토", "B200001", "9001_old/model.bdf"):
        assert secret not in r.text
    # 공유 자료면 LV1 에게도 보인다
    e.access = "shared"
    db.commit()
    _key, r = upload(client, auth_headers("G100001"), {"9999_새/a.bdf": deck()})
    assert r.json()["blocked"][0]["matches"][0]["entry_id"] == e.entry_id


def test_lv3_force_uploads_and_audits(client, db, storage, make_user, auth_headers, existing):
    make_user("C300001", level=3)
    e, _f = existing(deck())
    key, r = upload(client, auth_headers("C300001"), {"9999_새/forced.bdf": deck()}, force=True)
    body = r.json()
    assert body["state"] == "staged" and body["blocked"] == [] and staged(storage, key, "9999_새/forced.bdf")
    batch = db.query(models.Batch).filter_by(key=key).one()
    assert batch.allow_duplicates is True
    log = db.query(models.AuditLog).filter_by(action="UPLOAD_DUPLICATE_FORCED", target_id=key).one()
    assert log.employee_id == "C300001" and log.after["files"][0]["entries"] == [e.entry_id]
    # 워커도 막지 않는다
    process_batch(db, storage, batch)
    assert [f.name for f in db.query(models.File).filter_by(batch_id=batch.id)] == ["forced.bdf"]


def test_force_requires_lv3(client, db, make_user, auth_headers, existing):
    make_user("A100001", level=2)
    existing(deck())
    _key, r = upload(client, auth_headers("A100001"), {"9999_새/a.bdf": deck()}, force=True)
    assert r.status_code == 403 and r.json()["detail"] == "level3_required"


def test_large_upload_is_deferred_to_worker(client, db, storage, make_user, auth_headers, existing, monkeypatch):
    make_user("A100001")
    e, _f = existing(deck())
    monkeypatch.setattr(upload_service, "settings", replace(upload_service.settings, dup_sync_max_bytes=100))
    key, r = upload(client, auth_headers("A100001"), {"9999_새/big.bdf": deck()})
    body = r.json()
    assert body["state"] == "staged" and body["blocked"] == [] and body["deferred"] == 1
    batch = db.query(models.Batch).filter_by(key=key).one()
    process_batch(db, storage, batch)
    db.refresh(batch)
    [x] = batch.excluded
    assert x["reason"] == "duplicate_model" and x["kept"] is True and x["same_as_files"] == [_f.id]
    assert db.query(models.File).filter_by(batch_id=batch.id).count() == 0 and batch.state == "done"
    assert staged(storage, key, "9999_새/big.bdf")      # 원본은 지우지 않는다


def test_time_budget_defers_remaining_files(client, db, storage, make_user, auth_headers, monkeypatch):
    make_user("A100001")
    monkeypatch.setattr(upload_service, "settings", replace(upload_service.settings, dup_sync_seconds=-1))
    _key, r = upload(client, auth_headers("A100001"), {"9999_새/a.bdf": deck(), "9999_새/b.bdf": deck()})
    assert r.json()["deferred"] == 2 and r.json()["blocked"] == []


# ---- 2. 워커 배치 처리(탐색기 00_Inbox 경로) ----

def _inbox_batch(db, storage, files: dict[str, bytes], key="20261008-090000-a17a", uploader="A100001"):
    for rel, data in files.items():
        p = storage.staging / key / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    b = models.Batch(key=key, source="inbox", original_name="9999_탐색기", uploader=uploader, state="staged")
    db.add(b)
    db.commit()
    return b


def test_worker_excludes_duplicate_and_keeps_original(db, storage, make_user, existing):
    make_user("A100001")
    e, f0 = existing(deck())
    b = _inbox_batch(db, storage, {"9999_탐색기/copy.bdf": deck(style="fixed"), "9999_탐색기/new.bdf": deck(n=4),
                                   "9999_탐색기/new_copy.bdf": deck(n=4)})
    process_batch(db, storage, b)
    db.refresh(b)
    reasons = {x["name"]: (x["reason"], x["scope"], x.get("kept")) for x in b.excluded}
    assert reasons == {"9999_탐색기/copy.bdf": ("duplicate_model", "existing", True),
                       "9999_탐색기/new_copy.bdf": ("duplicate_model", "same_upload", True)}
    assert [f.name for f in db.query(models.File).filter_by(batch_id=b.id)] == ["new.bdf"]
    assert os.path.exists(to_long(storage.staging / b.key / "9999_탐색기" / "copy.bdf"))
    # 남은 BDF 는 변환 전에 서명을 미리 적어 둔다(다음 배치·확정 재검사가 변환을 기다리지 않는다)
    f = db.query(models.File).filter_by(batch_id=b.id).one()
    row = db.get(models.ModelSummary, f.id)
    assert row.state == "queued" and row.sig_geometry == sig_of(deck(n=4)).geometry


def test_worker_catches_race_between_two_uploads(client, db, storage, make_user, auth_headers):
    """두 업로드가 같은 순간 마무리되면 둘 다 동기 검사를 통과한다 — 워커가 뒤 배치를 막는다."""
    make_user("A100001")
    h = auth_headers("A100001")
    k1, r1 = upload(client, h, {"9999_새/a.bdf": deck()})
    k2, r2 = upload(client, h, {"9999_새/a_again.bdf": deck()})
    # 두 번째 마무리 때는 첫 배치가 아직 초안이 아니라(파일 행 없음) 통과한다
    assert r1.json()["state"] == r2.json()["state"] == "staged"
    b1 = db.query(models.Batch).filter_by(key=k1).one()
    b2 = db.query(models.Batch).filter_by(key=k2).one()
    process_batch(db, storage, b1)
    process_batch(db, storage, b2)
    db.refresh(b2)
    assert b2.state == "done" and b2.excluded[0]["reason"] == "duplicate_model"
    assert db.query(models.File).filter_by(batch_id=b1.id).count() == 1


# ---- 3. 확정 재검사 ----

def _draft_with_model(db, storage, data, *, uploader, key="20261008-100000-c17c", merge_into=None, target=None):
    b = models.Batch(key=key, source="web", original_name="9999_초안", uploader=uploader, state="processed",
                     target_entry_id=target)
    db.add(b)
    db.flush()
    # 20 — BDF 초안은 구역·해석 종류가 있어야 확정된다
    e = models.Entry(title="9999 초안", status="draft", batch_id=b.id, uploaded_by=uploader, merge_into_id=merge_into,
                     analysis_type="강도 평가")
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.add(models.EntryHull(entry_id=e.id, hull_no="9999", is_primary=True))
    from app.entries.service import set_zones
    set_zones(db, e, ["선수부"])
    p = storage.staging / key / "m.bdf"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    f = models.File(batch_id=b.id, entry_id=e.id, rel_path="m.bdf", name="m.bdf", ext=".bdf", kind="model",
                    size=len(data), sha256=hashlib.sha256(data).hexdigest(), location="staging")
    db.add(f)
    db.flush()
    row = models.ModelSummary(file_id=f.id, state="queued")
    set_signature(row, sig_of(data))
    db.add(row)
    db.commit()
    return b, e, f


def test_confirm_409_when_duplicate_appeared_and_lv3_can_force(client, db, storage, make_user, auth_headers,
                                                                existing):
    make_user("A100001", level=2)
    make_user("C300001", level=3)
    _b, d, _f = _draft_with_model(db, storage, deck(), uploader="A100001")
    e, _f0 = existing(deck())         # 그 사이 같은 모델이 확정됐다(예: 옛 모델이 서명을 얻음)
    r = client.post(f"/api/entries/{d.entry_id}/confirm", headers=auth_headers("A100001"))
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "duplicate_model"
    assert detail["files"][0]["rel_path"] == "m.bdf" and detail["files"][0]["matches"][0]["entry_id"] == e.entry_id
    db.refresh(d)
    assert d.status == "draft"
    # 일반 사용자는 우회할 수 없다
    r = client.post(f"/api/entries/{d.entry_id}/confirm?force=true", headers=auth_headers("A100001"))
    assert r.status_code == 403 and r.json()["detail"] == "level3_required"
    # LV3 가 올린 초안이면 [그래도 확정]
    d.uploaded_by = "C300001"
    db.query(models.Batch).filter_by(id=d.batch_id).update({"uploader": "C300001"})
    db.commit()
    r = client.post(f"/api/entries/{d.entry_id}/confirm?force=true", headers=auth_headers("C300001"))
    assert r.status_code == 200, r.text
    log = db.query(models.AuditLog).filter_by(action="ENTRY_CONFIRM", target_id=d.entry_id).one()
    assert log.after["duplicates_forced"] == [{"name": "m.bdf", "entries": [e.entry_id]}]


def test_confirm_passes_without_duplicates(client, db, storage, make_user, auth_headers, existing):
    make_user("A100001")
    existing(deck(thick="12."))       # 같은 형상일 뿐
    _b, d, _f = _draft_with_model(db, storage, deck(), uploader="A100001")
    assert client.post(f"/api/entries/{d.entry_id}/confirm", headers=auth_headers("A100001")).status_code == 200


def test_auto_merge_race_leaves_draft_in_inbox(db, storage, make_user, existing, make_entry_file):
    make_user("A100001")
    target, _tf = make_entry_file(status="confirmed", title="9999 대상", name="r.pdf", uploaded_by="A100001")
    b, d, _f = _draft_with_model(db, storage, deck(), uploader="A100001", merge_into=target.id, target=target.id)
    existing(deck())                  # 합치기 직전에 같은 모델이 다른 자료로 확정됐다
    assert auto_merge_batch(db, storage, b) == 0
    db.refresh(d)
    assert d.status == "draft" and d.merge_into_id == target.id


# ---- 운영 화면 ----

def test_ops_status_counts_models_without_signature(client, db, make_user, auth_headers, existing):
    make_user("C300001", level=3)
    existing(deck(), signed=False)
    existing(deck(n=4), name="9001_old/b.bdf")
    existing(deck(n=5), name="9001_old/c.bdf", signed=False, status="trashed")   # 휴지통은 세지 않는다
    r = client.get("/api/admin/ops/status", headers=auth_headers("C300001"))
    assert r.status_code == 200 and r.json()["signatures"] == {"missing": 1}


@pytest.mark.fresh_schema   # 스키마를 바꾼다(conftest 'DB 초기화')
def test_ensure_columns_adds_allow_duplicates():
    """17: 17 이전 DB(batches.allow_duplicates 없음)에 시작 때 열을 더하고 기본값 0(두 번째는 아무것도 안 함)."""
    from sqlalchemy import inspect, text

    from app import database

    with database.engine.begin() as conn:
        conn.execute(text("ALTER TABLE batches DROP COLUMN allow_duplicates"))
    assert database.init_schema() == ["batches.allow_duplicates"]
    assert "allow_duplicates" in {c["name"] for c in inspect(database.engine).get_columns("batches")}
    assert database.init_schema() == []


def test_worker_all_duplicates_batch_stays_visible_and_is_audited(client, db, storage, make_user, auth_headers,
                                                                   existing):
    """탐색기로 넣은 BDF 가 모두 동일이면 초안 없이 done — 정리 대기에 며칠 남겨(이유·대상과 함께) 사라진 이유를 알린다."""
    make_user("A100001")
    existing(deck())
    b = _inbox_batch(db, storage, {"9999_탐색기/copy.bdf": deck(style="fixed")})
    process_batch(db, storage, b)
    db.refresh(b)
    assert b.state == "done"
    log = db.query(models.AuditLog).filter_by(action="UPLOAD_DUPLICATE_BLOCKED", target_id=b.key).one()
    assert log.employee_id == "A100001" and log.after["files"] == ["9999_탐색기/copy.bdf"]
    h = auth_headers("A100001")
    [d] = client.get("/api/batches", headers=h).json()
    assert d["key"] == b.key and d["state"] == "done" and d["excluded"][0]["reason"] == "duplicate_model"
    # 오래된 것·초안이 있었던(확정해 끝난) done 배치는 보이지 않는다
    from datetime import datetime, timedelta
    b.processed_at = datetime.now() - timedelta(days=4)
    db.commit()
    assert client.get("/api/batches", headers=h).json() == []
    b.processed_at = datetime.now()
    db.commit()
    e = models.Entry(title="확정됨", status="confirmed", batch_id=b.id, uploaded_by="A100001")
    db.add(e)
    db.commit()
    assert client.get("/api/batches", headers=h).json() == []
