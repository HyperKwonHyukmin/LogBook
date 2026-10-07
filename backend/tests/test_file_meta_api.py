"""04b — 파일 메타 API(전체 화면 뷰어 머리줄용)."""


def test_file_meta(client, db, make_user, auth_headers, make_entry_file):
    make_user("A100001")
    h = auth_headers("A100001")
    e, f = make_entry_file(title="모델 검토", name="sub/m.bdf", kind="model")
    d = client.get(f"/api/files/{f.id}", headers=h).json()
    assert d == {"id": f.id, "name": "m.bdf", "rel_path": "sub/m.bdf", "kind": "model", "size": 10,
                 "entry_id": e.entry_id, "entry_title": "모델 검토", "entry_status": "confirmed",
                 "drm_encrypted": False, "format_version": None}   # 04c — 변환 결과가 없으면 None
    assert client.get(f"/api/files/{f.id}").status_code == 401
    assert client.get("/api/files/999999", headers=h).status_code == 404
