"""리뷰 9 — 무거운 처리를 자식 프로세스에서 시간 제한을 걸어 돌린다(app.isolated).

자식 프로세스에는 monkeypatch 가 닿지 않으므로, 멈추는 '가짜 무거운 함수'로 표준 라이브러리 time.sleep 을 쓴다
(모듈 최상위 함수라 pickle 로 넘어간다)."""
import operator
import os
import time
from dataclasses import replace

import pytest

from app import isolated, jobs, models


@pytest.fixture
def runner():
    yield isolated
    isolated.shutdown()


def test_timeout_kills_child_and_next_call_works(runner):
    started = time.monotonic()
    with pytest.raises(isolated.HeavyTimeout) as ei:
        isolated.run(time.sleep, 60, timeout=2)
    assert time.monotonic() - started < 30
    assert "처리 시간이 1분을 넘어 중단했습니다" == str(ei.value)
    # 새 자식이 떠서 다음 작업은 정상
    assert isolated.run(operator.add, 2, 3, timeout=60) == 5


def test_child_exception_is_reraised(runner):
    with pytest.raises(FileNotFoundError):
        isolated.run(os.stat, os.path.join(os.getcwd(), "없는-파일.bin"), timeout=60)
    assert isolated.run(operator.mul, 6, 7, timeout=60) == 42


def test_heartbeat_called_while_waiting(runner, monkeypatch):
    monkeypatch.setattr(isolated, "BEAT_SECONDS", 0.5)
    beats = []
    with isolated.heartbeat_scope(lambda: beats.append(1)):
        isolated.run(time.sleep, 2, timeout=60)
    assert beats


def test_zero_timeout_runs_inline():
    calls = []
    assert isolated.run(lambda x: calls.append(x) or x, 7, timeout=0) == 7 and calls == [7]


def test_timeout_message_minutes():
    assert str(isolated.HeavyTimeout(600)) == "처리 시간이 10분을 넘어 중단했습니다"
    assert str(isolated.HeavyTimeout(1800)) == "처리 시간이 30분을 넘어 중단했습니다"


def test_worker_marks_timed_out_job_failed_and_continues(db, storage, make_entry_file, monkeypatch):
    """한 파일이 제한 시간을 넘기면 그 작업만 바로 최종 실패(재시도 없음)로 끝나고 워커는 다음 작업을 한다."""
    from app import worker
    from app.extract.job import enqueue_extract
    from app.ingest.inbox import InboxWatcher

    _e, slow = make_entry_file(name="slow.pdf")
    _e, fast = make_entry_file(name="fast.pdf")
    enqueue_extract(db, slow)
    enqueue_extract(db, fast)
    db.commit()
    done = []

    def fake_extract(db_, storage_, f):
        if f.id == slow.id:
            raise isolated.HeavyTimeout(600)
        done.append(f.id)

    monkeypatch.setattr(worker, "run_extract", fake_extract)
    stats = worker.run_once(db, storage, InboxWatcher(storage))
    assert done == [fast.id] and stats["failed"] == 1
    db.expire_all()
    job = db.query(models.Job).filter_by(type="extract_file", target_id=slow.id).one()
    assert (job.state, job.attempts) == ("failed", 1)
    assert job.last_error == "처리 시간이 10분을 넘어 중단했습니다"
    row = db.get(models.FileExtract, slow.id)
    assert (row.state, row.error) == ("failed", "처리 시간이 10분을 넘어 중단했습니다")
    assert db.query(models.Job).filter_by(type="extract_file", target_id=fast.id).one().state == "done"


def test_convert_through_child_process(db, storage, make_entry_file, monkeypatch, runner):
    """실제 자식 프로세스로 BDF 를 변환해도 결과(서명·지문·lbm)가 DB·20_Derived 에 그대로 남는다."""
    import app.convert.job as job
    from app.entries.locate import file_path

    monkeypatch.setattr(job, "settings", replace(job.settings, convert_timeout=300))
    _e, f = make_entry_file(name="m.bdf", kind="model")
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(b"GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,0.\nGRID,4,,0.,1000.,0.\n"
                 b"CQUAD4,1,5,1,2,3,4\n")
    job.run_convert(db, storage, f)
    s = db.get(models.ModelSummary, f.id)
    assert s.state == "done" and s.key and s.sig_geometry and s.fingerprint
    lbm, png = job.model_paths(storage, s.key)
    assert lbm.is_file() and png.is_file()


def test_convert_missing_file_in_child_is_retryable(db, storage, make_entry_file, monkeypatch, runner):
    import app.convert.job as job

    monkeypatch.setattr(job, "settings", replace(job.settings, convert_timeout=300))
    _e, f = make_entry_file(name="nope.bdf", kind="model")
    with pytest.raises(OSError):
        job.run_convert(db, storage, f)


def test_extract_through_child_process(db, storage, make_entry_file, monkeypatch, runner):
    """본문 추출도 자식 프로세스에서 — 결과·DRM 판정이 같다(DRM 머리는 바이트로 직접 쓴다)."""
    import app.extract.job as job
    from app.entries.locate import file_path

    monkeypatch.setattr(job, "settings", replace(job.settings, extract_timeout=300))
    _e, f = make_entry_file(name="enc.docx")
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(b"HHIDRMC" + b"\0" * 64)
    job.run_extract(db, storage, f)
    assert (db.get(models.FileExtract, f.id).error, db.get(models.File, f.id).drm_encrypted) == ("drm", True)
    _e, broken = make_entry_file(name="broken.docx")
    p = file_path(db, storage, broken)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(b"not a zip")
    job.run_extract(db, storage, broken)
    assert db.get(models.FileExtract, broken.id).state == "failed"


def test_exhausted_unaffected_for_timeouts(db):
    """시간 초과 실패는 attempts 를 그 자리 값으로 상한 처리 — 다른 작업 종류의 재시도 규칙은 그대로."""
    j = jobs.enqueue(db, "convert_model", 1)
    db.commit()
    j.attempts = 1
    jobs.fail(db, j, "처리 시간이 30분을 넘어 중단했습니다", max_attempts=j.attempts)
    assert j.state == "failed"


def test_report_index_timeout_records_failure_with_backoff(tmp_path, monkeypatch):
    """보고서 색인 워커도 자식 프로세스 시간 초과를 실패(백오프)로 남기고 다음 보고서로 넘어간다."""
    from app.report_index import worker as rworker
    from app.report_index.config import IndexConfig
    from app.report_index.extractors import extract_file
    from app.report_index.store import IndexStore

    config = IndexConfig(index_path=tmp_path / "local" / "index.sqlite3", storage_root=tmp_path / "shared",
                         ocr=False, extract_timeout=5)
    path = tmp_path / "source.docx"
    path.write_bytes(b"x")
    report = {"file_id": 1, "entry_id": 2, "name": path.name, "path": str(path), "ext": ".docx",
              "metadata": {"registered_sha256": "h", "rel_path": path.name, "vault_rel": "2026/E2", "entry_id": 2}}
    seen = {}

    def fake_run(fn, *args, timeout, **kwargs):
        seen["fn"], seen["timeout"] = fn, timeout
        raise isolated.HeavyTimeout(timeout)

    monkeypatch.setattr(rworker.isolated, "run", fake_run)
    store = IndexStore(config.index_path)
    assert rworker.index_one(store, report, config, extractor=extract_file, embed=False) == "failed"
    assert seen == {"fn": extract_file, "timeout": 5}
    doc = store.get_document(1)
    assert "처리 시간이" in doc["error"] and doc["retry_at"]
