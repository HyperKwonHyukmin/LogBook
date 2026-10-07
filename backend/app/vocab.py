"""해석 종류·구역 통제 어휘(08 — SharePoint 관리 용어·M-Files 값 목록에 해당).

새 체계를 따로 만들지 않고 태그 동의어(tags.py)를 넓힌다.
- 용어 = `listed=1` 인 대표 태그(alias_of 없음). 동의어 = 용어를 alias_of 로 가리키는 태그(한 단계).
- 구역(zone) 은 기존처럼 entry_tags 로 Entry 와 잇는다. 해석 종류(atype) 태그는 사전 역할만 하고,
  Entry 의 값은 entries.analysis_type 문자열이 갖는다.
- 정규화(canon): 같은 값의 태그 → 그 대표 / 공백·대소문자만 다른 표기 → 용어 / 그 밖은 원래 값.
- 못 맞춘 값은 지우거나 바꾸지 않는다 — '목록 밖 값'으로 남아 관리자가 합치거나 용어로 올린다."""
import logging
from collections import Counter, defaultdict

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import audit, models
from .storage.paths import StoragePaths

log = logging.getLogger(__name__)

KINDS = ("atype", "zone")
FIELD = {"atype": "analysis_type", "zone": "zones"}   # Entry 이력(감사)의 칸 이름
OTHER = "기타"
LIVE = ("draft", "confirmed")
MAX_LEN = {"atype": 50, "zone": 100}                  # entries.analysis_type = String(50)

DEFAULTS = {
    "atype": ["강도 평가", "FE 해석", "진동 해석", "피로 평가", "좌굴 평가", "권상 해석", "계류 해석", "운송 해석", OTHER],
    "zone": ["선수부", "선미부", "화물창", "기관실", "거주구", "상갑판", "이중저", OTHER],
}
# 기본 동의어 — 이미 다른 용어 묶음에 든 값은 건드리지 않는다
DEFAULT_SYNONYMS = {
    "atype": {
        "강도 평가": ["강도 해석", "구조 강도 평가"],
        "FE 해석": ["FEM 해석", "FEM", "FEA", "유한요소 해석"],
        "진동 해석": ["진동 평가"],
        "피로 평가": ["피로 해석"],
        "좌굴 평가": ["좌굴 해석"],
        "권상 해석": ["권상 평가", "Lifting"],
        "계류 해석": ["계류 평가", "Mooring"],
        "운송 해석": ["해상 운송 해석", "운송 평가"],
    },
    "zone": {
        "선수부": ["FWD", "Fore", "선수"],
        "선미부": ["AFT", "선미"],
        "화물창": ["Cargo Hold", "카고 홀드"],
        "기관실": ["Engine Room", "ER", "E/R"],
        "거주구": ["Deck House", "Accommodation", "거주 구역"],
        "상갑판": ["Upper Deck"],
        "이중저": ["Double Bottom"],
    },
}


def clean(value, kind: str | None = None) -> str:
    """앞뒤·연속 공백 정리 + 길이 제한."""
    return " ".join(str(value or "").split())[:MAX_LEN.get(kind, 100)]


def key(value) -> str:
    """표기 비교 열쇠 — 공백을 모두 빼고 대소문자를 무시한다(강도평가 = 강도 평가)."""
    return "".join(str(value or "").split()).casefold()


def _order(t: models.Tag):
    return (t.sort_order is None, t.sort_order or 0, t.value)


