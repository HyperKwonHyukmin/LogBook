"""2026-11-18 — 'post' 로 찾으면 권상 자료 28건이 함께 나왔다(145 실측: 맞은 파일 34개 중 25개가 …_posture.json).

파일 이름은 부분 일치로 찾는데, WorkBench 권상 자료에 딸려 오는 보조 파일(종류 '기타' — posture.json 등)의 이름이
낱말 안에서 걸렸다. 규칙: 보조 파일(json·csv) 이름 적중은 자료(문서) 보기 결과에 올리지 않고, 파일 보기에서만 찾는다.
모델·보고서·도면·결과 파일의 이름은 그대로 부분 일치(sidepass → sidepassage).
자료 보기 행에는 이름이 맞은 파일을 `matched_files` 로 싣는다(화면이 '파일 이름: …' 으로 왜 맞았는지 보인다)."""
from app.access import SYSTEM
from app.search import SearchQuery, get_search


def test_sidecar_file_name_does_not_pull_entry(db, make_entry_file):
    lift, _ = make_entry_file(title="3592 · 기타 · Unit · M11", name="3592_M11.bdf", kind="model")
    make_entry_file(entry=lift, name="3592_M11_posture.json", kind="other")
    post, _ = make_entry_file(title="3105 · 2 Signal post", name="3105_Signal_post_R1.bdf", kind="model")

    res = get_search().search(db, SearchQuery(q="post", user=SYSTEM))
    assert [i["entry_id"] for i in res["items"]] == [post.entry_id]

    # 파일 보기에서는 보조 파일도 그대로 찾는다
    files = get_search().search(db, SearchQuery(q="posture", unit="file", user=SYSTEM))
    assert [i["name"] for i in files["items"]] == ["3592_M11_posture.json"]


def test_model_file_name_still_partial_and_reported(db, make_entry_file):
    e, _ = make_entry_file(title="권상 검토", name="3515_sidepassage.bdf", kind="model")
    make_entry_file(entry=e, name="결과정리.pptx", kind="report")

    res = get_search().search(db, SearchQuery(q="sidepass", user=SYSTEM))
    [item] = res["items"]
    assert item["entry_id"] == e.entry_id and item["matched"] == ["file"]
    assert item["matched_files"] == ["3515_sidepassage.bdf"]


def test_title_match_has_no_matched_files(db, make_entry_file):
    e, _ = make_entry_file(title="Signal post 경량화", name="a.bdf", kind="model")
    [item] = get_search().search(db, SearchQuery(q="Signal", user=SYSTEM))["items"]
    assert item["entry_id"] == e.entry_id and item["matched_files"] == []


def test_other_kind_model_name_still_pulls_entry(db, make_entry_file):
    """종류 'other' 라도 보조 파일(json·csv)이 아니면 자료 보기에서 찾는다(HyperMesh .hm 등 — 커밋 전 리뷰)."""
    e, _ = make_entry_file(title="데크 보강 검토", name="3592_deck_rev2.hm", kind="other")
    [item] = get_search().search(db, SearchQuery(q="deck_rev2", user=SYSTEM))["items"]
    assert item["entry_id"] == e.entry_id and item["matched_files"] == ["3592_deck_rev2.hm"]


def test_abaqus_input_name_still_pulls_entry(db, make_entry_file):
    """Abaqus 입력(.inp)은 종류가 'other' 지만 해석 모델이다(61) — 보조 파일처럼 빼지 않는다."""
    e, _ = make_entry_file(title="PSD 강도", name="8004_3000_PSD_2D.inp", kind="other")
    [item] = get_search().search(db, SearchQuery(q="3000_PSD", user=SYSTEM))["items"]
    assert item["entry_id"] == e.entry_id and item["matched_files"] == ["8004_3000_PSD_2D.inp"]
