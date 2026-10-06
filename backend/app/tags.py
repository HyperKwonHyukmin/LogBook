"""태그 동의어(설계 §6.2 — alias 로 묶인 값을 함께 찾는다, 원래 입력값은 보존).

한 단계만 묶는다. 대표 태그(alias_of 없음) 아래에 동의어들이 달린다. 어떤 태그를
다른 태그에 묶으면 대상의 대표로 묶는다. 묶이는 태그의 동의어들도 함께 옮긴다."""
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import audit, models
from .storage.paths import StoragePaths

TAG_KINDS = ("zone", "free")


def root(db: Session, tag: models.Tag) -> models.Tag:
    return db.get(models.Tag, tag.alias_of_id) if tag.alias_of_id else tag


def _find(db: Session, kind: str, value: str) -> models.Tag | None:
    # MySQL 기본 정렬 규칙(utf8mb4_0900_ai_ci)이라 대소문자를 가리지 않고 찾는다.
    return db.query(models.Tag).filter(models.Tag.kind == kind, models.Tag.value == value).first()


def group_ids(db: Session, tag_ids) -> list[int]:
    """태그들의 동의어 묶음 전체 id(대표 + 동의어)."""
    ids = list(tag_ids)
    if not ids:
        return []
    roots = {t.alias_of_id or t.id for t in db.query(models.Tag).filter(models.Tag.id.in_(ids))}
    if not roots:
        return []
    rows = db.query(models.Tag.id).filter((models.Tag.id.in_(roots)) | (models.Tag.alias_of_id.in_(roots)))
    return [i for (i,) in rows]


def group_values(db: Session, kind: str, value: str) -> set[str]:
    tag = _find(db, kind, value)
    if tag is None:
        return {value}
    return {v for (v,) in db.query(models.Tag.value).filter(models.Tag.id.in_(group_ids(db, [tag.id])))}


def root_value(db: Session, kind: str, value: str) -> str:
    tag = _find(db, kind, value)
    return root(db, tag).value if tag else value


def tag_to_dict(db: Session, tag: models.Tag, count: int | None = None) -> dict:
    target = db.get(models.Tag, tag.alias_of_id) if tag.alias_of_id else None
    d = {"id": tag.id, "kind": tag.kind, "value": tag.value,
         "alias_of": {"id": target.id, "value": target.value} if target else None}
    if count is not None:
        d["count"] = count
    return d


def list_tags(db: Session, kind: str) -> list[dict]:
    counts = dict(
        db.query(models.EntryTag.tag_id, func.count(models.EntryTag.entry_id))
        .join(models.Entry, models.Entry.id == models.EntryTag.entry_id)
        .filter(models.Entry.status.in_(("draft", "confirmed")))
        .group_by(models.EntryTag.tag_id).all())
    tags = db.query(models.Tag).filter_by(kind=kind).order_by(models.Tag.value).all()
    return [tag_to_dict(db, t, counts.get(t.id, 0)) for t in tags]


def _write_registry(db: Session, storage: StoragePaths) -> None:
    """동의어가 바뀌면 registry.json 을 다시 쓴다(05 — 재구축 원천). 순환 import 를 피해 안에서 불러온다."""
    from .ops.registry import write_registry

    write_registry(db, storage)


def set_alias(db: Session, storage: StoragePaths, actor: str, tag: models.Tag, target: models.Tag,
              ip: str | None = None) -> models.Tag:
    # 동시에 두 요청이 서로를 묶으면(A→B, B→A) 순환이 생길 수 있다 — 두 태그를 id 오름차순으로
    # 잠그고(교착 방지) 잠근 뒤의 최신 alias_of 로 대표를 계산한다.
    locked = {t.id: t for t in db.query(models.Tag).filter(models.Tag.id.in_({tag.id, target.id}))
              .order_by(models.Tag.id).with_for_update().populate_existing()}
    tag, target = locked[tag.id], locked[target.id]
    if tag.kind != target.kind:
        raise HTTPException(status_code=422, detail="kind_mismatch")
    new_root = root(db, target)
    if new_root.id == tag.id:
        raise HTTPException(status_code=422, detail="same_tag")
    before = {"alias_of": db.get(models.Tag, tag.alias_of_id).value if tag.alias_of_id else None}
    db.query(models.Tag).filter_by(alias_of_id=tag.id).update({"alias_of_id": new_root.id},
                                                              synchronize_session=False)
    tag.alias_of_id = new_root.id
    db.flush()
    audit.record(db, storage, actor=actor, action="TAG_ALIAS", target_type="tag",
                 target_id=f"{tag.kind}:{tag.value}", before=before, after={"alias_of": new_root.value}, ip=ip)
    _write_registry(db, storage)
    return tag


def clear_alias(db: Session, storage: StoragePaths, actor: str, tag: models.Tag,
                ip: str | None = None) -> models.Tag:
    if tag.alias_of_id is None:
        return tag
    before = {"alias_of": db.get(models.Tag, tag.alias_of_id).value}
    tag.alias_of_id = None
    db.flush()
    audit.record(db, storage, actor=actor, action="TAG_UNALIAS", target_type="tag",
                 target_id=f"{tag.kind}:{tag.value}", before=before, after={"alias_of": None}, ip=ip)
    _write_registry(db, storage)
    return tag
