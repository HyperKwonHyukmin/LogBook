# Logbook 02b — 올리기 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 크롬에서 폴더·여러 파일을 올리고(DRM 파일 거부), 정리 대기 화면에서 묶음을 고쳐 확정하고, 휴지통에서 복원하는 화면을 만든다.

**Architecture:** 백엔드에 웹 업로드 API(`/api/uploads`)를 더한다 — 배치를 `uploading` 상태로 만들고 8MB 조각을 `00_Inbox\_web\<key>\<rel>` 에 이어 쓴 뒤, 끝나면 폴더째 `10_Vault\_staging\<key>` 로 rename 하고 02a 의 `process_batch` 작업을 건다(Inbox 감시기는 `_web` 을 이미 건너뛴다). 첫 조각이 `HHIDRMC` 로 시작하면 그 파일은 거부한다. 프런트는 `/inbox`(업로드 영역 + 배치·초안 카드 편집·확정)와 `/trash`(복원)를 02a API 위에 만든다.

**Tech Stack:** FastAPI · SQLAlchemy 2.0 · MySQL 8 / React 19 · react-router 7 · Tailwind v4 · lucide-react · Vitest 5 + Testing Library

**설계 근거:** `docs/specs/2026-09-28-logbook-design.md` §3(저장소 구조), §5.1(크롬 업로드·DRM 거부), §5.2(중복 표시), §5.5(정리 대기 화면), §6.1(`/inbox`·`/trash`), §6.4(디자인), §8(휴지통), §9(연결 끊김 시 업로드 차단)

---

## 공통 규칙 (모든 태스크)

- 백엔드 명령은 `C:\Coding\Logbook\backend` 에서, 프런트 명령은 `C:\Coding\Logbook\frontend` 에서 실행한다.
- **pytest 는 한 번에 하나만(순차)** — 테스트 DB `logbook_test` 를 공유한다. 병렬 실행 금지.
- **`backend\.env` 는 어떤 방법으로도 열지 않는다**(cat/type/Get-Content/Read 모두 금지). DB 계정은 건드리지 않는다.
- **git 명령 금지**(add/commit/push 포함). 각 태스크의 "커밋" 단계는 사람이 한다.
- 공유 폴더(`\\storage.hpc.hd.com\...`) 경로는 항상 `to_long()` / `long_join()` 을 거친다(개발 PC 는 LongPathsEnabled=0).
- 파일은 `read()` 한 바이트 기준으로만 다룬다. 로컬 C: 에 쓴 파일은 DRM 이 암호화한다(`HHIDRMC` + 4096B). 공유 폴더에 쓴 파일은 평문이다.
- 화면 문구·주석은 한국어로 쓴다. 색은 `index.css` 의 토큰(`brand`, `ok`, `wait`, `err`, `line`, `canvas`)만 쓴다.
- 실제 호선·기밀 자료를 테스트나 저장소에 넣지 않는다. 가상 호선은 `9999` 를 쓴다.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `backend/app/storage/paths.py` (수정) | `StoragePaths.web_inbox` (`00_Inbox\_web`) |
| `backend/app/uploads/__init__.py` (새) | 빈 패키지 |
| `backend/app/uploads/service.py` (새) | 상대경로 검증, 업로드 시작·조각 쓰기·마치기·취소, 방치 업로드 정리 |
| `backend/app/routers/uploads.py` (새) | `/api/uploads` API |
| `backend/app/routers/suggest.py` (새) | `/api/suggest` 자동완성(호선·구역·해석 종류) |
| `backend/app/entries/service.py` (수정) | `entry_to_dict` 에 중복 대상·제안 Entry 번호 추가 |
| `backend/app/ingest/process.py` (수정) | 이미 있던 `batch.excluded`(DRM 거부 목록)를 보존 |
| `backend/app/worker.py` (수정) | 매 주기 방치 업로드 정리 |
| `backend/app/main.py` (수정) | 라우터 등록 |
| `frontend/src/api/client.js` (수정) | `apiBinary()` — 조각 PUT |
| `frontend/src/lib/upload.js` (새) | 드롭 항목 수집(폴더 재귀), DRM 머리 검사, 조각 업로드 |
| `frontend/src/lib/labels.js` (새) | 파일 종류·배치 상태·감사 동작 라벨(한 곳) |
| `frontend/src/components/ui/KindBadge.jsx` (새) | 파일 종류 배지 |
| `frontend/src/components/ui/ChipInput.jsx` (새) | 칩 입력 + 자동완성(호선·구역) |
| `frontend/src/components/inbox/UploadZone.jsx` (새) | 끌어 놓기·파일/폴더 선택·진행률·DRM 거부 안내 |
| `frontend/src/components/inbox/DraftCard.jsx` (새) | 초안 Entry 편집·파일 목록·나누기·옮기기·확정·버리기 |
| `frontend/src/components/inbox/BatchCard.jsx` (새) | 배치 머리(상태·제외 목록·가져가기) + 초안 카드들 |
| `frontend/src/pages/InboxPage.jsx` (새) | `/inbox` |
| `frontend/src/pages/TrashPage.jsx` (새) | `/trash` |
| `frontend/src/pages/AuditLogPage.jsx` (수정) | 라벨을 `lib/labels.js` 로 |
| `frontend/src/components/shell/AppShell.jsx` (수정) | `Outlet context={{ storage }}` |
| `frontend/src/App.jsx` (수정) | 라우트 연결 |

---

### Task 1: 웹 업로드 서비스 — 경로 검증과 시작

**Files:**
- Modify: `backend/app/storage/paths.py` (StoragePaths 에 속성 추가)
- Create: `backend/app/uploads/__init__.py`, `backend/app/uploads/service.py`
- Test: `backend/tests/test_uploads_service.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_uploads_service.py`

```python
import os

import pytest
from fastapi import HTTPException

from app import models
from app.storage.paths import to_long
from app.uploads import service


@pytest.mark.parametrize("rel,expected", [
    ("a.bdf", "a.bdf"),
    ("9999_시험/model/a.bdf", "9999_시험/model/a.bdf"),
    ("9999_시험\\r.pdf", "9999_시험/r.pdf"),       # 역슬래시는 / 로
    ("  9999_시험/a.bdf", "9999_시험/a.bdf"),       # 앞 공백 제거
])
def test_clean_rel_accepts(rel, expected):
    assert service.clean_rel(rel) == expected


@pytest.mark.parametrize("rel", [
    "", "/", "/abs.bdf", "../x.bdf", "a/../../x", "a/./b", "a//b", "C:/x.bdf", "a/b:c",
    "a/b?.bdf", "a/<b>", "a\x00b", "a/" + "x" * 256, "a/" * 600 + "b",
])
def test_clean_rel_rejects(rel):
    with pytest.raises(HTTPException) as e:
        service.clean_rel(rel)
    assert e.value.status_code == 422
    assert e.value.detail == "invalid_path"


def test_begin_creates_uploading_batch_and_folder(db, storage, make_user):
    user = make_user("A100001")
    batch = service.begin(db, storage, user, name="9999_시험", target_entry_id=None)
    assert batch.source == "web" and batch.state == "uploading"
    assert batch.uploader == "A100001" and batch.uploader_guess == "A100001"
    assert batch.original_name == "9999_시험"
    assert os.path.isdir(to_long(storage.web_inbox / batch.key))


def test_begin_rejects_unreachable_storage(db, storage, make_user, monkeypatch):
    user = make_user("A100001")
    monkeypatch.setattr(type(storage), "check_reachable", lambda self, timeout=2.0: False)
    with pytest.raises(HTTPException) as e:
        service.begin(db, storage, user, name="x", target_entry_id=None)
    assert e.value.status_code == 503 and e.value.detail == "storage_unreachable"


def test_begin_target_must_be_confirmed_entry(db, storage, make_user):
    user = make_user("A100001")
    draft = models.Entry(title="t", status="draft", entry_id="E000900")
    db.add(draft)
    db.commit()
    with pytest.raises(HTTPException) as e:
        service.begin(db, storage, user, name="x", target_entry_id="E000900")
    assert e.value.status_code == 422 and e.value.detail == "target_not_confirmed"
    draft.status = "confirmed"
    db.commit()
    batch = service.begin(db, storage, user, name="x", target_entry_id="e000900")
    assert batch.target_entry_id == draft.id
```

- [ ] **Step 2: 실패 확인** — `.venv\Scripts\pytest.exe tests/test_uploads_service.py -q` → `ModuleNotFoundError: app.uploads` 또는 `AttributeError: web_inbox`.

- [ ] **Step 3: `StoragePaths.web_inbox` 추가** — `backend/app/storage/paths.py` 의 `inbox` 속성 바로 아래에:

```python
    @property
    def web_inbox(self) -> Path:
        """크롬 업로드분이 조각으로 쌓이는 곳(`00_Inbox\\_web\\<key>`). Inbox 감시기는 `_web` 을 건너뛴다."""
        return self.inbox / "_web"
```

- [ ] **Step 4: 서비스 구현** — `backend/app/uploads/__init__.py` 는 빈 파일. `backend/app/uploads/service.py`:

```python
"""크롬 업로드 — 배치를 'uploading' 으로 만들고 조각을 00_Inbox\\_web\\<key> 에 이어 쓴 뒤
마치면 폴더째 _staging 으로 옮겨 02a 의 process_batch 흐름에 태운다(설계 §5.1)."""
import os
import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..ingest.inbox import new_batch_key
from ..ingest.process import MAX_NAME, MAX_REL_PATH
from ..storage.paths import StoragePaths, to_long

# 윈도우 파일 이름에 쓸 수 없는 글자 + 제어 문자
_BAD_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')


def clean_rel(rel: str) -> str:
    """브라우저가 보낸 상대경로(webkitRelativePath 등)를 posix 로 정규화하고 검증한다.
    절대경로·드라이브·`..`·`.`·빈 조각·금지 문자·길이 초과는 422 invalid_path."""
    value = (rel or "").strip().replace("\\", "/")
    parts = value.split("/")
    if (not value or len(value) > MAX_REL_PATH
            or any(p in ("", ".", "..") or len(p) > MAX_NAME or _BAD_CHARS.search(p) for p in parts)):
        raise HTTPException(status_code=422, detail="invalid_path")
    return value


def begin(db: Session, storage: StoragePaths, user: models.User, *, name: str,
          target_entry_id: str | None) -> models.Batch:
    if not storage.check_reachable():
        raise HTTPException(status_code=503, detail="storage_unreachable")
    target = None
    if target_entry_id:
        target = db.query(models.Entry).filter_by(entry_id=target_entry_id.strip().upper()).first()
        if target is None or target.status != "confirmed":
            raise HTTPException(status_code=422, detail="target_not_confirmed")
    key = new_batch_key()
    os.makedirs(to_long(storage.web_inbox / key), exist_ok=True)
    batch = models.Batch(key=key, source="web", original_name=(name or "").strip()[:255] or key,
                         uploader=user.employee_id, uploader_guess=user.employee_id, state="uploading",
                         target_entry_id=target.id if target else None)
    db.add(batch)
    db.commit()
    return batch
```

그리고 `backend/app/models.py` 의 `Batch.state` 주석을 `# uploading|staged|processed|failed|done` 으로 고친다(값 제약은 없다).

- [ ] **Step 5: 통과 확인** — `.venv\Scripts\pytest.exe tests/test_uploads_service.py -q` → 전부 PASS.

- [ ] **Step 6: 커밋(사람)** — `feat: 웹 업로드 시작·경로 검증`

---

### Task 2: 웹 업로드 서비스 — 조각 쓰기·DRM 거부·마치기·취소

**Files:**
- Modify: `backend/app/uploads/service.py`
- Modify: `backend/app/ingest/process.py:121`
- Test: `backend/tests/test_uploads_service.py` (추가)

- [ ] **Step 1: 실패하는 테스트 추가** — `backend/tests/test_uploads_service.py` 끝에:

```python
from app import jobs  # noqa: E402
from app.ingest.process import process_batch  # noqa: E402


def _begin(db, storage, make_user):
    user = make_user("A100001")
    return user, service.begin(db, storage, user, name="9999_시험", target_entry_id=None)


def _read(path):
    with open(to_long(path), "rb") as fh:
        return fh.read()


def test_write_chunk_appends_in_order(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    assert service.write_chunk(db, storage, user, b.key, "9999_시험/a.bdf", 0, b"GRID") == 4
    assert service.write_chunk(db, storage, user, b.key, "9999_시험/a.bdf", 4, b",1") == 6
    assert _read(storage.web_inbox / b.key / "9999_시험" / "a.bdf") == b"GRID,1"


def test_write_chunk_offset_zero_restarts_file(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"OLD-CONTENT")
    assert service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"NEW") == 3
    assert _read(storage.web_inbox / b.key / "a.bdf") == b"NEW"


def test_write_chunk_offset_mismatch_409_reports_size(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"1234")
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, user, b.key, "a.bdf", 9, b"x")
    assert e.value.status_code == 409
    assert e.value.detail == {"code": "offset_mismatch", "size": 4}


def test_write_chunk_rejects_drm_header(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, user, b.key, "enc.pdf", 0, b"HHIDRMC" + b"\x00" * 20)
    assert e.value.status_code == 422 and e.value.detail == "drm_encrypted"
    assert not os.path.exists(to_long(storage.web_inbox / b.key / "enc.pdf"))


def test_write_chunk_too_large_413(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"x" * (service.MAX_CHUNK + 1))
    assert e.value.status_code == 413


def test_write_chunk_only_uploader_and_uploading_state(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    other = make_user("A100002")
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, other, b.key, "a.bdf", 0, b"x")
    assert e.value.status_code == 403
    b.state = "staged"
    db.commit()
    with pytest.raises(HTTPException) as e:
        service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"x")
    assert e.value.status_code == 409 and e.value.detail == "not_uploading"


def test_finish_moves_to_staging_and_queues_processing(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "9999_시험/a.bdf", 0, b"GRID")
    service.write_chunk(db, storage, user, b.key, "9999_시험/r.pdf", 0, b"%PDF-1.4")
    done = service.finish(db, storage, user, b.key,
                          files=[{"rel_path": "9999_시험/a.bdf", "size": 4},
                                 {"rel_path": "9999_시험/r.pdf", "size": 8}],
                          rejected=[{"rel_path": "9999_시험/enc.pdf", "reason": "drm"}])
    assert done.state == "staged"
    assert not os.path.exists(to_long(storage.web_inbox / b.key))
    assert _read(storage.staging / b.key / "9999_시험" / "a.bdf") == b"GRID"
    assert db.query(models.Job).filter_by(type="process_batch", target_id=b.id).count() == 1
    assert done.excluded == [{"name": "9999_시험/enc.pdf", "size": 0, "reason": "drm"}]
    audit = db.query(models.AuditLog).filter_by(action="BATCH_RECEIVED", target_id=b.key).one()
    assert audit.employee_id == "A100001" and audit.after["source"] == "web"


def test_finish_keeps_drm_rejections_after_processing(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}],
                   rejected=[{"rel_path": "enc.pdf", "reason": "drm"}])
    batch = db.query(models.Batch).filter_by(key=b.key).one()
    process_batch(db, storage, batch)
    db.refresh(batch)
    assert {"name": "enc.pdf", "size": 0, "reason": "drm"} in batch.excluded


def test_finish_size_mismatch_422(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    with pytest.raises(HTTPException) as e:
        service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 99}], rejected=[])
    assert e.value.status_code == 422 and e.value.detail == {"code": "incomplete", "rel_path": "a.bdf"}
    assert db.query(models.Batch).filter_by(key=b.key).one().state == "uploading"


def test_finish_without_files_422(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    with pytest.raises(HTTPException) as e:
        service.finish(db, storage, user, b.key, files=[], rejected=[])
    assert e.value.status_code == 422 and e.value.detail == "no_files"


def test_finish_removes_undeclared_leftovers(db, storage, make_user):
    """중간에 버린 파일(재시도 전 조각 등)은 배치에 넣지 않는다."""
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    service.write_chunk(db, storage, user, b.key, "stray.tmp2", 0, b"zz")
    service.finish(db, storage, user, b.key, files=[{"rel_path": "a.bdf", "size": 4}], rejected=[])
    assert not os.path.exists(to_long(storage.staging / b.key / "stray.tmp2"))
    assert os.path.exists(to_long(storage.staging / b.key / "a.bdf"))


def test_cancel_removes_folder_and_batch(db, storage, make_user):
    user, b = _begin(db, storage, make_user)
    service.write_chunk(db, storage, user, b.key, "a.bdf", 0, b"GRID")
    service.cancel(db, storage, user, b.key)
    assert not os.path.exists(to_long(storage.web_inbox / b.key))
    assert db.query(models.Batch).filter_by(key=b.key).count() == 0
```

- [ ] **Step 2: 실패 확인** — `.venv\Scripts\pytest.exe tests/test_uploads_service.py -q` → `AttributeError: ... has no attribute 'write_chunk'`.

- [ ] **Step 3: 구현** — `backend/app/uploads/service.py` 의 import 를 다음으로 바꾸고:

```python
import os
import re
import shutil

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import audit, jobs, models
from ..ingest.inbox import new_batch_key
from ..ingest.process import MAX_NAME, MAX_REL_PATH
from ..storage.paths import StoragePaths, long_join, to_long
```

파일 끝에 추가:

```python
MAX_CHUNK = 8 * 1024 * 1024 + 1024  # 브라우저 조각 8MB + 여유
DRM_MAGIC = b"HHIDRMC"


def _uploading(db: Session, user: models.User, key: str) -> models.Batch:
    batch = db.query(models.Batch).filter_by(key=key, source="web").first()
    if batch is None:
        raise HTTPException(status_code=404, detail="upload_not_found")
    if batch.uploader != user.employee_id:
        raise HTTPException(status_code=403, detail="not_uploader")
    if batch.state != "uploading":
        raise HTTPException(status_code=409, detail="not_uploading")
    return batch


def write_chunk(db: Session, storage: StoragePaths, user: models.User, key: str, rel: str,
                offset: int, data: bytes) -> int:
    """조각을 이어 쓰고 쓴 뒤의 파일 크기를 돌려준다. offset 0 은 처음부터 다시 쓴다(재시도).
    첫 조각이 회사 DRM 머리(HHIDRMC)로 시작하면 그 파일은 받지 않는다(설계 §5.1)."""
    _uploading(db, user, key)
    rel = clean_rel(rel)
    if len(data) > MAX_CHUNK:
        raise HTTPException(status_code=413, detail="chunk_too_large")
    path = long_join(storage.web_inbox / key, rel)
    if offset == 0:
        if data.startswith(DRM_MAGIC):
            if os.path.exists(path):
                os.remove(path)
            raise HTTPException(status_code=422, detail="drm_encrypted")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)
        return len(data)
    size = os.path.getsize(path) if os.path.exists(path) else 0
    if offset != size:
        raise HTTPException(status_code=409, detail={"code": "offset_mismatch", "size": size})
    with open(path, "ab") as fh:
        fh.write(data)
    return size + len(data)


def _remove_undeclared(root: str, declared: set[str]) -> None:
    for dirpath, _dirs, names in os.walk(root):
        for name in names:
            full = os.path.join(dirpath, name)
            rel = full[len(root) + 1:].replace("\\", "/")
            if rel not in declared:
                os.remove(full)


def finish(db: Session, storage: StoragePaths, user: models.User, key: str, *,
           files: list[dict], rejected: list[dict]) -> models.Batch:
    batch = _uploading(db, user, key)
    if not files:
        raise HTTPException(status_code=422, detail="no_files")
    root = to_long(storage.web_inbox / key)
    declared: set[str] = set()
    for f in files:
        rel = clean_rel(f["rel_path"])
        path = long_join(storage.web_inbox / key, rel)
        if not os.path.exists(path) or os.path.getsize(path) != int(f["size"]):
            raise HTTPException(status_code=422, detail={"code": "incomplete", "rel_path": rel})
        declared.add(rel)
    _remove_undeclared(root, declared)
    dest = to_long(storage.staging / key)
    os.rename(root, dest)  # 같은 공유 폴더 안 rename — 평문 유지(PoC 실험 2)
    try:
        batch.excluded = [{"name": clean_rel(r["rel_path"]), "size": 0, "reason": r.get("reason") or "drm"}
                          for r in rejected]
        batch.state = "staged"
        db.flush()
        jobs.enqueue(db, "process_batch", batch.id)
        audit.record(db, storage, actor=user.employee_id, action="BATCH_RECEIVED", target_type="batch",
                     target_id=key, after={"name": batch.original_name, "files": len(declared),
                                           "source": "web", "rejected": len(rejected)})
    except Exception:
        db.rollback()
        os.rename(dest, root)  # DB 가 실패하면 폴더를 되돌려 다시 마칠 수 있게 한다
        raise
    return batch


def cancel(db: Session, storage: StoragePaths, user: models.User, key: str) -> None:
    batch = _uploading(db, user, key)
    shutil.rmtree(to_long(storage.web_inbox / key), ignore_errors=True)
    db.delete(batch)
    db.commit()
```

그리고 `backend/app/ingest/process.py:121` 의 `batch.excluded = excluded` 를 다음으로 바꾼다:

```python
    # 웹 업로드가 미리 적어 둔 DRM 거부 목록 등을 지우지 않는다(process_batch 는 배치당 한 번만 돈다).
    batch.excluded = list(batch.excluded or []) + excluded
```

- [ ] **Step 4: 통과 확인** — `.venv\Scripts\pytest.exe tests/test_uploads_service.py tests/test_process.py -q` → 전부 PASS.

- [ ] **Step 5: 커밋(사람)** — `feat: 웹 업로드 조각 쓰기·DRM 거부·마치기`

---

### Task 3: 업로드 API · 방치 업로드 정리

**Files:**
- Create: `backend/app/routers/uploads.py`
- Modify: `backend/app/main.py` (라우터 등록 — 기존 `batches`/`entries` 등록 줄 옆)
- Modify: `backend/app/uploads/service.py` (`cleanup_stale`)
- Modify: `backend/app/worker.py` (`run_once` 시작부)
- Test: `backend/tests/test_uploads_api.py`, `backend/tests/test_worker.py` (추가)

- [ ] **Step 1: 실패하는 API 테스트** — `backend/tests/test_uploads_api.py`

```python
import os
from datetime import datetime, timedelta

from app import models
from app.storage.paths import to_long
from app.uploads import service


def test_upload_roundtrip(client, db, storage, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    r = client.post("/api/uploads", json={"name": "9999_시험"}, headers=h)
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "9999_시험/a.bdf", "offset": 0},
                   content=b"GRID", headers={**h, "Content-Type": "application/octet-stream"})
    assert r.status_code == 200 and r.json() == {"size": 4}
    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "9999_시험/enc.pdf", "offset": 0},
                   content=b"HHIDRMC....", headers={**h, "Content-Type": "application/octet-stream"})
    assert r.status_code == 422 and r.json()["detail"] == "drm_encrypted"
    r = client.post(f"/api/uploads/{key}/finish", headers=h, json={
        "files": [{"rel_path": "9999_시험/a.bdf", "size": 4}],
        "rejected": [{"rel_path": "9999_시험/enc.pdf", "reason": "drm"}]})
    assert r.status_code == 200 and r.json()["state"] == "staged"
    assert os.path.exists(to_long(storage.staging / key / "9999_시험" / "a.bdf"))


def test_offset_mismatch_detail(client, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    key = client.post("/api/uploads", json={"name": "x"}, headers=h).json()["key"]
    r = client.put(f"/api/uploads/{key}/chunk", params={"path": "a.bdf", "offset": 5},
                   content=b"x", headers={**h, "Content-Type": "application/octet-stream"})
    assert r.status_code == 409 and r.json()["detail"] == {"code": "offset_mismatch", "size": 0}


def test_cancel(client, db, make_user, auth_headers):
    make_user("A100001")
    h = auth_headers("A100001")
    key = client.post("/api/uploads", json={"name": "x"}, headers=h).json()["key"]
    assert client.delete(f"/api/uploads/{key}", headers=h).status_code == 204
    assert db.query(models.Batch).filter_by(key=key).count() == 0


def test_requires_login(client):
    assert client.post("/api/uploads", json={"name": "x"}).status_code == 401


def test_cleanup_stale_removes_old_uploads_only(db, storage, make_user):
    user = make_user("A100001")
    old = service.begin(db, storage, user, name="old", target_entry_id=None)
    new = service.begin(db, storage, user, name="new", target_entry_id=None)
    old.received_at = datetime.now() - timedelta(hours=25)
    db.commit()
    assert service.cleanup_stale(db, storage) == 1
    assert db.query(models.Batch).filter_by(key=old.key).count() == 0
    assert not os.path.exists(to_long(storage.web_inbox / old.key))
    assert os.path.exists(to_long(storage.web_inbox / new.key))
```

- [ ] **Step 2: 실패 확인** — `.venv\Scripts\pytest.exe tests/test_uploads_api.py -q` → 404 / AttributeError.

- [ ] **Step 3: `cleanup_stale` 구현** — `backend/app/uploads/service.py` 끝에 (`from datetime import datetime, timedelta` import 추가):

