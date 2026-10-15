"""18-b — WorkBench 앱(target)별 보내기 제한(분류 규칙). 판정은 이 파일 한 곳에서만 한다.

계획: docs/plans/2026-10-08-logbook-18-workbench-link.md §8.
- 모델 내용(카드 수)으로 막지 않고 LogBook 분류(구역·자유 태그)로 막는다. 규칙은 LV3 가 관리 화면에서 정한다.
- 규칙은 Entry 단위다. Entry 의 구역 또는 태그 가운데 **하나라도** 규칙 값과 같으면 통과한다(OR).
  비교는 동의어 묶음의 대표값 기준이고(vocab.Vocab.canon), 표기 열쇠(vocab.key — 공백 제거·대소문자 무시)로 맞춘다.
- 규칙 행이 없거나 두 목록이 모두 비면 제한하지 않는다. Entry 에 속하지 않은 파일(배치에서 빠진 것)은
  분류가 없으므로 규칙이 있으면 보낼 수 없다.
- 기본 규칙(seed): truss = 구역 'Truss' 또는 태그 'Truss'. 행이 없을 때만 넣는다 — 관리자가 비워 두면 다시 넣지 않는다.
  구역 값은 목록 용어여야 하므로 구역 목록에 'Truss' 용어가 없으면 함께 만든다.
  이전 기본값(태그 'Truss' 만)을 관리자가 손대지 않은 채 갖고 있는 DB 는 새 기본값으로 한 번 올린다."""
import logging
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import audit, models, vocab
from .storage.paths import StoragePaths

log = logging.getLogger(__name__)

# 알려진 WorkBench 대상 — 새 앱은 여기에 한 줄 더한다(WorkBench 쪽 launch target 과 같은 값)
TARGETS: dict[str, str] = {
    "gmu": "Group & Module Unit 권상 구조 해석",
    "truss": "Truss Structural Assessment",
}
SEED_RULES: dict[str, dict] = {"truss": {"zones": ["Truss"], "tags": ["Truss"]}}
# 이전 판의 기본값 — 관리자가 바꾸지 않았으면(updated_by=system) 새 기본값으로 올린다
_OLD_SEEDS: dict[str, list[dict]] = {"truss": [{"zones": [], "tags": ["Truss"]}]}
MAX_VALUES = 20          # 한 규칙의 구역·태그 각각 최대 개수
MAX_ELIGIBLE_IDS = 200   # eligible API 한 번에 묻는 Entry 수 상한


def label(target: str) -> str:
    return TARGETS.get(target, target)


def _ro(word: str) -> str:
    """조사 '로/으로' — 마지막 글자가 받침 있는 한글이면 '으로'(ㄹ 받침은 '로'), 그 밖(영문 등)은 '로'."""
    ch = (word or "").rstrip()[-1:]
    if ch and "가" <= ch <= "힣":
        jong = (ord(ch) - 0xAC00) % 28
        return "으로" if jong not in (0, 8) else "로"
    return "로"


def _values(raw) -> list[str]:
    return [str(v) for v in (raw or []) if isinstance(v, str) and v.strip()]


def get_rule(db: Session, target: str) -> dict:
    """{zones, tags} — 행이 없으면 빈 목록(제한 없음)."""
    row = db.get(models.WbTargetRule, target)
    return {"zones": _values(row.zones) if row else [], "tags": _values(row.tags) if row else []}


def is_empty(rule: dict) -> bool:
    return not rule["zones"] and not rule["tags"]


def condition(rule: dict) -> str | None:
    """선택 띠·사유 문구의 조건 부분 — "구역 '선수부' 또는 태그 'Truss' 가 붙은 자료만". 제한이 없으면 None."""
    if is_empty(rule):
        return None
    parts = [f"구역 '{z}'" for z in rule["zones"]] + [f"태그 '{t}'" for t in rule["tags"]]
    return " 또는 ".join(parts) + " 가 붙은 자료만"


