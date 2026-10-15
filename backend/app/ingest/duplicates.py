"""완전 동일 BDF 막기(17) — 올리는 BDF 가 이미 있는 자료(확정·정리 대기)의 BDF 와 완전히 같으면 받지 않는다.

판정 규칙(docs/plans/2026-10-08-logbook-17-duplicate-block.md §1):
    서명 동일   12 의 geometry·property·material·load 서명(같은 규칙 버전)이 모두 같다(파일명·줄 형식 무관).
    바이트 동일 상대에 쓸 수 있는 서명이 없을 때(12 이전 변환)만, 올린 BDF 가 INCLUDE 없이 완결되면 files.sha256 이 같을 때.
형상만 같은 것은 막지 않는다(12 의 정보 칩 그대로).

막는 곳 세 군데가 이 모듈 하나를 쓴다:
    1. 웹 업로드 마무리(uploads.service.finish) — probe() → decide(), 동기 상한(바이트·초)을 넘으면 deferred 로 워커에 맡긴다.
    2. 워커 배치 처리(ingest.process.process_batch) — 같은 probe() → decide()(자기 배치 파일은 비교에서 뺀다).
    3. 확정·[파일 추가] 자동 합치기(entries.service.confirm) — 저장된 서명·바이트로 find_existing().

권한(15): 대상이 보는 사람에게 숨은 자료여도 막는다. 설명(describe)할 때 볼 수 없는 대상은 빼고 hidden=True 만 남긴다
(번호·제목·파일·올린 사람을 드러내지 않는다). batches.excluded 에는 대상 '파일 id' 만 저장하고 응답 때마다 보는 사람 권한으로 다시 설명한다.
"""
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import access, models
from ..bdf.deck import DeckReader, DeckTooLarge
from ..bdf.model import BEAM_CARDS, QUAD_CARDS, TRI_CARDS
from ..bdf.signature import VERSION as SIG_VERSION, Signature, compute_signature
from ..storage.paths import long_join
from .hashing import sha256_of
from .rules import classify, is_excluded

log = logging.getLogger(__name__)

# 변환(convert_model)이 '요소 있음'으로 보는 카드 — 이것이 하나도 없으면 서명을 남기지 않으므로 여기서도 비교하지 않는다
_ELEMENT_CARDS = frozenset((*BEAM_CARDS, *TRI_CARDS, *QUAD_CARDS))
DESCRIBE_LIMIT = 5          # 막힌 파일 하나에 보여 주는 대상 수(총 개수는 total)
_TARGET_STATES = ("confirmed", "draft")

REASON_MODEL = "duplicate_model"       # 완전 동일 BDF
REASON_INCLUDE = "duplicate_include"   # 막힌 BDF 만 INCLUDE 하던 조각(함께 막음)


@dataclass
class Probe:
    """올린 BDF 하나를 읽은 결과."""
    rel: str
    size: int
    sig: Signature | None                 # 요소가 없으면 None(비교하지 않는다)
    includes: list[str] = field(default_factory=list)   # 이 파일이 읽은 INCLUDE(업로드 루트 기준 posix)
    self_contained: bool = True           # INCLUDE 가 없고 못 찾은 것도 없다 — 바이트 규칙을 쓸 수 있다
    sha256: str | None = None


@dataclass
class Blocked:
    """막힌 본 BDF 하나(+ 함께 막는 조각)."""
    rel: str
    size: int
    scope: str                            # existing(이미 있는 자료) | same_upload(이번 업로드 안)
    file_ids: list[int] = field(default_factory=list)   # existing 대상 파일 id(확정 먼저)
    same_as: str | None = None            # same_upload 일 때 받은 쪽 파일 경로
    includes: list[str] = field(default_factory=list)   # 함께 막는 INCLUDE 조각 경로


def is_model_name(name: str) -> bool:
    return classify(name) == "model" and not is_excluded(name)


def _key(sig: Signature) -> tuple[str, str, str, str]:
    return (sig.geometry, sig.property, sig.material, sig.load)