class Vocab:
    """한 종류의 어휘 스냅숏(요청 하나 동안 쓴다). 태그 수가 수백 개를 넘지 않는다는 전제."""

    def __init__(self, db: Session, kind: str):
        self.kind = kind
        tags = db.query(models.Tag).filter(models.Tag.kind == kind).all()
        self.by_id = {t.id: t for t in tags}
        self.terms = sorted((t for t in tags if t.listed and t.alias_of_id is None), key=_order)
        self._terms_cf = {t.value.casefold(): t for t in self.terms}
        term_ids = {t.id for t in self.terms}
        self._root_cf: dict[str, models.Tag] = {}
        self._term_key: dict[str, models.Tag] = {}
        for t in tags:
            r = self.root(t)
            self._root_cf[t.value.casefold()] = r
            if r.id in term_ids:
                self._term_key.setdefault(key(t.value), r)
        for t in self.terms:   # 용어 자신의 표기가 동의어 표기보다 앞선다
            self._term_key[key(t.value)] = t

    @property
    def has_terms(self) -> bool:
        return bool(self.terms)

    def root(self, t: models.Tag) -> models.Tag:
        return self.by_id.get(t.alias_of_id, t) if t.alias_of_id else t

    def synonyms(self, term: models.Tag) -> list[models.Tag]:
        return sorted((t for t in self.by_id.values() if t.alias_of_id == term.id), key=lambda t: t.value)

    def term(self, value) -> models.Tag | None:
        """값과 같은 용어(대소문자 무시)."""
        return self._terms_cf.get(clean(value, self.kind).casefold())

    def is_listed(self, value) -> bool:
        return self.term(value) is not None

    def target(self, raw) -> models.Tag | None:
        """이 값이 가리키는 목록 용어 — 같은 값·동의어·표기 변형. 없으면 None."""
        v = clean(raw, self.kind)
        if not v:
            return None
        r = self._root_cf.get(v.casefold())
        if r is not None and r.id in self.by_id and r.listed and r.alias_of_id is None:
            return r
        return self._term_key.get(key(v)) or (self._term_key.get(key(r.value)) if r is not None else None)

    def canon(self, raw) -> str | None:
        """검색·필터용 대표 값 — 목록 용어, 아니면 (목록 밖) 동의어 묶음의 대표, 아니면 원래 값."""
        v = clean(raw, self.kind)
        if not v:
            return None
        t = self.target(v)
        if t is not None:
            return t.value
        r = self._root_cf.get(v.casefold())
        return r.value if r is not None else v


# ---- 태그 묶음 조작(한 단계 구조 유지) ----

def _find(db: Session, kind: str, value: str) -> models.Tag | None:
    # MySQL 정렬 규칙(utf8mb4_0900_ai_ci)상 대소문자를 가리지 않는다
    return db.query(models.Tag).filter(models.Tag.kind == kind, models.Tag.value == value).first()


def _new_tag(db: Session, kind: str, value: str, alias_of: models.Tag | None = None) -> models.Tag:
    t = models.Tag(kind=kind, value=value, alias_of_id=alias_of.id if alias_of else None)
    db.add(t)
    db.flush()   # 세션이 autoflush 를 끄고 있어 다음 조회가 이 행을 보게 한다
    return t


def _children(db: Session, tag: models.Tag) -> list[models.Tag]:
    return db.query(models.Tag).filter(models.Tag.alias_of_id == tag.id).all()


def _root(db: Session, tag: models.Tag) -> models.Tag:
    return db.get(models.Tag, tag.alias_of_id) if tag.alias_of_id else tag


def _make_root(db: Session, tag: models.Tag) -> None:
    """동의어였던 태그를 그 묶음의 대표로 올린다(옛 대표와 형제들은 이 태그 아래로)."""
    if tag.alias_of_id is None:
        return
    old = db.get(models.Tag, tag.alias_of_id)
    for c in _children(db, old):
        if c.id != tag.id:
            c.alias_of_id = tag.id
    old.alias_of_id, old.listed = tag.id, False
    tag.alias_of_id = None
    db.flush()


def _attach_group(db: Session, root: models.Tag, term: models.Tag) -> None:
    """대표 태그 root 의 묶음을 통째로 용어 term 의 동의어로 옮긴다."""
    if root.id == term.id:
        return
    for c in _children(db, root):
        c.alias_of_id = term.id
    root.alias_of_id, root.listed = term.id, False
    db.flush()


def _absorb(db: Session, syn: models.Tag, term: models.Tag) -> None:
    """동의어 행을 지우고 그 행을 가리키던 Entry 연결을 용어로 옮긴다(이미 용어가 있으면 하나로)."""
    has_term = {eid for (eid,) in db.query(models.EntryTag.entry_id).filter(models.EntryTag.tag_id == term.id)}
    for et in db.query(models.EntryTag).filter(models.EntryTag.tag_id == syn.id).all():
        if et.entry_id in has_term:
            db.delete(et)
        else:
            db.add(models.EntryTag(entry_id=et.entry_id, tag_id=term.id))
            db.delete(et)
    db.flush()
    db.delete(syn)
    db.flush()


def _renumber(terms: list[models.Tag]) -> None:
    """순서를 10 간격으로 다시 매기고 '기타' 는 늘 끝에 둔다."""
    rest = [t for t in terms if t.value != OTHER] + [t for t in terms if t.value == OTHER]
    for i, t in enumerate(rest):
        t.sort_order = i * 10


