"""32 — 보고서 판(한 자료 안 보고서 파일의 판 순서)과 자료 사이 보고서 관계.

모델 판(14)과 같은 이름 규칙(naming.name_info — `_r1`·`Rev.A`·날짜·`최종`·`R1/` 폴더)으로 계열을 만들고,
이름으로 짝이 없는 보고서는 **본문 겹침**(22 색인 조각의 MinHash 자카드, report_index.features)이 TEXT_REV_MIN 이상인
보고서의 계열에 붙인다(모델의 형상 서명·ID 자카드 자리). 같은 종류 문서끼리만(PDF·DOCX ↔ PPT ↔ XLSX 를 섞지 않는다 —
같은 내용의 발표자료는 판이 아니다).

저장하지 않는다(사용자 정리 없음 — 자동 추정만). 요청마다 파일 행 + 색인 특징으로 계산한다.
권한·현재성: 부르는 쪽이 볼 수 있는 자료만 넘기고, 색인 특징은 '현재'(등록 SHA·경로·자료가 색인과 같음)일 때만 쓴다.
"""
from collections import defaultdict

from .. import models
from ..report_index import features as rf
from ..report_index.search import current_document
from .naming import name_info
from .series import Item, auto_groups, auto_labels

TEXT_REV_MIN = 0.5        # 같은 자료 안 — 이름으로 짝이 없는 두 보고서를 판으로 묶는 본문 겹침
CROSS_TEXT_MIN = 0.6      # 다른 자료 사이 — 본문만으로 '같은 보고서의 다른 판'으로 보는 겹침(양식만 같은 보고서는 0.2~0.4)
CROSS_NAME_TEXT_MIN = 0.3 # 다른 자료 사이 — 이름 계열이 같을 때 함께 요구하는 겹침(본문 색인이 있을 때)
NAME_BASE_MIN = 6         # 본문 색인이 없을 때 이름만으로 잇는 최소 줄기 길이('보고서'·'report' 같은 흔한 이름 제외)

_FAMILY = {".pdf": "doc", ".doc": "doc", ".docx": "doc", ".hwp": "doc", ".hwpx": "doc",
           ".ppt": "slide", ".pptx": "slide", ".xls": "sheet", ".xlsx": "sheet", ".xlsm": "sheet"}


def family(ext: str | None) -> str:
    return _FAMILY.get((ext or "").lower(), "other")


def report_files(db, entry_pks) -> dict[int, list[models.File]]:
    """자료 pk → 휴지통 밖 보고서 파일(id 순)."""
    pks = [p for p in set(entry_pks) if p]
    out: dict[int, list[models.File]] = defaultdict(list)
    if not pks:
        return out
    for f in (db.query(models.File)
              .filter(models.File.entry_id.in_(pks), models.File.kind == "report", models.File.location != "trash")
              .order_by(models.File.id)):
        out[f.entry_id].append(f)
    return out


def current_features(store, files_by_entry: dict[int, list], entries: dict[int, object]) -> dict[int, rf.Feature]:
    """색인이 '현재'인 보고서의 특징만. 색인을 열 수 없으면 빈 사전(이름 규칙만으로 동작한다)."""
    if store is None:
        return {}
    all_files = [f for fs in files_by_entry.values() for f in fs]
    try:
        docs = store.document_rows([f.id for f in all_files])
        ok = [f.id for f in all_files
              if (d := docs.get(f.id)) is not None and current_document(d, f, entries[f.entry_id])]
        return rf.features(store, ok)
    except Exception:  # noqa: BLE001 — 색인 장애가 지도·자료 화면을 깨뜨리지 않게
        import logging
        logging.getLogger(__name__).warning("보고서 본문 특징을 읽지 못했습니다", exc_info=True)
        return {}


def _items(files) -> list[Item]:
    return [Item(id=f.id, rel_path=f.rel_path, name=f.name, created_at=f.created_at, sig=None,
                 info=name_info(f.rel_path)) for f in files]