def read_probe(root: Path, rel: str, size: int, sha: str | None = None) -> Probe | None:
    """BDF 하나를 DeckReader + compute_signature 로 읽는다(build_model·lbm 없음). 같은 폴더의 INCLUDE 는 함께 푼다.
    DRM 암호문·크기 상한·읽기 실패·메모리 부족이면 None — 검사하지 않는다(변환이 따로 판단한다)."""
    from ..convert.job import MAX_MODEL_BYTES, EncryptedFile, _opener   # 순환 import 방지

    reader = DeckReader(_opener(root), max_bytes=MAX_MODEL_BYTES)
    try:
        cards = reader.read(rel)
        has_elements = any(c.name in _ELEMENT_CARDS for c in cards)
        sig = compute_signature(cards, reader.control, reader.sol) if has_elements else None
    except (EncryptedFile, DeckTooLarge, MemoryError) as exc:
        log.info("동일 BDF 검사 건너뜀(%s): %s", type(exc).__name__, rel)
        return None
    except Exception as exc:  # noqa: BLE001 — 깨진 덱은 막지 않는다(변환이 실패로 기록한다)
        log.warning("동일 BDF 검사 중 읽기 실패 — 건너뜀: %s (%s)", rel, exc)
        return None
    finally:
        reader.cards = []
    p = Probe(rel=rel, size=size, sig=sig, includes=list(reader.includes),
              self_contained=not reader.includes and not reader.missing)
    if sig is not None and p.self_contained:
        try:
            p.sha256 = sha or sha256_of(long_join(root, rel))
        except OSError:
            p.sha256 = None
    return p


def probe(root: Path, files: list[tuple[str, int]], *, sha: dict[str, str] | None = None,
          max_bytes: int | None = None, max_seconds: float | None = None,
          clock=time.monotonic) -> tuple[list[Probe], list[str]]:
    """files(경로, 크기) 중 모델 파일을 경로 순서로 읽는다 → (probes, deferred).

    max_bytes·max_seconds(웹 업로드 동기 검사 상한): 모델 바이트 합이 넘거나 경과 시간이 넘으면 그 파일부터는 읽지 않고
    deferred 로 돌려준다(워커 process_batch 가 다시 검사한다)."""
    sha = {k.casefold(): v for k, v in (sha or {}).items()}
    started = clock()
    used = 0
    probes: list[Probe] = []
    deferred: list[str] = []
    for rel, size in sorted(files, key=lambda x: x[0].casefold()):
        if not is_model_name(rel.rsplit("/", 1)[-1]):
            continue
        if deferred or (max_bytes is not None and used + size > max_bytes) \
                or (max_seconds is not None and clock() - started > max_seconds):
            deferred.append(rel)
            continue
        used += size
        p = read_probe(root, rel, size, sha.get(rel.casefold()))
        if p is not None:
            probes.append(p)
    return probes, deferred


def find_existing(db: Session, *, sig: Signature | None, sha256: str | None, self_contained: bool,
                  exclude_batch_id: int | None = None, exclude_file_ids=()) -> list[int]:
    """완전 동일한 기존 BDF 파일 id(확정 Entry 먼저, 그다음 먼저 올라온 것). 휴지통·INCLUDE 조각은 대상이 아니다."""
    S, F, E = models.ModelSummary, models.File, models.Entry
    found: dict[int, bool] = {}

    def common(q):
        q = q.filter(F.location != "trash", E.status.in_(_TARGET_STATES))
        if exclude_batch_id is not None:
            q = q.filter(F.batch_id != exclude_batch_id)
        ex = [i for i in exclude_file_ids if i is not None]
        if ex:
            q = q.filter(F.id.notin_(ex))
        return q

    if sig is not None:
        q = (db.query(F.id, E.status).join(S, S.file_id == F.id).join(E, E.id == F.entry_id)
             .filter(S.sig_version == SIG_VERSION, S.sig_geometry == sig.geometry, S.sig_property == sig.property,
                     S.sig_material == sig.material, S.sig_load == sig.load))
        for fid, status in common(q):
            found[fid] = status == "confirmed"
    if self_contained and sha256:
        # 서명이 없는(12 이전 변환·옛 규칙) 상대만 — 서명이 있으면 서명이 판정한다
        q = (db.query(F.id, E.status).join(E, E.id == F.entry_id).outerjoin(S, S.file_id == F.id)
             .filter(F.sha256 == sha256, F.kind == "model",
                     or_(S.file_id.is_(None), S.sig_geometry.is_(None), S.sig_version != SIG_VERSION),
                     or_(S.file_id.is_(None), S.state != "include")))
        for fid, status in common(q):
            found[fid] = status == "confirmed"
    return sorted(found, key=lambda i: (not found[i], i))