```python
STALE_AFTER = timedelta(hours=24)


def cleanup_stale(db: Session, storage: StoragePaths, older_than: timedelta = STALE_AFTER) -> int:
    """브라우저를 닫아 끝나지 못한 업로드(uploading 으로 24시간 넘게 멈춤)를 지운다."""
    cutoff = datetime.now() - older_than
    rows = db.query(models.Batch).filter(models.Batch.source == "web", models.Batch.state == "uploading",
                                         models.Batch.received_at < cutoff).all()
    for batch in rows:
        shutil.rmtree(to_long(storage.web_inbox / batch.key), ignore_errors=True)
        db.delete(batch)
    db.commit()
    return len(rows)
```

- [ ] **Step 4: 라우터** — `backend/app/routers/uploads.py`

```python
"""크롬 업로드 API — 시작 → 조각(PUT, application/octet-stream) → 마치기 / 취소."""
from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import get_storage, require_auth
from ..storage.paths import StoragePaths
from ..uploads import service

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


class BeginBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    target_entry_id: str | None = None


class DeclaredFile(BaseModel):
    rel_path: str
    size: int = Field(ge=0)


class RejectedFile(BaseModel):
    rel_path: str
    reason: str = "drm"


class FinishBody(BaseModel):
    files: list[DeclaredFile]
    rejected: list[RejectedFile] = []


@router.post("", status_code=201)
def begin(body: BeginBody, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
          user: models.User = Depends(require_auth)):
    b = service.begin(db, storage, user, name=body.name, target_entry_id=body.target_entry_id)
    return {"key": b.key, "state": b.state}


@router.put("/{key}/chunk")
async def chunk(key: str, request: Request, path: str = Query(...), offset: int = Query(ge=0),
                db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
                user: models.User = Depends(require_auth)):
    data = await request.body()
    return {"size": service.write_chunk(db, storage, user, key, path, offset, data)}


@router.post("/{key}/finish")
def finish(key: str, body: FinishBody, db: Session = Depends(get_db),
           storage: StoragePaths = Depends(get_storage), user: models.User = Depends(require_auth)):
    b = service.finish(db, storage, user, key, files=[f.model_dump() for f in body.files],
                       rejected=[r.model_dump() for r in body.rejected])
    return {"key": b.key, "state": b.state}


@router.delete("/{key}", status_code=204)
def cancel(key: str, db: Session = Depends(get_db), storage: StoragePaths = Depends(get_storage),
           user: models.User = Depends(require_auth)):
    service.cancel(db, storage, user, key)
    return Response(status_code=204)
```

`backend/app/main.py` 에서 `batches`, `entries` 라우터를 import·`include_router` 하는 곳에 `uploads` 를 같은 방식으로 추가한다.

- [ ] **Step 5: 워커 연결** — `backend/app/worker.py` 상단 import 에 `from .uploads.service import cleanup_stale` 를 추가하고, `run_once` 의 `stats = {...}` 줄 바로 위에:

```python
    removed = cleanup_stale(db, storage)
    if removed:
        log.info("끝나지 않은 웹 업로드 %d건을 정리했습니다.", removed)
```

`backend/tests/test_worker.py` 끝에 추가:

```python
def test_run_once_cleans_stale_web_uploads(db, storage, make_user):
    from datetime import datetime, timedelta

    from app import models
    from app.ingest.inbox import InboxWatcher
    from app.uploads import service as uploads
    from app.worker import run_once

    user = make_user("A100001")
    b = uploads.begin(db, storage, user, name="old", target_entry_id=None)
    b.received_at = datetime.now() - timedelta(hours=30)
    db.commit()
    run_once(db, storage, InboxWatcher(storage))
    assert db.query(models.Batch).filter_by(key=b.key).count() == 0
```

- [ ] **Step 6: 통과 확인** — `.venv\Scripts\pytest.exe tests/test_uploads_api.py tests/test_worker.py -q` → PASS.

- [ ] **Step 7: 커밋(사람)** — `feat: 업로드 API·방치 업로드 정리`

---

### Task 4: 화면용 응답 보강 — 중복 대상·제안 Entry 번호, 자동완성 API

**Files:**
- Modify: `backend/app/entries/service.py` (`entry_to_dict`)
- Create: `backend/app/routers/suggest.py`; Modify: `backend/app/main.py`
- Test: `backend/tests/test_entry_service.py` (추가), `backend/tests/test_suggest_api.py`

- [ ] **Step 1: 실패하는 테스트** — `backend/tests/test_entry_service.py` 끝에:

```python
def test_entry_to_dict_resolves_duplicate_and_suggestion_numbers(db):
    from app import models
    from app.entries.service import entry_to_dict

    batch = models.Batch(key="k1", source="web", original_name="x", state="processed")
    db.add(batch)
    db.flush()
    old = models.Entry(title="기존", status="confirmed", entry_id="E000045")
    db.add(old)
    db.flush()
    old_file = models.File(batch_id=batch.id, entry_id=old.id, rel_path="a.bdf", name="a.bdf", ext=".bdf",
                           kind="model", size=1, sha256="0" * 64, location="vault")
    db.add(old_file)
    db.flush()
    draft = models.Entry(title="새", status="draft", entry_id="E000046", batch_id=batch.id,
                         suggested_entry_id=old.id, merge_into_id=old.id)
    db.add(draft)
    db.flush()
    db.add(models.File(batch_id=batch.id, entry_id=draft.id, rel_path="a.bdf", name="a.bdf", ext=".bdf",
                       kind="model", size=1, sha256="0" * 64, location="staging", duplicate_of_id=old_file.id))
    db.commit()
    d = entry_to_dict(db, draft)
    assert d["files"][0]["duplicate_of_entry"] == "E000045"
    assert d["suggested_entry"] == {"entry_id": "E000045", "title": "기존"}
    assert d["merge_into"] == {"entry_id": "E000045", "title": "기존"}
```

`backend/tests/test_suggest_api.py`:

```python
from app import models


def test_suggest_hull_zone_analysis_type(client, db, make_user, auth_headers):
    make_user("A100001")
    db.add_all([models.Hull(hull_no="9999"), models.Hull(hull_no="9998"), models.Hull(hull_no="1234"),
                models.Tag(kind="zone", value="Engine Room"), models.Tag(kind="zone", value="Deck House"),
                models.Entry(title="t", status="confirmed", entry_id="E000001", analysis_type="피로")])
    db.commit()
    h = auth_headers("A100001")
    assert client.get("/api/suggest", params={"kind": "hull", "q": "99"}, headers=h).json() == ["9998", "9999"]
    assert client.get("/api/suggest", params={"kind": "zone", "q": "engine"}, headers=h).json() == ["Engine Room"]
    assert client.get("/api/suggest", params={"kind": "analysis_type", "q": ""}, headers=h).json() == ["피로"]
    assert client.get("/api/suggest", params={"kind": "bad"}, headers=h).status_code == 422
```

- [ ] **Step 2: 실패 확인** — `.venv\Scripts\pytest.exe tests/test_entry_service.py tests/test_suggest_api.py -q` → KeyError / 404.

- [ ] **Step 3: `entry_to_dict` 보강** — `backend/app/entries/service.py`. `file_to_dict` 를 다음으로 바꾸고:

```python
def file_to_dict(f: models.File, duplicate_entries: dict[int, str] | None = None) -> dict:
    return {"id": f.id, "rel_path": f.rel_path, "name": f.name, "kind": f.kind, "size": f.size,
            "sha256": f.sha256, "drm_encrypted": f.drm_encrypted, "duplicate_of_id": f.duplicate_of_id,
            "duplicate_of_entry": (duplicate_entries or {}).get(f.duplicate_of_id),
            "location": f.location}


def _entry_ref(db: Session, entry_pk: int | None) -> dict | None:
    if entry_pk is None:
        return None
    e = db.get(models.Entry, entry_pk)
    return {"entry_id": e.entry_id, "title": e.title} if e else None
```

`entry_to_dict` 안에서 `files = ...` 다음 줄에:

```python
    dup_ids = [f.duplicate_of_id for f in files if f.duplicate_of_id]
    dup_entries = dict(
        db.query(models.File.id, models.Entry.entry_id).join(models.Entry, models.Entry.id == models.File.entry_id)
        .filter(models.File.id.in_(dup_ids)).all()) if dup_ids else {}
```

반환 dict 에서 `"files": [file_to_dict(f) for f in files],` 를 `"files": [file_to_dict(f, dup_entries) for f in files],` 로 바꾸고 다음 두 키를 더한다:

```python
        "suggested_entry": _entry_ref(db, entry.suggested_entry_id),
        "merge_into": _entry_ref(db, entry.merge_into_id),
```

- [ ] **Step 4: 자동완성 라우터** — `backend/app/routers/suggest.py`

```python
"""자유 입력 칸의 자동완성(설계 §1.3 — 표준 목록 없이 쓴 값을 다시 제안)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..dependencies import require_auth

router = APIRouter(prefix="/api", tags=["suggest"])


@router.get("/suggest")
def suggest(kind: str = Query(pattern="^(hull|zone|analysis_type)$"), q: str = "",
            limit: int = Query(default=10, ge=1, le=50),
            db: Session = Depends(get_db), user: models.User = Depends(require_auth)):
    q = q.strip()
    if kind == "hull":
        rows = (db.query(models.Hull.hull_no).filter(models.Hull.hull_no.like(f"{q}%"))
                .order_by(models.Hull.hull_no).limit(limit))
    elif kind == "zone":
        rows = (db.query(models.Tag.value).filter(models.Tag.kind == "zone", models.Tag.value.like(f"%{q}%"))
                .order_by(models.Tag.value).limit(limit))
    else:
        rows = (db.query(models.Entry.analysis_type).distinct()
                .filter(models.Entry.analysis_type.isnot(None), models.Entry.analysis_type.like(f"%{q}%"))
                .order_by(models.Entry.analysis_type).limit(limit))
    return [v for (v,) in rows]
```

`main.py` 에 `suggest` 라우터 등록. (MySQL `utf8mb4_unicode_ci` 라 `like` 는 대소문자를 가리지 않는다.)

- [ ] **Step 5: 통과 확인 후 전체 백엔드 한 번** — `.venv\Scripts\pytest.exe -q` → 전부 PASS(231 + 신규).

- [ ] **Step 6: 커밋(사람)** — `feat: 중복·제안 Entry 번호, 자동완성 API`

---

### Task 5: 프런트 업로드 모듈 (`lib/upload.js`)

**Files:**
- Modify: `frontend/src/api/client.js`
- Create: `frontend/src/lib/upload.js`
- Test: `frontend/src/lib/upload.test.js`

- [ ] **Step 1: 실패하는 테스트** — `frontend/src/lib/upload.test.js`

