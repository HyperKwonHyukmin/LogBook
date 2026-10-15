"""22 — 보고서 본문 색인 워커(증분). 실행: python -m app.report_index.worker --loop

- MySQL 은 읽기만 한다(확정·Vault 보고서 목록). 쓰기는 서버 로컬 SQLite 색인과 공유 폴더의 추출 캐시
  (20_Derived/_report_search/<추출 조건 해시>/<내용 SHA>.json)뿐이다. 기존 LogBook 워커(app.worker)와 따로 돈다.
- 원본은 임시 사본(중립 확장자 .bin — 로컬 DRM 이 사본을 감싸지 않게)으로만 읽고, 읽는 동안 바뀌면 다음 주기로 미룬다.
- 실패한 파일은 지수 백오프(5분 → 10분 → … 최대 24시간)로 다시 시도한다. 파일 크기·수정 시각·등록 SHA·추출 조건이
  바뀌면 기다리지 않고 바로 다시 한다. 벡터만 빠진 파일은 원본을 다시 읽지 않고 색인된 조각으로 임베딩만 채운다.
- 145 운영: ops/install-tasks.ps1 이 작업 스케줄러 'Logbook Report Index'(ops/run-report-index.ps1)로 등록한다.
"""
import argparse
import hashlib
import json
import logging
import os
import shutil
import tempfile
import time
from dataclasses import replace
from pathlib import Path

from .. import isolated
from .config import load_config
from .extractors import SUPPORTED, VERSION, extract_file, extraction_identity
from .store import IndexStore

log = logging.getLogger(__name__)

EMBED_CHUNK = 32   # 임베딩 요청 단위(조각 수)
PROCESSED = {"ready", "partial", "failed", "missing", "embedded"}   # 배치 상한에 세는 결과


def registered_reports(config):
    """확정·Vault 보고서 전체(완전한 목록을 다 읽은 뒤에만 정리한다 — 조회·네트워크 오류는 예외로 올려 색인을 지우지 않는다)."""
    from sqlalchemy import text

    from ..database import SessionLocal
    from ..storage.paths import StoragePaths, long_join
    storage = StoragePaths(config.storage_root)
    with SessionLocal() as db:
        rows = db.execute(text("""SELECT f.id AS file_id,f.entry_id,f.name,f.ext,f.rel_path,f.sha256,e.vault_rel
            FROM files f JOIN entries e ON e.id=f.entry_id
            WHERE e.status='confirmed' AND f.location='vault' AND f.kind='report'""")).mappings().all()
        result = []
        for row in rows:
            base = long_join(storage.vault, row["vault_rel"])
            path = long_join(base, "files/" + row["rel_path"])
            result.append({"file_id": row["file_id"], "entry_id": row["entry_id"], "name": row["name"],
                           "path": path, "ext": row["ext"],
                           "metadata": {"registered_sha256": row["sha256"], "rel_path": row["rel_path"],
                                        "vault_rel": row["vault_rel"], "entry_id": row["entry_id"]}})
        return result


def _stable_copy(path, target):
    before = os.stat(path)
    digest = hashlib.sha256()
    with open(path, "rb") as source, open(target, "wb") as output:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
            output.write(block)
    after = os.stat(path)
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise RuntimeError("색인하는 동안 원본이 바뀌었습니다 — 다음 주기에 다시 합니다")
    return digest.hexdigest(), after


def failure_key(report, stat, cache_identity):
    """같은 실패를 되풀이하는지 가르는 열쇠 — 이것이 바뀌면 백오프를 기다리지 않는다."""
    size_mtime = f"{stat.st_size}:{stat.st_mtime_ns}" if stat else "missing"
    return "|".join([VERSION, cache_identity, report["metadata"].get("registered_sha256") or "",
                     report["metadata"].get("rel_path") or "", report.get("ext") or "", size_mtime])


def _embed(texts):
    from .embeddings import embed_texts
    vectors = []
    for offset in range(0, len(texts), EMBED_CHUNK):
        vectors.extend(embed_texts(texts[offset:offset + EMBED_CHUNK]))
    if len(vectors) != len(texts):
        raise RuntimeError("임베딩 수가 조각 수와 다릅니다")
    return vectors