def decide(db: Session, probes: list[Probe], *, files: list[tuple[str, int]] | None = None, deferred=(),
           exclude_batch_id: int | None = None) -> list[Blocked]:
    """probes 중 막을 것. 같은 업로드 안의 다른 BDF 가 INCLUDE 하는 조각은 본 파일과 함께 판정하고 혼자 비교하지 않는다.
    같은 업로드 안에서 서로 같으면 경로 순서로 앞의 것만 받는다. files = 업로드의 모든 파일(경로, 크기) — 함께 막는 조각을
    찾는 데 쓴다(조각은 .inc 처럼 모델 확장자가 아닐 수 있다). 없으면 probes 만 본다."""
    fragments = {i.casefold() for p in probes for i in p.includes}
    mains = [p for p in probes if p.rel.casefold() not in fragments and p.sig is not None]
    kept: dict[tuple, str] = {}
    blocked: list[Blocked] = []
    for p in mains:
        k = _key(p.sig)
        if k in kept:
            blocked.append(Blocked(rel=p.rel, size=p.size, scope="same_upload", same_as=kept[k]))
            continue
        ids = find_existing(db, sig=p.sig, sha256=p.sha256, self_contained=p.self_contained,
                            exclude_batch_id=exclude_batch_id)
        if ids:
            blocked.append(Blocked(rel=p.rel, size=p.size, scope="existing", file_ids=ids))
        else:
            kept[k] = p.rel
    if not blocked:
        return blocked
    # 함께 막는 조각 — 받는 파일(막히지 않은 probe)이 쓰지 않는 것만. 읽지 못한(deferred) 모델이 있으면
    # 그 파일이 무엇을 INCLUDE 하는지 모르므로 조각을 남긴다(데이터를 지우는 쪽으로 틀리지 않게).
    if not deferred:
        out = {b.rel.casefold() for b in blocked}
        used = {i.casefold() for p in probes if p.rel.casefold() not in out for i in p.includes}
        by_rel = {p.rel.casefold(): p for p in probes}
        present = {r.casefold(): r for r, _s in (files if files is not None else [(p.rel, p.size) for p in probes])}
        taken: set[str] = set()
        for b in blocked:
            for inc in by_rel[b.rel.casefold()].includes:
                c = inc.casefold()
                if c not in used and c not in taken and c in present:
                    b.includes.append(present[c])
                    taken.add(c)
    return blocked


def include_paths(blocked: list[Blocked]) -> list[str]:
    return [i for b in blocked for i in b.includes]


def records(blocked: list[Blocked], sizes: dict[str, int], *, kept: bool) -> list[dict]:
    """batches.excluded 에 넣을 항목(대상은 파일 id 만). kept = 원본을 _staging 에 남겼는가(워커 경로)."""
    out: list[dict] = []
    for b in blocked:
        rec = {"name": b.rel, "size": b.size, "reason": REASON_MODEL, "scope": b.scope,
               "same_as_files": b.file_ids, "includes": b.includes}
        if b.same_as:
            rec["same_as"] = b.same_as
        if kept:
            rec["kept"] = True
        out.append(rec)
        for inc in b.includes:
            r = {"name": inc, "size": sizes.get(inc.casefold(), 0), "reason": REASON_INCLUDE, "of": b.rel}
            if kept:
                r["kept"] = True
            out.append(r)
    return out


# ---- 설명(보는 사람 권한으로) ----

