"""18-b — WorkBench 앱(target)별 보내기 제한(분류 규칙). 판정은 이 파일 한 곳에서만 한다.

계획: docs/plans/2026-10-08-logbook-18-workbench-link.md §8, 40(대상 추가).
- 모델 내용(카드 수)으로 막지 않고 LogBook 분류(구역·대상·자유 태그)로 막는다. 규칙은 LV3 가 관리 화면에서 정한다.
- 규칙은 Entry 단위다. Entry 의 구역·대상·태그 가운데 **하나라도** 규칙 값과 같으면 통과한다(OR).
  비교는 동의어 묶음의 대표값 기준이고(vocab.Vocab.canon), 표기 열쇠(vocab.key — 공백 제거·대소문자 무시)로 맞춘다.
- 규칙 행이 없거나 세 목록이 모두 비면 제한하지 않는다. Entry 에 속하지 않은 파일(배치에서 빠진 것)은
  분류가 없으므로 규칙이 있으면 보낼 수 없다.
- 기본 규칙(seed): truss = 대상 'Truss' 또는 태그 'Truss'. 행이 없을 때만 넣는다 — 관리자가 비워 두면 다시 넣지 않는다.
  구역·대상 값은 목록 용어여야 하므로 대상 목록에 'Truss' 용어가 없으면 함께 만든다.
  이전 기본값을 관리자가 손대지 않은 채(updated_by=system) 갖고 있는 DB 는 새 기본값으로 한 번 올린다.
- 40 — 'Truss' 는 구역(위치)이 아니라 대상(구조물)이다. 예전 기본값(구역 'Truss')을 가진 DB 는 구역을 그대로 둔 채
  대상 'Truss' 를 더한다 — 자료의 구역 값을 대상으로 옮기는(vocab-move) 사이에도 보내기가 막히지 않게.
  vocab-move 가 규칙의 구역 값도 대상으로 옮긴다(plan_move·apply_move)."""
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
FIELDS = ("zones", "targets", "tags")
KIND_FIELD = {"zone": "zones", "target": "targets"}   # 어휘 종류 → 규칙 칸
SEED_RULES: dict[str, dict] = {"truss": {"zones": [], "targets": ["Truss"], "tags": ["Truss"]}}
# 이전 판의 기본값 → 올릴 값. 관리자가 바꾸지 않았으면(updated_by=system) 한 번 올린다
_UPGRADES: dict[str, list[tuple[dict, dict]]] = {"truss": [
    ({"zones": [], "targets": [], "tags": ["Truss"]}, SEED_RULES["truss"]),
    ({"zones": ["Truss"], "targets": [], "tags": ["Truss"]}, {"zones": ["Truss"], "targets": ["Truss"], "tags": ["Truss"]}),
]}
MAX_VALUES = 20          # 한 규칙의 구역·대상·태그 각각 최대 개수
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


def _row_rule(row: models.WbTargetRule | None) -> dict:
    return {f: _values(getattr(row, f)) if row else [] for f in FIELDS}


def get_rule(db: Session, target: str) -> dict:
    """{zones, targets, tags} — 행이 없으면 빈 목록(제한 없음)."""
    return _row_rule(db.get(models.WbTargetRule, target))


def is_empty(rule: dict) -> bool:
    return not any(rule.get(f) for f in FIELDS)


def condition(rule: dict) -> str | None:
    """선택 띠·사유 문구의 조건 부분 — "대상 'Truss' 또는 태그 'Truss' 가 붙은 자료만". 제한이 없으면 None."""
    if is_empty(rule):
        return None
    parts = ([f"대상 '{t}'" for t in rule.get("targets", [])] + [f"구역 '{z}'" for z in rule.get("zones", [])]
             + [f"태그 '{t}'" for t in rule.get("tags", [])])
    return " 또는 ".join(parts) + " 가 붙은 자료만"


def reason(target: str, rule: dict) -> str | None:
    cond = condition(rule)
    if cond is None:
        return None
    name = label(target)
    return f"{cond} {name} {_ro(name)} 보낼 수 있습니다."


def describe(db: Session, target: str) -> dict:
    """화면용 — {target, label, zones, targets, tags, condition, reason}. condition 은 선택 띠 문구(제한 없으면 None)."""
    rule = get_rule(db, target)
    cond = condition(rule)
    return {"target": target, "label": label(target), **rule,
            "condition": f"{cond} 보낼 수 있습니다" if cond else None, "reason": reason(target, rule)}


def list_targets(db: Session) -> list[dict]:
    return [describe(db, t) for t in TARGETS]


def check_target(target: str) -> None:
    if target not in TARGETS:
        raise HTTPException(status_code=422, detail="unknown_target")


# ---- 판정 ----

class Matcher:
    """한 target 의 규칙 + 구역·대상·자유 태그 어휘 스냅숏(요청 하나 동안 쓴다)."""

    _KINDS = {"zone": "zones", "target": "targets", "free": "tags"}   # 태그 종류 → 규칙 칸

    def __init__(self, db: Session, target: str):
        self.db, self.target = db, target
        self.rule = get_rule(db, target)
        self.empty = is_empty(self.rule)
        self.reason = reason(target, self.rule)
        if self.empty:
            return
        self._vocab = {k: vocab.Vocab(db, k) for k in self._KINDS}
        self._keys = {k: {self._key(self._vocab[k], v) for v in self.rule[f]} for k, f in self._KINDS.items()}

    @staticmethod
    def _key(v: vocab.Vocab, value: str) -> str:
        return vocab.key(v.canon(value) or value)

    def _match(self, tags: list[models.Tag]) -> bool:
        return any(t.kind in self._keys and self._key(self._vocab[t.kind], t.value) in self._keys[t.kind]
                   for t in tags)

    def entries(self, entry_pks) -> dict[int, tuple[bool, str | None]]:
        """Entry pk → (ok, 사유). 한 번의 질의로 구역·대상·태그를 읽는다."""
        pks = [p for p in dict.fromkeys(entry_pks) if p is not None]
        if self.empty:
            return {p: (True, None) for p in pks}
        by_entry: dict[int, list[models.Tag]] = defaultdict(list)
        if pks:
            for eid, tag in (self.db.query(models.EntryTag.entry_id, models.Tag)
                             .join(models.Tag, models.Tag.id == models.EntryTag.tag_id)
                             .filter(models.EntryTag.entry_id.in_(pks), models.Tag.kind.in_(tuple(self._KINDS)))):
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

