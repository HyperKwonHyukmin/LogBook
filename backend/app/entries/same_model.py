"""같은 BDF 찾기(12) — 내용 서명(bdf.signature)으로 '같은 모델'·'같은 형상' 파일을 찾는 단 하나의 조회.

    같은 모델(same_model)    geometry·property·material·load 서명이 모두 같다 → '동일 BDF 가 이미 있음'
    같은 형상(same_geometry) geometry 만 같고 property·material·load 중 하나 이상 다르다 → 정보로만(무엇이 다른지 함께)

제외: 자기 자신, 휴지통 파일·휴지통 Entry, 서명 규칙 버전이 다른 행(재변환 전 옛 서명).
초안(정리 대기)끼리 — 같은 배치 안 두 파일이 같아도 서로 알린다.
바이트까지 같은 파일(files.duplicate_of_id)은 기존 '…에 이미 있음' 표시가 이미 알리므로 same_model 에서 뺀다.

권한(13): **이 모듈의 _visible() 한 곳**에서 viewer 가 볼 수 없는 Entry 의 파일을 뺀다(존재 자체를 숨긴다 —
익명 '숨은 자료가 있음' 표시도 하지 않는다). *_total 도 거른 뒤의 수다. 화면·API 는 이 함수의 결과만 쓴다.
"""
from sqlalchemy.orm import Session

from .. import access, models
from ..bdf.signature import VERSION as SIG_VERSION, differing

# 파일 하나에 보여 주는 목록 상한(총 개수는 *_total 로 따로 준다)
SAME_LIMIT = 5
_SIG_COLUMNS = ("geometry", "property", "material", "load")


def _sig(row) -> dict:
    return {c: getattr(row, f"sig_{c}") for c in _SIG_COLUMNS}


def _visible(refs: list[dict], allowed: set[int] | None) -> list[dict]:
    """권한 거르개(13) — allowed(viewer 가 볼 수 있는 Entry pk) 밖의 파일을 뺀다. None = 거르지 않음(내부용)."""
    if allowed is None:
        return refs
    return [r for r in refs if r["_entry_pk"] in allowed]


def _public(refs: list[dict]) -> list[dict]:
    return [{k: v for k, v in r.items() if k != "_entry_pk"} for r in refs]


def _ref(r) -> dict:
    return {"file_id": r.file_id, "name": r.name, "rel_path": r.rel_path, "entry_id": r.entry_id,
            "entry_title": r.title, "entry_status": r.status, "_entry_pk": r.entry_pk}


def find_same_models(db: Session, rows: dict[int, models.ModelSummary], files: list[models.File],
                     viewer: models.User | None = None, limit: int = SAME_LIMIT) -> dict[int, dict]:
    """files(그중 서명이 있는 모델) 마다 {same_model, same_model_total, same_geometry, same_geometry_total}.

    rows 는 files 의 ModelSummary(file_id → 행). 서명이 없는(변환 전·실패·include) 파일은 결과에 없다.
    정렬: 확정 Entry 먼저, 그다음 먼저 올라온 파일."""
    mine = {f.id: f for f in files
            if (r := rows.get(f.id)) is not None and r.sig_geometry and r.sig_version == SIG_VERSION}
    if not mine:
        return {}
    geoms = {rows[i].sig_geometry for i in mine}
    S, F, E = models.ModelSummary, models.File, models.Entry
    candidates = (
        db.query(S.file_id, S.sig_geometry, S.sig_property, S.sig_material, S.sig_load,
                 F.name, F.rel_path, E.id.label("entry_pk"), E.entry_id, E.title, E.status)
        .join(F, F.id == S.file_id).join(E, E.id == F.entry_id)
        .filter(S.sig_geometry.in_(geoms), S.sig_version == SIG_VERSION,
                F.location != "trash", E.status != "trashed")
        .order_by((E.status == "confirmed").desc(), S.file_id)
        .all())
    # 13 — viewer 가 볼 수 있는 후보 Entry(한 번의 질의). viewer 가 없으면 내부용이라 거르지 않는다
    allowed = (access.visible_entry_pks(db, viewer, {c.entry_pk for c in candidates})
               if viewer is not None else None)
    by_geom: dict[str, list] = {}
    for c in candidates:
        by_geom.setdefault(c.sig_geometry, []).append(c)

    out: dict[int, dict] = {}
    for fid, f in mine.items():
        me = _sig(rows[fid])
        same, shape = [], []
        for c in by_geom.get(me["geometry"], ()):
            if c.file_id == fid:
                continue
            diff = differing(me, _sig(c))
            if not diff:
                if c.file_id != f.duplicate_of_id:   # 바이트 동일 표시와 겹치면 한 번만
                    same.append(_ref(c))
            else:
                shape.append(_ref(c) | {"differs": diff})
        same, shape = _visible(same, allowed), _visible(shape, allowed)
        out[fid] = {"same_model": _public(same[:limit]), "same_model_total": len(same),
                    "same_geometry": _public(shape[:limit]), "same_geometry_total": len(shape)}
    return out
