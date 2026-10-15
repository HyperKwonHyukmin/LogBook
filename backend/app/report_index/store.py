"""22 — 보고서 본문 색인 저장소(서버 로컬 SQLite). 색인은 다시 만들 수 있는 파생물이고 권한의 근거가 아니다.

표 구성(스키마 2):
- documents: 파일 하나의 색인 상태·등록 정보(권한·현재성은 매 요청 MySQL 로 다시 확인한다).
- chunks: 위치(locator)가 있는 본문 조각 + 정규화 본문(norm, NFKC·casefold). 벡터는 여기 두지 않는다.
- chunk_fts: chunks.norm 의 FTS5 trigram 색인(외부 내용 표 — 본문을 두 번 저장하지 않는다). 부분 일치 후보를 뽑는 데만 쓰고,
  최종 판정(숫자 경계·조각 경계 이어붙이기)은 search.py 가 조각 본문으로 다시 한다.
- vectors: 조각별 float32 벡터(BLOB). 키워드 검색은 이 표를 절대 읽지 않는다.
- index_meta: schema·generation(조각/벡터가 바뀔 때마다 1 증가 — API 프로세스의 벡터 캐시 무효화 기준).

스키마 0(Codex 초안: chunks.vector 에 JSON 벡터)은 처음 열 때 자동으로 옮긴다(벡터도 BLOB 로 보존).
"""
import json
import sqlite3
import threading
import time
import unicodedata
from contextlib import contextmanager
from pathlib import Path

import numpy as np

SCHEMA_VERSION = 2
FTS_MIN_CHARS = 3        # trigram 은 3글자부터 찾는다 — 1~2글자 검색어는 정규화 본문 instr 로 훑는다
FTS_PREFIX_CHARS = 200   # 긴 검색어는 앞부분만으로 후보를 뽑는다(조각 겹침 256자 안에 반드시 들어간다)
GROUP = 800              # IN (...) 한 번에 넣는 값 수(SQLite 변수 상한 아래)


def normalize(text):
    return unicodedata.normalize("NFKC", str(text or "")).casefold()


_DOC_COLUMNS = {
    "entry_id": "INTEGER", "name": "TEXT", "path": "TEXT", "sha256": "TEXT", "version": "TEXT", "state": "TEXT",
    "error": "TEXT", "warnings": "TEXT", "metadata": "TEXT", "size": "INTEGER", "mtime_ns": "INTEGER",
    "indexed_at": "REAL", "checked_at": "REAL", "active": "INTEGER NOT NULL DEFAULT 1",
    # 스키마 2 에서 더한 열
    "chunk_count": "INTEGER NOT NULL DEFAULT 0", "vector_count": "INTEGER NOT NULL DEFAULT 0",
    "embedding_model": "TEXT", "fail_count": "INTEGER NOT NULL DEFAULT 0", "retry_at": "REAL", "fail_key": "TEXT",
    "embed_fail_count": "INTEGER NOT NULL DEFAULT 0", "embed_retry_at": "REAL",
}

_FTS_DDL = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(norm, content='chunks', content_rowid='id', tokenize='trigram')",
    "CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN "
    "INSERT INTO chunk_fts(rowid, norm) VALUES (new.id, new.norm); END",
    "CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN "
    "INSERT INTO chunk_fts(chunk_fts, rowid, norm) VALUES ('delete', old.id, old.norm); END",
]


def retry_delay(count, base, maximum):
    """실패 count 번째의 다음 재시도까지 초: base, 2·base, 4·base … 최대 maximum."""
    return min(maximum, base * (2 ** max(0, count - 1)))


class IndexStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fts = False
        self._ensure_schema()

    # ---- 연결 ----
    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def read(self):
        """한 읽기 스냅숏(BEGIN … COMMIT) — 문서 정보와 조각을 같은 세대로 읽는다."""
        with self._connect() as db:
            db.execute("BEGIN")
            try:
                yield db
            finally:
                db.execute("COMMIT")

    @contextmanager
    def write(self):
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                yield db
            except BaseException:
                db.execute("ROLLBACK")
                raise
            db.execute("COMMIT")

    # 예전 이름(테스트·도구 호환)
    connect = read

    # ---- 스키마 ----
    def _ensure_schema(self):
        with self._connect() as db:
            if db.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION:
                self.fts = self._meta(db, "fts") == "1"
                return
            db.execute("PRAGMA journal_mode=WAL")
        with self.write() as db:
            # 다른 프로세스(워커·API)가 먼저 옮겼을 수 있다 — 잠금을 잡은 뒤 다시 본다
            if db.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION:
                self.fts = self._meta(db, "fts") == "1"
                return
            self._migrate(db)

    @staticmethod
    def _meta(db, key, default=None):
        row = db.execute("SELECT value FROM index_meta WHERE key=?", (key,)).fetchone() \
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='index_meta'").fetchone() else None
        return row[0] if row else default

    def _migrate(self, db):
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        db.execute("CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS worker_state (key TEXT PRIMARY KEY, value TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS documents (file_id INTEGER PRIMARY KEY, "
                   + ", ".join(f"{k} {v}" for k, v in _DOC_COLUMNS.items()) + ")")
        have = {r[1] for r in db.execute("PRAGMA table_info(documents)")}
        for column, ddl in _DOC_COLUMNS.items():
            if column not in have:
                db.execute(f"ALTER TABLE documents ADD COLUMN {column} {ddl}")
        old_chunks = "chunks" in tables and "norm" not in {r[1] for r in db.execute("PRAGMA table_info(chunks)")}
        if old_chunks:
            db.execute("ALTER TABLE chunks RENAME TO chunks_v0")
        db.execute("CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, "
                   "seq INTEGER NOT NULL, locator TEXT NOT NULL, text TEXT NOT NULL, norm TEXT NOT NULL, "
                   "UNIQUE(file_id, seq))")
        db.execute("CREATE TABLE IF NOT EXISTS vectors (chunk_id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL, "
                   "model TEXT NOT NULL, dim INTEGER NOT NULL, data BLOB NOT NULL)")
        try:
            for ddl in _FTS_DDL:
                db.execute(ddl)
            self.fts = True
        except sqlite3.OperationalError:
            # FTS5 trigram 이 없는 SQLite(3.34 미만) — 키워드 검색은 정규화 본문 instr 로 동작한다(느리지만 정확)
            self.fts = False
        if old_chunks:
            self._copy_v0_chunks(db)
            db.execute("DROP TABLE chunks_v0")
        db.execute("CREATE INDEX IF NOT EXISTS ix_report_chunks_file ON chunks(file_id)")
        db.execute("CREATE INDEX IF NOT EXISTS ix_report_vectors_file ON vectors(file_id)")
        db.execute("CREATE INDEX IF NOT EXISTS ix_report_vectors_model ON vectors(model, dim)")
        self._recount(db)
        db.executemany("INSERT OR REPLACE INTO index_meta VALUES (?, ?)",
                       [("schema", str(SCHEMA_VERSION)), ("fts", "1" if self.fts else "0"),
                        ("migrated_at", str(time.time()))])
        self._bump(db)
        db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def _copy_v0_chunks(self, db):
        """스키마 0 의 조각을 옮긴다: 본문 → norm 계산, JSON 벡터 → float32 BLOB(그 파일의 embedding_model 이 있을 때만)."""
        models = {}
        for fid, meta in db.execute("SELECT file_id, metadata FROM documents"):
            try:
                m = json.loads(meta or "{}")
            except ValueError:
                m = {}
            if m.get("embedding_state") == "ready" and m.get("embedding_model"):
                models[fid] = m["embedding_model"]
        rows = db.execute("SELECT id, file_id, seq, locator, text, vector FROM chunks_v0 ORDER BY id")
        for cid, fid, seq, locator, text, vector in rows.fetchall():
            db.execute("INSERT INTO chunks(id, file_id, seq, locator, text, norm) VALUES (?,?,?,?,?,?)",
                       (cid, fid, seq, locator, text, normalize(text)))
            if vector and fid in models:
                try:
                    array = np.asarray(json.loads(vector), dtype="<f4")
                except (ValueError, TypeError):
                    continue
                if array.ndim == 1 and array.size and np.all(np.isfinite(array)):
                    db.execute("INSERT INTO vectors VALUES (?,?,?,?,?)",
                               (cid, fid, models[fid], int(array.size), array.tobytes()))
        for fid, model in models.items():
            db.execute("UPDATE documents SET embedding_model=? WHERE file_id=?", (model, fid))

    @staticmethod
    def _recount(db):
        db.execute("UPDATE documents SET chunk_count=(SELECT count(*) FROM chunks c WHERE c.file_id=documents.file_id), "
                   "vector_count=(SELECT count(*) FROM vectors v WHERE v.file_id=documents.file_id "
                   "AND v.model=documents.embedding_model)")

    @staticmethod
    def _bump(db):
        db.execute("INSERT INTO index_meta VALUES ('generation', '1') "
                   "ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1")

    def generation(self):
        with self._connect() as db:
            row = db.execute("SELECT value FROM index_meta WHERE key='generation'").fetchone()
        return int(row[0]) if row else 0

    # ---- 문서 ----
    @staticmethod
    def _document(row):
        result = dict(row)
        result["warnings"] = json.loads(result["warnings"] or "[]")
        result["metadata"] = json.loads(result["metadata"] or "{}")
        result["generation"] = result["sha256"]
        result["status"] = result["state"]
        return result

    def document_rows(self, file_ids=None, active_only=True, db=None):
        """file_id → 문서 정보(조각·벡터는 읽지 않는다)."""
        ids = None if file_ids is None else list(set(file_ids))
        if ids == []:
            return {}
        out = {}

        def run(conn):
            for group in ([None] if ids is None else [ids[i:i + GROUP] for i in range(0, len(ids), GROUP)]):
                clauses = ["active=1"] if active_only else []
                if group is not None:
                    clauses.append("file_id IN (" + ",".join("?" * len(group)) + ")")
                sql = "SELECT * FROM documents" + (" WHERE " + " AND ".join(clauses) if clauses else "")
                for row in conn.execute(sql, group or ()):
                    out[row["file_id"]] = self._document(row)

        if db is not None:
            run(db)
        else:
            with self.read() as conn:
                run(conn)
        return out

    def documents(self, file_ids=None, active_only=True):
        return list(self.document_rows(file_ids, active_only).values())

    def get_document(self, file_id):
        return self.document_rows([file_id], active_only=False).get(file_id)

    # ---- 조각(본문만) ----
    def chunk_texts(self, file_ids, db=None):
        """file_id → [{id, seq, locator, text}] (seq 순). 벡터는 읽지 않는다."""
        ids = list(set(file_ids))
        out = {fid: [] for fid in ids}

        def run(conn):
            for i in range(0, len(ids), GROUP):
                group = ids[i:i + GROUP]
                for row in conn.execute("SELECT id, file_id, seq, locator, text FROM chunks WHERE file_id IN ("
                                        + ",".join("?" * len(group)) + ") ORDER BY file_id, seq", group):
                    out[row["file_id"]].append({"id": row["id"], "seq": row["seq"], "locator": row["locator"],
                                                "text": row["text"]})

        if db is not None:
            run(db)
        else:
            with self.read() as conn:
                run(conn)
        return out

    def chunks(self, file_ids=None):
        """조각 목록(본문만, 활성 문서). 도구·테스트용."""
        if file_ids is None:
            with self.read() as db:
                file_ids = [r[0] for r in db.execute("SELECT file_id FROM documents WHERE active=1")]
        rows = self.chunk_texts(file_ids)
        return [{**c, "file_id": fid} for fid in sorted(rows) for c in rows[fid]]

    def chunks_by_id(self, chunk_ids):
        ids = list(set(chunk_ids))
        out = {}
        with self.read() as db:
            for i in range(0, len(ids), GROUP):
                group = ids[i:i + GROUP]
                for row in db.execute("SELECT id, file_id, seq, locator, text FROM chunks WHERE id IN ("
                                      + ",".join("?" * len(group)) + ")", group):
                    out[row["id"]] = dict(row)
        return out

    def keyword_files(self, term, db=None):
        """정규화된 검색어 하나가 (부분 문자열로) 들어 있을 수 있는 file_id 집합 — 후보만 넓게 뽑는다(판정은 호출자)."""
        if not term:
            return set()

        def run(conn):
            if self.fts and len(term) >= FTS_MIN_CHARS:
                needle = '"' + term[:FTS_PREFIX_CHARS].replace('"', '""') + '"'
                sql = ("SELECT DISTINCT c.file_id FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid "
                       "WHERE chunk_fts MATCH ?")
                return {r[0] for r in conn.execute(sql, (needle,))}
            return {r[0] for r in conn.execute("SELECT DISTINCT file_id FROM chunks WHERE instr(norm, ?) > 0", (term,))}

        if db is not None:
            return run(db)
        with self.read() as conn:
            return run(conn)

    # ---- 쓰기 ----
    def upsert_document(self, *, file_id, entry_id, name, path, sha256, version, chunks, state="ready",
                        warnings=(), metadata=None, size=0, mtime_ns=0, embedding_model=None):
        """문서 하나의 조각(과 벡터)을 통째로 바꾼다. 한 트랜잭션이라 중간에 실패하면 이전 색인이 그대로 남는다."""
        now = time.time()
        rows = [(i, c["locator"], c["text"]) for i, c in enumerate(chunks)]
        vectors = [c.get("vector") for c in chunks]
        with_vectors = embedding_model is not None and rows and all(v is not None for v in vectors)
        with self.write() as db:
            db.execute(
                "INSERT INTO documents(file_id, entry_id, name, path, sha256, version, state, error, warnings, metadata, "
                "size, mtime_ns, indexed_at, checked_at, active, chunk_count, vector_count, embedding_model, fail_count, "
                "retry_at, fail_key) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,1,?,?,?,0,NULL,NULL) "
                "ON CONFLICT(file_id) DO UPDATE SET entry_id=excluded.entry_id, name=excluded.name, path=excluded.path, "
                "sha256=excluded.sha256, version=excluded.version, state=excluded.state, error=NULL, "
                "warnings=excluded.warnings, metadata=excluded.metadata, size=excluded.size, mtime_ns=excluded.mtime_ns, "
                "indexed_at=excluded.indexed_at, checked_at=excluded.checked_at, active=1, "
                "chunk_count=excluded.chunk_count, vector_count=excluded.vector_count, "
                "embedding_model=excluded.embedding_model, fail_count=0, retry_at=NULL, fail_key=NULL, "
                "embed_fail_count=0, embed_retry_at=NULL",
                (file_id, entry_id, name, str(path), sha256, version, state,
                 json.dumps(list(warnings), ensure_ascii=False), json.dumps(metadata or {}, ensure_ascii=False),
                 size, mtime_ns, now, now, len(rows), len(rows) if with_vectors else 0,
                 embedding_model if with_vectors else None))
            db.execute("DELETE FROM vectors WHERE file_id=?", (file_id,))
            db.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
            for seq, locator, text in rows:
                cur = db.execute("INSERT INTO chunks(file_id, seq, locator, text, norm) VALUES (?,?,?,?,?)",
                                 (file_id, seq, locator, text, normalize(text)))
                if with_vectors:
                    vector = np.asarray(vectors[seq], dtype="<f4")
                    db.execute("INSERT INTO vectors VALUES (?,?,?,?,?)",
                               (cur.lastrowid, file_id, embedding_model, int(vector.size), vector.tobytes()))
            self._bump(db)

    def set_vectors(self, file_id, sha256, model, vectors):
        """이미 색인된 조각에 벡터만 채운다(원본을 다시 읽지 않는다). 그 사이 조각이 바뀌었으면 쓰지 않고 False."""
        with self.write() as db:
            doc = db.execute("SELECT sha256, chunk_count FROM documents WHERE file_id=? AND active=1",
                             (file_id,)).fetchone()
            ids = [r[0] for r in db.execute("SELECT id FROM chunks WHERE file_id=? ORDER BY seq", (file_id,))]
            if not doc or doc["sha256"] != sha256 or len(ids) != len(vectors) or doc["chunk_count"] != len(ids):
                return False
            db.execute("DELETE FROM vectors WHERE file_id=?", (file_id,))
            for cid, vector in zip(ids, vectors):
                vector = np.asarray(vector, dtype="<f4")
                db.execute("INSERT INTO vectors VALUES (?,?,?,?,?)", (cid, file_id, model, int(vector.size), vector.tobytes()))
            db.execute("UPDATE documents SET vector_count=?, embedding_model=?, embed_fail_count=0, embed_retry_at=NULL "
                       "WHERE file_id=?", (len(ids), model, file_id))
            self._bump(db)
        return True

    def record_failure(self, file_id, error, state="failed", *, fail_key=None, retry_base=300, retry_max=86400,
                       **identity):
        """실패 기록 + 다음 재시도 시각(같은 실패 열쇠면 간격을 두 배로, 열쇠가 바뀌면 처음부터). 이전 조각은 남긴다."""
        now = time.time()
        with self.write() as db:
            db.execute("INSERT OR IGNORE INTO documents(file_id, entry_id, name, path, metadata, warnings, active) "
                       "VALUES (?,?,?,?,?,'[]',1)",
                       (file_id, identity.get("entry_id"), identity.get("name"), str(identity.get("path", "")),
                        json.dumps(identity.get("metadata", {}), ensure_ascii=False)))
            row = db.execute("SELECT fail_count, fail_key FROM documents WHERE file_id=?", (file_id,)).fetchone()
            count = (row["fail_count"] or 0) + 1 if row and fail_key is not None and row["fail_key"] == fail_key else 1
            db.execute("UPDATE documents SET state=?, error=?, checked_at=?, active=1, fail_count=?, fail_key=?, "
                       "retry_at=? WHERE file_id=?",
                       (state, str(error)[:2000], now, count, fail_key,
                        now + retry_delay(count, retry_base, retry_max), file_id))

    def record_embedding_failure(self, file_id, error, retry_base=300, retry_max=86400):
        now = time.time()
        with self.write() as db:
            row = db.execute("SELECT embed_fail_count, metadata FROM documents WHERE file_id=?", (file_id,)).fetchone()
            if not row:
                return
            count = (row[0] or 0) + 1
            try:
                metadata = json.loads(row[1] or "{}")
            except ValueError:
                metadata = {}
            metadata["embedding_error"] = str(error)[:500]
            db.execute("UPDATE documents SET embed_fail_count=?, embed_retry_at=?, metadata=? WHERE file_id=?",
                       (count, now + retry_delay(count, retry_base, retry_max),
                        json.dumps(metadata, ensure_ascii=False), file_id))

    def touch(self, file_id):
        with self.write() as db:
            db.execute("UPDATE documents SET checked_at=?, active=1 WHERE file_id=?", (time.time(), file_id))

    def reconcile(self, registered_ids):
        """등록 목록에 없는 문서를 비활성으로. 반드시 완전한 등록 목록으로만 부른다(DB 오류를 빈 목록으로 보지 않는다)."""
        ids = set(registered_ids)
        with self.write() as db:
            gone = [r[0] for r in db.execute("SELECT file_id FROM documents WHERE active=1") if r[0] not in ids]
            for fid in gone:
                db.execute("UPDATE documents SET active=0, state='removed' WHERE file_id=?", (fid,))
            if gone:
                self._bump(db)

    def set_worker_state(self, **values):
        with self.write() as db:
            db.executemany("INSERT OR REPLACE INTO worker_state VALUES (?,?)",
                           [(k, json.dumps(v)) for k, v in values.items()])

    def status(self):
        """관리자용 전역 상태(경로·오류 문구 없이 건수만)."""
        now = time.time()
        with self.read() as db:
            counts = dict(db.execute("SELECT state, count(*) FROM documents WHERE active=1 GROUP BY state").fetchall())
            worker = {r[0]: json.loads(r[1]) for r in db.execute("SELECT * FROM worker_state")}
            chunks = db.execute("SELECT coalesce(sum(chunk_count),0), coalesce(sum(vector_count),0) "
                                "FROM documents WHERE active=1").fetchone()
            waiting = db.execute("SELECT count(*) FROM documents WHERE active=1 AND retry_at > ? "
                                 "AND state IN ('failed','missing')", (now,)).fetchone()[0]
            generation = self._meta(db, "generation", "0")
        return {"counts": counts, "documents": sum(counts.values()), "chunks": chunks[0], "vectors": chunks[1],
                "retry_waiting": waiting, "fts": self.fts, "schema": SCHEMA_VERSION, "generation": int(generation),
                "worker": worker}

    # ---- 의미 검색(벡터) ----
    def semantic_best(self, model, query, allowed_file_ids, threshold):
        """허용된 파일마다 유사도가 threshold 이상인 가장 가까운 조각: {file_id: (유사도, chunk_id)}.
        벡터 행렬은 프로세스 안에 (색인 세대·모델)별로 들고 있고, 상한을 넘으면 매번 나눠 읽는다."""
        query = np.asarray(query, dtype=np.float32)
        allowed = np.fromiter(allowed_file_ids, dtype=np.int64)
        if not allowed.size or query.ndim != 1 or not query.size:
            return {}
        best = {}

        def scan(file_ids, chunk_ids, matrix):
            for start in range(0, matrix.shape[0], 8192):
                sims = matrix[start:start + 8192].astype(np.float32) @ query
                hit = np.nonzero(sims >= threshold)[0]
                if not hit.size:
                    continue
                fids = file_ids[start:start + 8192][hit]
                keep = np.isin(fids, allowed)
                for i, fid in zip(hit[keep], fids[keep]):
                    score = float(sims[i])
                    fid = int(fid)
                    if np.isfinite(score) and (fid not in best or score > best[fid][0]):
                        best[fid] = (score, int(chunk_ids[start + i]))

        cached = _vector_matrix(self, model, int(query.size))
        if cached is not None:
            scan(*cached)
            return best
        # 상한을 넘는 큰 색인 — 4096행씩 읽어 계산하고 버린다
        with self.read() as db:
            cur = db.execute("SELECT chunk_id, file_id, data FROM vectors WHERE model=? AND dim=?", (model, int(query.size)))
            while True:
                rows = cur.fetchmany(4096)
                if not rows:
                    break
                scan(np.array([r[1] for r in rows], dtype=np.int64), np.array([r[0] for r in rows], dtype=np.int64),
                     np.frombuffer(b"".join(r[2] for r in rows), dtype="<f4").reshape(len(rows), int(query.size)))
        return best


