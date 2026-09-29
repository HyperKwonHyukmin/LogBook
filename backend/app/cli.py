"""관리 명령.

첫 관리자 만들기 (backend 폴더):
    .venv\\Scripts\\python.exe -m app.cli create-admin A476854 권혁민 구조시스템연구실
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


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create-admin", help="관리자 계정을 만들거나 기존 계정을 관리자로 승격")
    p.add_argument("employee_id")
    p.add_argument("name")
    p.add_argument("department", nargs="?")
    args = parser.parse_args(argv)

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
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
