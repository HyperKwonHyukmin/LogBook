"""배치 처리: 제외·해시·분류·DRM·중복 → 묶음 제안 → 초안 Entry (설계 §5.2~5.4)."""
import logging
import os
from datetime import datetime

from sqlalchemy.orm import Session

from .. import audit, models
from ..entries import naming
from ..entries.files import remove_empty_dirs
from ..convert.job import enqueue_convert, set_signature
from ..extract.job import enqueue_extract
from ..storage.paths import StoragePaths, to_long, walk_root
from . import duplicates
from .hashing import sha256_of
from .proposal import FileInfo, propose
from .rules import classify, is_excluded, safe_ext

MAX_REL_PATH = 1024  # models.File.rel_path 컬럼 길이
MAX_NAME = 255       # models.File.name 컬럼 길이

logger = logging.getLogger(__name__)

DRM_MAGIC = b"HHIDRMC"
def _words(title: str) -> set[str]:
    return naming.title_words(title)


def _find_similar(db: Session, hull_no: str | None, title: str) -> int | None:
    """올리기 때 '비슷한 기존 자료에 추가할까요?' 제안(suggested_entry_id). 확정 때 경고는 entries.quality.similar_entries."""
    if not hull_no:
        return None
    mine = _words(title)
    rows = (
        db.query(models.Entry)
        .join(models.EntryHull, models.EntryHull.entry_id == models.Entry.id)
        .filter(models.Entry.status == "confirmed", models.EntryHull.hull_no == hull_no)
        .all()
    )
    for e in rows:
        theirs = _words(e.title)
        if naming.jaccard(mine, theirs) >= 0.5:
            return e.id
    return None


def _noop_progress(step: str, done: int = 0, total: int = 0, force: bool = False) -> None:
    return None


def _block_duplicates(db: Session, storage: StoragePaths, batch: models.Batch,
                      rows: dict[int, models.File]) -> tuple[list[dict], dict[int, object]]:
    """이 배치의 BDF 중 이미 있는 자료(확정·정리 대기, 이 배치 밖)의 BDF 와 완전히 같은 것과, 이 배치 안에서 앞 파일과 같은 것을
    File 행에서 뺀다(rows 에서도). 원본은 지우지 않는다 — _staging/<key> 에 그대로 남는다(탐색기로 넣은 사람은 원본을 옮겨
    버렸을 수 있다. 경로 길이·읽기 실패 제외와 같은 규칙). 돌려주는 것: (excluded 항목, 남은 본 BDF 의 서명 {file_id: Signature})."""
    root = storage.staging / batch.key
    model_rows = [f for f in rows.values() if f.kind == "model" and not f.drm_encrypted]
    if not model_rows:
        return [], {}
    probes, _deferred = duplicates.probe(root, [(f.rel_path, f.size) for f in model_rows],
                                         sha={f.rel_path: f.sha256 for f in model_rows})
    listed = [(f.rel_path, f.size) for f in rows.values()]
    blocked = duplicates.decide(db, probes, files=listed, exclude_batch_id=batch.id)
    by_rel = {f.rel_path.casefold(): f for f in rows.values()}
    for b in blocked:
        for rel in (b.rel, *b.includes):
            f = by_rel.get(rel.casefold())
            if f is not None and f.id in rows:
                rows.pop(f.id)
                db.delete(f)
    if blocked:
        db.flush()
        logger.info("배치 %s: 완전 동일 BDF %d개를 제외(원본은 _staging 에 둠)", batch.key, len(blocked))
    fragments = {i.casefold() for p in probes for i in p.includes}
    signatures = {by_rel[p.rel.casefold()].id: p.sig for p in probes
                  if p.sig is not None and p.rel.casefold() not in fragments
                  and by_rel[p.rel.casefold()].id in rows}
    sizes = {r.casefold(): s for r, s in listed}
    return duplicates.records(blocked, sizes, kept=True), signatures