def reason(target: str, rule: dict) -> str | None:
    cond = condition(rule)
    if cond is None:
        return None
    name = label(target)
    return f"{cond} {name} {_ro(name)} 보낼 수 있습니다."


def describe(db: Session, target: str) -> dict:
    """화면용 — {target, label, zones, tags, condition, reason}. condition 은 선택 띠 문구(제한 없으면 None)."""
    rule = get_rule(db, target)
    cond = condition(rule)
    return {"target": target, "label": label(target), "zones": rule["zones"], "tags": rule["tags"],
            "condition": f"{cond} 보낼 수 있습니다" if cond else None, "reason": reason(target, rule)}


def list_targets(db: Session) -> list[dict]:
    return [describe(db, t) for t in TARGETS]


def check_target(target: str) -> None:
    if target not in TARGETS:
        raise HTTPException(status_code=422, detail="unknown_target")


# ---- 판정 ----

class Matcher:
    """한 target 의 규칙 + 구역·자유 태그 어휘 스냅숏(요청 하나 동안 쓴다)."""

    def __init__(self, db: Session, target: str):
        self.db, self.target = db, target
        self.rule = get_rule(db, target)
        self.empty = is_empty(self.rule)
        self.reason = reason(target, self.rule)
        if self.empty:
            return
        self._zone = vocab.Vocab(db, "zone")
        self._free = vocab.Vocab(db, "free")
        self._zone_keys = {self._key(self._zone, z) for z in self.rule["zones"]}
        self._tag_keys = {self._key(self._free, t) for t in self.rule["tags"]}

    @staticmethod
    def _key(v: vocab.Vocab, value: str) -> str:
        return vocab.key(v.canon(value) or value)

    def _match(self, tags: list[models.Tag]) -> bool:
        for t in tags:
            if t.kind == "zone" and self._key(self._zone, t.value) in self._zone_keys:
                return True
            if t.kind == "free" and self._key(self._free, t.value) in self._tag_keys:
                return True
        return False

    def entries(self, entry_pks) -> dict[int, tuple[bool, str | None]]:
        """Entry pk → (ok, 사유). 한 번의 질의로 구역·태그를 읽는다."""
        pks = [p for p in dict.fromkeys(entry_pks) if p is not None]
        if self.empty:
            return {p: (True, None) for p in pks}
        by_entry: dict[int, list[models.Tag]] = defaultdict(list)
        if pks:
            for eid, tag in (self.db.query(models.EntryTag.entry_id, models.Tag)
                             .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                             .filter(models.EntryTag.entry_id.in_(pks), models.Tag.kind.in_(("zone", "free")))):
                by_entry[eid].append(tag)
        return {p: (True, None) if self._match(by_entry.get(p, [])) else (False, self.reason) for p in pks}

    def file(self, f: models.File) -> tuple[bool, str | None]:
        """파일 하나 — Entry 에 속하지 않은 파일은 규칙이 있으면 보낼 수 없다."""
        if self.empty:
            return True, None
        if f.entry_id is None:
            return False, self.reason
        return self.entries([f.entry_id])[f.entry_id]


# ---- 기본 규칙 ----

def _ensure_zone_terms(db: Session, storage: StoragePaths | None, actor: str, zones: list[str]) -> list[str]:
    """기본 규칙의 구역 값을 구역 목록 용어로 맞춘다 — 없으면 목록에 용어로 더한다(동의어면 그 용어를 쓴다)."""
    out = []
    for z in zones:
        term = vocab.Vocab(db, "zone").target(z)
        if term is None:
            term = (vocab.add_term(db, storage, actor, "zone", z) if storage is not None
                    else vocab._new_tag(db, "zone", vocab.clean(z, "zone")))
            term.listed, term.active = True, True
            db.flush()
        if term.value not in out:
            out.append(term.value)
    return out