def _write_registry(db: Session, storage: StoragePaths | None) -> None:
    if storage is None:
        return
    from .ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)


def _err(status: int, code: str):
    return HTTPException(status_code=status, detail=code)


# ---- 기본 목록 ----

def seed(db: Session, storage: StoragePaths | None, actor: str = "system", *, record: bool = True) -> dict:
    """용어가 하나도 없는 종류에 기본 목록과 기본 동의어를 넣는다. 넣은 종류 → 용어 값.

    record=False 면 커밋·감사·registry 없이 세션에만 넣는다(vocab-report 의 시험 적용 — 호출자가 되돌린다)."""
    out: dict[str, list[str]] = {}
    for kind in KINDS:
        if db.query(models.Tag.id).filter(models.Tag.kind == kind, models.Tag.listed.is_(True)).first():
            continue
        terms = []
        for value in DEFAULTS[kind]:
            t = _find(db, kind, value) or _new_tag(db, kind, value)
            _make_root(db, t)
            t.listed, t.active = True, True
            terms.append(t)
        _renumber(terms)
        db.flush()
        for term_value, syns in DEFAULT_SYNONYMS[kind].items():
            term = _find(db, kind, term_value)
            for s in syns:
                tag = _find(db, kind, s)
                if tag is None:
                    _new_tag(db, kind, s, alias_of=term)
                    continue
                r = _root(db, tag)
                if r.id != term.id and not r.listed:
                    _attach_group(db, r, term)
        out[kind] = [t.value for t in terms]
    db.flush()
    if record and out:
        for kind, values in out.items():
            audit.record(db, storage, actor=actor, action="VOCAB_SEED", target_type="vocab", target_id=kind,
                         after={"terms": values})
        _write_registry(db, storage)
    return out


def safe_seed(db: Session, storage: StoragePaths) -> None:
    """API 시작 때 — 실패해도 기동은 한다(다음 시작이나 vocab-normalize 가 다시 넣는다)."""
    try:
        added = seed(db, storage)
        if added:
            log.info("기본 분류 목록을 넣었습니다: %s", ", ".join(added))
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("기본 분류 목록을 넣지 못했습니다: %s", exc)


# ---- 데이터 속 값 ----

def value_counts(db: Session, kind: str) -> Counter:
    """미확정·확정 Entry 에 실제로 쓰인 값 → Entry 수(휴지통 제외)."""
    E = models.Entry
    if kind == "atype":
        rows = (db.query(E.analysis_type, E.id).filter(E.status.in_(LIVE), E.analysis_type.isnot(None)))
        c = Counter()
        for value, _id in rows:
            if value and value.strip():
                c[value] += 1
        return c
    rows = (db.query(models.Tag.value, models.EntryTag.entry_id)
            .join(models.EntryTag, models.EntryTag.tag_id == models.Tag.id)
            .join(E, E.id == models.EntryTag.entry_id)
            .filter(models.Tag.kind == "zone", E.status.in_(LIVE)))
    return Counter(v for v, _e in rows)


def unlisted(db: Session, kind: str) -> list[dict]:
    """목록 밖 값 — 데이터에 있지만 어떤 용어로도 맞춰지지 않는 값(많이 쓴 순)."""
    v = Vocab(db, kind)
    return [{"value": val, "count": n}
            for val, n in sorted(value_counts(db, kind).items(), key=lambda x: (-x[1], x[0]))
            if v.target(val) is None]


def list_terms(db: Session, kind: str) -> list[dict]:
    v = Vocab(db, kind)
    counts = Counter()
    for val, n in value_counts(db, kind).items():
        t = v.target(val)
        if t is not None:
            counts[t.id] += n
    return [{"id": t.id, "value": t.value, "active": bool(t.active), "count": counts.get(t.id, 0),
             "synonyms": [{"id": s.id, "value": s.value} for s in v.synonyms(t)]} for t in v.terms]


# ---- 입력 정규화(정리 대기·Entry 상세) ----

def _allowed(v: Vocab, value: str, current: set[str], admin: bool) -> bool:
    return not v.has_terms or admin or value.casefold() in current


