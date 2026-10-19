"""관리 명령.

첫 관리자(LV3) 만들기 (backend 폴더) — WorkBench 관리자(is_admin=1)는 따로 하지 않아도 자동 LV3:
    .venv\\Scripts\\python.exe -m app.cli create-admin A476854 권혁민 구조시스템연구실

LogBook 등급 바꾸기(15 — 1 게스트 | 2 일반 | 3 관리자. WorkBench 활성 사용자만, WorkBench 관리자는 못 바꿈):
    .venv\\Scripts\\python.exe -m app.cli set-level A100001 2

관리자가 아닌 LV2 를 모두 LV1(게스트)로 내리기(31 — 모델 자료가 안 보이게. --apply 없으면 대상만 보고):
    .venv\\Scripts\\python.exe -m app.cli level-guest [--apply]

기존 파일(03 이전에 올라온 것)을 본문 추출 대기열에 넣기:
    .venv\\Scripts\\python.exe -m app.cli enqueue-extract [--force]

기존 BDF(04a 이전에 올라온 것)를 변환 대기열에 넣기:
    .venv\\Scripts\\python.exe -m app.cli enqueue-convert [--force | --outdated | --missing-signature]
    (--outdated: 변환은 끝났지만 lbm 형식이 옛 버전인 모델만 — 04c 형식 v2 로 다시 변환)
    (--missing-signature: 변환은 끝났지만 내용 서명(12)이 없거나 옛 규칙인 모델만 — '같은 BDF' 찾기용)

변환이 끝난 모델을 해석 검증(Nastran) 대기열에 넣기(06):
    .venv\\Scripts\\python.exe -m app.cli enqueue-solve-check [--all]
    (기본: 검증 기록이 없는 모델만 / --all: 검증 중이 아닌 모델 전부 다시)

DB 백업(mysqldump → 80_Backup, 05):
    .venv\\Scripts\\python.exe -m app.cli backup

보관 기간이 지난 휴지통 비우기(워커가 매일 하지만 수동으로도):
    .venv\\Scripts\\python.exe -m app.cli purge-trash [--days N]

빈 DB 를 공유 폴더로 다시 채우기(entries 표가 비어 있을 때만):
    .venv\\Scripts\\python.exe -m app.cli rebuild --yes [--force]

덤프 복원 뒤 Entry 번호 보정(공유 폴더·감사 로그의 최대 번호 다음으로) + Vault 에만 있는 Entry 경고:
    .venv\\Scripts\\python.exe -m app.cli fix-autoinc

팀원 배포용 바로가기(Logbook.url + 사용 안내문)를 공유 폴더 루트에 쓰기:
    .venv\\Scripts\\python.exe -m app.cli write-shortcut [--url URL]

해석 종류·구역 값을 분류 목록 용어로 맞추기(08) — 먼저 보고서로 확인하고 적용한다:
    .venv\\Scripts\\python.exe -m app.cli vocab-report
    .venv\\Scripts\\python.exe -m app.cli vocab-normalize --apply
    (다시 돌려도 바뀌는 것이 없다. 맞추지 못한 값은 그대로 두고 관리 화면 '목록 밖 값'에 남는다)

한 자료 안 BDF 판 묶음(14)을 모든 자료에 대해 다시 맞추고, 계열 인접 판 비교를 대기열에 넣기(배포 뒤 1회):
    .venv\\Scripts\\python.exe -m app.cli revisions-refresh [--no-diffs]

기존 자료 정비(20) — 필수 분류(호선·구역·해석 종류)가 빠진 확정 BDF 자료 목록과 제목을 새 형식으로 바꿀 목록을
보여 준다(기본은 보기만). --apply 면 바꿀 수 있는 제목을 모두 바꾼다(감사 ENTRY_RETITLE — 관리 화면 '자료 정비'에서
행별로 되돌릴 수 있다). ⚠ 적용 전에 backup 으로 DB 를 백업할 것:
    .venv\\Scripts\\python.exe -m app.cli naming-cleanup [--apply] [--limit N]

21 초안이 자료 폴더에 남긴 보고서 분류 파일(report-catalog.json)을 DB 로 옮기기 — 기본은 계획만 보여 준다.
--apply 면 문서 분류·모델 연결을 DB 에, 프로젝트를 자료 값으로 옮기고 파일 이름을 report-catalog.migrated.json 으로
바꾼다(지우지 않는다). 같은 자료 안 보고서끼리 프로젝트가 다르면 충돌로 보고만 한다. ⚠ 적용 전에 backup:
    .venv\\Scripts\\python.exe -m app.cli report-catalog-migrate [--apply]

문서 분류가 저장되지 않은 확정 자료의 발표 파일(.ppt/.pptx)에 '발표자료'를 저장하기(23) — 기본은 대상 목록만 보여 준다.
화면은 이 파일들을 이미 '발표자료(자동)'로 보이고 거르지만, --apply 면 값을 실제로 저장한다(감사 REPORT_META actor system,
entry.json 갱신). 사용자가 '미분류'로 저장한 파일은 건너뛴다. 다시 돌려도 바뀌는 것이 없다. ⚠ 적용 전에 backup:
    .venv\\Scripts\\python.exe -m app.cli document-type-fill [--apply]

DB 와 공유 폴더 대조(리뷰 7) — 없는 파일, 중단된 이동으로 다른 자리에 있는 파일(반쯤 옮겨짐), DB 행이 없는 폴더를
보고한다(기본은 보기만, 문제가 있으면 종료 코드 1). --fix 면 안전한 경우(staging↔vault 사이 반쯤 옮겨진 파일)만
DB 가 말하는 자리로 파일을 옮긴다(DB 는 고치지 않는다, 폴더는 지우지 않는다):
    .venv\\Scripts\\python.exe -m app.cli verify [--fix]
"""
import argparse
import sys