def index_one(store, report, config, extractor=extract_file, embed=True, model_identity=None, now=None):
    """보고서 하나. 결과: unchanged·backoff·embedded·ready·partial·failed·missing."""
    now = time.time() if now is None else now
    identity = {k: report[k] for k in ("file_id", "entry_id", "name", "path", "metadata")}
    rest = {k: v for k, v in identity.items() if k != "file_id"}
    current = store.get_document(report["file_id"])
    cache_identity = extraction_identity(config)
    try:
        stat = os.stat(report["path"])
    except FileNotFoundError as exc:
        key = failure_key(report, None, cache_identity)
        if current and current.get("state") == "missing" and current.get("fail_key") == key \
                and (current.get("retry_at") or 0) > now:
            return "backoff"
        store.record_failure(report["file_id"], f"원본 없음: {exc}", state="missing", fail_key=key,
                             retry_base=config.retry_base_seconds, retry_max=config.retry_max_seconds, **rest)
        return "missing"
    except OSError as exc:
        store.record_failure(report["file_id"], f"{type(exc).__name__}: {exc}", fail_key=None,
                             retry_base=config.retry_base_seconds, retry_max=config.retry_max_seconds, **rest)
        return "failed"
    key = failure_key(report, stat, cache_identity)
    if current and current.get("state") in ("failed", "missing") and current.get("fail_key") == key \
            and (current.get("retry_at") or 0) > now:
        return "backoff"

    same_content = (current and current["state"] in ("ready", "partial") and current["version"] == VERSION
                    and current["metadata"].get("extraction_identity") == cache_identity
                    and current["metadata"] | report["metadata"] == current["metadata"]
                    and current["size"] == stat.st_size and current["mtime_ns"] == stat.st_mtime_ns
                    and now - (current["checked_at"] or 0) < config.verify_seconds)
    if same_content:
        # 본문은 그대로 — 임베딩 서버가 살아 있고 벡터가 빠졌으면 색인된 조각으로 벡터만 채운다
        missing_vectors = (embed and model_identity and current["chunk_count"]
                           and (current.get("embedding_model") != model_identity
                                or current["vector_count"] != current["chunk_count"]))
        if not missing_vectors or (current.get("embed_retry_at") or 0) > now:
            return "unchanged"   # checked_at 은 건드리지 않는다 — 주기적 재해시가 언젠가 돌아오게
        texts = [c["text"] for c in store.chunk_texts([report["file_id"]])[report["file_id"]]]
        try:
            vectors = _embed(texts)
        except Exception as exc:
            store.record_embedding_failure(report["file_id"], exc, config.retry_base_seconds, config.retry_max_seconds)
            return "unchanged"
        return "embedded" if store.set_vectors(report["file_id"], current["sha256"], model_identity, vectors) else "unchanged"

    if report["ext"].lower() not in SUPPORTED:
        store.record_failure(report["file_id"], "지원하지 않는 보고서 형식", fail_key=key,
                             retry_base=config.retry_base_seconds, retry_max=config.retry_max_seconds, **rest)
        return "failed"
    try:
        with tempfile.TemporaryDirectory(prefix="logbook-index-") as folder:
            copy = Path(folder) / "source.bin"
            sha, stat = _stable_copy(report["path"], copy)
            # 캐시 위치는 추출 조건(OCR 언어·도구 포함) 해시별 — OCR 을 켜면 예전 부분 추출본을 쓰지 않는다
            cache = config.cache_root / (hashlib.sha256(cache_identity.encode()).hexdigest()[:12]) / f"{sha}.json"
            result = None
            if cache.is_file():
                try:
                    result = json.loads(cache.read_text(encoding="utf-8"))
                except (ValueError, OSError):
                    result = None
            if result is None:
                if extractor is extract_file:
                    # 자식 프로세스에서 제한 시간 안에(리뷰 9) — 깨진 PDF 하나가 색인 워커를 영영 붙잡지 않게.
                    # 넘으면 HeavyTimeout 이 아래 except 로 가서 실패(지수 백오프)로 남는다
                    result = isolated.run(extract_file, copy, config, source_ext=report["ext"],
                                          timeout=config.extract_timeout)
                else:
                    result = extractor(copy, config)
                cache.parent.mkdir(parents=True, exist_ok=True)
                pending = cache.with_name(cache.name + f".{os.getpid()}.tmp")
                pending.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
                os.replace(pending, cache)
            metadata = dict(report["metadata"])
            metadata["extraction_identity"] = cache_identity
            chunks, model = result["chunks"], None
            if embed and model_identity and chunks:
                try:
                    vectors = _embed([c["text"] for c in chunks])
                    chunks = [{**c, "vector": v} for c, v in zip(chunks, vectors)]
                    model = model_identity
                except Exception as exc:
                    # 본문 상태(ready/partial)는 그대로 두고 벡터만 비운다 — 다음 주기에 벡터만 다시 채운다
                    metadata["embedding_error"] = str(exc)[:500]
            latest = os.stat(report["path"])
            if (latest.st_size, latest.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
                raise RuntimeError("게시 전에 원본이 바뀌었습니다 — 다음 주기에 다시 합니다")
            store.upsert_document(**{**identity, "metadata": metadata}, sha256=sha, version=VERSION,
                                  size=stat.st_size, mtime_ns=stat.st_mtime_ns, chunks=chunks,
                                  state=result["state"], warnings=result["warnings"], embedding_model=model)
            return result["state"]
    except Exception as exc:
        missing = isinstance(exc, FileNotFoundError)
        store.record_failure(report["file_id"], f"{type(exc).__name__}: {exc}", state="missing" if missing else "failed",
                             fail_key=key, retry_base=config.retry_base_seconds, retry_max=config.retry_max_seconds, **rest)
        return "missing" if missing else "failed"


def run_cycle(config, source=registered_reports, extractor=extract_file, embed=True):
    store = IndexStore(config.index_path)
    started = time.time()
    try:
        reports = source(config)
        store.reconcile(r["file_id"] for r in reports)
        model_identity = None
        if embed:
            try:
                from .embeddings import embedding_identity
                model_identity = embedding_identity(max_age=0)
            except Exception:
                model_identity = None   # 임베딩 서버가 없으면 본문만 색인한다(벡터는 서버가 살아나면 채운다)
        # 오래 확인하지 않은 것부터 — 큰 배치가 뒤쪽 보고서를 굶기지 않게(조회 한 번)
        checked = {fid: doc.get("checked_at") or 0
                   for fid, doc in store.document_rows([r["file_id"] for r in reports], active_only=False).items()}
        reports.sort(key=lambda r: checked.get(r["file_id"], 0))
        outcomes, processed = {}, 0
        for report in reports:
            outcome = index_one(store, report, config, extractor=extractor, embed=embed, model_identity=model_identity)
            outcomes[outcome] = outcomes.get(outcome, 0) + 1
            if outcome in PROCESSED:
                processed += 1
            if processed >= config.batch_size:
                break
        store.set_worker_state(last_scan_at=started, last_success_at=time.time(), last_error=None,
                               registered=len(reports), outcomes=outcomes,
                               embedding_available=model_identity is not None)
        return outcomes
    except Exception as exc:
        store.set_worker_state(last_scan_at=started, last_error=f"{type(exc).__name__}: {exc}")
        log.exception("보고서 색인 주기 실패 — 기존 색인은 그대로 둔다")
        raise


class WorkerLock:
    """같은 색인 파일에 워커가 둘 뜨지 않게 하는 잠금."""

    def __init__(self, index_path):
        self.path = Path(index_path).with_suffix(".worker.lock")

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = open(self.path, "a+b")
        self.handle.seek(0)
        self.handle.write(b"0")
        self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.handle.close()
            raise RuntimeError("다른 보고서 색인 워커가 이미 실행 중입니다")
        return self

    def __exit__(self, *_):
        self.handle.close()


def rebuild_index(config):
    """색인 파일을 옆으로 치우고(.bak-시각) 새로 만든다. 추출 캐시(공유 폴더)가 있으면 원본을 다시 추출하지 않는다."""
    path = Path(config.index_path)
    if path.exists():
        stamp = time.strftime("%Y%m%d-%H%M%S")
        for suffix in ("", "-wal", "-shm"):
            old = Path(str(path) + suffix)
            if old.exists():
                shutil.move(str(old), str(old) + f".bak-{stamp}")
    return IndexStore(path)


def main():
    parser = argparse.ArgumentParser(description="22 — 보고서 본문 색인 워커")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--once", action="store_true", help="한 주기만 돌고 끝낸다")
    group.add_argument("--loop", action="store_true", help="LOGBOOK_REPORT_INTERVAL 마다 되풀이한다")
    group.add_argument("--status", action="store_true", help="색인 상태를 JSON 으로 보여 준다")
    group.add_argument("--rebuild", action="store_true",
                       help="색인 파일을 .bak 으로 치우고 새로 만든다(다음 --once/--loop 가 캐시에서 다시 채운다)")
    parser.add_argument("--root", type=Path, help="원본 저장소(기본 LOGBOOK_STORAGE_ROOT)")
    parser.add_argument("--no-embeddings", action="store_true", help="키워드 색인만 만든다")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    config = load_config()
    if args.root:
        config = replace(config, storage_root=args.root)
    if args.status:
        print(json.dumps(IndexStore(config.index_path).status(), ensure_ascii=False, indent=2))
        return
    with WorkerLock(config.index_path):
        if args.rebuild:
            rebuild_index(config)
            print(json.dumps({"rebuilt": str(config.index_path)}, ensure_ascii=False))
            return
        while True:
            try:
                print(json.dumps(run_cycle(config, embed=not args.no_embeddings), ensure_ascii=False), flush=True)
            except Exception:
                if not args.loop:
                    raise
            if not args.loop:
                break
            time.sleep(config.interval_seconds)


if __name__ == "__main__":
    main()