def normalize_input(db: Session, kind: str, value, *, current, admin: bool) -> str | None:
    out = normalize_inputs(db, kind, [value] if value else [], current=[current] if current else [], admin=admin)
    return out[0] if out else None


def normalize_inputs(db: Session, kind: str, values, *, current, admin: bool) -> list[str]:
    """동의어·표기 변형 → 용어. 목록 밖 새 값은 관리자만(그 Entry 에 이미 있던 값은 통과) — 아니면 422."""
    v = Vocab(db, kind)
    cur = {c.casefold() for c in current or []}
    out: list[str] = []
    for raw in values or []:
        c = clean(raw, kind)
        if not c:
            continue
        t = v.target(c)
        if t is not None:
            c = t.value
        elif not _allowed(v, c, cur, admin):
            raise _err(422, "vocab_not_listed")
        if c.casefold() not in {x.casefold() for x in out}:
            out.append(c)
    return out


# ---- Entry 값 다시 쓰기 ----

def _plan(db: Session, kind: str, v: Vocab, only: models.Tag | None = None) -> list[tuple]:
    """바꿀 Entry 목록 — (Entry, 이전 값, 새 값). 용어로 맞춰지는 값만 바꾼다."""
    E = models.Entry
    plan = []
    if kind == "atype":
        for e in (db.query(E).filter(E.status.in_(LIVE), E.analysis_type.isnot(None)).order_by(E.id)):
            t = v.target(e.analysis_type)
            if t is not None and (only is None or t.id == only.id) and e.analysis_type != t.value:
                plan.append((e, e.analysis_type, t.value))
        return plan
    by_entry: dict[int, list[models.Tag]] = defaultdict(list)
    for eid, tag in (db.query(models.EntryTag.entry_id, models.Tag)
                     .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                     .join(E, E.id == models.EntryTag.entry_id)
                     .filter(models.Tag.kind == "zone", E.status.in_(LIVE))):
        by_entry[eid].append(tag)
    for eid in sorted(by_entry):
        tags = sorted(by_entry[eid], key=lambda t: t.value)
        new, changed = [], False
        for tag in tags:
            t = v.target(tag.value)
            if t is not None and (only is None or t.id == only.id) and t.id != tag.id:
                changed = True
                tag = t
            if tag.value not in new:
                new.append(tag.value)
        if changed:
            plan.append((db.get(E, eid), [t.value for t in tags], sorted(new)))
    return plan


def _apply(db: Session, storage: StoragePaths, actor: str, kind: str, plan: list[tuple],
           ip: str | None = None) -> list[str]:
    from .entries import service  # 순환 import 방지

    done = []
    for e, before, after in plan:
        if kind == "atype":
            e.analysis_type = after
        else:
            service.set_tags(db, e, "zone", after)
        e.version += 1
        db.flush()
        if e.status == "confirmed":
            audit.record(db, storage, actor=actor, action="ENTRY_UPDATE", target_type="entry", target_id=e.entry_id,
                         before={FIELD[kind]: before}, after={FIELD[kind]: after}, ip=ip)
            service._write_meta_or_queue(db, storage, e)
        else:
            db.commit()
        done.append(e.entry_id)
    return done


def _check_kind(kind: str) -> None:
    if kind not in KINDS:
        raise _err(422, "invalid_kind")


def _term(db: Session, term: models.Tag) -> models.Tag:
    if term is None or not term.listed or term.alias_of_id is not None or term.kind not in KINDS:
        raise _err(404, "term_not_found")
    return term


# ---- 관리(관리자) ----

def add_term(db: Session, storage: StoragePaths, actor: str, kind: str, value, ip: str | None = None) -> models.Tag:
    _check_kind(kind)
    v = clean(value, kind)
    if not v:
        raise _err(422, "value_required")
    voc = Vocab(db, kind)
    hit = voc.target(v)
    if hit is not None:
        raise _err(409, "vocab_exists" if hit.value.casefold() == v.casefold() else "vocab_is_synonym")
    t = _find(db, kind, v)
    if t is None:
        t = _new_tag(db, kind, v)
    else:
        _make_root(db, t)   # 목록 밖 동의어 묶음의 한 값이면 그 묶음의 대표로 올린다
    t.listed, t.active = True, True
    _renumber(voc.terms + [t])
    db.flush()
    audit.record(db, storage, actor=actor, action="VOCAB_TERM_ADD", target_type="vocab",
                 target_id=f"{kind}:{t.value}"[:40], after={"kind": kind, "value": t.value}, ip=ip)
    _write_registry(db, storage)
    return t


