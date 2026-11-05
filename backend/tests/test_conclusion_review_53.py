"""53 — 자료의 결론 한 줄·주의점·검토 서명(LV2 이상, 작성자 본인 제외, 결론·주의점이 바뀌면 자동으로 풀림)."""
import json

import pytest

from app import models
from app.entries.files import entry_dir, write_entry_files

OWNER, LV1, LV2, LV2B, LV3 = "U520001", "G520001", "M520001", "M520002", "A520001"


@pytest.fixture
def users(make_user):
    make_user(OWNER, name="작성자", level=2)
    make_user(LV1, name="게스트", level=1)
    make_user(LV2, name="검토자", level=2)
    make_user(LV2B, name="다른사람", level=2)
    make_user(LV3, name="관리자", level=3)


@pytest.fixture
def entry(users, make_entry_file, db):
    e, _f = make_entry_file(title="계류 검토", hulls=("9999",), name="r.pdf", uploaded_by=OWNER)
    e.access = "shared"   # LV1 도 볼 수 있게(서명 권한만 따로 본다)
    db.commit()
    return e


def _cur(client, h, entry):
    return client.get(f"/api/entries/{entry.entry_id}", headers=h).json()


def _patch(client, h, entry, body):
    return client.patch(f"/api/entries/{entry.entry_id}", json={"version": _cur(client, h, entry)["version"], **body},
                        headers=h)


