"""49 — Module Unit(MU) 권상 자료와 권상 Wire 모델 판별(판정은 이 파일 한 곳에서만).

- Wire 모델 = WorkBench 권상 해석이 만든 `<stem>_lifting.bdf`(원본 모델 + lug→apex Wire CROD + apex SPC1).
  변환 때 case control `TITLE = HiTessWorkBench Lifting Analysis` 를 보면 `model_summaries.lifting` 을 켠다
  (WorkBench WorkBenchSubModule Nastran_bridge `build_lifting_bdf`). 사람이 이름을 바꿀 수 있어 본문이 더 확실하고,
  변환 전·옛 변환에는 이름(`_lifting`)으로 본다.
- MU 자료 = 대상이 'Unit'·'Module Unit'(동의어 포함 — 145 는 40 에서 구역에서 옮겨 온 대상 'Unit', 동의어 GMU)
  이거나 WorkBench 출처 프로그램이 GroupModuleUnit·SidePassage. 기본 목록(vocab.DEFAULTS)은 바꾸지 않는다(40 과 같은 이유).
- MU 자료인데 Wire 모델이 없으면 올려 달라고 요청한다(확정은 막지 않는다 — 43 원칙).
  Wire 모델이 있어야 나중에 이전 실적의 권상 위치(lug·apex·wire)를 찾을 수 있다."""
import os

from sqlalchemy.orm import Session

from . import models, vocab

TITLE_MARK = "HITESSWORKBENCH LIFTING ANALYSIS"
NAME_SUFFIX = "_lifting"
MU_TARGETS = ("Unit", "Module Unit")
MU_PROGRAMS = ("GroupModuleUnit", "SidePassage")   # WorkBench program_name(권상 부모 해석)


def control_is_lifting(control) -> bool:
    """BDF 실행·케이스 제어 줄에 WorkBench 권상 해석 TITLE 이 있는가."""
    for line in control or []:
        text = str(line).strip().upper()
        if text.startswith("TITLE") and TITLE_MARK in text:
            return True
    return False


def name_is_lifting(name: str) -> bool:
    return os.path.splitext(name or "")[0].lower().endswith(NAME_SUFFIX)


def is_wire_model(f: models.File, summary: models.ModelSummary | None) -> bool:
    if f.kind != "model" or f.location == "trash":
        return False
    if summary is not None and summary.lifting:
        return True
    return name_is_lifting(f.name)


def is_mu(db: Session, target: str | None, programs) -> bool:
    if any(p in MU_PROGRAMS for p in programs or []):
        return True
    if not target:
        return False
    canon = vocab.Vocab(db, "target").canon(target) or target
    return vocab.key(canon) in {vocab.key(t) for t in MU_TARGETS}


def programs_of(db: Session, files: list[models.File]) -> list[str]:
    """자료 파일들의 WorkBench 출처 프로그램(origin.program)."""
    ids = {f.batch_id for f in files if f.batch_id}
    if not ids:
        return []
    rows = db.query(models.Batch.origin).filter(models.Batch.id.in_(ids), models.Batch.wb_analysis_id.isnot(None))
    return [o.get("program") for (o,) in rows if isinstance(o, dict) and o.get("program")]


def brief(db: Session, target: str | None, files: list[models.File], model_rows: dict) -> dict:
    """자료 응답 `lifting` — {needed: MU 자료인가, has_wire: Wire 모델이 있는가, has_result: 그 Wire 모델의 구조 해석 결과 세트가 함께 있는가}.
    has_result 는 59(실적 결과 화면)와 같은 짝 규칙 — 정리 대기 카드가 'Wire · 결과 포함 / Wire 포함 / Wire 없음' 을 보인다."""
    from .lifting_refs import _pick_result   # lifting_refs 가 이 모듈을 import 한다 — 순환을 피해 함수 안에서
    wires = [f for f in files if is_wire_model(f, model_rows.get(f.id))]
    return {"needed": is_mu(db, target, programs_of(db, files)), "has_wire": bool(wires),
            "has_result": any(_pick_result(f, files) is not None for f in wires)}