from sqlalchemy.orm import Session

from . import audit, models
from .config import settings
from .database import SessionLocal, init_schema
from .dependencies import get_storage
from .identifiers import EMPLOYEE_ID_PATTERN
from .schemas import user_snapshot
from .storage.paths import StoragePaths


def create_admin(db: Session, storage: StoragePaths, employee_id: str, name: str,
                 department: str | None) -> models.User:
    employee_id = employee_id.strip().upper()
    if not EMPLOYEE_ID_PATTERN.fullmatch(employee_id):
        raise ValueError(f"올바르지 않은 사번 형식: {employee_id}")
    user = db.query(models.User).filter_by(employee_id=employee_id).first()
    before = user_snapshot(user) if user else None
    if user is None:
        user = models.User(employee_id=employee_id, name=name, department=department)
        db.add(user)
    user.status = "active"
    user.level = 3   # 15 — LV3(관리자)
    audit.record(db, storage, actor="system", action="ADMIN_BOOTSTRAP", target_type="user",
                 target_id=employee_id, before=before, after=user_snapshot(user))
    db.refresh(user)
    from .ops.registry import write_registry

    write_registry(db, storage)  # 05 — 재구축 원천
    return user


def set_level_cli(db: Session, storage: StoragePaths, employee_id: str, level: int) -> models.User:
    """서버 콘솔에서 등급 바꾸기(15). 대상은 WorkBench 활성 사용자(LogBook 에 들어온 적 없어도 된다).
    WorkBench 관리자는 자동 LV3 라 바꿀 수 없고, 내린 뒤 실효 LV3 가 0명이 되면 거부한다."""
    from fastapi import HTTPException

    from .roles import set_level

    try:
        return set_level(db, storage, None, employee_id, level)
    except HTTPException as exc:
        msg = {"user_not_found": f"WorkBench 사용자 표에 없는 사번입니다: {employee_id}",
               "wb_user_inactive": f"WorkBench 에서 활성 사용자가 아닙니다: {employee_id}",
               "wb_admin_locked": "WorkBench 관리자는 LogBook 에서 자동 LV3 입니다(바꿀 수 없음).",
               "wb_unavailable": "WorkBench 사용자 표를 읽을 수 없습니다(LOGBOOK_WB_USERS_TABLE·GRANT SELECT 확인).",
               "last_level3": "마지막 LV3 입니다. 다른 사람을 먼저 LV3 로 지정하세요.",
               "invalid_level": f"알 수 없는 등급: {level}"}.get(exc.detail, str(exc.detail))
        raise ValueError(msg) from exc


