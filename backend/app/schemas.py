"""요청 본문 모델과 응답 변환."""
from pydantic import BaseModel, ConfigDict, Field

from . import models


class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    employee_id: str = Field(min_length=1, max_length=20)


class LevelRequest(BaseModel):
    """15 — LogBook 등급 1(게스트)·2(일반)·3(관리자)."""
    level: int = Field(ge=1, le=3)


def user_to_dict(u: models.User) -> dict:
    from .access import level_of  # 순환 import 방지

    lv = level_of(u)
    return {
        "id": u.id,
        "employee_id": u.employee_id,
        "name": u.name,
        "department": u.department,
        "position": u.position,
        "status": u.status,
        # 15 — level = 실효 등급(WorkBench 관리자면 3), stored_level = LogBook 에 저장한 값
        "level": lv,
        "stored_level": u.level or 1,
        "wb_admin": bool(u.wb_admin),
        "is_admin": lv >= 3,
        "login_count": u.login_count or 0,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def user_snapshot(u: models.User) -> dict:
    """감사 로그용 — 바뀔 수 있는 필드만."""
    return {"level": u.level or 1, "wb_admin": bool(u.wb_admin), "name": u.name,
            "department": u.department, "position": u.position}
