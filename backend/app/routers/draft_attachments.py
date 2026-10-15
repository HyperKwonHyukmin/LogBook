from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth, get_storage
from ..storage.paths import StoragePaths
from ..entries.draft_attachments import release_batch

router = APIRouter(prefix="/api/entries", tags=["draft-attachments"])


@router.post("/{entry_id}/attachments/{key}/release")
def release(entry_id: str, key: str, db: Session = Depends(get_db), user: models.User = Depends(require_auth),
            storage: StoragePaths = Depends(get_storage)):
    release_batch(db, user, entry_id, key, storage=storage)
    return {"ok": True}
