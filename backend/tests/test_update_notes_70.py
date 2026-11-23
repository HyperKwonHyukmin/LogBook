"""70 업데이트 안내 — 목록과 한 건(로그인한 누구나), 그림(로그인 없이), notes.json 모양."""
import json

from app.routers.update_notes import DATA, IMG_DIR, NOTE_ID, load_notes

KINDS = {"새 기능", "개선", "고침"}


def test_list_and_detail_need_login_any_level(client, make_user, auth_headers):
    make_user("G700001", level=1)
    assert client.get("/api/update-notes").status_code == 401
    items = client.get("/api/update-notes", headers=auth_headers("G700001")).json()["items"]
    assert items and set(items[0]) == {"id", "date", "kind", "title", "summary"}
    first = items[0]["id"]
    assert client.get(f"/api/update-notes/{first}").status_code == 401
    note = client.get(f"/api/update-notes/{first}", headers=auth_headers("G700001")).json()
    assert note["id"] == first and note["sections"]
    r = client.get("/api/update-notes/no-such-note", headers=auth_headers("G700001"))
    assert r.status_code == 404 and r.json()["detail"] == "note_not_found"


def test_image_public_and_safe(client):
    name = next(p.name for p in IMG_DIR.iterdir() if p.is_file())
    r = client.get(f"/api/update-notes/img/{name}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/")
    for bad in ("..%2Fnotes.json", "notes.json", "x.exe", "nope.png"):
        assert client.get(f"/api/update-notes/img/{bad}").status_code == 404


def test_load_skips_bad_items_and_sorts(tmp_path):
    p = tmp_path / "n.json"
    p.write_text(json.dumps({"items": [
        {"id": "a-old", "date": "2026-01-01", "title": "옛"},
        {"id": "Bad Id", "date": "2026-02-01", "title": "x"},
        {"id": "no-date", "title": "x"},
        {"id": "b-new", "date": "2026-03-01", "title": "새"},
        {"id": "b-new", "date": "2026-03-02", "title": "겹침"},
        {"id": "no-title", "date": "2026-03-03", "title": " "},
    ]}), encoding="utf-8")
    assert [i["id"] for i in load_notes(p)] == ["b-new", "a-old"]
    assert load_notes(tmp_path / "없음.json") == []


def _texts(it):
    yield it["title"]
    yield it.get("summary") or ""
    for link in it.get("links") or []:
        yield link["label"]
    for s in it.get("sections") or []:
        yield s.get("heading") or ""
        yield s.get("note") or ""
        yield from s.get("body") or []
        yield from s.get("points") or []
        yield from s.get("steps") or []
        for f in s.get("facts") or []:
            yield f["label"]
            yield f["text"]
        for img in ([s["image"]] if s.get("image") else []) + (s.get("images") or []):
            yield img.get("alt") or ""
            yield img.get("caption") or ""


def test_data_shape():
    """파일 순서는 최근 것이 앞, id 는 겹치지 않고 규칙대로, 그림 파일이 있고, 링크는 앱 안 경로.
    화면 문구에 가운뎃점(사용자 지시 2026-11-12)과 em dash(DESIGN.md)를 쓰지 않는다."""
    items = json.loads(DATA.read_text(encoding="utf-8"))["items"]
    assert [i["date"] for i in items] == sorted((i["date"] for i in items), reverse=True)
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids)) and all(NOTE_ID.match(i) for i in ids)
    assert len(load_notes()) == len(items)          # 형식에서 빠지는 안내가 없다
    for it in items:
        assert it["kind"] in KINDS and it["summary"], it["id"]
        for link in it.get("links") or []:
            assert link["path"].startswith("/") and not link["path"].startswith("//"), it["id"]
        for s in it.get("sections") or []:
            for img in ([s["image"]] if s.get("image") else []) + (s.get("images") or []):
                assert (IMG_DIR / img["src"]).is_file() and img["alt"], img
        for t in _texts(it):
            assert "·" not in t and "—" not in t, (it["id"], t)
