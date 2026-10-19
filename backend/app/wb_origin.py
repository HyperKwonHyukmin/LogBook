"""39 — WorkBench 해석 출처(Hi-TESS Core 1단계, hitess-core docs/10-phase1-provenance.md).

WorkBench 관리자가 해석 1건의 파일을 보낼 때(`/api/integration/uploads`, 19) 실어 오는 `origin` 을
묶음(batches.origin)에 남겨, 확정된 자료에서도 "WorkBench 해석 WB #123 에서 왔다"를 보이게 한다.

- 묶음 단위로 남긴다 — 파일은 합치기·옮기기 뒤에도 원래 batch_id 를 가지므로 출처가 파일을 따라간다.
- 여권(passport): WB 해석 여권의 산출물 목록(역할·이름·sha256). LogBook 파일 sha256 과 같으면 'WB 산출물과 같음'.
- 화면·API 노출은 LOGBOOK_WB_ORIGIN_SHOW 가 켜졌을 때만(Core 03-safety: 기본 꺼짐). 저장과 entry.json 보존은 늘 한다.
- 받은 값은 정해진 칸만 길이를 잘라 남긴다(모르는 칸은 버린다). 경로는 받지 않는다."""
import re

from sqlalchemy.orm import Session

from . import models

LABEL = "WB #{}"
MAX_ARTIFACTS = 500
_SHA = re.compile(r"^[0-9a-f]{64}$")
# 검색어 하나가 해석 표기 전체일 때 — 'WB #123', 'WB#123', 'wb 123' (Core 01: 표기 WB #123)
WB_TERM = re.compile(r"^\s*wb\s*#?\s*([0-9]{1,9})\s*$", re.IGNORECASE)
_TEXT = {"owner": 50, "program": 100, "project": 200, "created_at": 40, "note": 500}


def label(analysis_id: int) -> str:
    return LABEL.format(analysis_id)


def parse_term(q: str | None) -> int | None:
    """검색어가 'WB #123' 꼴이면 해석 번호, 아니면 None."""
    m = WB_TERM.match(q or "")
    return int(m.group(1)) if m else None


def _passport(raw) -> dict | None:
    items = raw.get("artifacts") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return None
    out = []
    for a in items[:MAX_ARTIFACTS]:
        if not isinstance(a, dict):
            continue
        sha = str(a.get("sha256") or "").strip().lower()
        if not _SHA.fullmatch(sha):
            continue
        size = a.get("size")
        out.append({"role": str(a.get("role") or "")[:40], "name": str(a.get("name") or "")[:255], "sha256": sha,
                    "size": size if isinstance(size, int) and size >= 0 else None})
    return {"artifacts": out} if out else None


def clean(raw) -> dict | None:
    """WB 가 보낸 origin → 남길 값. 해석 번호(양의 정수)가 없으면 None(남기지 않는다)."""
    if not isinstance(raw, dict):
        return None
    try:
        aid = int(raw.get("analysis_id"))
    except (TypeError, ValueError):
        return None
    if aid <= 0:
        return None
    out: dict = {"analysis_id": aid}
    for k, n in _TEXT.items():
        v = raw.get(k)
        if v is not None and str(v).strip():
            out[k] = str(v).strip()[:n]
    if out.get("owner"):
        out["owner"] = out["owner"].upper()
    passport = _passport(raw.get("passport"))
    if passport:
        out["passport"] = passport
    return out


def stamp(batch: models.Batch, origin: dict | None) -> bool:
    """묶음에 출처를 남긴다(커밋은 부르는 쪽). 남겼으면 True."""
    c = clean(origin)
    if c is None:
        return False
    batch.origin, batch.wb_analysis_id = c, c["analysis_id"]
    return True


def entry_origins(db: Session, files: list[models.File]) -> list[dict]:
    """자료 파일들의 출처 — 묶음마다 하나 {analysis_id, label, owner, program, project, created_at, note,
    files: [파일 id], matched: [{file_id, role, name}]}. 출처 없는 묶음은 뺀다. 해석 번호 순."""
    by_batch: dict[int, list[models.File]] = {}
    for f in files:
        by_batch.setdefault(f.batch_id, []).append(f)
    if not by_batch:
        return []
    rows = (db.query(models.Batch).filter(models.Batch.id.in_(list(by_batch)), models.Batch.origin.isnot(None)).all())
    out = []
    for b in rows:
        o = b.origin if isinstance(b.origin, dict) else None
        if not o or not o.get("analysis_id"):
            continue
        fs = sorted(by_batch[b.id], key=lambda f: f.rel_path)
        arts = {a["sha256"]: a for a in ((o.get("passport") or {}).get("artifacts") or [])}
        matched = [{"file_id": f.id, "role": arts[f.sha256]["role"], "name": arts[f.sha256]["name"]}
                   for f in fs if f.sha256 in arts]
        out.append({**{k: o[k] for k in ("analysis_id", *_TEXT) if k in o}, "label": label(o["analysis_id"]),
                    "files": [f.id for f in fs], "matched": matched,
                    "artifacts": len(arts)})
    return sorted(out, key=lambda r: r["analysis_id"])


def export(db: Session, files: list[models.File]) -> list[dict]:
    """entry.json `origins`(재구축 원천) — 묶음마다 출처 원본 + 파일 rel_path. 출처 없으면 []."""
    by_batch: dict[int, list[str]] = {}
    for f in files:
        by_batch.setdefault(f.batch_id, []).append(f.rel_path)
    if not by_batch:
        return []
    rows = db.query(models.Batch).filter(models.Batch.id.in_(list(by_batch)), models.Batch.origin.isnot(None)).all()
    return sorted(({**b.origin, "files": sorted(by_batch[b.id])} for b in rows
                   if isinstance(b.origin, dict) and b.origin.get("analysis_id")),
                  key=lambda o: o["analysis_id"])


def restore(db: Session, entry: models.Entry, files: list[models.File], origins) -> int:
    """재구축 — entry.json `origins` 마다 묶음을 하나 만들어 그 파일들을 옮겨 단다. 되살린 출처 수."""
    if not isinstance(origins, list):
        return 0
    by_rel = {f.rel_path: f for f in files}
    n = 0
    for i, o in enumerate(origins):
        c = clean(o) if isinstance(o, dict) else None
        rels = [r for r in (o.get("files") or []) if r in by_rel] if c else []
        if not rels:
            continue
        b = models.Batch(key=f"rbo-{entry.id}-{i}"[:24], source="rebuild", original_name=label(c["analysis_id"]),
                         state="done", origin=c, wb_analysis_id=c["analysis_id"])
        db.add(b)
        db.flush()
        for r in rels:
            by_rel[r].batch_id = b.id
        n += 1
    db.flush()
    return n