def describe(db: Session, file_ids, viewer, limit: int = DESCRIBE_LIMIT) -> dict:
    """대상 파일 id → {matches: [...], total, hidden}. viewer 가 볼 수 없는 자료는 빼고 hidden=True(개수는 싣지 않는다).
    viewer None = 내부용(거르지 않는다). 없어진(영구 삭제·휴지통) 대상은 건너뛴다."""
    ids = [i for i in (file_ids or []) if isinstance(i, int)]
    if not ids:
        return {"matches": [], "total": 0, "hidden": False}
    F, E = models.File, models.Entry
    rows = (db.query(F.id, F.name, F.rel_path, E.id.label("pk"), E.entry_id, E.title, E.status, E.uploaded_by)
            .join(E, E.id == F.entry_id)
            .filter(F.id.in_(ids), F.location != "trash", E.status.in_(_TARGET_STATES)).all())
    order = {fid: n for n, fid in enumerate(ids)}
    rows.sort(key=lambda r: (r.status != "confirmed", order.get(r.id, 0)))
    allowed = access.visible_entry_pks(db, viewer, {r.pk for r in rows}) if viewer is not None else None
    seen = [r for r in rows if allowed is None or r.pk in allowed]
    hidden = len(seen) < len(rows)
    people = {u.employee_id: u.name for u in db.query(models.User.employee_id, models.User.name)
              .filter(models.User.employee_id.in_({r.uploaded_by for r in seen if r.uploaded_by} or {""}))}
    matches = [{"file_id": r.id, "name": r.name, "rel_path": r.rel_path, "entry_id": r.entry_id,
                "entry_title": r.title, "entry_status": r.status, "uploaded_by": r.uploaded_by,
                "uploaded_by_name": people.get(r.uploaded_by)} for r in seen[:limit]]
    return {"matches": matches, "total": len(seen), "hidden": hidden}


def public_record(db: Session, rec: dict, viewer) -> dict:
    """excluded 항목 하나를 응답용으로 — duplicate_model 이면 대상(same_as_files)을 보는 사람 권한으로 설명해 붙인다."""
    if rec.get("reason") != REASON_MODEL:
        return rec
    out = {k: v for k, v in rec.items() if k != "same_as_files"}
    out.update(describe(db, rec.get("same_as_files") or [], viewer))
    return out


def public_excluded(db: Session, excluded: list[dict] | None, viewer) -> list[dict]:
    return [public_record(db, r, viewer) if isinstance(r, dict) else r for r in (excluded or [])]


# ---- 확정 재검사 ----

def entry_duplicates(db: Session, files: list[models.File], *, exclude_batch_id: int | None) -> list[tuple[models.File, list[int]]]:
    """초안 파일 중 그 사이 생긴 완전 동일 BDF 가 있는 것 — 저장된 서명(변환 또는 배치 처리가 적어 둔 것)과 바이트로 찾는다.
    같은 배치 파일은 들어올 때 이미 판정했으므로 뺀다. 서명도 없고 INCLUDE 여부도 모르면(변환 전 옛 행) 건너뛴다."""
    model_files = [f for f in files if f.kind == "model" and f.location != "trash"]
    if not model_files:
        return []
    rows = {r.file_id: r for r in db.query(models.ModelSummary)
            .filter(models.ModelSummary.file_id.in_([f.id for f in model_files]))}
    mine = [f.id for f in files]
    out = []
    for f in model_files:
        r = rows.get(f.id)
        if r is not None and r.state == "include":
            continue
        sig = (Signature(geometry=r.sig_geometry, property=r.sig_property, material=r.sig_material,
                         load=r.sig_load, other=r.sig_other or "")
               if r is not None and r.sig_geometry and r.sig_version == SIG_VERSION else None)
        self_contained = bool(r is not None and r.state == "done" and not r.includes and not r.missing)
        if sig is None and not self_contained:
            continue
        ids = find_existing(db, sig=sig, sha256=f.sha256, self_contained=self_contained,
                            exclude_batch_id=exclude_batch_id, exclude_file_ids=mine)
        if ids:
            out.append((f, ids))
    return out


def missing_signature_count(db: Session) -> int:
    """변환이 끝났는데 서명이 없거나 옛 규칙인 모델 수(휴지통 밖) — 운영 화면 안내용."""
    S, F = models.ModelSummary, models.File
    return (db.query(S.file_id).join(F, F.id == S.file_id)
            .filter(S.state == "done", F.location != "trash",
                    or_(S.sig_geometry.is_(None), S.sig_version.is_(None), S.sig_version != SIG_VERSION))
            .count())
