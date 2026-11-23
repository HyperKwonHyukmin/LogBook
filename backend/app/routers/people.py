"""46 — 담당자 명부 API(찾기·만들기·고치기). 자료에 붙이기는 PATCH /api/entries/{id} 의 assignees."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models, people, profile
from ..favorites import favorite_entry_ids
from ..database import get_db
from ..dependencies import client_ip, get_storage, require_auth
from ..storage.paths import StoragePaths

router = APIRouter(prefix="/api/people", tags=["people"])


class PersonBody(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=100)
    position: str | None = Field(default=None, max_length=50)
    employed: bool = True


class PersonPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    department: str | None = Field(default=None, max_length=100)
    position: str | None = Field(default=None, max_length=50)
    employed: bool | None = None


@router.get("")
def search_people(q: str = "", db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """명부 + WorkBench 활성 사용자(명부에 없는 사람은 id 가 None — 고르면 사번으로 명부에 들어간다)."""
    return people.search(db, q)


@router.post("")
def create_person(body: PersonBody, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """WorkBench 에 없는 사람(퇴사자·외부 인원 등)을 이름·부서·직책으로 만든다."""
    return people.person_to_dict(people.create(db, user, body.model_dump()))


def _with_favorites(db: Session, user: models.User, d: dict) -> dict:
    """10 — 목록 행마다 내 즐겨찾기 여부(한 번의 질의, 호선 화면과 같다)."""
    rows = [e for m in d["timeline"] for e in m["entries"]]
    mine = favorite_entry_ids(db, user.employee_id, [e["entry_id"] for e in rows])
    for e in rows:
        e["favorite"] = e["entry_id"] in mine
    return d


@router.get("/by-employee/{employee_id}/profile")
def profile_by_employee(employee_id: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """67 — 사번으로 프로필 카드(작성자, 호선 참여자처럼 사번만 아는 곳). 명부에 없으면 사용자 정보로."""
    person, user_row = profile.resolve(db, employee_id=employee_id)
    return _with_favorites(db, user, profile.person_profile(db, person, user_row, user))


@router.get("/{person_id}/profile")
def person_profile(person_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    """67 — 담당자 프로필 카드(명부 번호). 숫자는 보는 사람이 볼 수 있는 확정 자료로만 센다."""
    person, user_row = profile.resolve(db, person_id=person_id)
    return _with_favorites(db, user, profile.person_profile(db, person, user_row, user))


@router.patch("/{person_id}")
def patch_person(person_id: int, body: PersonPatch, request: Request, db: Session = Depends(get_db),
                 storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    """이름·부서·직책·재직 고치기(LV2 이상) — 그 사람이 담당인 모든 자료에 함께 보인다."""
    p = db.get(models.Person, person_id)
    if p is None:
        raise HTTPException(status_code=404, detail="person_not_found")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is None:
        raise HTTPException(status_code=422, detail="name_required")
    return people.person_to_dict(people.update(db, storage, p, user, data, client_ip(request)))