def process_batch(db: Session, storage: StoragePaths, batch: models.Batch, progress=None) -> None:
    """progress(step, done, total, force=False) — 정리 대기 화면에 보일 진행 상황(ingest.progress).
    단계: scan(파일 목록) → files(파일마다 제외·분류·DRM·해시·중복) → propose(묶음·호선 추정) → queue(추출·변환 예약)."""
    progress = progress or _noop_progress
    if batch.state != "staged":
        # 이미 처리됐거나(재시도로 큐에 중복 등록 등) 다른 상태면 아무것도 하지 않는다 —
        # 그대로 다시 돌면 File 행이 중복 생성된다(I4, 멱등성).
        logger.info("배치 %s 는 이미 %s 상태 — process_batch 를 건너뜀", batch.key, batch.state)
        return

    root = storage.staging / batch.key
    long_root = walk_root(root)
    excluded: list[dict] = []
    infos: list[FileInfo] = []
    rows: dict[int, models.File] = {}

    def _onerror(exc: OSError) -> None:
        # os.walk 가 하위 폴더 하나를 못 읽어도(권한 등) 배치 전체를 실패시키지 않는다 —
        # 그 폴더 안 파일은 이번엔 못 건너뛰고 남지만, 나머지는 정상 처리된다.
        logger.warning("배치 %s 처리 중 하위 폴더를 읽지 못함(건너뜀): %s", batch.key, exc)

    # 먼저 목록만 훑는다 — 전체 개수를 알아야 화면에 n/N 을 보일 수 있다(이름만 읽어 값싸다).
    progress("scan", 0, 0, force=True)
    listing = [(dirpath, name) for dirpath, _dirs, files in os.walk(long_root, onerror=_onerror) for name in files]
    total = len(listing)
    progress("files", 0, total, force=True)
    for done, (dirpath, name) in enumerate(listing):
        progress("files", done, total)
        full = os.path.join(dirpath, name)
        opened = to_long(full)   # 열 때는 접두사를 뗀다(짧으면) — DRM 이 접두 경로의 .pdf 열기를 막는다
        # rel 은 문자열을 직접 잘라 만든다(os.path.relpath 는 abspath 를 다시 타서
        # 끝 공백·점을 지워 버린다 — I1). dirpath 는 os.walk(long_root) 가 준 것이라
        # 항상 long_root 로 시작한다.
        rel = full[len(long_root) + 1:].replace("\\", "/")
        size = 0
        if len(rel) > MAX_REL_PATH or len(name) > MAX_NAME:
            excluded.append({"name": rel, "size": 0, "reason": "path_too_long"})
            continue
        try:
            size = os.path.getsize(opened)
            if is_excluded(name):
                os.remove(opened)
                excluded.append({"name": rel, "size": size})
                continue
            with open(opened, "rb") as fh:
                head = fh.read(16)
            digest = sha256_of(opened)
        except OSError as exc:
            # 파일 하나가 못 읽혀도(권한·레이스로 사라짐 등) 배치 전체는 계속 진행한다 —
            # 사유를 남겨 사람이 나중에 batches.excluded 화면에서 알 수 있게 한다.
            excluded.append({"name": rel, "size": size, "reason": str(exc)})
            logger.warning("배치 %s 처리 중 파일을 건너뜀: %s (%s)", batch.key, rel, exc)
            continue

        dup = (
            db.query(models.File.id)
            .filter(models.File.sha256 == digest, models.File.location == "vault")
            .first()
        )
        f = models.File(batch_id=batch.id, rel_path=rel, name=name, ext=safe_ext(name),
                        kind=classify(name), size=size, sha256=digest,
                        duplicate_of_id=dup[0] if dup else None,
                        drm_encrypted=head.startswith(DRM_MAGIC), location="staging")
        db.add(f)
        db.flush()
        rows[f.id] = f
        infos.append(FileInfo(key=f.id, rel_path=rel))

    # 17 — 완전 동일 BDF(탐색기로 넣은 것·큰 파일·동시 업로드 경합). 웹 업로드 마무리가 이미 막은 것은 여기 오지 않는다
    progress("propose", total, total, force=True)
    signatures: dict[int, object] = {}
    if not batch.allow_duplicates:
        blocked_records, signatures = _block_duplicates(db, storage, batch, rows)
        excluded.extend(blocked_records)
        infos = [i for i in infos if i.key in rows]

    known = {h for (h,) in db.query(models.Hull.hull_no)}
    created = 0
    for p in propose(infos, known):
        # 20 — 호선을 알면 제목 초안을 형식(`3496 · 구별자`)으로, 모르면 예전처럼 폴더/파일 이름. 구역·대상은
        # 사람이 정리 대기에서 고르고, 그때 (사람이 제목을 고치지 않았으면) 제목도 따라 바뀐다
        title = naming.title_draft(p.source, hulls=[p.best_hull] if p.best_hull else []) if p.best_hull else p.title
        entry = models.Entry(title=title or p.title, status="draft", batch_id=batch.id, uploaded_by=batch.uploader,
                             hull_evidence=p.hull_candidates, merge_into_id=batch.target_entry_id,
                             # Targeted upload proposals are temporary. Only their uploader/admin
                             # may see them until files inherit the selected Entry's visibility.
                             access="blocked" if batch.target_entry_id is not None else "normal",
                             title_source=p.source or None)
        db.add(entry)
        db.flush()
        entry.entry_id = f"E{entry.id:06d}"
        if p.best_hull:
            db.add(models.EntryHull(entry_id=entry.id, hull_no=p.best_hull, is_primary=True))
        if batch.target_entry_id is None:
            entry.suggested_entry_id = _find_similar(db, p.best_hull, entry.title)
        for key in p.file_keys:
            rows[key].entry_id = entry.id
        created += 1

    # 보고서 본문 추출·BDF 변환은 워커가 따로 처리한다(배치 처리를 무겁게 만들지 않게).
    progress("queue", total, total, force=True)
    for f in rows.values():
        enqueue_extract(db, f)
        enqueue_convert(db, f)
    if signatures:
        # 17 — 서명을 변환 전에 적어 둔다: 다음 배치·확정 재검사·정리 대기 칩이 변환을 기다리지 않는다.
        # 변환이 끝나면 같은 값으로 덮거나(include·요소 없음이면) 지운다.
        db.flush()
        for fid, sig in signatures.items():
            row = db.get(models.ModelSummary, fid)
            if row is not None:
                set_signature(row, sig)

    # 웹 업로드가 미리 적어 둔 DRM 거부 목록 등을 지우지 않는다(process_batch 는 배치당 한 번만 돈다).
    batch.excluded = list(batch.excluded or []) + excluded
    batch.processed_at = datetime.now().replace(microsecond=0)
    if created == 0:
        # 초안이 하나도 안 생겼다(전부 제외됨 등) — 확정할 것이 없으니 곧장 done 으로
        # 두고 staging 을 정리한다(M4). 그대로 'processed' 로 두면 아무도 확정하지
        # 않을 초안 없는 배치가 목록에 영원히 남는다.
        batch.state = "done"
        remove_empty_dirs(root)
    else:
        batch.state = "processed"
    db.commit()
    blocked = [x for x in excluded if x.get("reason") == duplicates.REASON_MODEL]
    if blocked:
        # 17 — 워커가 뺀 동일 BDF 도 활동 로그에 남긴다(웹 업로드 마무리와 같은 동작 이름, 대상 자료는 적지 않는다).
        # 배치 처리 트랜잭션은 위에서 끝났다 — 감사 실패가 처리 결과를 되돌리지 않게 따로 커밋한다
        try:
            audit.record(db, storage, actor=batch.uploader, action="UPLOAD_DUPLICATE_BLOCKED", target_type="batch",
                         target_id=batch.key, after={"name": batch.original_name, "files": [x["name"] for x in blocked],
                                                     "source": batch.source, "kept": True})
        except Exception:
            db.rollback()
            logger.exception("배치 %s 의 동일 BDF 감사 기록 실패(처리는 완료됨)", batch.key)
