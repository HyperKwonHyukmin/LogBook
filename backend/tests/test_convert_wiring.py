import os

from app import jobs, models
from app.entries import service
from app.entries.locate import file_path

MESH = "GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nCROD,1,1,1,2\n"


def test_heavy_jobs_claimed_last(db):
    jobs.enqueue(db, "convert_model", 1)
    jobs.enqueue(db, "extract_file", 2)
    jobs.enqueue(db, "write_meta", 3)
    db.commit()
    assert jobs.claim_next(db).type == "write_meta"
    assert set(jobs.HEAVY_JOB_TYPES) == {"extract_file", "convert_model"}


def test_process_batch_enqueues_convert(db, storage):
    from app.ingest.process import process_batch

    b = models.Batch(key="20261002-111111-aaaa", source="inbox", original_name="9999_모델", uploader="A100001")
    db.add(b)
    db.commit()
    root = storage.staging / b.key / "9999_모델"
    root.mkdir(parents=True)
    (root / "m.bdf").write_text(MESH)
    process_batch(db, storage, b)
    assert [j.type for j in db.query(models.Job)] == ["convert_model"]


def test_worker_runs_convert(db, storage):
    from app.ingest.inbox import InboxWatcher
    from app.worker import run_once

    b = models.Batch(key="20261002-222222-bbbb", source="inbox", original_name="9999_모델", uploader="A100001")
    db.add(b)
    db.flush()
    jobs.enqueue(db, "process_batch", b.id)
    db.commit()
    root = storage.staging / b.key / "9999_모델"
    root.mkdir(parents=True)
    (root / "m.bdf").write_text(MESH)
    stats = run_once(db, storage, InboxWatcher(storage))
    assert stats["failed"] == 0
    f = db.query(models.File).one()
    assert db.get(models.ModelSummary, f.id).state == "done"


def test_convert_final_failure_marks_failed(db, storage, make_entry_file):
    from app.ingest.inbox import InboxWatcher
    from app.worker import run_once

    _e, f = make_entry_file(name="gone.bdf", kind="model")
    jobs.enqueue(db, "convert_model", f.id)
    db.commit()
    job = db.query(models.Job).one()
    job.attempts = 2  # 이번이 마지막 시도
    db.commit()
    run_once(db, storage, InboxWatcher(storage))
    assert db.get(models.ModelSummary, f.id).state == "failed"


def test_entry_dict_has_model(db, make_entry_file):
    e, f = make_entry_file(name="m.bdf", kind="model")
    make_entry_file(entry=e, name="r.pdf")
    db.add(models.ModelSummary(file_id=f.id, state="done", counts={"CROD": 1}, bbox={"min": [0, 0, 0], "max": [1, 0, 0]},
                               missing=[], warnings=["a"] * 20))
    db.commit()
    d = service.entry_to_dict(db, e)
    by = {x["name"]: x for x in d["files"]}
    assert by["m.bdf"]["model"]["state"] == "done" and len(by["m.bdf"]["model"]["warnings"]) == 10
    assert by["r.pdf"]["model"] is None


def test_confirm_into_existing_requeues_models(db, storage, make_user, setup_entry_with_files, make_entry_file):
    u = make_user("A100001")
    target, tf = make_entry_file(name="main.bdf", kind="model")
    db.add(models.ModelSummary(file_id=tf.id, state="done", missing=["mesh.bdf"], includes=[]))
    db.commit()
    batch, draft = setup_entry_with_files(rels=("mesh.bdf",))
    draft.merge_into_id = target.id
    db.commit()
    db.query(models.Job).delete()
    db.commit()
    service.confirm(db, storage, draft, u)
    assert db.query(models.Job).filter_by(type="convert_model", target_id=tf.id).count() == 1


def test_cli_enqueue_convert(db, make_entry_file):
    from app.cli import enqueue_convert_all

    _e, a = make_entry_file(name="a.bdf", kind="model")
    _e2, b = make_entry_file(name="b.bdf", kind="model")
    make_entry_file(name="r.pdf")
    db.add(models.ModelSummary(file_id=b.id, state="done"))
    db.commit()
    assert enqueue_convert_all(db) == 1
    # 05 리뷰 반영: force 여도 이미 대기 중인(a) 작업은 또 넣지 않는다 — b 만 다시 들어간다
    assert enqueue_convert_all(db, force=True) == 1


def test_exhausted_convert_job_marks_model_failed(db, storage, make_entry_file):
    """recover_running 이 되돌린, 시도 횟수를 다 쓴 변환 작업 — 다시 돌리지 않고 모델 상태를 failed 로."""
    from app.ingest.inbox import InboxWatcher
    from app.worker import MAX_ATTEMPTS, run_once

    _e, f = make_entry_file(name="crash.bdf", kind="model")
    db.add(models.ModelSummary(file_id=f.id, state="queued"))
    db.add(models.Job(type="convert_model", target_id=f.id, attempts=MAX_ATTEMPTS))
    db.commit()
    run_once(db, storage, InboxWatcher(storage))
    db.expire_all()
    s = db.get(models.ModelSummary, f.id)
    assert s.state == "failed" and s.error == "attempts_exhausted"
    assert db.query(models.Job).one().state == "failed"


def test_normal_confirm_requeues_models(db, storage, make_user, setup_entry_with_files):
    u = make_user("A100001")
    _b, e = setup_entry_with_files(rels=("main.bdf",))
    f = db.query(models.File).filter_by(entry_id=e.id).one()
    db.add(models.ModelSummary(file_id=f.id, state="done", missing=["mesh.bdf"], includes=[]))
    db.query(models.Job).delete()
    db.commit()
    service.confirm(db, storage, e, u)
    assert db.query(models.Job).filter_by(type="convert_model", target_id=f.id).count() == 1
