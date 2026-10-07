"""관리 명령.

첫 관리자 만들기 (backend 폴더):
    .venv\\Scripts\\python.exe -m app.cli create-admin A476854 권혁민 구조시스템연구실

기존 파일(03 이전에 올라온 것)을 본문 추출 대기열에 넣기:
    .venv\\Scripts\\python.exe -m app.cli enqueue-extract [--force]

기존 BDF(04a 이전에 올라온 것)를 변환 대기열에 넣기:
    .venv\\Scripts\\python.exe -m app.cli enqueue-convert [--force | --outdated]
    (--outdated: 변환은 끝났지만 lbm 형식이 옛 버전인 모델만 — 04c 형식 v2 로 다시 변환)

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
    user.is_admin = True
    audit.record(db, storage, actor="system", action="ADMIN_BOOTSTRAP", target_type="user",
                 target_id=employee_id, before=before, after=user_snapshot(user))
    db.refresh(user)
    from .ops.registry import write_registry

    write_registry(db, storage)  # 05 — 재구축 원천
    return user


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


def enqueue_convert_all(db: Session, *, force: bool = False, outdated: bool = False) -> int:
    """변환 기록이 없거나 실패·휴지통에서 나온 모델을 변환 작업에 넣는다(force 면 휴지통 밖 전부).

    DRM·크기 초과·요소 없음으로 건너뛴 것, 이미 끝났거나(done·include) 대기 중인 것은 둔다.
    outdated: 변환이 끝난(done) 모델 중 lbm 형식 버전이 현재(bdf.lbm.VERSION)보다 낮은 것(NULL = v1)만."""
    from .bdf.lbm import VERSION
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


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create-admin", help="관리자 계정을 만들거나 기존 계정을 관리자로 승격")
    p.add_argument("employee_id")
    p.add_argument("name")
    p.add_argument("department", nargs="?")
    q = sub.add_parser("enqueue-extract", help="본문 추출이 안 된 파일을 워커 작업에 넣는다")
    q.add_argument("--force", action="store_true", help="상태와 상관없이 휴지통 밖 파일 전부 다시")
    c = sub.add_parser("enqueue-convert", help="BDF 변환이 안 된 모델 파일을 워커 작업에 넣는다")
    cg = c.add_mutually_exclusive_group()
    cg.add_argument("--force", action="store_true", help="상태와 상관없이 휴지통 밖 모델 파일 전부 다시")
    cg.add_argument("--outdated", action="store_true", help="lbm 형식이 옛 버전(현재보다 낮음)인 변환 완료 모델만 다시")
    v = sub.add_parser("enqueue-solve-check", help="변환이 끝난 모델을 해석 검증(Nastran) 작업에 넣는다")
    v.add_argument("--all", action="store_true", help="이미 검증한 모델도 다시(검증 중인 것은 제외)")
    sub.add_parser("backup", help="mysqldump 로 DB 를 80_Backup 에 백업하고 오래된 백업을 정리한다")
    t = sub.add_parser("purge-trash", help="보관 기간이 지난 휴지통 Entry 를 영구 삭제한다(수동 실행용)")
    t.add_argument("--days", type=int, default=None, help="보관일(기본: LOGBOOK_TRASH_DAYS)")
    r = sub.add_parser("rebuild", help="빈 DB 를 공유 폴더(entry.json·registry.json·감사 로그)로 다시 채운다")
    r.add_argument("--yes", action="store_true", help="실제로 실행한다(없으면 안내만)")
    r.add_argument("--force", action="store_true", help="워커 심장 박동이 최근이어도 실행한다")
    sub.add_parser("fix-autoinc", help="Entry 자동 증가 값을 공유 폴더·감사 로그의 최대 번호 다음으로 올린다(덤프 복원 뒤)")
    w = sub.add_parser("write-shortcut", help="공유 폴더 루트에 Logbook.url 과 사용 안내문을 쓴다")
    w.add_argument("--url", default=None, help="접속 주소(기본: LOGBOOK_PUBLIC_URL)")
    sub.add_parser("vocab-report", help="해석 종류·구역 값이 분류 목록 용어로 어떻게 맞춰질지 보고한다(쓰지 않음)")
    n = sub.add_parser("vocab-normalize", help="해석 종류·구역 값을 분류 목록 용어로 맞춘다(--apply 없으면 보고만)")
    n.add_argument("--apply", action="store_true", help="실제로 바꾼다(감사 로그·entry.json 갱신)")
    args = parser.parse_args(argv)

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
            n = enqueue_convert_all(db, force=args.force, outdated=args.outdated)
            print(f"변환 작업 {n}건을 넣었습니다." + (" (옛 형식 모델)" if args.outdated else ""))
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