def _queued_targets(db: Session, job_type: str) -> set[int]:
    return {t for (t,) in db.query(models.Job.target_id).filter(models.Job.type == job_type,
                                                              models.Job.state == "queued")}


def enqueue_extract_all(db: Session, *, force: bool = False) -> int:
    """휴지통 밖의 추출 가능한 파일 중 다시 뽑아야 할 것을 추출 작업에 넣는다.

    기본: 추출 기록이 없거나, 실패(failed)했거나, 휴지통에 있어 건너뛴(skipped·trashed) 뒤
    복원된 파일. DRM·크기 초과로 건너뛴 파일과 이미 끝났거나(done) 대기 중인(queued) 파일은 둔다.
    force: 상태와 상관없이 휴지통 밖의 추출 가능한 파일 전부."""
    from .extract.job import enqueue_extract

    files = db.query(models.File).filter(models.File.location != "trash").order_by(models.File.id).all()
    rows = {fid: (state, error) for fid, state, error in
            db.query(models.FileExtract.file_id, models.FileExtract.state, models.FileExtract.error)}
    pending = _queued_targets(db, "extract_file")
    n = 0
    for f in files:
        if f.id in pending:  # 이미 대기 중인 작업이 있으면 force 여도 또 넣지 않는다
            continue
        row = rows.get(f.id)
        if not force and row is not None and row[0] != "failed" and row != ("skipped", "trashed"):
            continue
        if enqueue_extract(db, f):
            n += 1
    db.commit()
    return n


def enqueue_convert_all(db: Session, *, force: bool = False, outdated: bool = False,
                        missing_signature: bool = False) -> int:
    """변환 기록이 없거나 실패·휴지통에서 나온 모델을 변환 작업에 넣는다(force 면 휴지통 밖 전부).

    DRM·크기 초과·요소 없음으로 건너뛴 것, 이미 끝났거나(done·include) 대기 중인 것은 둔다.
    outdated: 변환이 끝난(done) 모델 중 lbm 형식 버전이 현재(bdf.lbm.VERSION)보다 낮은 것(NULL = v1)만.
    missing_signature: 변환이 끝난(done) 모델 중 내용 서명이 없거나 규칙 버전(bdf.signature.VERSION)이 다른 것만."""
    from .bdf.lbm import VERSION
    from .bdf.signature import VERSION as SIG_VERSION
    from .convert.job import enqueue_convert

    files = (db.query(models.File).filter(models.File.kind == "model", models.File.location != "trash")
             .order_by(models.File.id).all())
    rows = {r.file_id: r for r in db.query(models.ModelSummary)
            .filter(models.ModelSummary.file_id.in_([f.id for f in files] or [0]))}
    pending = _queued_targets(db, "convert_model")
    n = 0
    for f in files:
        if f.id in pending:  # 이미 대기 중인 작업이 있으면 force 여도 또 넣지 않는다
            continue
        r = rows.get(f.id)
        if outdated:
            if r is not None and r.state == "done" and (r.format_version or 1) < VERSION:
                n += enqueue_convert(db, f)
        elif missing_signature:
            if r is not None and r.state == "done" and (r.sig_geometry is None or r.sig_version != SIG_VERSION):
                n += enqueue_convert(db, f)
        elif force or r is None or r.state == "failed" or (r.state == "skipped" and r.error == "trashed"):
            n += enqueue_convert(db, f)
    db.commit()
    return n


def _cmd_backup() -> int:
    from .ops.backup import BackupError, prune_backups, run_backup

    storage = get_storage()
    try:
        r = run_backup(storage)
    except (BackupError, OSError) as exc:
        # 메시지는 backup 모듈이 비밀번호를 가린 뒤의 것이다
        print(f"오류: {exc}", file=sys.stderr)
        return 2
    removed = prune_backups(storage, settings.backup_keep)
    print(f"백업 완료: {r['file']} ({r['size'] / 1024 / 1024:.1f} MB)"
          + (f", 오래된 백업 {removed}개 정리" if removed else ""))
    return 0


