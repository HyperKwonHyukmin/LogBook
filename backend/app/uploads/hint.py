"""56 — 올리는 폴더 이름에서 비슷한 기존 자료를 찾아 그 구역·대상을 기본값으로 준다.

예: `6_Rudder` 를 올리면 이미 있는 Rudder 자료(제목·대상·구역·태그에 'rudder')의 구역·대상을 공통 분류에 미리 넣는다.
사람이 폴더 올리기 창·정리 대기 카드에서 보고 고친다(2026-11-06 사용자 요청).

- 낱말: 폴더·파일 이름을 낱말로 나눠, 숫자·호선 번호·날짜·사번·흔한 말(구조·해석·강도·평가·rev·doc 등)은 뺀다.
- 비교 대상: 내가 볼 수 있는 확정 자료의 제목 + 구역·대상·자유 태그(동의어 포함) 낱말. 구역·대상이 없는 자료는 줄 것이 없어 뺀다.
- 겹치는 낱말이 가장 많은 자료, 같으면 최근에 확정된 자료. 겹치는 낱말이 없으면 None — 엉뚱한 값보다 빈칸이 낫다.
- 담당자는 가져오지 않는다(같은 대상이라도 이번에 맡은 사람은 다르다).
- 초안마다 따로 찾는다(ingest.process): 하위 폴더마다 나눠 올리면 `5_Rudder_3143`·`Manifold_support` 가 각자 맞는 자료를 찾는다.
  폴더 창에서 사람이 고른 공통 분류가 있으면 그것이 먼저다."""
import os

from sqlalchemy.orm import Session

from .. import access, models
from ..entries import naming

# batches.preset 의 표시 — SKIP_KEY: 사람이 비워 보냄(자동 채움 안 함), HINTS_KEY: {초안 번호: 기본값을 가져온 자료 번호}
SKIP_KEY = "skip_hint"
HINTS_KEY = "hints"
CANDIDATE_LIMIT = 2000   # 최근 확정 자료부터 이만큼만 본다(entries.quality.similar_entries 와 같은 상한)
TEXTS_MAX = 50

# 거의 모든 해석 자료 이름에 들어가 무엇인지 가르지 못하는 말(소문자)
GENERIC = frozenset({
    "구조", "해석", "구조해석", "강도", "평가", "강도평가", "검토", "보고서", "표준화", "자료", "계산", "결과", "모델",
    "도면", "문서", "참고", "수정", "보완", "초안", "작업", "요청", "회신", "호선",
    "structure", "structural", "analysis", "strength", "assessment", "report", "result", "results", "model",
    "models", "doc", "docs", "document", "drawing", "dwg", "calc", "calculation", "fe", "fem", "fea", "check",
    "review", "draft", "rev", "ver", "pdf", "bdf", "dat", "xlsx", "xls", "pptx", "docx", "hwp", "zip",
    "nastran", "patran", "femap", "abaqus", "the", "and", "for", "of",
})


def _useful(word: str) -> bool:
    w = word.casefold()
    if len(w) < 2 or w.isdigit() or w in GENERIC or w in naming.NOISE:
        return False
    if naming._HULL_TOKEN.match(w) or naming._DATE.match(w) or naming._EMPLOYEE.match(w):
        return False
    # 판 표기(rev0·r1·v2)
    if w[0] in "rv" and w[1:].isdigit() or w.startswith("rev") and w[3:].isdigit():
        return False
    return True


def words_of(texts) -> set[str]:
    out: set[str] = set()
    for t in texts or []:
        stem, ext = os.path.splitext(str(t or ""))
        base = stem if ext and len(ext) <= 6 and " " not in ext else str(t or "")
        out |= {w.casefold() for w in naming.WORD.findall(base) if _useful(w)}
    return out


def similar_preset(db: Session, user: models.User, texts) -> dict | None:
    """texts(폴더 이름·파일 이름)와 낱말이 겹치는 기존 확정 자료의 {zones, target, from_entry, from_title}. 없으면 None."""
    mine = words_of(list(texts or [])[:TEXTS_MAX])
    if not mine:
        return None
    entries = (db.query(models.Entry)
               .filter(models.Entry.status == "confirmed", access.visible_entries_filter(user))
               .order_by(models.Entry.confirmed_at.desc(), models.Entry.id.desc())
               .limit(CANDIDATE_LIMIT).all())
    if not entries:
        return None
    ids = [e.id for e in entries]
    tag_rows = (db.query(models.EntryTag.entry_id, models.Tag)
                .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                .filter(models.EntryTag.entry_id.in_(ids), models.Tag.kind.in_(("zone", "target", "free"))).all())
    # 동의어(alias) — 'Rudder' 자료가 '러더' 로 올라와도 찾게, 자료에 붙은 태그의 동의어 이름도 낱말에 넣는다
    tag_ids = {t.id for _e, t in tag_rows}
    aliases: dict[int, list[str]] = {}
    if tag_ids:
        for a in db.query(models.Tag).filter(models.Tag.alias_of_id.in_(tag_ids)):
            aliases.setdefault(a.alias_of_id, []).append(a.value)
    per_entry: dict[int, dict] = {}
    for eid, t in tag_rows:
        d = per_entry.setdefault(eid, {"zones": [], "target": None, "words": set()})
        if t.kind == "zone":
            d["zones"].append(t.value)
        elif t.kind == "target" and d["target"] is None:
            d["target"] = t.value
        d["words"] |= words_of([t.value, *aliases.get(t.id, [])])
    best = None
    for rank, e in enumerate(entries):
        d = per_entry.get(e.id)
        if d is None or not (d["zones"] or d["target"]):
            continue
        score = len(mine & (d["words"] | words_of([e.title, e.title_source])))
        # entries 는 최근 확정 순 — 점수가 같으면 앞(최근) 것이 남는다
        if score and (best is None or score > best[0]):
            best = (score, rank, e, d)
    if best is None:
        return None
    _s, _r, e, d = best
    out = {"zones": sorted(d["zones"]), "target": d["target"]}
    return {**{k: v for k, v in out.items() if v}, "from_entry": e.entry_id, "from_title": e.title}
