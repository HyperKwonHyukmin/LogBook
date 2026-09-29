"""관리 명령.

첫 관리자 만들기 (backend 폴더):
    .venv\\Scripts\\python.exe -m app.cli create-admin A476854 권혁민 구조시스템연구실

기존 파일(03 이전에 올라온 것)을 본문 추출 대기열에 넣기:
    .venv\\Scripts\\python.exe -m app.cli enqueue-extract [--force]
"""
import argparse
import sys

from sqlalchemy.orm import Session

from . import audit, models
from .database import Base, SessionLocal, engine
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
    return user


def enqueue_extract_all(db: Session, *, force: bool = False) -> int:
    """휴지통 밖의 추출 가능한 파일 중 다시 뽑아야 할 것을 추출 작업에 넣는다.

    기본: 추출 기록이 없거나, 실패(failed)했거나, 휴지통에 있어 건너뛴(skipped·trashed) 뒤
    복원된 파일. DRM·크기 초과로 건너뛴 파일과 이미 끝났거나(done) 대기 중인(queued) 파일은 둔다.
    force: 상태와 상관없이 휴지통 밖의 추출 가능한 파일 전부."""
    from .extract.job import enqueue_extract

    files = db.query(models.File).filter(models.File.location != "trash").order_by(models.File.id).all()
    rows = {fid: (state, error) for fid, state, error in
            db.query(models.FileExtract.file_id, models.FileExtract.state, models.FileExtract.error)}
    n = 0
    for f in files:
        row = rows.get(f.id)
        if not force and row is not None and row[0] != "failed" and row != ("skipped", "trashed"):
            continue
        if enqueue_extract(db, f):
            n += 1
    db.commit()
    return n


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create-admin", help="관리자 계정을 만들거나 기존 계정을 관리자로 승격")
    p.add_argument("employee_id")
    p.add_argument("name")
    p.add_argument("department", nargs="?")
    q = sub.add_parser("enqueue-extract", help="본문 추출이 안 된 파일을 워커 작업에 넣는다")
    q.add_argument("--force", action="store_true", help="상태와 상관없이 휴지통 밖 파일 전부 다시")
    args = parser.parse_args(argv)

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if args.cmd == "enqueue-extract":
            print(f"추출 작업 {enqueue_extract_all(db, force=args.force)}건을 넣었습니다.")
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