def _ensure_terms(db: Session, storage: StoragePaths | None, actor: str, kind: str, values: list[str]) -> list[str]:
    """기본 규칙의 구역·대상 값을 목록 용어로 맞춘다 — 없으면 목록에 용어로 더한다(동의어면 그 용어를 쓴다)."""
    out = []
    for z in values:
        term = vocab.Vocab(db, kind).target(z)
        if term is None:
            term = (vocab.add_term(db, storage, actor, kind, z) if storage is not None
                    else vocab._new_tag(db, kind, vocab.clean(z, kind)))
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
            current = {f: list(getattr(row, f) or []) for f in FIELDS}
            up = next((new for old, new in _UPGRADES.get(target, []) if old == current), None)
            if row.updated_by != "system" or up is None:
                continue
            rule = up
        # 올릴 때 남겨 둔 옛 구역 값은 이미 목록에 있다 — 새로 만드는 것은 기본값 자체의 값뿐
        new = {"zones": (list(rule["zones"]) if row is not None
                         else _ensure_terms(db, storage, actor, "zone", rule["zones"])),
               "targets": _ensure_terms(db, storage, actor, "target", rule["targets"]),
               "tags": list(rule["tags"])}
        if row is None:
            db.add(models.WbTargetRule(target=target, **new, updated_by=actor))
        else:
            row.zones, row.targets, row.tags, row.updated_by = new["zones"], new["targets"], new["tags"], actor
        added.append((target, new))
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


# ---- 40 — 어휘 종류 옮기기(vocab.move_term)와 함께 ----

def plan_move(db: Session, kind_from: str, values: list[str], kind_to: str, dest: str) -> list[dict]:
    """kind_from 칸에 values(용어·동의어) 중 하나를 쓴 규칙 → [{target, before, after}]. 바꾸지 않는다."""
    f_from, f_to = KIND_FIELD[kind_from], KIND_FIELD[kind_to]
    keys = {vocab.key(v) for v in values}
    out = []
    for row in db.query(models.WbTargetRule).order_by(models.WbTargetRule.target):
        before = _row_rule(row)
        if not any(vocab.key(v) in keys for v in before[f_from]):
            continue
        after = dict(before)
        after[f_from] = [v for v in before[f_from] if vocab.key(v) not in keys]
        if not any(vocab.key(v) == vocab.key(dest) for v in before[f_to]):
            after[f_to] = before[f_to] + [dest]
        out.append({"target": row.target, "before": before, "after": after})
    return out


def apply_move(db: Session, storage: StoragePaths | None, plans: list[dict], actor: str) -> None:
    """plan_move 결과를 저장한다. 고친 사람(updated_by)은 그대로 둔다 — 값의 뜻만 옮긴 것이라
    손대지 않은 기본 규칙은 계속 기본 규칙으로 본다."""
    for p in plans:
        row = db.get(models.WbTargetRule, p["target"])
        for f in FIELDS:
            setattr(row, f, list(p["after"][f]))
        db.flush()
        if storage is not None:
            audit.record(db, storage, actor=actor, action="WB_RULE_SET", target_type="wb_target",
                         target_id=p["target"], before=p["before"], after=p["after"])


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


def _resolve(db: Session, kind: str, values: list[str]) -> list[str]:
    v = vocab.Vocab(db, kind)
    out = []
    for raw in values:
        term = v.target(raw)
        if term is None:
            raise HTTPException(status_code=422, detail=f"{kind}_not_listed")
        if term.value not in out:
            out.append(term.value)
    return out


def set_rule(db: Session, storage: StoragePaths, actor: str, target: str, zones, tags,
             ip: str | None = None, *, targets=None) -> dict:
    """규칙을 통째로 바꾼다. 구역·대상은 목록 용어여야 하고(동의어를 쓰면 용어로 바꿔 저장) 목록 밖이면 422.
    태그는 입력한 그대로 저장한다(판정 때 동의어를 푼다). 감사 기록 WB_RULE_SET + registry.json."""
    check_target(target)
    zones, targets, tags = _dedupe(zones), _dedupe(targets), _dedupe(tags)
    if max(len(zones), len(targets), len(tags)) > MAX_VALUES:
        raise HTTPException(status_code=422, detail="too_many_values")
    zones, targets = _resolve(db, "zone", zones), _resolve(db, "target", targets)
    row = db.get(models.WbTargetRule, target)
    before = get_rule(db, target) if row is not None else None
    if row is None:
        row = models.WbTargetRule(target=target)
        db.add(row)
    row.zones, row.targets, row.tags, row.updated_by = zones, targets, tags, actor
    db.flush()
    audit.record(db, storage, actor=actor, action="WB_RULE_SET", target_type="wb_target", target_id=target,
                 before=before, after={"zones": zones, "targets": targets, "tags": tags}, ip=ip)
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
