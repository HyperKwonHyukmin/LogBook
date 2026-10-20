"""20 — 자료 필수 분류·제목 초안·비슷한 제목(DB 를 읽는 쪽). 순수 규칙은 naming.py.

필수 분류: BDF(kind=model 파일)가 있는 자료는 호선(또는 '호선 없음(공용)')·구역 또는 대상(40)을 채워야 한다.
40 — 위치 개념이 없는 모델(Unit·Truss·전선 모델)은 대상만 있어도 된다. 42 — 해석 종류는 없앴다(필수 칸 아님).
43 — 빈 칸이 있어도 확정은 막지 않는다(나중에 고치는 편이 쉬울 수 있다). BDF 없는 자료(보고서만 등)는 권하기만 한다.
확정된 자료의 빈 칸은 숨기거나 상태를 바꾸지 않고 '보완 필요'(needs_fix)로만 표시한다 —
관리 화면 '자료 정비'·CLI naming-cleanup 이 고칠 목록을 보여 준다.
"""
from sqlalchemy.orm import Session

from .. import access, models, vocab
from . import naming

# 확정을 막는 빠진 칸 이름(오류 응답 missing 과 화면이 같은 이름을 쓴다)
REQUIRED = ("hull", "zone_or_target")
SIMILAR_MIN = 0.6     # 비슷한 제목 경고(호선 번호를 뺀 낱말 겹침)
SIMILAR_LIMIT = 5


def has_model(db: Session, entry: models.Entry) -> bool:
    return db.query(models.File.id).filter(models.File.entry_id == entry.id, models.File.kind == "model",
                                           models.File.location != "trash").first() is not None


def missing_fields(*, has_bdf: bool, hulls, no_hull: bool, zones, target) -> list[str]:
    """빠진 필수 칸 — BDF 가 없으면 늘 빈 목록(권하기만 한다). 'hull' = 호선·'호선 없음(공용)' 모두 없음."""
    if not has_bdf:
        return []
    out = []
    if not list(hulls or []) and not no_hull:
        out.append("hull")
    if not list(zones or []) and not (target or "").strip():
        out.append("zone_or_target")
    return out


def missing_required(db: Session, entry: models.Entry) -> list[str]:
    from .service import hulls_of, target_of, zones_of

    return missing_fields(has_bdf=has_model(db, entry), hulls=[h.hull_no for h in hulls_of(db, entry)],
                          no_hull=bool(entry.no_hull), zones=zones_of(db, entry), target=target_of(db, entry))


class TitleContext:
    """제목 초안 계산에 쓰는 어휘 스냅숏(요청·명령 하나 동안). 많은 자료를 볼 때 한 번만 만든다."""

    def __init__(self, db: Session):
        self.db = db
        self.vocab = {k: vocab.Vocab(db, k) for k in vocab.KINDS}

    def phrases(self, kind: str, values) -> list[str]:
        """고른 값의 표기들 — 값 자체 + 그 값이 가리키는 용어와 용어의 동의어."""
        v = self.vocab[kind]
        out: list[str] = []
        for raw in values or []:
            if not raw:
                continue
            out.append(raw)
            term = v.target(raw)
            if term is not None:
                out.append(term.value)
                out.extend(s.value for s in v.synonyms(term))
        return out

    def source_of(self, entry: models.Entry) -> str:
        if entry.title_source:
            return entry.title_source
        rows = (self.db.query(models.File.rel_path, models.File.kind).filter(models.File.entry_id == entry.id)
                .order_by(models.File.rel_path).all())
        rows.sort(key=lambda r: r[1] != "model")   # BDF 를 앞에(안정 정렬 — 같은 종류는 경로 순)
        return naming.source_from_files([r for r, _k in rows])

    def draft(self, entry: models.Entry, *, hulls=None, no_hull=None, zones=None,
              target=None, source: str | None = None) -> str:
        """제목 초안 — 값을 안 주면 지금 저장된 값으로."""
        from .service import hulls_of, target_of, zones_of

        hulls = [h.hull_no for h in hulls_of(self.db, entry)] if hulls is None else list(hulls)
        zones = zones_of(self.db, entry) if zones is None else list(zones)
        no_hull = bool(entry.no_hull) if no_hull is None else bool(no_hull)
        source = self.source_of(entry) if source is None else source
        target = target_of(self.db, entry) if target is None else (target or None)
        phrases = self.phrases("zone", zones) + self.phrases("target", [target] if target else [])
        return naming.title_draft(source, hulls=hulls, no_hull=no_hull, zones=zones, target=target, phrases=phrases)

    def is_auto(self, entry: models.Entry) -> bool:
        """지금 제목이 사람이 고친 것이 아니라 초안 그대로인가(형식 초안 또는 예전 방식 이름)."""
        title = (entry.title or "").strip()
        if not title:
            return True
        source = self.source_of(entry)
        return title in (self.draft(entry, source=source), naming.legacy_title(source))


def similar_entries(db: Session, entry: models.Entry, viewer=None, *, title: str | None = None,
                    limit: int = SIMILAR_LIMIT) -> list[dict]:
    """같은 호선(공용 자료는 공용 자료끼리)에 같은·비슷한 제목의
    확정 자료 — 확정 때 알림(막지 않는다). 호선 번호는 비교 낱말에서 뺀다(같은 호선이니 늘 겹친다).
    viewer 가 볼 수 없는 자료는 뺀다(13)."""
    from .service import hulls_of

    hulls = [h.hull_no for h in hulls_of(db, entry)]
    title = entry.title if title is None else title
    mine = naming.title_words(title, drop=hulls)
    if not mine:
        return []
    q = db.query(models.Entry).filter(models.Entry.status == "confirmed", models.Entry.id != entry.id)
    if hulls:
        q = (q.join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
             .filter(models.EntryHull.hull_no.in_(hulls)).distinct())
    elif entry.no_hull:
        q = q.filter(models.Entry.no_hull.is_(True))
    else:
        return []
    if viewer is not None:
        q = q.filter(access.visible_entries_filter(viewer))
    same_key = naming.key(title)
    out = []
    for e in q.order_by(models.Entry.id.desc()).limit(2000):
        if naming.key(e.title) == same_key:
            out.append((2.0, e, "same"))
            continue
        score = naming.jaccard(mine, naming.title_words(e.title, drop=hulls))
        if score >= SIMILAR_MIN:
            out.append((score, e, "similar"))
    out.sort(key=lambda x: (-x[0], -x[1].id))
    return [{"entry_id": e.entry_id, "title": e.title, "match": kind} for _s, e, kind in out[:limit]]