def _cmd_fix_autoinc() -> int:
    from .ops.autoinc import fix_autoinc

    init_schema()
    db = SessionLocal()
    try:
        r = fix_autoinc(db, get_storage())
    except Exception as exc:  # noqa: BLE001 — 잠금 대기 초과 등
        print(f"오류: 자동 증가 값을 바꾸지 못했습니다(API·워커를 멈추고 다시): {type(exc).__name__}", file=sys.stderr)
        return 2
    finally:
        db.close()
    print(f"다음 Entry 번호: E{r['next_id']:06d} (공유 폴더 최대 {r['seen_max']}, DB 최대 {r['db_max']})")
    for eid in r["missing_in_db"]:
        print(f"경고: Vault 에는 있는데 DB 에 없는 Entry — {eid} (덤프 이후 확정된 것일 수 있음)")
    return 0


def _cmd_rebuild(yes: bool, force: bool = False) -> int:
    from .ops.rebuild import RebuildError, rebuild

    storage = get_storage()
    if not yes:
        print(f"빈 DB 에 공유 폴더({storage.root})의 entry.json·registry.json·감사 로그를 읽어 채웁니다. "
              "실행하려면 --yes")
        return 1
    init_schema()
    db = SessionLocal()
    try:
        result = rebuild(db, storage, force=force)
    except RebuildError as exc:
        if str(exc) == "worker_running":
            print("워커가 돌고 있어(최근 심장 박동) 재구축하지 않습니다. 워커를 멈추거나 --force.", file=sys.stderr)
        else:
            print("DB 가 비어 있지 않아 재구축하지 않습니다.", file=sys.stderr)
        return 2
    finally:
        db.close()
    for key, value in result.items():
        if key in ("admins", "missing_in_db"):
            continue
        print(f"{key}: {value}")
    print(f"관리자: {', '.join(result['admins']) or '없음 — create-admin 으로 만드세요'}")
    for eid in result["missing_in_db"]:
        print(f"경고: Vault 에는 있는데 DB 에 없는 Entry — {eid}")
    return 0


_VOCAB_NAMES = {"atype": "해석 종류", "zone": "구역"}


def _print_vocab_report(rep: dict) -> None:
    from .vocab import KINDS

    if rep.get("seeded"):
        verb = "넣었습니다" if rep["applied"] else "넣게 됩니다(아직 비어 있음)"
        print(f"기본 목록을 {verb}: {', '.join(_VOCAB_NAMES[k] for k in rep['seeded'])}")
    for kind in KINDS:
        r = rep[kind]
        print(f"\n[{_VOCAB_NAMES[kind]}] 용어 {len(r['terms'])}개: {', '.join(r['terms'])}")
        if not r["values"]:
            print("  (데이터에 값 없음)")
        for row in r["values"]:
            if row["to"] is None:
                mark = "목록 밖 — 그대로 둠"
            elif row["to"] == row["value"]:
                mark = "용어"
            else:
                mark = f"→ {row['to']}"
            print(f"  {row['value']}  ({row['count']}건)  {mark}")
        print(f"  바꿀 Entry {r['changes']}건 · 목록 밖 값 {len(r['unlisted'])}개")
        if rep["applied"]:
            print(f"  바꾼 Entry {len(r.get('entries', []))}건: {', '.join(r.get('entries', [])) or '-'}")
    if not rep["applied"]:
        print("\n아무것도 바꾸지 않았습니다. 적용하려면: vocab-normalize --apply")


def _cmd_vocab(apply: bool) -> int:
    from .vocab import normalize

    init_schema()
    db = SessionLocal()
    try:
        rep = normalize(db, get_storage(), "system", apply=apply)
    finally:
        db.close()
    _print_vocab_report(rep)
    return 0