_matrix_lock = threading.Lock()
_matrix_cache: dict = {}   # 색인 경로 → (세대, 모델, 차원, file_ids, chunk_ids, float16 행렬)


def clear_vector_cache():
    with _matrix_lock:
        _matrix_cache.clear()


def _vector_matrix(store, model, dim):
    """캐시된 (file_ids, chunk_ids, 행렬) 또는 None(상한 초과 — 호출자가 나눠 읽는다)."""
    from .config import vector_cache_bytes

    key = str(store.path.resolve())
    generation = store.generation()
    with _matrix_lock:
        hit = _matrix_cache.get(key)
        if hit and hit[:3] == (generation, model, dim):
            return hit[3:]
    with store.read() as db:
        count = db.execute("SELECT count(*) FROM vectors WHERE model=? AND dim=?", (model, dim)).fetchone()[0]
        if count * dim * 2 > vector_cache_bytes():
            with _matrix_lock:
                _matrix_cache.pop(key, None)
            return None
        file_ids = np.empty(count, dtype=np.int64)
        chunk_ids = np.empty(count, dtype=np.int64)
        matrix = np.empty((count, dim), dtype=np.float16)
        cur = db.execute("SELECT chunk_id, file_id, data FROM vectors WHERE model=? AND dim=? ORDER BY chunk_id",
                         (model, dim))
        n = 0
        while True:
            rows = cur.fetchmany(4096)
            if not rows:
                break
            for chunk_id, file_id, data in rows:
                if n >= count:   # 읽는 사이 늘었으면(같은 스냅숏이라 없어야 한다) 넘치는 행은 버린다
                    break
                chunk_ids[n], file_ids[n] = chunk_id, file_id
                matrix[n] = np.frombuffer(data, dtype="<f4")
                n += 1
    value = (file_ids[:n], chunk_ids[:n], matrix[:n])
    with _matrix_lock:
        _matrix_cache[key] = (generation, model, dim, *value)
    return value


_stores: dict = {}
_stores_lock = threading.Lock()


def open_store(path):
    """경로별 IndexStore 하나(스키마 확인·이전은 처음 열 때 한 번)."""
    key = str(Path(path).resolve())
    with _stores_lock:
        store = _stores.get(key)
        if store is None or not store.path.exists():
            store = _stores[key] = IndexStore(path)
        return store


ReportIndexStore = IndexStore
