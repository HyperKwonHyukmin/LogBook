"""파일 소유자(Windows 보안 설명자)로 올린 사람을 추정한다(PoC 실험 4 로 검증된 방식)."""
import os
from functools import lru_cache

from sqlalchemy.orm import Session

from .. import models
from ..storage.paths import to_long


@lru_cache(maxsize=256)
def _lookup_account(sid_string: str):
    """SID(문자열) → (계정명, 도메인, SID 종류). 도메인 컨트롤러 왕복이 걸릴 수 있어
    SID 로 캐싱한다 — 같은 폴더의 파일 수천 개가 보통 같은 소유자다."""
    import win32security

    sid = win32security.ConvertStringSidToSid(sid_string)
    return win32security.LookupAccountSid(None, sid)


def owner_account(path: str | os.PathLike) -> str | None:
    """사용자 계정이 소유자면 소문자 계정명('a476854'), 그룹 소유·실패면 None."""
    try:
        import win32security

        sd = win32security.GetFileSecurity(to_long(path), win32security.OWNER_SECURITY_INFORMATION)
        sid_string = win32security.ConvertSidToStringSid(sd.GetSecurityDescriptorOwner())
        name, _domain, sid_type = _lookup_account(sid_string)
    except Exception:
        return None
    return name.lower() if sid_type == win32security.SidTypeUser else None


def employee_for_account(db: Session, account: str | None) -> str | None:
    if not account:
        return None
    employee_id = account.upper()
    exists = db.query(models.User.id).filter_by(employee_id=employee_id).first()
    return employee_id if exists else None