def naming_cleanup(db: Session, storage: StoragePaths, *, apply: bool = False, limit: int = 200,
                   out=None) -> dict:
    """20 — 자료 정비 보고(그리고 --apply 면 제목 적용). 화면 '자료 정비'와 같은 함수(entries.cleanup)."""
    from .entries import cleanup

    out = out or sys.stdout
    miss = cleanup.missing_list(db, None, limit=cleanup.MAX_LIMIT)
    labels = cleanup.MISSING_LABELS
    print(f"[필수 분류가 빠진 확정 BDF 자료] {miss['total']}건 — "
          + ", ".join(f"{labels[k]} {n}" for k, n in miss["counts"].items()), file=out)
    for it in miss["items"][:limit]:
        print(f"  {it['entry_id']}  {it['title']}  — 빠짐: {', '.join(labels[k] for k in it['missing'])}"
              f"  (올린 사람 {it['uploaded_by'] or '-'})", file=out)
    if miss["total"] > limit:
        print(f"  … 외 {miss['total'] - limit}건(관리 화면 '자료 정비'에서 모두 볼 수 있습니다)", file=out)
    prev = cleanup.title_preview(db, None, limit=cleanup.MAX_LIMIT)
    ready = [p for p in prev["items"] if p["status"] == "ready"]
    blocked = [p for p in prev["items"] if p["status"] == "blocked"]
    print(f"\n[제목을 새 형식으로] 바꿀 수 있음 {prev['counts']['ready']}건 · 제외 {prev['counts']['blocked']}건", file=out)
    for p in ready[:limit]:
        print(f"  {p['entry_id']}  {p['title']}  →  {p['new_title']}", file=out)
    for p in blocked[:limit]:
        print(f"  {p['entry_id']}  {p['title']}  (제외: {p['reason']})", file=out)
    result = {"missing": miss["total"], "ready": prev["counts"]["ready"], "blocked": prev["counts"]["blocked"],
              "applied": 0, "skipped": []}
    if not apply:
        print("\n아무것도 바꾸지 않았습니다. 제목을 바꾸려면(먼저 backup 권장): naming-cleanup --apply", file=out)
        return result
    # 미리보기는 MAX_LIMIT 건까지만 싣는다 — 적용은 남은 것이 없을 때까지 되풀이한다(적용한 것은 다음 미리보기에서 빠진다)
    seen: set[str] = set()
    while True:
        todo = [p for p in cleanup.title_preview(db, None, status="ready", limit=cleanup.MAX_LIMIT)["items"]
                if p["entry_id"] not in seen]
        if not todo:
            break
        seen.update(p["entry_id"] for p in todo)
        r = cleanup.apply_titles(db, storage, [{"entry_id": p["entry_id"], "version": p["version"],
                                                "new_title": p["new_title"]} for p in todo], system_actor="system")
        result["applied"] += len(r["applied"])
        result["skipped"] += r["skipped"]
    print(f"\n제목을 바꾼 자료 {result['applied']}건" + (f", 건너뜀 {len(result['skipped'])}건" if result["skipped"] else "")
          + " — 관리 화면 '자료 정비 › 바꾼 기록'에서 되돌릴 수 있습니다.", file=out)
    for sk in result["skipped"]:
        print(f"  건너뜀 {sk['entry_id']}: {sk['reason']}", file=out)
    return result


def report_catalog_migrate(db: Session, storage: StoragePaths, *, apply: bool = False, out=None) -> dict:
    """21 — 예전 report-catalog.json(공유 폴더) → DB(report_meta·report_model_links) + '호선 없음(공용)'."""
    from .report_catalog import migrate_sidecars

    out = out or sys.stdout
    plan = migrate_sidecars(db, storage, apply=apply)
    todo = [e for e in plan["entries"] if e["no_hull"] or e["reports"]]
    print(f"[report-catalog.json 이 있는 자료] {len(plan['entries'])}건 — 옮길 것이 있는 자료 {len(todo)}건", file=out)
    for e in todo:
        parts = []
        if e["no_hull"]:
            parts.append("호선 없음(공용)")
        for r in e["reports"]:
            parts.append(f"{r['report']}: 문서 분류 {r['document_type'] or '-'}, 모델 연결 {r['models']}개")
        print(f"  {e['entry_id']}  " + " / ".join(parts), file=out)
    for u in plan["unreadable"]:
        print(f"  [읽지 못함] {u['entry_id']}  {u['reason']}", file=out)
    for st in plan["stale"]:
        print(f"  [건너뜀 — 파일이 바뀌었거나 없음] {st['entry_id']}  {st['report']}", file=out)
    for un in plan["unresolved"]:
        m = un["model"]
        print(f"  [연결할 모델을 찾지 못함] {un['entry_id']}  {un['report']} → {m.get('entry_id')}/{m.get('rel_path')}",
              file=out)
    if not apply:
        print("\n아무것도 바꾸지 않았습니다. 옮기려면(먼저 backup 권장): report-catalog-migrate --apply", file=out)
    else:
        print(f"\n옮김: 문서 분류 {plan['meta']}건 · 모델 연결 {plan['links']}건 · "
              f"공용 {plan['no_hull']}건 · 이름을 바꾼 파일 {plan['renamed']}개(report-catalog.migrated.json)", file=out)
    return plan


