"""74 — 팀 관리 API(LV3 만). 팀원 명단은 관리자만 고친다(사용자 결정 2026-11-25)."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models, teams
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_admin, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/admin/teams", tags=["teams"])
# 74 3단계 — 팀 공간(그 팀원과 LV3). 업무별 모음 맨 위 팀 줄과 팀 공간 화면 머리
space_router = APIRouter(prefix="/api/teams", tags=["teams"])


@space_router.get("")
def my_spaces(db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return teams.spaces_for(db, user)


@space_router.get("/{team_id}")
def team_space(team_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    return teams.space(db, user, team_id)


class TeamBody(BaseModel):
    name: str = Field(min_length=1, max_length=teams.NAME_MAX)
    description: str | None = Field(default=None, max_length=teams.DESC_MAX)


class TeamPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=teams.NAME_MAX)
    description: str | None = Field(default=None, max_length=teams.DESC_MAX)


class MembersBody(BaseModel):
    employee_ids: list[str] = Field(min_length=1, max_length=teams.ADD_LIMIT)


@router.get("")
def list_teams(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return teams.list_teams(db)


@router.post("")
def create_team(body: TeamBody, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    t = teams.create(db, storage, admin, body.name, body.description, client_ip(request))
    return teams.team_to_dict(db, t)


@router.patch("/{team_id}")
def patch_team(team_id: int, body: TeamPatch, request: Request, db: Session = Depends(get_db),
               storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    t = teams.update(db, storage, admin, team_id, body.model_dump(exclude_unset=True), client_ip(request))
    return teams.team_to_dict(db, t)


@router.delete("/{team_id}")
def delete_team(team_id: int, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    teams.delete(db, storage, admin, team_id, client_ip(request))
    return {"ok": True}


@router.post("/{team_id}/members")
def add_members(team_id: int, body: MembersBody, request: Request, db: Session = Depends(get_db),
                storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    teams.add_members(db, storage, admin, team_id, body.employee_ids, client_ip(request))
    return teams.team_to_dict(db, teams.get_team(db, team_id))


@router.delete("/{team_id}/members/{employee_id}")
def remove_member(team_id: int, employee_id: str, request: Request, db: Session = Depends(get_db),
                  storage: StoragePaths = Depends(get_storage), admin: models.User = Depends(require_admin)):
    teams.remove_member(db, storage, admin, team_id, employee_id, client_ip(request))
    return teams.team_to_dict(db, teams.get_team(db, team_id))
