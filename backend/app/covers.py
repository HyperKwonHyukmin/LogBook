"""52 — 검색 결과의 대표 그림 대체(BDF 썸네일이 없는 자료). PDF 첫 쪽 → PPTX 에 든 첫 슬라이드 그림 → 이미지 파일.

그림은 처음 요청 때 만들어 20_Derived/covers/<파일 id>_<sha 앞 12자>.png 에 둔다(파일 내용이 바뀌면 이름이 바뀐다).
DRM 이 걸린 파일·휴지통 파일은 고르지 않는다."""
import io
import os
import zipfile

from sqlalchemy.orm import Session

from . import models
from .entries.locate import file_path
from .storage.paths import StoragePaths, to_long

WIDTH, HEIGHT = 384, 240          # 결과 행 그림(128×80)의 3배
PDF = (".pdf",)
PPTX = (".pptx",)
IMAGES = (".png", ".jpg", ".jpeg")
# 고르는 순서 — PDF 가 가장 낫고(보고서 첫 쪽), 그다음 PPTX 썸네일, 마지막이 이미지
RANK = {**{e: 0 for e in PDF}, **{e: 1 for e in PPTX}, **{e: 2 for e in IMAGES}}


class NoCover(Exception):
    pass


def _chunks(ids, n=500):
    ids = list(ids)
    for i in range(0, len(ids), n):
        yield ids[i:i + n]


def cover_files(db: Session, entry_ids) -> dict[int, dict]:
    """Entry pk → {file_id, key} — 그림을 만들 파일 하나. 같은 형식이면 이름에 '보고서'가 든 것, 큰 파일, 낮은 id."""
    F = models.File
    best: dict[int, tuple] = {}
    for part in _chunks(entry_ids):
        q = (db.query(F.entry_id, F.id, F.name, F.ext, F.size, F.sha256)
             .filter(F.entry_id.in_(part), F.location != "trash", F.drm_encrypted.is_(False),
                     F.ext.in_(list(RANK))))
        for eid, fid, name, ext, size, sha in q:
            rank = (RANK[(ext or "").lower()], 0 if "보고서" in (name or "") else 1, -(size or 0), fid)
            if eid in best and rank >= best[eid][0]:
                continue
            best[eid] = (rank, {"file_id": fid, "key": (sha or "")[:12]})
    return {eid: v[1] for eid, v in best.items()}


def _fit(img):
    from PIL import Image

    img = img.convert("RGB")
    img.thumbnail((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


def render(path: str, ext: str) -> bytes:
    """원본 파일 → 작은 PNG. 만들 수 없으면 NoCover."""
    from PIL import Image

    ext = ext.lower()
    try:
        if ext in PDF:
            import fitz

            with fitz.open(to_long(path)) as doc:
                if doc.page_count == 0:
                    raise NoCover("empty_pdf")
                page = doc[0]
                zoom = min(WIDTH / max(page.rect.width, 1), HEIGHT / max(page.rect.height, 1)) * 2
                pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
                return _fit(Image.open(io.BytesIO(pix.tobytes("png"))))
        if ext in PPTX:
            # PowerPoint 가 저장할 때 첫 슬라이드 그림을 docProps/thumbnail.jpeg 로 넣어 둔다(없는 파일도 있다)
            with zipfile.ZipFile(to_long(path)) as z:
                name = next((n for n in z.namelist() if n.lower().startswith("docprops/thumbnail.")), None)
                if name is None:
                    raise NoCover("no_pptx_thumbnail")
                return _fit(Image.open(io.BytesIO(z.read(name))))
        if ext in IMAGES:
            with Image.open(to_long(path)) as img:
                return _fit(img)
    except NoCover:
        raise
    except Exception as exc:   # 깨진 파일·읽기 실패 — 그림 없이 둔다
        raise NoCover(str(exc)) from exc
    raise NoCover("unsupported")


def cover_png(db: Session, storage: StoragePaths, f: models.File) -> tuple[bytes, str]:
    """→ (PNG, ETag 열쇠). 만들어 둔 것이 있으면 그것을, 없으면 만들어 저장한다."""
    ext = (f.ext or os.path.splitext(f.name or "")[1]).lower()
    if ext not in RANK or f.drm_encrypted or f.location == "trash":
        raise NoCover("unsupported")
    key = (f.sha256 or "")[:12] or "nokey"
    cached = storage.derived / "covers" / f"{f.id}_{key}.png"
    try:
        with open(to_long(cached), "rb") as fh:
            return fh.read(), key
    except OSError:
        pass
    data = render(file_path(db, storage, f), ext)
    try:
        os.makedirs(to_long(cached.parent), exist_ok=True)
        with open(to_long(cached), "wb") as fh:
            fh.write(data)
    except OSError:
        pass   # 저장하지 못해도 이번 응답은 준다(다음에 다시 만든다)
    return data, key
