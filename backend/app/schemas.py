"""요청 본문 모델과 응답 변환."""
from pydantic import BaseModel, ConfigDict, Field

from . import models


class RegisterRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    employee_id: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=100)
    position: str | None = Field(default=None, max_length=50)


class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    employee_id: str = Field(min_length=1, max_length=20)


class AdminFlagRequest(BaseModel):
    is_admin: bool


def user_to_dict(u: models.User) -> dict:
    return {
        "id": u.id,
        "employee_id": u.employee_id,
        "name": u.name,
        "department": u.department,
        "position": u.position,
        "status": u.status,
        "is_admin": bool(u.is_admin),
        "login_count": u.login_count or 0,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def user_snapshot(u: models.User) -> dict:
    """감사 로그용 — 바뀔 수 있는 필드만."""
    return {"status": u.status, "is_admin": bool(u.is_admin), "name": u.name,
            "department": u.department, "position": u.position}