def update_term(db: Session, storage: StoragePaths, actor: str, term: models.Tag, *, value=None,
                active: bool | None = None, ip: str | None = None) -> models.Tag:
    """이름 바꾸기(옛 이름은 동의어로 남기고 Entry 값도 바꾼다)·사용 중지/다시 사용."""
    term = _term(db, term)
    kind = term.kind
    before = {"value": term.value, "active": bool(term.active)}
    renamed_from = None
    if value is not None:
        v = clean(value, kind)
        if not v:
            raise _err(422, "value_required")
        if v != term.value:
            other = _find(db, kind, v)
            if other is not None and other.id != term.id:
                if other.alias_of_id != term.id:
                    raise _err(409, "vocab_exists")
                _absorb(db, other, term)   # 자기 동의어를 새 이름으로 — 동의어 행을 용어로 흡수
            renamed_from = term.value
            term.value = v
            db.flush()
            if renamed_from.casefold() != v.casefold():
                _new_tag(db, kind, renamed_from, alias_of=term)
    if active is not None:
        term.active = bool(active)
    db.flush()
    audit.record(db, storage, actor=actor, action="VOCAB_TERM_UPDATE", target_type="vocab",
                 target_id=f"{kind}:{term.value}"[:40], before=before,
                 after={"value": term.value, "active": bool(term.active)}, ip=ip)
    if renamed_from is not None:
        if kind == "atype":
            _apply(db, storage, actor, kind, _plan(db, kind, Vocab(db, kind), only=term), ip)
        else:
            # 구역은 Entry 가 태그 행을 가리켜 화면 값은 이미 바뀌었다 — 이력과 entry.json 만 맞춘다
            _touch_zone_entries(db, storage, actor, term, renamed_from, ip)
    _write_registry(db, storage)
    return term


def _touch_zone_entries(db: Session, storage: StoragePaths, actor: str, term: models.Tag, old: str,
                        ip: str | None) -> None:
    from .entries import service

    E = models.Entry
    entries = (db.query(E).join(models.EntryTag, models.EntryTag.entry_id == E.id)
               .filter(models.EntryTag.tag_id == term.id, E.status.in_(LIVE)).order_by(E.id).all())
    for e in entries:
        after = service.zones_of(db, e)
        before = sorted({old if z == term.value else z for z in after})
        e.version += 1
        db.flush()
        if e.status == "confirmed":
            audit.record(db, storage, actor=actor, action="ENTRY_UPDATE", target_type="entry", target_id=e.entry_id,
                         before={"zones": before}, after={"zones": after}, ip=ip)
            service._write_meta_or_queue(db, storage, e)
        else:
            db.commit()


def reorder(db: Session, storage: StoragePaths, actor: str, kind: str, ids: list[int],
            ip: str | None = None) -> None:
    _check_kind(kind)
    v = Vocab(db, kind)
    if sorted(ids) != sorted(t.id for t in v.terms):
        raise _err(422, "invalid_order")
    for i, tid in enumerate(ids):
        v.by_id[tid].sort_order = i * 10
    db.flush()
    audit.record(db, storage, actor=actor, action="VOCAB_REORDER", target_type="vocab", target_id=kind,
                 after={"order": [v.by_id[i].value for i in ids]}, ip=ip)
    _write_registry(db, storage)


def merge_value(db: Session, storage: StoragePaths, actor: str, kind: str, value, term: models.Tag, *,
                create: bool = False, ip: str | None = None) -> dict:
    """값을 용어의 동의어로 묶고, 그 값을 쓴 Entry 를 용어로 바꾼다('X 로 합치기' · 동의어 추가).

    create=True 면 데이터에 없는 값도 동의어로 등록한다(관리 화면의 '동의어 추가')."""
    _check_kind(kind)
    term = _term(db, term)
    if term.kind != kind:
        raise _err(422, "kind_mismatch")
    v = clean(value, kind)
    if not v:
        raise _err(422, "value_required")
    voc = Vocab(db, kind)
    hit = voc.target(v)
    if hit is not None and hit.id != term.id:
        raise _err(409, "vocab_is_term" if hit.value.casefold() == v.casefold() else "vocab_conflict")
    src = _find(db, kind, v)
    if src is not None:
        r = _root(db, src)
        if r.listed and r.id != term.id:
            raise _err(409, "vocab_is_term")
        _attach_group(db, r, term)
    else:
        used = kind == "atype" and db.query(models.Entry.id).filter(models.Entry.analysis_type == v).first()
        if not used and not create:
            raise _err(404, "value_not_found")
        if v.casefold() != term.value.casefold():
            _new_tag(db, kind, v, alias_of=term)
    db.flush()
    plan = _plan(db, kind, Vocab(db, kind), only=term)
    audit.record(db, storage, actor=actor, action="VOCAB_MERGE", target_type="vocab",
                 target_id=f"{kind}:{term.value}"[:40], before={"value": v},
                 after={"term": term.value, "entries": [e.entry_id for e, _b, _a in plan]}, ip=ip)
    done = _apply(db, storage, actor, kind, plan, ip)
    _write_registry(db, storage)
    return {"term": term.value, "value": v, "entries": done}