def plm_fill(db: Session, storage: StoragePaths, *, only_unchecked: bool = False, out=None) -> int:
    """30 — 사내 PLM(VT_PLM_SHIP)에서 호선 선박 정보를 채운다. 선종은 비어 있는 호선만 선형으로."""
    from fastapi import HTTPException

    from .hull_info import fill_from_plm

    out = out or sys.stdout
    try:
        r = fill_from_plm(db, storage, "system", only_unchecked=only_unchecked)
    except HTTPException as exc:
        print(f"PLM 조회 실패: {exc.detail}", file=out)
        return 2
    print(f"조회 {r['checked']}건 — 찾음 {r['found']} · 없음 {r['not_found']} · 선종 채움 {r['filled']}", file=out)
    return 0


def document_type_fill(db: Session, storage: StoragePaths, *, apply: bool = False, out=None) -> dict:
    """23 — 문서 분류가 저장되지 않은 확정 자료의 .ppt/.pptx → '발표자료' 저장(기본은 목록만)."""
    from .report_catalog import fill_document_types

    out = out or sys.stdout
    plan = fill_document_types(db, storage, apply=apply)
    print(f"[문서 분류가 저장되지 않은 발표 파일(.ppt/.pptx)] {len(plan['items'])}건", file=out)
    for it in plan["items"]:
        print(f"  {it['entry_id']}  {it['report']} → {it['document_type']}", file=out)
    if plan["kept"]:
        print(f"[건너뜀 — '미분류'로 저장된 발표 파일] {len(plan['kept'])}건", file=out)
        for it in plan["kept"]:
            print(f"  {it['entry_id']}  {it['report']}", file=out)
    if not apply:
        print("\n아무것도 바꾸지 않았습니다. 저장하려면(먼저 backup 권장): document-type-fill --apply", file=out)
    else:
        print(f"\n문서 분류를 저장한 파일 {plan['filled']}건(감사 '문서 분류 변경', 사용자 system).", file=out)
    return plan


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create-admin", help="관리자(LV3) 계정을 만들거나 기존 계정을 LV3 로 올린다")
    p.add_argument("employee_id")
    p.add_argument("name")
    p.add_argument("department", nargs="?")
    q = sub.add_parser("enqueue-extract", help="본문 추출이 안 된 파일을 워커 작업에 넣는다")
    q.add_argument("--force", action="store_true", help="상태와 상관없이 휴지통 밖 파일 전부 다시")
    c = sub.add_parser("enqueue-convert", help="BDF 변환이 안 된 모델 파일을 워커 작업에 넣는다")
    cg = c.add_mutually_exclusive_group()
    cg.add_argument("--force", action="store_true", help="상태와 상관없이 휴지통 밖 모델 파일 전부 다시")
    cg.add_argument("--outdated", action="store_true", help="lbm 형식이 옛 버전(현재보다 낮음)인 변환 완료 모델만 다시")
    cg.add_argument("--missing-signature", action="store_true",
                    help="내용 서명(같은 BDF 찾기)이 없거나 옛 규칙인 변환 완료 모델만 다시")
    v = sub.add_parser("enqueue-solve-check", help="변환이 끝난 모델을 해석 검증(Nastran) 작업에 넣는다")
    v.add_argument("--all", action="store_true", help="이미 검증한 모델도 다시(검증 중인 것은 제외)")
    sub.add_parser("backup", help="mysqldump 로 DB 를 80_Backup 에 백업하고 오래된 백업을 정리한다")
    t = sub.add_parser("purge-trash", help="보관 기간이 지난 휴지통 Entry 를 영구 삭제한다(수동 실행용)")
    t.add_argument("--days", type=int, default=None, help="보관일(기본: LOGBOOK_TRASH_DAYS)")
    r = sub.add_parser("rebuild", help="빈 DB 를 공유 폴더(entry.json·registry.json·감사 로그)로 다시 채운다")
    r.add_argument("--yes", action="store_true", help="실제로 실행한다(없으면 안내만)")
    r.add_argument("--force", action="store_true", help="워커 심장 박동이 최근이어도 실행한다")
    sub.add_parser("fix-autoinc", help="Entry 자동 증가 값을 공유 폴더·감사 로그의 최대 번호 다음으로 올린다(덤프 복원 뒤)")
    w = sub.add_parser("write-shortcut", help="공유 폴더 루트에 Logbook.url(Hi-TESS LogBook 바로가기)과 사용 안내문을 쓴다")
    w.add_argument("--url", default=None, help="접속 주소(기본: LOGBOOK_PUBLIC_URL)")
    sr = sub.add_parser("set-level", help="LogBook 등급 바꾸기(15) — 1 게스트 | 2 일반 | 3 관리자")
    sr.add_argument("employee_id")
    sr.add_argument("level", type=int, choices=(1, 2, 3))
    lg = sub.add_parser("level-guest", help="31 — 관리자가 아닌 LV2 사용자를 모두 LV1(게스트)로 내린다(--apply 없으면 보고만)")
    lg.add_argument("--apply", action="store_true", help="실제로 바꾼다")
    rv = sub.add_parser("revisions-refresh", help="모든 자료의 BDF 판 묶음(14)을 다시 맞추고 인접 판 비교를 넣는다")
    rv.add_argument("--no-diffs", action="store_true", help="판 묶음만 맞추고 비교 작업은 넣지 않는다")
    sub.add_parser("vocab-report", help="해석 종류·구역 값이 분류 목록 용어로 어떻게 맞춰질지 보고한다(쓰지 않음)")
    n = sub.add_parser("vocab-normalize", help="해석 종류·구역 값을 분류 목록 용어로 맞춘다(--apply 없으면 보고만)")
    n.add_argument("--apply", action="store_true", help="실제로 바꾼다(감사 로그·entry.json 갱신)")
    nc = sub.add_parser("naming-cleanup", help="필수 분류가 빠진 자료·새 형식 제목 목록(20) — --apply 면 제목을 바꾼다")
    nc.add_argument("--apply", action="store_true", help="바꿀 수 있는 제목을 실제로 바꾼다(감사 ENTRY_RETITLE)")
    nc.add_argument("--limit", type=int, default=200, help="목록마다 출력할 줄 수(기본 200)")
    rc = sub.add_parser("report-catalog-migrate",
                        help="예전 report-catalog.json 을 DB 로 옮긴다(21) — --apply 없으면 계획만")
    rc.add_argument("--apply", action="store_true", help="실제로 옮긴다(감사 기록·entry.json 갱신, 파일 이름 바꿈)")
    df = sub.add_parser("document-type-fill",
                        help="문서 분류가 없는 확정 자료의 .ppt/.pptx 에 '발표자료'를 저장한다(23) — --apply 없으면 목록만")
    df.add_argument("--apply", action="store_true", help="실제로 저장한다(감사 REPORT_META·entry.json 갱신)")
    pf = sub.add_parser("plm-fill", help="30 — 사내 PLM 에서 호선 선박 정보를 한 번에 조회해 채운다(선종은 빈 것만)")
    pf.add_argument("--unchecked", action="store_true", help="아직 조회하지 않은 호선만(기본: 못 찾은 것·선종 빈 것도)")
    pc = sub.add_parser("plm-check", help="30 — PLM 접속 환경(모드·tnsnames 항목)을 보이고 호선 하나를 조회해 본다(바꾸지 않음)")
    pc.add_argument("ship_no", nargs="?", default="3370")
    vf = sub.add_parser("verify", help="DB 의 파일 위치와 공유 폴더를 대조한다(기본은 보고만)")
    vf.add_argument("--fix", action="store_true",
                    help="staging↔vault 사이 반쯤 옮겨진 파일만 DB 가 말하는 자리로 옮긴다")
    args = parser.parse_args(argv)

    if args.cmd == "plm-check":
        from . import plm_ship
        for line in plm_ship.diagnose(args.ship_no):
            print(line)
        return 0
    if args.cmd == "vocab-report":
        return _cmd_vocab(False)
    if args.cmd == "vocab-normalize":
        return _cmd_vocab(args.apply)
    if args.cmd == "backup":
        return _cmd_backup()
    if args.cmd == "rebuild":
        return _cmd_rebuild(args.yes, args.force)
    if args.cmd == "fix-autoinc":
        return _cmd_fix_autoinc()
    if args.cmd == "write-shortcut":
        from .ops.shortcut import write_shortcut

        url = args.url or settings.public_url
        try:
            names = write_shortcut(get_storage(), url)
        except OSError as exc:
            print(f"오류: {exc}", file=sys.stderr)
            return 2
        print(f"바로가기를 썼습니다({url}): {', '.join(names)}")
        return 0

    init_schema()
    db = SessionLocal()
    try:
        if args.cmd == "set-level":
            from .access import LEVEL_LABELS

            u = set_level_cli(db, get_storage(), args.employee_id, args.level)
            print(f"등급 변경: {u.employee_id} {u.name} → LV{u.level} {LEVEL_LABELS[u.level]}")
            return 0
        if args.cmd == "level-guest":
            from .roles import reset_to_guest

            rows = reset_to_guest(db, get_storage(), apply=args.apply)
            for u in rows:
                print(f"  {u.employee_id} {u.name} {u.department or ''}")
            verb = "LV1 로 내렸습니다" if args.apply else "LV1 로 내릴 대상입니다(--apply 로 실행)"
            print(f"{len(rows)}명 {verb}. WorkBench 관리자와 LV3 지정자는 그대로입니다.")
            return 0
        if args.cmd == "naming-cleanup":
            naming_cleanup(db, get_storage(), apply=args.apply, limit=max(1, args.limit))
            return 0
        if args.cmd == "report-catalog-migrate":
            report_catalog_migrate(db, get_storage(), apply=args.apply)
            return 0
        if args.cmd == "document-type-fill":
            document_type_fill(db, get_storage(), apply=args.apply)
            return 0
        if args.cmd == "plm-fill":
            return plm_fill(db, get_storage(), only_unchecked=args.unchecked)
        if args.cmd == "verify":
            from .ops.verify import has_problems, verify

            result = verify(db, get_storage(), fix=args.fix, out=sys.stdout)
            return 1 if has_problems(result) else 0
        if args.cmd == "revisions-refresh":
            from .revisions.service import refresh_all

            entries, queued = refresh_all(db, diffs=not args.no_diffs)
            print(f"판 묶음을 다시 맞춘 자료 {entries}건, 넣은 비교 작업 {queued}건.")
            return 0
        if args.cmd == "enqueue-extract":
            print(f"추출 작업 {enqueue_extract_all(db, force=args.force)}건을 넣었습니다.")
            return 0
        if args.cmd == "purge-trash":
            from .ops.purge import purge_expired

            days = settings.trash_days if args.days is None else args.days
            n = purge_expired(db, get_storage(), days)
            print(f"휴지통에서 {days}일 지난 Entry {n}건을 영구 삭제했습니다.")
            return 0
        if args.cmd == "enqueue-solve-check":
            from .solve.job import enqueue_solve_all

            n = enqueue_solve_all(db, force=args.all, requested_by="system")
            print(f"해석 검증 작업 {n}건을 넣었습니다." + (" (전체 다시)" if args.all else ""))
            return 0
        if args.cmd == "enqueue-convert":
            n = enqueue_convert_all(db, force=args.force, outdated=args.outdated,
                                    missing_signature=args.missing_signature)
            note = " (옛 형식 모델)" if args.outdated else " (내용 서명 없는 모델)" if args.missing_signature else ""
            print(f"변환 작업 {n}건을 넣었습니다." + note)
            return 0
        u = create_admin(db, get_storage(), args.employee_id, args.name, args.department)
    except ValueError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 2
    finally:
        db.close()
    print(f"관리자 준비됨: {u.employee_id} {u.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