```js
import { vi } from 'vitest';
import { batchName, collectFromInput, hasDrmHeader, uploadBatch } from './upload.js';

function file(name, content, relPath = '') {
  const f = new File([content], name);
  if (relPath) Object.defineProperty(f, 'webkitRelativePath', { value: relPath });
  return f;
}

test('DRM 머리(HHIDRMC)를 알아본다', async () => {
  expect(await hasDrmHeader(file('a.pdf', 'HHIDRMC\0\0'))).toBe(true);
  expect(await hasDrmHeader(file('a.pdf', '%PDF-1.4'))).toBe(false);
});

test('input 선택 파일은 webkitRelativePath 를 상대경로로 쓴다', () => {
  const items = collectFromInput([file('a.bdf', 'x', '9999_시험/a.bdf'), file('b.pdf', 'y')]);
  expect(items.map((i) => i.relPath)).toEqual(['9999_시험/a.bdf', 'b.pdf']);
});

test('배치 이름: 최상위 폴더가 하나면 그 이름, 아니면 파일 수', () => {
  expect(batchName([{ relPath: '9999_시험/a.bdf' }, { relPath: '9999_시험/r/b.pdf' }])).toBe('9999_시험');
  expect(batchName([{ relPath: 'a.bdf' }, { relPath: 'b.pdf' }])).toBe('파일 2개');
});

function routeFetch(handler) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => Promise.resolve(handler(url, init))));
}
const ok = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const fail = (status, detail) => ({ ok: false, status, json: () => Promise.resolve({ detail }) });

test('조각으로 올리고 DRM 파일은 거부 목록으로 마친다', async () => {
  const calls = [];
  routeFetch((url, init) => {
    calls.push(`${init.method} ${url}`);
    if (url === '/api/uploads') return { ...ok({ key: 'K1' }), status: 201 };
    if (url.includes('/chunk')) return ok({ size: 4 });
    if (url.endsWith('/finish')) return ok({ key: 'K1', state: 'staged' });
    throw new Error(url);
  });
  const progress = vi.fn();
  const res = await uploadBatch([
    { file: file('a.bdf', 'GRID'), relPath: '9999_시험/a.bdf' },
    { file: file('enc.pdf', 'HHIDRMC..'), relPath: '9999_시험/enc.pdf' },
  ], { onProgress: progress, chunkSize: 2 });
  expect(res).toEqual({ key: 'K1', uploaded: 1, rejected: ['9999_시험/enc.pdf'] });
  expect(calls.filter((c) => c.includes('/chunk'))).toHaveLength(2); // 4바이트 / 2바이트 조각
  const finish = fetch.mock.calls.find(([u]) => u.endsWith('/finish'));
  expect(JSON.parse(finish[1].body)).toEqual({
    files: [{ rel_path: '9999_시험/a.bdf', size: 4 }],
    rejected: [{ rel_path: '9999_시험/enc.pdf', reason: 'drm' }],
  });
  expect(progress).toHaveBeenLastCalledWith({ sent: 4, total: 4 });
});

test('모든 파일이 DRM 이면 업로드를 취소하고 오류를 던진다', async () => {
  routeFetch((url, init) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K2' }), status: 201 };
    if (init.method === 'DELETE') return { ok: true, status: 204, json: () => Promise.resolve(null) };
    throw new Error(url);
  });
  await expect(uploadBatch([{ file: file('e.pdf', 'HHIDRMC'), relPath: 'e.pdf' }]))
    .rejects.toMatchObject({ code: 'all_drm', rejected: ['e.pdf'] });
  expect(fetch.mock.calls.some(([u, i]) => i.method === 'DELETE' && u === '/api/uploads/K2')).toBe(true);
});

test('조각이 offset_mismatch 면 서버 크기에서 이어 보낸다', async () => {
  let n = 0;
  routeFetch((url) => {
    if (url === '/api/uploads') return { ...ok({ key: 'K3' }), status: 201 };
    if (url.includes('/chunk')) {
      n += 1;
      if (n === 2) return fail(409, { code: 'offset_mismatch', size: 2 });
      return ok({ size: 0 });
    }
    return ok({ key: 'K3', state: 'staged' });
  });
  await uploadBatch([{ file: file('a.bdf', 'ABCD'), relPath: 'a.bdf' }], { chunkSize: 2 });
  const chunkUrls = fetch.mock.calls.map(([u]) => u).filter((u) => u.includes('/chunk'));
  expect(chunkUrls.at(-1)).toContain('offset=2');
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/upload.test.js` → 모듈 없음.

- [ ] **Step 3: `apiBinary` 추가** — `frontend/src/api/client.js` 끝에:

```js
/** 조각 업로드용 — 본문이 바이너리(Blob)다. 오류 처리·401 처리는 api() 와 같다. */
export async function apiBinary(path, blob, { method = 'PUT' } = {}) {
  const token = tokenStore.get();
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: blob });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && tokenStore.get() === token) {
      tokenStore.clear();
      window.dispatchEvent(new Event('logbook:unauthorized'));
    }
    throw new ApiError(res.status, data?.detail ?? null);
  }
  return data;
}
```

- [ ] **Step 4: 구현** — `frontend/src/lib/upload.js`

```js
/**
 * 크롬 업로드 — 폴더/여러 파일을 모아 8MB 조각으로 /api/uploads 에 올린다(설계 §5.1).
 * 회사 DRM 파일(첫 바이트 HHIDRMC)은 보내기 전에 거르고, 서버도 한 번 더 거른다.
 */
import { api, apiBinary, ApiError } from '../api/client.js';

export const CHUNK_SIZE = 8 * 1024 * 1024;
const DRM_MAGIC = 'HHIDRMC';
const RETRIES = 3;

export async function hasDrmHeader(file) {
  const head = new Uint8Array(await file.slice(0, DRM_MAGIC.length).arrayBuffer());
  return String.fromCharCode(...head) === DRM_MAGIC;
}

export function collectFromInput(fileList) {
  return Array.from(fileList).map((file) => ({ file, relPath: file.webkitRelativePath || file.name }));
}

function readAll(reader) {
  return new Promise((resolve, reject) => {
    const out = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) resolve(out);
      else { out.push(...batch); next(); }
    }, reject);
    next();
  });
}

async function walk(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, relPath: prefix + entry.name });
  } else if (entry.isDirectory) {
    for (const child of await readAll(entry.createReader())) {
      await walk(child, `${prefix}${entry.name}/`, out);
    }
  }
}

/** 끌어 놓은 항목(폴더 포함)을 모은다. 폴더는 재귀로 펼치고 상대경로를 유지한다. */
export async function collectFromDrop(dataTransfer) {
  const entries = Array.from(dataTransfer.items || [])
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return collectFromInput(dataTransfer.files || []);
  const out = [];
  for (const e of entries) await walk(e, '', out);
  return out;
}

export function batchName(items) {
  const tops = new Set(items.map((i) => i.relPath.split('/')[0]));
  const allNested = items.every((i) => i.relPath.includes('/'));
  return tops.size === 1 && allNested ? [...tops][0] : `파일 ${items.length}개`;
}

async function sendFile(key, item, chunkSize, onBytes) {
  const { file, relPath } = item;
  let offset = 0;
  let attempts = 0;
  do {
    const end = Math.min(offset + chunkSize, file.size);
    const q = `path=${encodeURIComponent(relPath)}&offset=${offset}`;
    try {
      await apiBinary(`/uploads/${key}/chunk?${q}`, file.slice(offset, end));
      onBytes(end - offset);
      offset = end;
      attempts = 0;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.detail?.code === 'offset_mismatch') {
        onBytes(err.detail.size - offset);
        offset = err.detail.size;
        continue;
      }
      attempts += 1;
      if (attempts >= RETRIES || (err instanceof ApiError && err.status < 500 && err.status !== 409)) throw err;
    }
  } while (offset < file.size);
}

/**
 * items: [{file, relPath}] → {key, uploaded, rejected}
 * 모든 파일이 DRM 이면 업로드를 취소하고 {code:'all_drm', rejected} 를 던진다.
 */
export async function uploadBatch(items, { onProgress = () => {}, chunkSize = CHUNK_SIZE, targetEntryId } = {}) {
  const rejected = [];
  const good = [];
  for (const it of items) (await hasDrmHeader(it.file) ? rejected : good).push(it);
  const { key } = await api('/uploads', { method: 'POST', body: { name: batchName(items), target_entry_id: targetEntryId || null } });
  if (!good.length) {
    await api(`/uploads/${key}`, { method: 'DELETE' }).catch(() => {});
    throw Object.assign(new Error('all_drm'), { code: 'all_drm', rejected: rejected.map((r) => r.relPath) });
  }
  const total = good.reduce((s, it) => s + it.file.size, 0);
  let sent = 0;
  try {
    for (const it of good) {
      try {
        await sendFile(key, it, chunkSize, (n) => { sent += n; onProgress({ sent, total }); });
      } catch (err) {
        if (err instanceof ApiError && err.detail === 'drm_encrypted') { rejected.push(it); continue; }
        throw err;
      }
    }
    const uploaded = good.filter((g) => !rejected.includes(g));
    await api(`/uploads/${key}/finish`, {
      method: 'POST',
      body: {
        files: uploaded.map((u) => ({ rel_path: u.relPath, size: u.file.size })),
        rejected: rejected.map((r) => ({ rel_path: r.relPath, reason: 'drm' })),
      },
    });
    onProgress({ sent: total, total });
    return { key, uploaded: uploaded.length, rejected: rejected.map((r) => r.relPath) };
  } catch (err) {
    await api(`/uploads/${key}`, { method: 'DELETE' }).catch(() => {});
    throw err;
  }
}
```

주의: 테스트의 0바이트 파일 대비 — `do … while` 이라 빈 파일도 조각 1번(0바이트)을 보낸다(서버가 빈 파일을 만든다).

- [ ] **Step 5: 통과 확인** — `npx vitest run src/lib/upload.test.js` → PASS.

- [ ] **Step 6: 커밋(사람)** — `feat: 크롬 업로드 모듈(폴더 수집·DRM 검사·조각 전송)`

---

### Task 6: 라벨 모음 · 파일 종류 배지 · 칩 입력

**Files:**
- Create: `frontend/src/lib/labels.js`, `frontend/src/components/ui/KindBadge.jsx`, `frontend/src/components/ui/ChipInput.jsx`
- Modify: `frontend/src/pages/AuditLogPage.jsx` (라벨 import)
- Test: `frontend/src/components/ui/ChipInput.test.jsx`, `frontend/src/pages/AuditLogPage.test.jsx` (추가)

- [ ] **Step 1: 실패하는 테스트** — `frontend/src/components/ui/ChipInput.test.jsx`

```jsx
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChipInput from './ChipInput.jsx';

test('Enter 로 칩을 더하고 × 로 뺀다, 검증 실패 값은 안내한다', async () => {
  const onChange = vi.fn();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })));
  const { rerender } = render(<ChipInput label="호선" kind="hull" values={['9999']} onChange={onChange}
                                         validate={(v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.'} />);
  const input = screen.getByRole('combobox', { name: '호선' });
  await userEvent.type(input, '99a{Enter}');
  expect(screen.getByRole('alert')).toHaveTextContent('호선은 숫자 4자리입니다.');
  await userEvent.clear(input);
  await userEvent.type(input, '9998{Enter}');
  expect(onChange).toHaveBeenLastCalledWith(['9999', '9998']);
  rerender(<ChipInput label="호선" kind="hull" values={['9999']} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: '9999 빼기' }));
  expect(onChange).toHaveBeenLastCalledWith([]);
});

test('입력하면 자동완성 후보를 보여 주고 고르면 칩이 된다', async () => {
  const onChange = vi.fn();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(['Engine Room']) })));
  render(<ChipInput label="구역" kind="zone" values={[]} onChange={onChange} />);
  await userEvent.type(screen.getByRole('combobox', { name: '구역' }), 'eng');
  await userEvent.click(await screen.findByRole('option', { name: 'Engine Room' }));
  expect(onChange).toHaveBeenLastCalledWith(['Engine Room']);
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/suggest?kind=zone&q=eng');
});
```

`frontend/src/pages/AuditLogPage.test.jsx` 끝에 추가(파일의 기존 fetch 모킹 방식을 따른다):

```jsx
test('올리기 관련 동작도 한국어 라벨로 보인다', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
    { id: 1, at: '2026-09-29T12:33:04', employee_id: 'A476854', action: 'ENTRY_CONFIRM', target: { type: 'entry', id: 'E000001' } },
    { id: 2, at: '2026-09-29T12:33:05', employee_id: 'A476854', action: 'DRAFT_DISCARD', target: { type: 'entry', id: 'E000002' } },
  ]) })));
  render(<AuditLogPage />);
  expect(await screen.findByText('확정')).toBeInTheDocument();
  expect(screen.getByText('초안 버림')).toBeInTheDocument();
});
```