def remove_synonym(db: Session, storage: StoragePaths, actor: str, tag: models.Tag, ip: str | None = None) -> None:
    if tag is None or tag.kind not in KINDS:
        raise _err(404, "tag_not_found")
    if tag.alias_of_id is None:
        raise _err(422, "not_synonym")
    term = db.get(models.Tag, tag.alias_of_id)
    value, kind = tag.value, tag.kind
    in_use = db.query(models.EntryTag.entry_id).filter(models.EntryTag.tag_id == tag.id).first()
    if kind == "atype" or not in_use:
        db.delete(tag)   # Entry 가 가리키지 않는 사전 행 — 지워도 잃는 것이 없다
    else:
        tag.alias_of_id = None
    db.flush()
    audit.record(db, storage, actor=actor, action="VOCAB_SYNONYM_REMOVE", target_type="vocab",
                 target_id=f"{kind}:{term.value}"[:40], before={"synonym": value}, ip=ip)
    _write_registry(db, storage)


# ---- 일괄 정규화(CLI vocab-report / vocab-normalize) ----

def normalize(db: Session, storage: StoragePaths | None, actor: str = "system", *, apply: bool = False) -> dict:
    """데이터의 값을 목록 용어로 맞춘다. apply=False 면 무엇이 바뀔지만 보고 아무것도 남기지 않는다.

    다시 돌려도 바뀌는 것이 없다(멱등). 못 맞춘 값은 그대로 둔다(정보를 잃지 않는다)."""
    seeded = seed(db, storage, actor, record=apply)
    report: dict = {"seeded": seeded, "applied": apply}
    plans = {}
    for kind in KINDS:
        v = Vocab(db, kind)
        rows = []
        for val, n in sorted(value_counts(db, kind).items(), key=lambda x: (-x[1], x[0])):
            t = v.target(val)
            rows.append({"value": val, "count": n, "to": t.value if t is not None else None})
        plan = _plan(db, kind, v)
        plans[kind] = plan
        report[kind] = {"terms": [t.value for t in v.terms], "values": rows, "changes": len(plan),
                        "unlisted": [r for r in rows if r["to"] is None]}
        if apply:
            # 표기 변형(공백·대소문자만 다른 값)도 동의어로 남겨 원래 표기를 잃지 않는다
            for r in rows:
                # 연속 공백만 다른 값('강도  평가')은 clean() 이 늘 같은 값으로 맞춰 따로 남길 것이 없다
                # (남기면 화면에서 용어와 똑같아 보이는 동의어가 된다). 원래 표기는 Entry 이력(감사)에 남는다.
                if r["to"] is None or clean(r["value"], kind).casefold() == r["to"].casefold():
                    continue
                term = v.term(r["to"])
                tag = _find(db, kind, r["value"])
                if tag is None:
                    _new_tag(db, kind, r["value"], alias_of=term)
                else:
                    root = _root(db, tag)
                    if root.id != term.id and not root.listed:
                        _attach_group(db, root, term)
            db.flush()
    if not apply:
        db.rollback()
        return report
    audit.record(db, storage, actor=actor, action="VOCAB_NORMALIZE", target_type="vocab", target_id="all",
                 after={k: {"changes": report[k]["changes"], "unlisted": len(report[k]["unlisted"])} for k in KINDS})
    for kind in KINDS:
        report[kind]["entries"] = _apply(db, storage, actor, kind, plans[kind])
    _write_registry(db, storage)
    return report