def seed(db: Session, storage: StoragePaths | None = None, actor: str = "system") -> list[str]:
    """SEED_RULES 중 행이 없는 target 만 넣는다(비워 둔 규칙은 다시 넣지 않는다). 넣거나 올린 target 목록.

    이전 기본값을 그대로(updated_by=system) 가진 행은 새 기본값으로 올린다 — 관리자가 고친 규칙은 건드리지 않는다.
    registry.json 은 쓰지 않는다 — 빈 DB 로 막 시작한 서버가 재구축 전에 registry 를 덮어쓰지 않게.
    다음 규칙 변경이나 재구축이 registry 를 맞춘다."""
    added = []
    for target, rule in SEED_RULES.items():
        row = db.get(models.WbTargetRule, target)
        if row is not None:
            current = {"zones": list(row.zones or []), "tags": list(row.tags or [])}
            if row.updated_by != "system" or current not in _OLD_SEEDS.get(target, []):
                continue
        zones = _ensure_zone_terms(db, storage, actor, rule["zones"])
        if row is None:
            db.add(models.WbTargetRule(target=target, zones=zones, tags=list(rule["tags"]), updated_by=actor))
        else:
            row.zones, row.tags, row.updated_by = zones, list(rule["tags"]), actor
        added.append((target, {"zones": zones, "tags": list(rule["tags"])}))
    if not added:
        return []
    db.commit()
    if storage is not None:
        for target, after in added:
            audit.record(db, storage, actor=actor, action="WB_RULE_SEED", target_type="wb_target",
                         target_id=target, after=after)
    return [t for t, _ in added]


def safe_seed(db: Session, storage: StoragePaths) -> None:
    """API 시작 때 — 실패해도 기동은 한다."""
    try:
        if added := seed(db, storage):
            log.info("WorkBench 보내기 기본 규칙을 넣었습니다: %s", ", ".join(added))
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("WorkBench 보내기 기본 규칙을 넣지 못했습니다: %s", exc)


# ---- 관리(LV3) ----

def _dedupe(values) -> list[str]:
    out, seen = [], set()
    for raw in values or []:
        v = vocab.clean(raw)
        k = vocab.key(v)
        if v and k not in seen:
            seen.add(k)
            out.append(v)
    return out


def set_rule(db: Session, storage: StoragePaths, actor: str, target: str, zones, tags,
             ip: str | None = None) -> dict:
    """규칙을 통째로 바꾼다. 구역은 목록 용어여야 하고(동의어를 쓰면 용어로 바꿔 저장) 목록 밖이면 422.
    태그는 입력한 그대로 저장한다(판정 때 동의어를 푼다). 감사 기록 WB_RULE_SET + registry.json."""
    check_target(target)
    zones, tags = _dedupe(zones), _dedupe(tags)
    if len(zones) > MAX_VALUES or len(tags) > MAX_VALUES:
        raise HTTPException(status_code=422, detail="too_many_values")
    zv = vocab.Vocab(db, "zone")
    resolved = []
    for z in zones:
        term = zv.target(z)
        if term is None:
            raise HTTPException(status_code=422, detail="zone_not_listed")
        if term.value not in resolved:
            resolved.append(term.value)
    row = db.get(models.WbTargetRule, target)
    before = get_rule(db, target) if row is not None else None
    if row is None:
        row = models.WbTargetRule(target=target)
        db.add(row)
    row.zones, row.tags, row.updated_by = resolved, tags, actor
    db.flush()
    audit.record(db, storage, actor=actor, action="WB_RULE_SET", target_type="wb_target", target_id=target,
                 before=before, after={"zones": resolved, "tags": tags}, ip=ip)
    from .ops.registry import write_registry  # 순환 import 방지

    write_registry(db, storage)
    return _admin_dict(db, target, db.get(models.WbTargetRule, target))


def _admin_dict(db: Session, target: str, row: models.WbTargetRule | None) -> dict:
    d = describe(db, target)
    d["updated_by"] = row.updated_by if row else None
    d["updated_at"] = row.updated_at.isoformat() if row and row.updated_at else None
    return d


def admin_list(db: Session) -> list[dict]:
    rows = {r.target: r for r in db.query(models.WbTargetRule)}
    return [_admin_dict(db, t, rows.get(t)) for t in TARGETS]