(기존 파일에 `vi`·`render`·`screen` import 가 없으면 맨 위에 추가한다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/ui/ChipInput.test.jsx src/pages/AuditLogPage.test.jsx` → FAIL.

- [ ] **Step 3: `lib/labels.js`**

```js
/** 화면 라벨 모음 — 같은 코드 값을 여러 화면이 같은 말로 보이게 한 곳에 둔다. */
export const ACTION_LABELS = {
  USER_REGISTER: '가입 신청', USER_APPROVE: '가입 승인', USER_REJECT: '가입 거절',
  USER_DISABLE: '계정 비활성화', USER_ENABLE: '계정 재활성화',
  USER_ADMIN_GRANT: '관리자 지정', USER_ADMIN_REVOKE: '관리자 해제', ADMIN_BOOTSTRAP: '관리자 초기 설정',
  BATCH_RECEIVED: '자료 받음', BATCH_CLAIM: '배치 가져감',
  ENTRY_UPDATE: '정보 수정', ENTRY_CONFIRM: '확정', ENTRY_FILES_ADDED: '파일 추가',
  ENTRY_TRASH: '휴지통으로', ENTRY_RESTORE: '복원', DRAFT_DISCARD: '초안 버림',
};

export const KIND_LABELS = { model: 'BDF', result: '결과', report: '보고서', drawing: '도면', other: '기타' };

export const BATCH_STATE_LABELS = {
  staged: '분석 중', processed: '정리 대기', failed: '처리 실패', done: '완료', uploading: '올리는 중',
};

export const EXCLUDE_REASON_LABELS = {
  drm: 'DRM 암호화 — 탐색기로 00_Inbox 에 복사해 주세요',
  path_too_long: '경로가 너무 김',
};

export const ERROR_LABELS = {
  version_conflict: '다른 사람이 먼저 고쳤습니다. 최신 내용으로 다시 불러왔습니다.',
  not_uploader: '올린 사람만 할 수 있습니다.',
  storage_unreachable: '999_LogBook 공유 폴더에 연결할 수 없습니다.',
  storage_error_partial: '파일 이동 중 문제가 생겼습니다. 관리자에게 알려 주세요.',
  title_required: '제목을 입력해 주세요.',
  invalid_period: '해석 시기는 YYYY-MM 형식입니다.',
  target_not_confirmed: '합칠 대상 Entry 가 확정 상태가 아닙니다.',
  already_claimed: '이미 다른 사람이 가져갔습니다.',
  entry_trashed: '휴지통에 있는 자료입니다.',
};

export function errorText(err, fallback = '요청을 처리하지 못했습니다.') {
  const code = typeof err?.detail === 'string' ? err.detail : err?.detail?.code;
  return ERROR_LABELS[code] || fallback;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
```

`AuditLogPage.jsx` 의 로컬 `ACTION_LABELS` 상수를 지우고 `import { ACTION_LABELS } from '../lib/labels.js';` 로 바꾼다.

- [ ] **Step 4: `KindBadge.jsx`** (설계 §6.4 — 옅은 배경 + 진한 글자)

```jsx
import { KIND_LABELS } from '../../lib/labels.js';

const STYLES = {
  model: 'bg-indigo-50 text-indigo-800', result: 'bg-violet-50 text-violet-800',
  report: 'bg-red-50 text-red-800', drawing: 'bg-emerald-50 text-emerald-800', other: 'bg-zinc-100 text-zinc-700',
};
const EXT_STYLES = { '.pdf': 'bg-red-50 text-red-800', '.pptx': 'bg-orange-50 text-orange-800', '.ppt': 'bg-orange-50 text-orange-800',
                     '.xlsx': 'bg-green-50 text-green-800', '.xls': 'bg-green-50 text-green-800' };

export default function KindBadge({ kind, name = '' }) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const label = kind === 'report' && EXT_STYLES[ext] ? ext.slice(1).toUpperCase() : KIND_LABELS[kind] || kind;
  const cls = (kind === 'report' && EXT_STYLES[ext]) || STYLES[kind] || STYLES.other;
  return <span className={`inline-flex h-5 min-w-10 items-center justify-center rounded px-1.5 font-mono text-[11px] font-semibold ${cls}`}>{label}</span>;
}
```

- [ ] **Step 5: `ChipInput.jsx`**

```jsx
import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../api/client.js';

/** 자유 입력 칩 + /api/suggest 자동완성(설계: 표준 목록 없이, 쓴 값을 다시 제안). */
export default function ChipInput({ label, kind, values, onChange, validate, placeholder = '입력 후 Enter', disabled = false }) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState([]);
  const [error, setError] = useState('');
  const listId = useId();

  useEffect(() => {
    const q = text.trim();
    if (!q) { setOptions([]); return undefined; }
    const t = setTimeout(() => {
      api(`/suggest?kind=${kind}&q=${encodeURIComponent(q)}`)
        .then((rows) => setOptions(rows.filter((r) => !values.includes(r))))
        .catch(() => setOptions([]));
    }, 150);
    return () => clearTimeout(t);
  }, [text, kind, values]);

  function add(raw) {
    const v = raw.trim();
    if (!v || values.includes(v)) { setText(''); return; }
    const verdict = validate ? validate(v) : true;
    if (verdict !== true) { setError(verdict); return; }
    setError('');
    setText('');
    setOptions([]);
    onChange([...values, v]);
  }

  return (
    <div>
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-zinc-300 bg-white px-1.5 py-1 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand-ring">
        {values.map((v) => (
          <span key={v} className="inline-flex h-6 items-center gap-1 rounded bg-brand-tint px-2 font-mono text-xs text-brand">
            {v}
            {!disabled && (
              <button type="button" aria-label={`${v} 빼기`} onClick={() => onChange(values.filter((x) => x !== v))}
                      className="rounded text-brand/70 hover:text-brand"><X size={12} aria-hidden="true" /></button>
            )}
          </span>
        ))}
        <input role="combobox" aria-label={label} aria-expanded={options.length > 0} aria-controls={listId}
               disabled={disabled} value={text} placeholder={values.length ? '' : placeholder}
               onChange={(e) => { setText(e.target.value); setError(''); }}
               onKeyDown={(e) => {
                 if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); }
                 if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
               }}
               onBlur={() => text.trim() && add(text)}
               className="min-w-20 flex-1 bg-transparent px-1 text-[13px] outline-none" />
      </div>
      {options.length > 0 && (
        <ul id={listId} role="listbox" className="mt-1 max-h-40 overflow-auto rounded-md border border-line bg-white py-1 shadow-sm">
          {options.map((o) => (
            <li key={o} role="option" aria-selected="false" tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); add(o); }}
                className="cursor-pointer px-2.5 py-1 text-[13px] hover:bg-brand-tint">{o}</li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-err">{error}</p>}
    </div>
  );
}
```

주의: `role="option"` 에 `userEvent.click` 은 mousedown 을 발생시키므로 `onMouseDown` 으로 받는다(입력의 blur 가 먼저 일어나 후보가 사라지지 않게).

- [ ] **Step 6: 통과 확인** — `npx vitest run src/components/ui src/pages/AuditLogPage.test.jsx` → PASS.

- [ ] **Step 7: 커밋(사람)** — `feat: 라벨 모음·파일 종류 배지·칩 입력`

---

### Task 7: 업로드 영역 (`UploadZone`)

**Files:**
- Create: `frontend/src/components/inbox/UploadZone.jsx`
- Test: `frontend/src/components/inbox/UploadZone.test.jsx`

- [ ] **Step 1: 실패하는 테스트**

```jsx
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/upload.js', async (orig) => ({ ...(await orig()), uploadBatch: vi.fn() }));
import { uploadBatch } from '../../lib/upload.js';
import UploadZone from './UploadZone.jsx';

test('파일을 고르면 올리고, 끝나면 onUploaded 와 DRM 거부 안내', async () => {
  uploadBatch.mockResolvedValue({ key: 'K1', uploaded: 1, rejected: ['enc.pdf'] });
  const onUploaded = vi.fn();
  render(<UploadZone onUploaded={onUploaded} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['GRID'], 'a.bdf'), new File(['x'], 'enc.pdf')]);
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('K1'));
  expect(screen.getByRole('status')).toHaveTextContent('1개 파일을 올렸습니다');
  expect(screen.getByText('enc.pdf')).toBeInTheDocument();
  expect(screen.getByText(/탐색기로 00_Inbox/)).toBeInTheDocument();
});

test('모든 파일이 DRM 이면 오류로 안내한다', async () => {
  uploadBatch.mockRejectedValue(Object.assign(new Error('all_drm'), { code: 'all_drm', rejected: ['e.pdf'] }));
  render(<UploadZone onUploaded={() => {}} />);
  await userEvent.upload(screen.getByLabelText('파일 선택'), [new File(['x'], 'e.pdf')]);
  expect(await screen.findByRole('alert')).toHaveTextContent('DRM 암호화');
});

