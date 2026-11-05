"""52 — 폴더째 올리기: 과제 폴더마다 초안 1건(split_top), 올리기 전 공통 분류(preset), 처음에 체크를 풀 형식 규칙."""
import pytest

from app import models
from app.entries import service as entry_service
from app.ingest.process import process_batch
from app.ingest.proposal import FileInfo, propose

# 2026-11-05 조사한 실제 폴더 구성(…\과거 과제 자료\2025) 일부
TREE_2025 = [
    "2025/closed_chock/보고서_Closed chock 강도해석을 통한 SWL 상향 적용 건_R1.pdf",
    "2025/closed_chock/Result_M1_90ton/M1_Chock_400x250x428_90ton.bdf",
    "2025/closed_chock/Result_M1_92ton/Original/M1_Chock_400x250x428_92ton.bdf",
    "2025/closed_chock/Result_M1_92ton/Revision/M1_Chock_400x250x428_92ton_R1.bdf",
    "2025/manifold_support_8182/doc/report.pdf",
    "2025/manifold_support_8182/fe_model/model.bdf",
]


def _infos(paths):
    return [FileInfo(key=i, rel_path=p) for i, p in enumerate(paths)]


def test_without_split_two_projects_merge_into_one():
    """지금까지의 동작 — 맨 위 이름 하나로 묶여 두 과제가 섞인다(52 를 만든 이유)."""
    [p] = propose(_infos(TREE_2025), {"8182"})
    assert len(p.file_keys) == 6


def test_split_top_makes_one_draft_per_project_folder():
    props = propose(_infos(TREE_2025), {"8182"}, split_top=True)
    assert [(p.title, len(p.file_keys)) for p in props] == [("closed chock", 4), ("manifold support 8182", 2)]
    assert props[1].best_hull == "8182"   # 호선 후보 찾기는 그대로
    assert props[0].best_hull is None      # 고른 폴더 이름(연도 2025)은 호선 후보가 아니다


def test_split_top_loose_files_under_root_use_root_name():
    props = propose(_infos(["2025/메모.xlsx", "2025/a/x.bdf"]), set(), split_top=True)
    assert sorted((p.title, len(p.file_keys)) for p in props) == [("2025", 1), ("a", 1)]


def test_split_top_ignored_for_workbench_single():
    [p] = propose(_infos(TREE_2025), set(), single=True, split_top=True)
    assert len(p.file_keys) == 6


def test_rules_endpoint(client, make_user, auth_headers):
    make_user("A100001")
    r = client.get("/api/uploads/rules", headers=auth_headers("A100001"))
    assert r.status_code == 200
    body = r.json()
    assert ".op2" in body["skip_by_default"] and ".mvw" in body["skip_by_default"]
    assert ".xlsm" not in body["skip_by_default"] and ".f06" not in body["skip_by_default"]
    assert "~$*" in body["excluded_patterns"]


def _tag(db, value, kind):
    db.add(models.Tag(kind=kind, value=value, listed=True))
    db.commit()


def test_begin_stores_cleaned_preset(client, db, make_user, auth_headers):
    make_user("A100001")
    _tag(db, "선수부", "zone")
    _tag(db, "Closed chock", "target")
    person = models.Person(name="김미희")
    db.add(person)
    db.commit()
    r = client.post("/api/uploads", headers=auth_headers("A100001"), json={
        "name": "2025", "split_top": True,
        "preset": {"zones": ["선수부"], "target": "closed chock", "assignees": [{"id": person.id}]}})
    assert r.status_code == 201, r.text
    db.expire_all()
    b = db.query(models.Batch).filter_by(key=r.json()["key"]).one()
    assert b.split_top is True
    assert b.preset == {"zones": ["선수부"], "target": "Closed chock", "assignees": [person.id]}


def test_begin_rejects_unlisted_zone_for_non_admin(client, db, make_user, auth_headers):
    make_user("A100001")
    _tag(db, "선수부", "zone")   # 목록이 비어 있으면 누구나 새 값을 넣을 수 있다(vocab._allowed)
    r = client.post("/api/uploads", headers=auth_headers("A100001"),
                    json={"name": "x", "preset": {"zones": ["없는구역"]}})
    assert r.status_code == 422


