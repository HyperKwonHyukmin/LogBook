"""58 — 파일명이 같은 보고서·엑셀·모델 찾기와 정리(관리 › 자료 정비 › 중복 파일)."""
from app import models
from app.bdf.signature import VERSION as SIG_VERSION
from app.entries import duplicate_files, service


def _confirmed(db, storage, setup_entry_with_files, u, rels, key):
    _, e = setup_entry_with_files(rels=rels, key=key)
    service.confirm(db, storage, e, u)
    db.expire_all()
    return db.get(models.Entry, e.id)


def _setup(db, storage, make_user, setup_entry_with_files):
    admin = make_user("A100001", is_admin=True)
    a = _confirmed(db, storage, setup_entry_with_files, admin, ("3496_검토/model/a.bdf", "3496_검토/r.pdf"),
                   "20260929-000000-aaaa")
    b = _confirmed(db, storage, setup_entry_with_files, admin, ("다른/R.PDF",), "20260929-000000-bbbb")
    return admin, a, b


def test_category():
    assert duplicate_files.category_of("x.PDF") == "report"
    assert duplicate_files.category_of("x.xlsx") == "excel"
    assert duplicate_files.category_of("x.inp") == "model"
    assert duplicate_files.category_of("x.op2") is None


def test_list_groups_same_name_across_entries(db, storage, make_user, setup_entry_with_files):
    _, a, b = _setup(db, storage, make_user, setup_entry_with_files)
    r = duplicate_files.duplicate_list(db)
    assert r["total"] == 1 and r["counts"]["report"] == 1   # a.bdf 는 한 자료에만 있다
    g = r["items"][0]
    assert g["key"] == "r.pdf" and g["same_content"] is True
    assert [f["entry_id"] for f in g["files"]] == [a.entry_id, b.entry_id]
    assert [f["keep"] for f in g["files"]] == [True, False]   # 먼저 올린 확정 자료를 남길 것으로
    assert [f["entry_file_count"] for f in g["files"]] == [2, 1]
    assert duplicate_files.duplicate_list(db, same="name")["total"] == 0
    assert duplicate_files.duplicate_list(db, category="excel")["total"] == 0


def test_name_only_when_content_differs(db, storage, make_user, setup_entry_with_files):
    _, a, b = _setup(db, storage, make_user, setup_entry_with_files)
    f = db.query(models.File).filter_by(entry_id=b.id).one()
    f.sha256 = "b" * 64
    db.commit()
    g = duplicate_files.duplicate_list(db, same="name")["items"][0]
    assert g["same_content"] is False


def test_resolve_removes_file_or_trashes_entry(db, storage, make_user, setup_entry_with_files):
    admin, a, b = _setup(db, storage, make_user, setup_entry_with_files)
    fa = db.query(models.File).filter_by(entry_id=a.id, name="r.pdf").one().id
    fb = db.query(models.File).filter_by(entry_id=b.id).one().id
    r = duplicate_files.resolve(db, storage, [fa, fb, 999999], user=admin)
    by = {x["file_id"]: x for x in r["results"]}
    assert by[fa]["status"] == "file_removed"     # a 에는 a.bdf 가 남는다 → 파일만 빼기
    assert by[fb]["status"] == "entry_trashed"    # b 는 마지막 파일 → 자료를 휴지통으로
    assert by[999999]["status"] == "skipped"
    db.expire_all()
    assert db.get(models.Entry, a.id).status == "confirmed"
    assert db.get(models.Entry, b.id).status == "trashed"
    assert db.query(models.AuditLog).filter_by(action="ENTRY_FILES_REMOVED").count() == 1
    assert duplicate_files.duplicate_list(db)["total"] == 0
    # 다시 하면 이미 빠진 파일은 건너뛴다
    assert duplicate_files.resolve(db, storage, [fa], user=admin)["skipped"] == 1


def test_api_admin_only(client, db, storage, make_user, auth_headers, setup_entry_with_files):
    admin, a, b = _setup(db, storage, make_user, setup_entry_with_files)
    make_user("B200002")
    assert client.get("/api/admin/cleanup/duplicates", headers=auth_headers("B200002")).status_code == 403
    h = auth_headers("A100001")
    res = client.get("/api/admin/cleanup/duplicates?category=report", headers=h)
    assert res.status_code == 200 and res.json()["total"] == 1
    fb = db.query(models.File).filter_by(entry_id=b.id).one().id
    res = client.post("/api/admin/cleanup/duplicates/resolve", json={"file_ids": [fb]}, headers=h)
    assert res.status_code == 200 and res.json()["done"] == 1


def _model_pair(db, storage, make_user, setup_entry_with_files):
    admin = make_user("A100001", is_admin=True)
    a = _confirmed(db, storage, setup_entry_with_files, admin, ("x/m.bdf", "x/r.pdf"), "20260929-000000-aaaa")
    b = _confirmed(db, storage, setup_entry_with_files, admin, ("y/m.bdf",), "20260929-000000-bbbb")
    fa = db.query(models.File).filter_by(entry_id=a.id, name="m.bdf").one()
    fb = db.query(models.File).filter_by(entry_id=b.id).one()
    fb.sha256 = "b" * 64          # 바이트는 다르다
    sig = dict(sig_version=SIG_VERSION, sig_geometry="g" * 64, sig_property="p" * 64, sig_material="m" * 64,
               sig_load="l" * 64, state="done")
    for f in (fa, fb):   # 확정이 변환 대기 행을 만든다 — 변환이 끝난 것처럼 채운다
        row = db.get(models.ModelSummary, f.id) or models.ModelSummary(file_id=f.id)
        for k, v in (sig | {"counts": {"GRID": 100, "CBEAM": 90}}).items():
            setattr(row, k, v)
        db.add(row)
    db.commit()
    return fa, fb


def test_model_same_signature_counts_as_same(db, storage, make_user, setup_entry_with_files):
    _model_pair(db, storage, make_user, setup_entry_with_files)
    r = duplicate_files.duplicate_list(db, category="model")
    g = r["items"][0]
    assert (g["same_content"], g["same_model"]) == (False, True)   # 주석·줄 형식만 다른 같은 모델
    assert g["files"][1]["compare"] == {"same_model": True, "diff": [], "same": list(duplicate_files.SIG_KINDS),
                                        "counts": {}}
    assert r["same_counts"] == {"content": 1, "name": 0}


def test_model_different_signature_shows_diff(db, storage, make_user, setup_entry_with_files):
    _, fb = _model_pair(db, storage, make_user, setup_entry_with_files)
    s = db.get(models.ModelSummary, fb.id)
    s.sig_geometry, s.counts = "h" * 64, {"GRID": 90, "CBEAM": 90, "RBE2": 3}
    db.commit()
    g = duplicate_files.duplicate_list(db, category="model")["items"][0]
    assert g["same_model"] is False
    c = g["files"][1]["compare"]
    assert c["diff"] == ["geometry"] and c["counts"] == {"GRID": -10, "RBE2": 3}
    assert g["files"][0]["compare"] is None    # 남길 것은 기준
    # 서명이 없으면(변환 전·옛 규칙) 비교하지 않는다
    s.sig_version = SIG_VERSION - 1
    db.commit()
    g = duplicate_files.duplicate_list(db, category="model")["items"][0]
    assert g["files"][1]["compare"] is None and g["same_model"] is False