test('공유 폴더가 끊기면 올리기를 막는다', () => {
  render(<UploadZone onUploaded={() => {}} disabled />);
  expect(screen.getByLabelText('파일 선택')).toBeDisabled();
  expect(screen.getByText(/연결되면 올릴 수 있습니다/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/inbox/UploadZone.test.jsx` → 모듈 없음.

- [ ] **Step 3: 구현** — `frontend/src/components/inbox/UploadZone.jsx`

```jsx
import { useRef, useState } from 'react';
import { FolderUp, UploadCloud } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { collectFromDrop, collectFromInput, uploadBatch } from '../../lib/upload.js';
import { errorText, formatBytes } from '../../lib/labels.js';

/** 폴더·여러 파일 끌어 놓기/선택 → 한 배치로 올린다. DRM 파일은 거부하고 탐색기 경로를 안내한다. */
export default function UploadZone({ onUploaded, disabled = false }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const dirRef = useRef(null);

  async function start(items) {
    if (!items.length || busy) return;
    setBusy(true); setError(''); setResult(null); setProgress({ sent: 0, total: 1 });
    try {
      const res = await uploadBatch(items, { onProgress: setProgress });
      setResult(res);
      onUploaded(res.key);
    } catch (err) {
      if (err.code === 'all_drm') setResult({ uploaded: 0, rejected: err.rejected });
      setError(err.code === 'all_drm' ? '모든 파일이 DRM 암호화 상태라 올리지 않았습니다.' : errorText(err, '올리기에 실패했습니다. 다시 시도해 주세요.'));
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  const pct = progress ? Math.floor((progress.sent / Math.max(progress.total, 1)) * 100) : 0;
  return (
    <section aria-label="자료 올리기" className="rounded-lg border border-line bg-white p-4">
      <div
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); if (!disabled) start(await collectFromDrop(e.dataTransfer)); }}
        className={`flex flex-col items-center gap-2 rounded-md border-2 border-dashed px-6 py-7 text-center transition-colors ${over ? 'border-brand bg-brand-tint' : 'border-zinc-300 bg-zinc-50'} ${disabled ? 'opacity-60' : ''}`}>
        <UploadCloud size={26} className="text-brand" aria-hidden="true" />
        <p className="text-sm font-semibold">폴더나 파일을 여기로 끌어 놓으세요</p>
        <p className="text-xs text-zinc-600">한 번에 올린 것이 한 배치가 됩니다. 큰 해석 폴더는 탐색기로 <span className="font-mono">00_Inbox</span> 에 복사해도 됩니다.</p>
        <div className="mt-1 flex gap-2">
          <input ref={fileRef} type="file" multiple hidden aria-label="파일 선택" disabled={disabled || busy}
                 onChange={(e) => { start(collectFromInput(e.target.files)); e.target.value = ''; }} />
          <input ref={dirRef} type="file" hidden webkitdirectory="" aria-label="폴더 선택" disabled={disabled || busy}
                 onChange={(e) => { start(collectFromInput(e.target.files)); e.target.value = ''; }} />
          <Button variant="secondary" disabled={disabled || busy} onClick={() => fileRef.current?.click()}><UploadCloud size={14} aria-hidden="true" />파일 선택</Button>
          <Button variant="secondary" disabled={disabled || busy} onClick={() => dirRef.current?.click()}><FolderUp size={14} aria-hidden="true" />폴더 선택</Button>
        </div>
        {disabled && <p className="text-xs text-err">999_LogBook 공유 폴더에 연결되면 올릴 수 있습니다.</p>}
      </div>
      {progress && (
        <div className="mt-3" aria-live="polite">
          <div className="flex justify-between text-xs text-zinc-600"><span>올리는 중…</span>
            <span className="font-mono">{formatBytes(progress.sent)} / {formatBytes(progress.total)} · {pct}%</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="올리기 진행률">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {result && result.uploaded > 0 && (
        <p role="status" className="mt-3 text-[13px] text-ok">{result.uploaded}개 파일을 올렸습니다. 잠시 뒤 아래에 묶음 제안이 나타납니다.</p>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      {result?.rejected?.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-wait">
          <p className="font-semibold">DRM 암호화 파일 {result.rejected.length}개는 올리지 않았습니다 — 탐색기로 00_Inbox 에 복사해 주세요(복사하면 암호가 풀립니다).</p>
          <ul className="mt-1 font-mono">{result.rejected.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/components/inbox/UploadZone.test.jsx` → PASS.

- [ ] **Step 5: 커밋(사람)** — `feat: 업로드 영역`

---

### Task 8: 초안 카드 (`DraftCard`)

**Files:**
- Create: `frontend/src/components/inbox/DraftCard.jsx`
- Test: `frontend/src/components/inbox/DraftCard.test.jsx`

동작 요약:
- 제목·해석 종류·해석 시기(YYYY-MM)·설명은 칸을 벗어날 때(blur) 바뀐 경우에만 `PATCH /api/entries/{id}` 에 `{version, <field>}` 를 보낸다. 호선·구역 칩은 바뀔 때마다 보낸다.
- 409 `version_conflict` 면 안내 후 `onChanged()` 로 목록을 새로 부른다.
- 파일 행: 체크박스, 종류 배지, 상대경로(mono), 크기, 중복 배지("E000045 에 이미 있음"), DRM 표시. 행을 다른 카드로 끌어 놓으면 이동한다. 키보드·접근성 대안으로 "옮기기" 선택 상자(같은 배치의 다른 초안 목록)를 둔다.
- 선택한 파일 → [새 묶음으로 나누기] = `POST /split {file_ids}`.
- [다른 묶음과 합치기] 선택 상자 = `POST /api/entries/{this}/merge {from_entry_id}` (선택한 묶음의 파일을 이 카드로 모은다).
- 제안: `suggested_entry` 가 있으면 "E000045 ‘제목’ 에 추가할까요?" + [추가로 표시] = PATCH `merge_into_id`, 표시된 경우 "E000045 에 추가됨 · [취소]".
- [확정] = `POST /confirm`, [버리기] = 확인 후 `DELETE`. `canEdit=false`(남의 초안)면 모든 편집 버튼 비활성.

- [ ] **Step 1: 실패하는 테스트**

```jsx
import { vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraftCard from './DraftCard.jsx';

const ENTRY = {
  entry_id: 'E000010', status: 'draft', title: '9999 연결시험', version: 3, analysis_type: null,
  analysis_period: null, description: null, zones: [],
  hulls: [{ hull_no: '9999', ship_type: null, is_primary: true }],
  hull_evidence: [{ hull_no: '9999', score: 5, reasons: ['파일명 2개'] }],
  suggested_entry: { entry_id: 'E000001', title: '기존 해석' }, merge_into: null,
  files: [
    { id: 1, rel_path: '9999_시험/a.bdf', name: 'a.bdf', kind: 'model', size: 2048, duplicate_of_entry: null, drm_encrypted: false },
    { id: 2, rel_path: '9999_시험/r.pdf', name: 'r.pdf', kind: 'report', size: 10, duplicate_of_entry: 'E000045', drm_encrypted: false },
  ],
};
const OTHER = { entry_id: 'E000011', title: '다른 묶음' };

function mockFetch(map) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    if (key.startsWith('GET /api/suggest')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    const r = map[key];
    if (!r) throw new Error(`unexpected ${key}`);
    return Promise.resolve(r.__status ? { ok: false, status: r.__status, json: () => Promise.resolve({ detail: r.detail }) }
                                     : { ok: true, status: 200, json: () => Promise.resolve(r) });
  }));
}
const bodyOf = (method, url) => JSON.parse(fetch.mock.calls.find(([u, i = {}]) => u === url && i.method === method)[1].body);

test('제목을 고치고 칸을 벗어나면 version 과 함께 저장한다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...ENTRY, title: '새 제목', version: 4 } });
  const onChanged = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={onChanged} />);
  const title = screen.getByLabelText('제목');
  await userEvent.clear(title);
  await userEvent.type(title, '새 제목');
  await userEvent.tab();
  expect(bodyOf('PATCH', '/api/entries/E000010')).toEqual({ version: 3, title: '새 제목' });
  expect(onChanged).toHaveBeenCalled();
});

test('버전 충돌이면 안내하고 새로 부른다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { __status: 409, detail: 'version_conflict' } });
  const onChanged = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.type(screen.getByLabelText('제목'), '!');
  await userEvent.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 사람이 먼저 고쳤습니다');
  expect(onChanged).toHaveBeenCalled();
});

test('중복 파일에 기존 Entry 번호를 보여 준다', () => {
  mockFetch({});
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  expect(screen.getByText('E000045 에 이미 있음')).toBeInTheDocument();
});

test('파일을 골라 새 묶음으로 나눈다', async () => {
  mockFetch({ 'POST /api/entries/E000010/split': { entry_id: 'E000012' } });
  const onChanged = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.click(screen.getByRole('checkbox', { name: '9999_시험/r.pdf 선택' }));
  await userEvent.click(screen.getByRole('button', { name: '새 묶음으로 나누기' }));
  expect(bodyOf('POST', '/api/entries/E000010/split')).toEqual({ file_ids: [2] });
  expect(onChanged).toHaveBeenCalled();
});

test('옮기기 선택으로 파일을 다른 묶음에 보낸다', async () => {
  mockFetch({ 'POST /api/files/1/move': { ok: true } });
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={() => {}} />);
  await userEvent.selectOptions(screen.getByLabelText('9999_시험/a.bdf 옮기기'), 'E000011');
  expect(bodyOf('POST', '/api/files/1/move')).toEqual({ to_entry_id: 'E000011' });
});

test('다른 카드에서 끌어 온 파일을 놓으면 이 묶음으로 옮긴다', async () => {
  mockFetch({ 'POST /api/files/7/move': { ok: true } });
  render(<DraftCard entry={ENTRY} siblings={[OTHER]} canEdit onChanged={() => {}} />);
  const card = screen.getByRole('article', { name: /E000010/ });
  fireEvent.drop(card, { dataTransfer: { getData: () => JSON.stringify({ fileId: 7, from: 'E000011' }) } });
  await vi.waitFor(() => expect(bodyOf('POST', '/api/files/7/move')).toEqual({ to_entry_id: 'E000010' }));
});

test('기존 Entry 추가 제안을 받아들인다', async () => {
  mockFetch({ 'PATCH /api/entries/E000010': { ...ENTRY, merge_into: ENTRY.suggested_entry, version: 4 } });
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'E000001 에 추가' }));
  expect(bodyOf('PATCH', '/api/entries/E000010')).toEqual({ version: 3, merge_into_id: 'E000001' });
});

test('확정과 버리기', async () => {
  mockFetch({ 'POST /api/entries/E000010/confirm': { ...ENTRY, status: 'confirmed' },
              'DELETE /api/entries/E000010': { ...ENTRY, status: 'trashed' } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const onChanged = vi.fn();
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit onChanged={onChanged} />);
  await userEvent.click(screen.getByRole('button', { name: '확정' }));
  await userEvent.click(screen.getByRole('button', { name: '버리기' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).toContain('POST /api/entries/E000010/confirm');
  expect(calls).toContain('DELETE /api/entries/E000010');
  expect(onChanged).toHaveBeenCalledTimes(2);
});

test('남의 초안은 고칠 수 없다', () => {
  mockFetch({});
  render(<DraftCard entry={ENTRY} siblings={[]} canEdit={false} onChanged={() => {}} />);
  expect(screen.getByLabelText('제목')).toBeDisabled();
  expect(screen.getByRole('button', { name: '확정' })).toBeDisabled();
  expect(within(screen.getByRole('article')).queryByRole('checkbox')).toBeNull();
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/inbox/DraftCard.test.jsx` → 모듈 없음.

- [ ] **Step 3: 구현** — `frontend/src/components/inbox/DraftCard.jsx`

```jsx
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, GripVertical, Lock, Scissors, Trash2 } from 'lucide-react';
import Button from '../ui/Button.jsx';
import ChipInput from '../ui/ChipInput.jsx';
import KindBadge from '../ui/KindBadge.jsx';
import { api } from '../../api/client.js';
import { errorText, formatBytes } from '../../lib/labels.js';

const DRAG_TYPE = 'application/x-logbook-file';
const hullRule = (v) => /^\d{4}$/.test(v) || '호선은 숫자 4자리입니다.';

function Field({ label, children }) {
  return <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">{label}{children}</label>;
}
const inputCls = 'h-8 rounded-md border border-zinc-300 bg-white px-2.5 text-[13px] text-zinc-900 outline-none focus:border-brand focus:ring-3 focus:ring-brand-ring disabled:bg-zinc-50';

/** 정리 대기 화면의 초안 Entry 카드 — 추정값을 고치고, 파일을 옮기고, 확정한다(설계 §5.5). */
export default function DraftCard({ entry, siblings, canEdit, onChanged }) {
  const [form, setForm] = useState(entry);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => { setForm(entry); setSelected([]); }, [entry]);

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); onChanged(); } catch (err) {
      setError(errorText(err));
      if (err.detail === 'version_conflict') onChanged();
    } finally { setBusy(false); }
  }
  const patch = (fields) => run(() => api(`/entries/${entry.entry_id}`, { method: 'PATCH', body: { version: entry.version, ...fields } }));
  const saveIfChanged = (key) => { if ((form[key] || '') !== (entry[key] || '')) patch({ [key]: form[key] || null }); };
  const moveFile = (fileId, to) => run(() => api(`/files/${fileId}/move`, { method: 'POST', body: { to_entry_id: to } }));

  const disabled = !canEdit || busy;
  const hulls = form.hulls.map((h) => h.hull_no);
  return (
    <article aria-label={`${entry.entry_id} ${entry.title}`}
             onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(true); } }}
             onDragLeave={() => setOver(false)}
             onDrop={(e) => {
               e.preventDefault(); setOver(false);
               if (!canEdit) return;
               const raw = e.dataTransfer.getData(DRAG_TYPE);
               if (!raw) return;
               const { fileId, from } = JSON.parse(raw);
               if (from !== entry.entry_id) moveFile(fileId, entry.entry_id);
             }}
             className={`rounded-lg border bg-white ${over ? 'border-brand ring-3 ring-brand-ring' : 'border-line'}`}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="h-[7px] w-[7px] rounded-full bg-wait" aria-hidden="true" />
        <span className="font-mono text-xs text-zinc-500">{entry.entry_id}</span>
        <span className="text-xs font-medium text-wait">미확정</span>
        {!canEdit && <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><Lock size={12} aria-hidden="true" />올린 사람만 수정</span>}
        <div className="flex-1" />
        <Button variant="danger" size="sm" disabled={disabled}
                onClick={() => window.confirm(`${entry.entry_id} 초안을 버릴까요? 파일은 휴지통으로 갑니다.`) && run(() => api(`/entries/${entry.entry_id}`, { method: 'DELETE' }))}>
          <Trash2 size={13} aria-hidden="true" />버리기
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => run(() => api(`/entries/${entry.entry_id}/confirm`, { method: 'POST' }))}>
          <CheckCircle2 size={13} aria-hidden="true" />확정
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-2">
        <Field label="제목">
          <input className={inputCls} value={form.title || ''} disabled={disabled}
                 onChange={(e) => setForm({ ...form, title: e.target.value })} onBlur={() => saveIfChanged('title')} />
        </Field>
        <Field label="해석 종류">
          <input className={inputCls} value={form.analysis_type || ''} disabled={disabled} placeholder="예: 강도, 피로, 진동"
                 onChange={(e) => setForm({ ...form, analysis_type: e.target.value })} onBlur={() => saveIfChanged('analysis_type')} />
        </Field>
        <div className="flex flex-col gap-1 text-xs font-medium text-zinc-600">호선
          <ChipInput label="호선" kind="hull" values={hulls} validate={hullRule} disabled={disabled}
                     onChange={(v) => patch({ hulls: v })} />
          {entry.hull_evidence?.length > 0 && (
            <span className="font-normal text-zinc-500">추정 근거: {entry.hull_evidence.map((h) => `${h.hull_no} — ${(h.reasons || []).join(', ')}`).join(' · ')}</span>
          )}
        </div>
        <div className="flex flex-col gap-1 text-xs font-medium text-zinc-600">구역
          <ChipInput label="구역" kind="zone" values={form.zones} disabled={disabled} onChange={(v) => patch({ zones: v })} />
        </div>
        <Field label="해석 시기">
          <input className={inputCls} value={form.analysis_period || ''} disabled={disabled} placeholder="YYYY-MM"
                 onChange={(e) => setForm({ ...form, analysis_period: e.target.value })} onBlur={() => saveIfChanged('analysis_period')} />
        </Field>
        <Field label="설명">
          <input className={inputCls} value={form.description || ''} disabled={disabled}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => saveIfChanged('description')} />
        </Field>
      </div>

      {(entry.suggested_entry || entry.merge_into) && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-md bg-brand-tint px-3 py-2 text-[13px] text-brand">
          {entry.merge_into ? (
            <>
              <span>확정하면 <b className="font-mono">{entry.merge_into.entry_id}</b> ‘{entry.merge_into.title}’ 에 파일이 추가됩니다.</span>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => patch({ merge_into_id: null })}>새 Entry 로 확정</Button>
            </>
          ) : (
            <>
              <span>비슷한 기존 자료 <b className="font-mono">{entry.suggested_entry.entry_id}</b> ‘{entry.suggested_entry.title}’ 에 추가할까요?</span>
              <div className="flex-1" />
              <Button variant="secondary" size="sm" disabled={disabled} aria-label={`${entry.suggested_entry.entry_id} 에 추가`}
                      onClick={() => patch({ merge_into_id: entry.suggested_entry.entry_id })}>추가</Button>
            </>
          )}
        </div>
      )}

      <div className="border-t border-line">
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-600">
          <span>파일 {entry.files.length}개</span>
          <div className="flex-1" />
          {canEdit && siblings.length > 0 && (
            <select aria-label="다른 묶음과 합치기" disabled={disabled} value="" className="h-7 rounded-md border border-zinc-300 bg-white px-2 text-xs"
                    onChange={(e) => e.target.value && run(() => api(`/entries/${entry.entry_id}/merge`, { method: 'POST', body: { from_entry_id: e.target.value } }))}>
              <option value="">다른 묶음과 합치기…</option>
              {siblings.map((s) => <option key={s.entry_id} value={s.entry_id}>{s.entry_id} {s.title}</option>)}
            </select>
          )}
          {canEdit && (
            <Button variant="secondary" size="sm" disabled={disabled || selected.length === 0 || selected.length === entry.files.length}
                    onClick={() => run(() => api(`/entries/${entry.entry_id}/split`, { method: 'POST', body: { file_ids: selected } }))}>
              <Scissors size={13} aria-hidden="true" />새 묶음으로 나누기
            </Button>
          )}
        </div>
        <ul className="divide-y divide-line">
          {entry.files.map((f) => (
            <li key={f.id} draggable={canEdit}
                onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ fileId: f.id, from: entry.entry_id }))}
                className="flex items-center gap-2.5 px-4 py-1.5 text-[13px]">
              {canEdit && <GripVertical size={14} className="cursor-grab text-zinc-400" aria-hidden="true" />}
              {canEdit && (
                <input type="checkbox" aria-label={`${f.rel_path} 선택`} checked={selected.includes(f.id)} disabled={busy}
                       onChange={(e) => setSelected(e.target.checked ? [...selected, f.id] : selected.filter((x) => x !== f.id))} />
              )}
              <KindBadge kind={f.kind} name={f.name} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.rel_path}>{f.rel_path}</span>
              {f.duplicate_of_entry && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 text-[11px] text-wait"><Copy size={11} aria-hidden="true" />{f.duplicate_of_entry} 에 이미 있음</span>
              )}
              {f.drm_encrypted && (
                <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 text-[11px] text-err"><AlertTriangle size={11} aria-hidden="true" />암호화됨</span>
              )}
              <span className="w-16 text-right font-mono text-xs text-zinc-500">{formatBytes(f.size)}</span>
              {canEdit && siblings.length > 0 && (
                <select aria-label={`${f.rel_path} 옮기기`} disabled={busy} value="" className="h-6 rounded border border-zinc-300 bg-white px-1 text-[11px]"
                        onChange={(e) => e.target.value && moveFile(f.id, e.target.value)}>
                  <option value="">옮기기…</option>
                  {siblings.map((s) => <option key={s.entry_id} value={s.entry_id}>{s.entry_id}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      </div>
      {error && <p role="alert" className="border-t border-line px-4 py-2 text-[13px] text-err">{error}</p>}
    </article>
  );
}
```

`test('다른 카드에서 끌어 온 …')` 는 `getData` 가 어떤 타입이든 같은 JSON 을 돌려주는 모의 객체다 — 구현이 `getData(DRAG_TYPE)` 하나만 읽으면 된다.

- [ ] **Step 4: 통과 확인** — `npx vitest run src/components/inbox/DraftCard.test.jsx` → PASS.

- [ ] **Step 5: 커밋(사람)** — `feat: 초안 카드(수정·나누기·옮기기·합치기·확정)`

---

### Task 9: 배치 카드와 정리 대기 화면 (`/inbox`)

**Files:**
- Create: `frontend/src/components/inbox/BatchCard.jsx`, `frontend/src/pages/InboxPage.jsx`
- Modify: `frontend/src/components/shell/AppShell.jsx` (`<Outlet context={{ storage }} />`), `frontend/src/App.jsx` (`inbox` 라우트)
- Test: `frontend/src/pages/InboxPage.test.jsx`

- [ ] **Step 1: 실패하는 테스트** — `frontend/src/pages/InboxPage.test.jsx`

```jsx
import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext.jsx';
import InboxPage from './InboxPage.jsx';

const DRAFT = { entry_id: 'E000010', status: 'draft', title: '9999 연결시험', version: 1, hulls: [], zones: [],
  hull_evidence: [], files: [], suggested_entry: null, merge_into: null, uploaded_by: 'A100001' };
const MINE = [
  { key: 'K1', source: 'web', original_name: '9999_연결시험', state: 'processed', uploader: 'A100001',
    received_at: '2026-09-29T12:32:35', excluded: [{ name: 'enc.pdf', size: 0, reason: 'drm' }], error: null, entries: [DRAFT] },
  { key: 'K2', source: 'inbox', original_name: '방금 올린 폴더', state: 'staged', uploader: 'A100001',
    received_at: '2026-09-29T12:40:00', excluded: [], error: null, entries: [] },
];
const UNCLAIMED = [{ key: 'K3', source: 'inbox', original_name: '주인 없음', state: 'processed', uploader: null,
  owner_account: 'x1234', received_at: '2026-09-29T11:00:00', excluded: [], error: null, entries: [] }];

function renderPage(fetchMap) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${url}`;
    const r = fetchMap[key];
    if (r === undefined) throw new Error(`unexpected ${key}`);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(r) });
  }));
  const auth = { user: { employee_id: 'A100001', name: '사용자' }, isAdmin: false };
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes><Route path="/inbox" element={<InboxPage />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

test('내 배치: 초안 카드, 처리 중 배치, DRM 제외 목록', async () => {
  renderPage({ 'GET /api/batches?scope=mine': MINE });
  expect(await screen.findByRole('article', { name: /E000010/ })).toBeInTheDocument();
  const k2 = screen.getByRole('region', { name: /방금 올린 폴더/ });
  expect(within(k2).getByText('분석 중')).toBeInTheDocument();
  expect(screen.getByText(/enc\.pdf/)).toBeInTheDocument();
  expect(screen.getByText(/DRM 암호화/)).toBeInTheDocument();
});

test('주인 없는 배치를 가져온다', async () => {
  renderPage({ 'GET /api/batches?scope=mine': [], 'GET /api/batches?scope=unclaimed': UNCLAIMED,
               'POST /api/batches/K3/claim': { ...UNCLAIMED[0], uploader: 'A100001' } });
  await userEvent.click(await screen.findByRole('tab', { name: /주인 없는 배치/ }));
  await userEvent.click(await screen.findByRole('button', { name: '내가 올렸어요' }));
  const calls = fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`);
  expect(calls).toContain('POST /api/batches/K3/claim');
});