def test_conclusion_and_caveats_saved_audited_and_written(entry, client, auth_headers, db, storage):
    ho = auth_headers(OWNER)
    r = _patch(client, ho, entry, {"conclusion": "  선미 계류 하중으로 모델이 수렴한다 ", "caveats": "Lug 는 강체로 단순화"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["conclusion"] == "선미 계류 하중으로 모델이 수렴한다" and body["caveats"] == "Lug 는 강체로 단순화"
    assert body["review"] is None and body["can_review"] is False   # 작성자 본인은 서명하지 못한다
    db.expire_all()
    row = db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=entry.entry_id).one()
    assert row.after["conclusion"] == "선미 계류 하중으로 모델이 수렴한다" and "conclusion" not in row.before
    meta = json.loads((entry_dir(storage, entry) / "entry.json").read_text(encoding="utf-8"))
    assert meta["conclusion"] == "선미 계류 하중으로 모델이 수렴한다" and meta["caveats"] == "Lug 는 강체로 단순화"
    assert _patch(client, ho, entry, {"conclusion": "가" * 301}).status_code == 422
    # 남(LV2)은 고칠 수 없다 — 기존 규칙(작성자·LV3)
    assert _patch(client, auth_headers(LV2), entry, {"conclusion": "x"}).status_code == 403


def test_review_rules(entry, client, auth_headers, db, make_entry_file):
    url = f"/api/entries/{entry.entry_id}/review"
    h2 = auth_headers(LV2)
    assert client.post(url, headers=h2).json()["detail"] == "conclusion_required"   # 결론이 없으면 서명할 것이 없다
    _patch(client, auth_headers(OWNER), entry, {"conclusion": "모델이 수렴한다"})
    assert client.post(url, headers=auth_headers(OWNER)).json()["detail"] == "own_entry"
    assert client.post(url, headers=auth_headers(LV1)).json()["detail"] == "level2_required"
    r = client.post(url, headers=h2)
    assert r.status_code == 200, r.text
    rev = r.json()["review"]
    assert rev["by"] == LV2 and rev["name"] == "검토자" and rev["at"]
    assert r.json()["can_unreview"] is True
    db.expire_all()
    assert db.query(models.AuditLog).filter_by(action="ENTRY_REVIEW", target_id=entry.entry_id).count() == 1
    # 취소 — 남(LV2) 은 못 하고, 서명한 사람·LV3 는 된다
    assert client.delete(url, headers=auth_headers(LV2B)).status_code == 403
    assert client.delete(url, headers=h2).json()["review"] is None
    client.post(url, headers=h2)
    assert client.delete(url, headers=auth_headers(LV3)).json()["review"] is None
    db.expire_all()
    assert db.query(models.AuditLog).filter_by(action="ENTRY_REVIEW_CANCEL", target_id=entry.entry_id).count() == 2
    # 초안은 서명하지 않는다
    d, _ = make_entry_file(title="초안", status="draft", uploaded_by=OWNER)
    d.conclusion = "x"
    db.commit()
    assert client.post(f"/api/entries/{d.entry_id}/review", headers=h2).json()["detail"] == "not_confirmed"


def test_review_cleared_when_conclusion_or_caveats_change(entry, client, auth_headers, db, storage):
    ho, h2 = auth_headers(OWNER), auth_headers(LV2)
    _patch(client, ho, entry, {"conclusion": "수렴한다"})
    client.post(f"/api/entries/{entry.entry_id}/review", headers=h2)
    # 분류만 바꾸면 서명은 그대로
    assert _patch(client, ho, entry, {"tags": ["Lashing"]}).json()["review"]["by"] == LV2
    meta = json.loads((entry_dir(storage, entry) / "entry.json").read_text(encoding="utf-8"))
    assert meta["reviewed_by"] == LV2 and meta["reviewed_at"]
    # 같은 값으로 저장해도 그대로
    assert _patch(client, ho, entry, {"conclusion": "수렴한다 "}).json()["review"]["by"] == LV2
    r = _patch(client, ho, entry, {"caveats": "새 주의점"})
    assert r.json()["review"] is None
    db.expire_all()
    row = (db.query(models.AuditLog).filter_by(action="ENTRY_UPDATE", target_id=entry.entry_id)
           .order_by(models.AuditLog.id.desc()).first())
    assert row.before["reviewed_by"] == "검토자" and "reviewed_by" not in row.after   # 이력에 풀림이 남는다


def test_search_scores_and_returns_conclusion(entry, client, auth_headers):
    ho = auth_headers(OWNER)
    _patch(client, ho, entry, {"conclusion": "선미 Bitt 보강 후 수렴", "caveats": "피로는 보지 않음"})
    client.post(f"/api/entries/{entry.entry_id}/review", headers=auth_headers(LV2))
    items = client.get("/api/search", params={"q": "Bitt"}, headers=ho).json()["items"]
    hit = [x for x in items if x["entry_id"] == entry.entry_id]
    assert hit and "conclusion" in hit[0]["matched"]
    assert hit[0]["conclusion"] == "선미 Bitt 보강 후 수렴" and hit[0]["reviewed"] is True
    items = client.get("/api/search", params={"q": "피로는"}, headers=ho).json()["items"]
    assert any(x["entry_id"] == entry.entry_id and "caveats" in x["matched"] for x in items)


def test_split_carries_conclusion(db, make_user, setup_entry_with_files):
    from app.entries import service

    make_user(OWNER, level=2)
    _b, e = setup_entry_with_files(uploader=OWNER)
    e.conclusion, e.caveats = "수렴", "단순화"
    db.commit()
    owner = db.query(models.User).filter_by(employee_id=OWNER).one()
    fid = db.query(models.File).filter_by(entry_id=e.id).first().id
    new = service.split(db, e, owner, [fid])
    assert (new.conclusion, new.caveats) == ("수렴", "단순화")


def test_rebuild_restores_conclusion_and_review(entry, db, storage):
    from datetime import datetime

    from app import database
    from app.ops.rebuild import rebuild

    eid = entry.entry_id
    entry.conclusion, entry.caveats = "수렴한다", "강체 단순화"
    entry.reviewed_by, entry.reviewed_at = LV2, datetime(2026, 11, 5, 10, 0, 0)
    db.commit()
    write_entry_files(db, storage, entry)
    db.rollback()
    database.Base.metadata.drop_all(database.engine)
    database.Base.metadata.create_all(database.engine)
    db.expunge_all()
    rebuild(db, storage)
    a = db.query(models.Entry).filter_by(entry_id=eid).one()
    assert (a.conclusion, a.caveats, a.reviewed_by, a.reviewed_at) == (
        "수렴한다", "강체 단순화", LV2, datetime(2026, 11, 5, 10, 0, 0))