def test_empty_preset_stored_as_none(client, db, make_user, auth_headers):
    make_user("A100001")
    r = client.post("/api/uploads", headers=auth_headers("A100001"),
                    json={"name": "x", "preset": {"zones": [], "target": "", "assignees": []}})
    db.expire_all()
    assert db.query(models.Batch).filter_by(key=r.json()["key"]).one().preset is None


def _write(path, data=b"GRID"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_process_applies_preset_to_every_draft(db, storage):
    _tag(db, "선수부", "zone")
    _tag(db, "Closed chock", "target")
    person = models.Person(name="김미희")
    db.add(person)
    db.commit()
    b = models.Batch(key="20261105-000000-aaaa", source="web", original_name="2025", uploader="A476854",
                     split_top=True, preset={"zones": ["선수부"], "target": "Closed chock", "assignees": [person.id]})
    db.add(b)
    db.commit()
    root = storage.staging / b.key / "2025"
    _write(root / "closed_chock" / "Result_M1_90ton" / "m1.bdf", b"GRID 1")
    _write(root / "closed_chock" / "보고서.pdf", b"%PDF")
    _write(root / "manifold_support" / "fe_model" / "model.bdf", b"GRID 2")
    process_batch(db, storage, b)
    db.expire_all()
    entries = db.query(models.Entry).order_by(models.Entry.id).all()
    assert len(entries) == 2
    for e in entries:
        d = entry_service.entry_to_dict(db, e)
        assert d["zones"] == ["선수부"] and d["target"] == "Closed chock"
        assert [a["name"] for a in d["assignees"]] == ["김미희"]
    # 구역·대상이 들어가면 제목 초안도 그 형식(사람이 고치지 않은 초안 그대로로 남는다)
    assert all("Closed chock" in e.title for e in entries), [e.title for e in entries]


@pytest.mark.parametrize("split", [False, True])
def test_target_entry_upload_ignores_preset_and_split(client, db, make_user, auth_headers, split):
    """기존 자료에 파일 추가는 그 자료의 분류를 따른다 — 공통 분류·나누기를 저장하지 않는다."""
    make_user("A100001")
    e = models.Entry(title="t", status="draft", uploaded_by="A100001")
    db.add(e)
    db.flush()
    e.entry_id = f"E{e.id:06d}"
    db.commit()
    r = client.post("/api/uploads", headers=auth_headers("A100001"), json={
        "name": "x", "target_entry_id": e.entry_id, "split_top": split, "preset": {"zones": ["선수부"]}})
    assert r.status_code == 201, r.text
    db.expire_all()
    b = db.query(models.Batch).filter_by(key=r.json()["key"]).one()
    assert b.preset is None and b.split_top is False


def test_blocked_models_follow_project_folder_when_split(db):
    """과제 폴더마다 나눈 묶음에서 '이미 있는 BDF' 는 그 BDF 가 든 과제 폴더의 초안에만 보인다."""
    b = models.Batch(key="20261105-000000-bbbb", source="web", original_name="2025", uploader="A476854",
                     split_top=True, excluded=[{"name": "2025/a/x.bdf", "size": 4, "reason": "duplicate_model",
                                                "same_as_files": []}])
    db.add(b)
    db.flush()
    drafts = []
    for sub in ("a", "b"):
        e = models.Entry(title=sub, status="draft", batch_id=b.id, uploaded_by="A476854")
        db.add(e)
        db.flush()
        f = models.File(batch_id=b.id, entry_id=e.id, rel_path=f"2025/{sub}/m.bdf", name="m.bdf", ext=".bdf",
                        kind="model", size=4, sha256=sub * 64, location="staging")
        db.add(f)
        db.flush()
        drafts.append((e, [f]))
    db.commit()
    got = [len(entry_service.blocked_models(db, e, fs, None)) for e, fs in drafts]
    assert got == [1, 0]