test('비어 있으면 안내한다', async () => {
  renderPage({ 'GET /api/batches?scope=mine': [] });
  expect(await screen.findByText('정리할 자료가 없습니다')).toBeInTheDocument();
});
```

주의: 현재 `frontend/src/auth/AuthContext.jsx:10` 은 `const AuthContext = createContext(null);` 로 export 되지 않는다. 테스트에서 값을 주입할 수 있게 `export const AuthContext = createContext(null);` 로 바꾼다(값 모양 = `{ user, loading, isAdmin, login, logout }` — 테스트는 `user`·`isAdmin` 만 쓴다).

- [ ] **Step 2: 실패 확인** — `npx vitest run src/pages/InboxPage.test.jsx` → 모듈 없음.

- [ ] **Step 3: `BatchCard.jsx`**

```jsx
import { AlertCircle, FolderInput, Globe, Loader2 } from 'lucide-react';
import Button from '../ui/Button.jsx';
import DraftCard from './DraftCard.jsx';
import { BATCH_STATE_LABELS, EXCLUDE_REASON_LABELS } from '../../lib/labels.js';

/** 한 번에 올라온 배치 — 머리(출처·상태·제외 목록) + 초안 카드들. */
export default function BatchCard({ batch, me, isAdmin, onChanged, onClaim }) {
  const mine = batch.uploader === me;
  const drafts = batch.entries || [];
  const SourceIcon = batch.source === 'web' ? Globe : FolderInput;
  return (
    <section aria-label={`배치 ${batch.original_name}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <SourceIcon size={15} className="text-zinc-500" aria-hidden="true" />
        <h2 className="font-semibold">{batch.original_name}</h2>
        <span className="font-mono text-xs text-zinc-500">{batch.received_at.replace('T', ' ').slice(0, 16)}</span>
        <span className={`inline-flex items-center gap-1 rounded px-1.5 text-xs ${batch.state === 'failed' ? 'bg-red-50 text-err' : 'bg-zinc-100 text-zinc-700'}`}>
          {batch.state === 'staged' && <Loader2 size={11} className="animate-spin" aria-hidden="true" />}
          {BATCH_STATE_LABELS[batch.state] || batch.state}
        </span>
        {!batch.uploader && batch.owner_account && <span className="text-xs text-zinc-500">파일 소유 계정 <span className="font-mono">{batch.owner_account}</span></span>}
        <div className="flex-1" />
        {!batch.uploader && <Button size="sm" onClick={() => onClaim(batch.key)}>내가 올렸어요</Button>}
      </div>
      {batch.state === 'failed' && (
        <p className="flex items-center gap-1.5 text-[13px] text-err"><AlertCircle size={14} aria-hidden="true" />처리하지 못했습니다: {batch.error}</p>
      )}
      {batch.excluded?.length > 0 && (
        <details className="rounded-md border border-line bg-white px-3 py-2 text-xs text-zinc-600">
          <summary className="cursor-pointer">제외된 파일 {batch.excluded.length}개</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {batch.excluded.map((x) => (
              <li key={x.name}>{x.name}{x.reason && <span className="ml-2 font-sans text-wait">{EXCLUDE_REASON_LABELS[x.reason] || x.reason}</span>}</li>
            ))}
          </ul>
        </details>
      )}
      {drafts.map((d) => (
        <DraftCard key={d.entry_id} entry={d} canEdit={mine || isAdmin}
                   siblings={drafts.filter((s) => s.entry_id !== d.entry_id).map((s) => ({ entry_id: s.entry_id, title: s.title }))}
                   onChanged={onChanged} />
      ))}
    </section>
  );
}
```

(관리자의 초안 수정은 백엔드 `can_edit_draft` 가 허용한다. 확정은 백엔드가 30일 규칙으로 다시 판단한다.)

- [ ] **Step 4: `InboxPage.jsx`**

```jsx
import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import BatchCard from '../components/inbox/BatchCard.jsx';
import UploadZone from '../components/inbox/UploadZone.jsx';
import { errorText } from '../lib/labels.js';

const TABS = [{ id: 'mine', label: '내 배치' }, { id: 'unclaimed', label: '주인 없는 배치' }];
const POLL_MS = 5000;

export default function InboxPage() {
  const { user, isAdmin } = useAuth();
  const storage = useOutletContext()?.storage;
  const [tab, setTab] = useState('mine');
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => api(`/batches?scope=${tab}`)
    .then((rows) => { setBatches(rows); setError(''); })
    .catch(() => setError('정리 대기 목록을 불러오지 못했습니다.'))
    .finally(() => setLoading(false)), [tab]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  // 분석 중(staged) 배치가 있으면 워커가 끝낼 때까지 주기적으로 다시 부른다.
  const waiting = batches.some((b) => b.state === 'staged');
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  async function claim(key) {
    try { await api(`/batches/${key}/claim`, { method: 'POST' }); } catch (err) { setError(errorText(err)); }
    load();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <div>
        <h1 className="text-lg font-bold tracking-tight">정리 대기</h1>
        <p className="mt-1 text-[13px] text-zinc-600">올린 자료의 묶음 제안을 확인하고 확정하세요. 확정 전에도 검색에는 ‘미분류’로 보입니다.</p>
      </div>
      <UploadZone onUploaded={() => { setTab('mine'); load(); }} disabled={storage?.reachable === false} />
      <div role="tablist" aria-label="배치 구분" className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${tab === t.id ? 'border-brand font-semibold text-brand' : 'border-transparent text-zinc-600 hover:text-zinc-900'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-[13px] text-err">{error}</p>}
      {loading && <div className="h-24 animate-pulse rounded-lg bg-zinc-200/60" aria-label="불러오는 중" />}
      {!loading && batches.length === 0 && !error && (
        <EmptyState icon={Inbox} title="정리할 자료가 없습니다">
          {tab === 'mine' ? '위에서 올리거나, 탐색기로 999_LogBook\\00_Inbox 에 복사하면 1~2분 뒤 여기에 나타납니다.' : '주인을 찾지 못한 배치가 없습니다.'}
        </EmptyState>
      )}
      {batches.map((b) => (
        <BatchCard key={b.key} batch={b} me={user.employee_id} isAdmin={isAdmin} onChanged={load} onClaim={claim} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: 셸·라우트 연결** — `AppShell.jsx` 의 `<Outlet />` 를 `<Outlet context={{ storage }} />` 로. `App.jsx` 에 `import InboxPage from './pages/InboxPage.jsx';` 를 더하고 `inbox` 라우트 element 를 `<InboxPage />` 로 바꾼다.

- [ ] **Step 6: 통과 확인** — `npx vitest run` (프런트 전체) → PASS.

- [ ] **Step 7: 커밋(사람)** — `feat: 정리 대기 화면`

---

### Task 10: 휴지통 화면 (`/trash`)

**Files:**
- Create: `frontend/src/pages/TrashPage.jsx`
- Modify: `frontend/src/App.jsx` (`trash` 라우트), `frontend/src/pages/PlaceholderPage.jsx` (`inbox`·`trash` 항목 삭제)
- Test: `frontend/src/pages/TrashPage.test.jsx`

- [ ] **Step 1: 실패하는 테스트**

```jsx
import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrashPage from './TrashPage.jsx';

const ROWS = [
  { entry_id: 'E000001', title: '9999 연결시험', trash_rel: 'E000001_20260929-123305', restorable: true, updated_at: '2026-09-29T12:33:05' },
  { entry_id: 'E000002', title: '버린 초안', trash_rel: 'draft_E000002_20260929-130000', restorable: false, updated_at: '2026-09-29T13:00:00' },
];

function mock(map) {
  vi.stubGlobal('fetch', vi.fn((url, init = {}) => {
    const r = map[`${init.method || 'GET'} ${url}`];
    if (r === undefined) throw new Error(url);
    return Promise.resolve(r.__status ? { ok: false, status: r.__status, json: () => Promise.resolve({ detail: r.detail }) }
                                     : { ok: true, status: 200, json: () => Promise.resolve(r) });
  }));
}

test('확정 자료는 복원하고, 버린 초안은 복원 불가로 표시한다', async () => {
  mock({ 'GET /api/trash': ROWS, 'POST /api/entries/E000001/restore': { entry_id: 'E000001', status: 'confirmed' } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<TrashPage />);
  const row1 = (await screen.findByText('9999 연결시험')).closest('li');
  await userEvent.click(within(row1).getByRole('button', { name: '복원' }));
  expect(fetch.mock.calls.map(([u, i = {}]) => `${i.method || 'GET'} ${u}`)).toContain('POST /api/entries/E000001/restore');
  const row2 = screen.getByText('버린 초안').closest('li');
  expect(within(row2).queryByRole('button', { name: '복원' })).toBeNull();
  expect(within(row2).getByText('초안이라 복원할 수 없음')).toBeInTheDocument();
  expect(await screen.findByRole('status')).toHaveTextContent('E000001 을 복원했습니다');
});

test('복원 실패 사유를 보여 준다', async () => {
  mock({ 'GET /api/trash': [ROWS[0]], 'POST /api/entries/E000001/restore': { __status: 503, detail: 'storage_unreachable' } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<TrashPage />);
  await userEvent.click(await screen.findByRole('button', { name: '복원' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('공유 폴더에 연결할 수 없습니다');
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/pages/TrashPage.test.jsx` → 모듈 없음.

- [ ] **Step 3: 구현** — `frontend/src/pages/TrashPage.jsx`

```jsx
import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { errorText } from '../lib/labels.js';

/** 휴지통 — 삭제한 Entry 를 복원한다(설계 §8). 자료는 95_Trash 에 있다. */
export default function TrashPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(() => api('/trash').then(setRows)
    .catch(() => setError('휴지통을 불러오지 못했습니다.')).finally(() => setLoading(false)), []);
  useEffect(() => { load(); }, [load]);

  async function restore(r) {
    if (!window.confirm(`${r.entry_id} ‘${r.title}’ 을 복원할까요?`)) return;
    setBusyId(r.entry_id); setError(''); setNotice('');
    try {
      await api(`/entries/${r.entry_id}/restore`, { method: 'POST' });
      setNotice(`${r.entry_id} 을 복원했습니다.`);
      load();
    } catch (err) { setError(errorText(err, '복원하지 못했습니다.')); } finally { setBusyId(''); }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-lg font-bold tracking-tight">휴지통</h1>
      <p className="mt-1 text-[13px] text-zinc-600">삭제한 자료는 <span className="font-mono">95_Trash</span> 에 보관되며 여기서 복원할 수 있습니다.</p>
      {notice && <p role="status" className="mt-3 text-[13px] text-ok">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-[13px] text-err">{error}</p>}
      {!loading && rows.length === 0 && !error && <EmptyState icon={Trash2} title="휴지통이 비어 있습니다">삭제한 자료가 여기에 모입니다.</EmptyState>}
      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
          {rows.map((r) => (
            <li key={r.entry_id} className="flex items-center gap-4 px-4 py-2.5 text-[13px]">
              <span className="w-20 shrink-0 font-mono text-zinc-500">{r.entry_id}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
              <span className="w-36 shrink-0 font-mono text-xs text-zinc-500">{r.updated_at.replace('T', ' ').slice(0, 16)}</span>
              {r.restorable ? (
                <Button variant="secondary" size="sm" disabled={busyId === r.entry_id} onClick={() => restore(r)}>
                  <RotateCcw size={13} aria-hidden="true" />복원
                </Button>
              ) : <span className="text-xs text-zinc-500">초안이라 복원할 수 없음</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`App.jsx` 에 `import TrashPage from './pages/TrashPage.jsx';` 를 더하고 `trash` 라우트를 `<TrashPage />` 로. `PlaceholderPage.jsx` 의 `inbox`·`trash` 항목을 지운다(쓰는 곳이 없어짐 — 관련 테스트가 있으면 함께 정리).

- [ ] **Step 4: 통과 확인** — `npx vitest run` → 프런트 전체 PASS.

- [ ] **Step 5: 커밋(사람)** — `feat: 휴지통 화면`

---

### Task 11: 빌드 · 개발 PC 실측 (실제 공유 폴더 + 크롬)

- [ ] **Step 1: 전체 테스트** — 백엔드 `.venv\Scripts\pytest.exe -q` (순차 1회), 프런트 `npx vitest run`. 둘 다 전부 PASS.

- [ ] **Step 2: 빌드** — `cd frontend; npm run build` → `frontend/dist` 갱신(저장소에 커밋되는 산출물).

- [ ] **Step 3: 서버·워커 실행** — `backend` 에서 각각 백그라운드로:
```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 9095
.venv\Scripts\python.exe -m app.worker
```

- [ ] **Step 4: 크롬 실측(Playwright, chromium-1228 + playwright 1.61.0)** — 스크래치 폴더에 시험 자료를 만든다: 폴더 `9999_Logbook_웹시험\` (합성 `9999_web.bdf`, 합성 `web.pdf`) + DRM 모사 파일 `enc.pdf`(내용이 `HHIDRMC` 로 시작하는 합성 바이트). 실제 호선·기밀 자료 금지.
  1. A476854 로 로그인 → `/inbox` → 폴더 선택(`setInputFiles` 로 `폴더 선택` 입력에 위 3개 파일, webkitRelativePath 가 없으므로 파일 선택 입력으로 대체 가능) → "2개 파일을 올렸습니다" + DRM 거부 안내 확인.
  2. 30~60초 안에 배치가 ‘정리 대기’ 로 바뀌고 초안 카드가 뜨는지(5초 폴링) 확인. 제외 목록에 `enc.pdf — DRM 암호화` 확인.
  3. 제목 수정(blur 저장) → 구역 칩 추가 → 확정. 공유 폴더 `10_Vault\2026\<E번호>\files\...` 와 `entry.json` 확인(평문 `%PDF` 머리).
  4. 검증용으로 API 로 휴지통 보냄 → `/trash` 에서 복원 버튼 → Vault 로 돌아온 것 확인 → 다시 휴지통으로(시험 자료를 검색 대상에서 뺀다).
  5. 각 단계 화면을 스크래치에 스크린샷으로 남겨 레이아웃(1440×900, 1280×720)을 눈으로 확인 — 디자인 토큰·간격·상태 점(미확정 주황, 확정 초록).
- [ ] **Step 5: 정리·보고** — 서버·워커 종료. `00_Inbox\_web`·`_staging` 에 남은 것이 없는지 확인. 결과·스크린샷·휴지통에 남긴 시험 Entry 번호를 보고한다.
- [ ] **Step 6: 커밋(사람)** — `feat: Logbook 02b 올리기 화면` (dist 포함)

---

## 자기 점검 (작성자)

- 설계 §5.1 크롬 업로드(폴더·다중·DRM 거부·`_web\<BatchID>`) → Task 1–3, 5, 7. 연결 끊김 시 업로드 차단(§9) → Task 1(503)·7(disabled)·9(storage 전달).
- §5.2 중복 "E000045 에 이미 있음" → Task 4·8. §5.4-4 기존 Entry 추가 제안 → Task 4(`suggested_entry`/`merge_into`)·8.
- §5.5 정리 대기(카드·끌어 옮기기·병합·분할·추정값 편집·확정) → Task 8–9. 관리자 30일 대리 확정은 백엔드(02a)가 판단하고, 화면은 관리자에게 편집을 열어 둔다.
- §6.1 `/inbox`·`/trash`, 활동 로그 라벨 → Task 6·9·10. 자유 입력 + 자동완성(§1.3) → Task 4·6.
- §5.6 "기존 Entry 에 파일 추가" 는 Entry 상세 화면(03)에서 버튼을 단다 — 백엔드는 이번에 `target_entry_id` 를 받아 둔다(Task 1).
- 방치된 웹 업로드 정리(24시간) → Task 3.

---

## 후속 (2026-10-06) — 정리 대기 화면에 '무엇을·왜' 보이기

사용자 신고: BDF 를 올리면 '분석 중'·'정리 대기' 한 마디만 보여 무엇을 왜 정리하는지 알 수 없다.

- **분석 중(staged)** — 배치 머리줄에 지금 하는 일 한 줄(`파일 확인 중 37/160` · `호선·제목을 추정해 묶는 중` · `앞의 배치 1개를 먼저 처리하고 있습니다` ·
  `워커가 하던 작업(BDF 변환)을 마치면 시작합니다` · `곧 시작합니다`), 펼침 '무엇을 하나요?' 에 `process_batch` 의 실제 4단계
  (파일 목록 훑기 → 파일마다 확인[임시 파일 제외·종류·DRM·SHA-256 중복] → 묶음(초안) 제안[호선·제목 추정, 비슷한 기존 자료] → 본문 추출·3D 변환 예약)를
  지난 단계 체크·지금 단계 스피너로 보인다. 워커 박동이 10분 넘게 없으면(관리자 운영 화면과 같은 기준) 주황 안내
  '처리 프로그램(워커)이 꺼져 있어 기다리는 중입니다 — 관리자에게 알려 주세요.' 를 펼침 밖에 바로 보인다.
- **정리 대기(processed)** — 머리줄 `초안 N개 · 확인 후 확정하세요` + 배치의 BDF 3D 변환 상태 개수(`BDF 변환 중 1 · 대기 2 · 준비됨 1`),
  펼침 '왜 기다리나요?'(이름으로 추정한 초안이라 사람이 확인 → 확정하면 `10_Vault` 로 옮겨져 정식 자료, 확정 전에도 검색엔 미분류,
  BDF 변환은 확정과 따로 진행). 초안 카드 머리 아래 '확인할 것' 한 줄(제목 없음 = 확정 불가로 빨강, 호선·해석 종류 없음, 암호화·중복 파일 수 —
  수정 권한이 있을 때만), 파일 줄마다 BDF 변환 상태(3D 변환 대기·변환 중·준비됨·실패·안 함·INCLUDE).
- 화면 규칙은 순수 함수 `frontend/src/lib/inboxStatus.js`(+시험). 변환만 남은 배치는 15초마다 다시 부른다(분석 중은 5초 그대로).
- **백엔드**: `process_batch(…, progress=)` 가 단계·n/N 을 보고한다(먼저 파일 목록을 다 훑어 전체 개수를 안다). 워커는
  `ingest/progress.make_reporter` 로 **별도 세션**에서 `system_state['batch_progress']` 한 행에 쓴다(같은 단계는 1초에 한 번만).
  - ⚠ 배치 행(`batches`)에 열을 더해 쓰지 않은 이유: process_batch 는 배치 하나를 한 트랜잭션으로 처리한다(중간 커밋 시 재시도에서 File 행이
    중복 — I4). 그 트랜잭션이 `files` 를 넣을 때 외래키 검사로 `batches` 행에 공유 잠금을 잡으므로, 다른 연결로 그 행을 갱신하면 같은 스레드가
    자기 잠금을 기다리며 멈춘다. `system_state` 는 외래키가 없어 겹치지 않는다. 워커가 하나라 한 번에 한 배치만 처리한다. 10분 지난 기록은 버린다.
  - `GET /api/batches` — staged 배치에 `progress {step, done, total, at}` 와 `queue {job_state, attempts, last_error, ahead, busy_with,
    worker_alive, worker_at}`, 초안 파일의 `model.running`(그 파일의 `convert_model` 작업이 도는 중). 큐 상황은 목록 한 번에 한 번만 읽는다.
  - 시험: `tests/test_batch_progress.py`(단계 순서·보고 간격·지난 기록·API 진행/대기/워커 꺼짐·변환 중 표시).
- 배포: API·워커 둘 다 다시 시작해야 한다(DB 열 추가 없음).