def entry_series(files: list, feats: dict[int, rf.Feature]) -> list[dict]:
    """한 자료의 보고서 계열(판 2개 이상) — [{key, items: [{file_id, name, display, mark, is_latest}], steps: [...]}].
    steps[i] = items[i] → items[i+1] 의 쪽 변화(page_changes, 색인이 없으면 None)."""
    if len(files) < 2:
        return []
    ext = {f.id: f.ext for f in files}
    overlaps: dict[frozenset, float] = {}
    ids = [f.id for f in files]
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if family(ext[a]) != family(ext[b]):
                continue
            j = rf.jaccard(feats.get(a), feats.get(b))
            if j is not None and j >= TEXT_REV_MIN:
                overlaps[frozenset((a, b))] = j
    out = []
    for key, its in auto_groups(_items(files), overlaps):
        if key is None:
            continue
        labels = auto_labels(its)
        items = [{"file_id": it.id, "name": it.name, "display": lab, "mark": it.info.marks.text or None,
                  "is_latest": i == len(its) - 1} for i, (it, lab) in enumerate(zip(its, labels))]
        steps = [rf.page_changes(feats.get(a.id), feats.get(b.id)) for a, b in zip(its, its[1:])]
        out.append({"key": key, "items": items, "steps": steps})
    return sorted(out, key=lambda s: s["items"][0]["name"].casefold())


def cross_pairs(files_by_entry: dict[int, list], feats: dict[int, rf.Feature]) -> dict[tuple[int, int], dict]:
    """다른 자료 사이 '같은 보고서의 다른 판' — {(자료 pk a, b): {files: [이름 a, 이름 b], score, count}} (a < b).
    ① 이름 계열 열쇠가 같고(판 표시 뗀 줄기 + 폴더) 본문 겹침 ≥ CROSS_NAME_TEXT_MIN — 본문 색인이 없으면 줄기가 충분히 길고
       한쪽이라도 판 표시가 있을 때만. ② 이름이 달라도 본문 겹침 ≥ CROSS_TEXT_MIN."""
    by_id = {f.id: f for fs in files_by_entry.values() for f in fs}
    info = {fid: name_info(f.rel_path.rsplit("/", 1)[-1]) for fid, f in by_id.items()}   # 자료마다 폴더가 달라 이름만
    out: dict[tuple[int, int], dict] = {}
    seen: set[frozenset] = set()

    def put(a, b, score):
        if frozenset((a, b)) in seen:
            return
        seen.add(frozenset((a, b)))
        fa, fb = by_id[a], by_id[b]
        if fa.entry_id == fb.entry_id or family(fa.ext) != family(fb.ext):
            return
        if fa.entry_id > fb.entry_id:
            fa, fb = fb, fa
        p = out.setdefault((fa.entry_id, fb.entry_id), {"files": [fa.name, fb.name], "score": score, "count": 0})
        p["count"] += 1
        if (score or 0) > (p["score"] or 0):
            p.update(files=[fa.name, fb.name], score=score)

    by_key: dict[str, list[int]] = defaultdict(list)
    for fid, ni in info.items():
        if ni.base:
            by_key[ni.key].append(fid)
    for fids in by_key.values():
        if len({by_id[f].entry_id for f in fids}) < 2:
            continue
        fids = fids[:rf.BAND_GROUP]
        for i, a in enumerate(fids):
            for b in fids[i + 1:]:
                j = rf.jaccard(feats.get(a), feats.get(b))
                if j is not None:
                    if j >= CROSS_NAME_TEXT_MIN:
                        put(a, b, j)
                elif len(info[a].base) >= NAME_BASE_MIN and not (info[a].marks.empty and info[b].marks.empty):
                    put(a, b, None)
    for key, score in rf.text_pairs(feats, CROSS_TEXT_MIN).items():
        a, b = sorted(key)
        if a in by_id and b in by_id:
            put(a, b, score)
    return out

