from app import models


def test_suggest_hull_zone_analysis_type(client, db, make_user, auth_headers):
    make_user("A100001")
    db.add_all([models.Hull(hull_no="9999"), models.Hull(hull_no="9998"), models.Hull(hull_no="1234"),
                models.Tag(kind="zone", value="Engine Room"), models.Tag(kind="zone", value="Deck House"),
                models.Entry(title="t", status="confirmed", entry_id="E000001", analysis_type="피로")])
    db.commit()
    h = auth_headers("A100001")
    assert client.get("/api/suggest", params={"kind": "hull", "q": "99"}, headers=h).json() == ["9998", "9999"]
    assert client.get("/api/suggest", params={"kind": "zone", "q": "engine"}, headers=h).json() == ["Engine Room"]
    assert client.get("/api/suggest", params={"kind": "analysis_type", "q": ""}, headers=h).json() == ["피로"]
    assert client.get("/api/suggest", params={"kind": "bad"}, headers=h).status_code == 422
