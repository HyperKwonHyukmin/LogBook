"""solve_check 작업(06 §3) — 가짜 실행기로 pass/fail/timeout/missing 경로, 원본 불변, f06 보관, 박동."""
import functools
import hashlib
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app import jobs, models
from app.convert.job import run_convert
from app.entries.locate import file_path
from app.solve.job import enqueue_solve, f06_path, run_solve_check
from app.solve.runner import NastranMissing, RunResult, run_nastran
from app.storage.paths import to_long

FIX = Path(__file__).parent / "fixtures" / "solve_f06"
MAIN = """\
SOL 101
CEND
SUBCASE 1
  SPC = 1
  LOAD = 2
BEGIN BULK
PARAM,POST,-1
INCLUDE 'mesh.bdf'
SPC1,1,123456,1
GRAV,2,,9810.,0.,0.,-1.
ENDDATA
"""
MESH = ("GRID,1,,0.,0.,0.\nGRID,2,,1000.,0.,0.\nGRID,3,,1000.,1000.,500.\nGRID,4,,0.,1000.,500.\n"
        "CQUAD4,1,5,1,2,3,4\nPSHELL,5,1,10.\nMAT1,1,206000.,,0.3,7.85-9\n"
        "GRID,11,,0.,5000.,100.\nGRID,12,,1000.,5000.,100.\nCROD,2,6,11,12\nPROD,6,1,100.\n")


def _write(db, storage, f, text: str):
    p = file_path(db, storage, f)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(text.encode())
    return p


@pytest.fixture
def model_file(db, storage, make_entry_file):
    e, main = make_entry_file(name="main.bdf", kind="model", sha="a" * 64, hulls=("9999",))
    _e, mesh = make_entry_file(entry=e, name="mesh.bdf", kind="model", sha="b" * 64)
    _write(db, storage, main, MAIN)
    _write(db, storage, mesh, MESH)
    run_convert(db, storage, main)
    assert db.get(models.ModelSummary, main.id).state == "done"
    return main


class FakeRunner:
    """deck.bdf 를 받아 두고 정해진 f06 을 쓴다(대소문자 바꾼 이름도 시험)."""

    def __init__(self, f06: str | None, *, timed_out=False, name="deck.f06", beats=0, log_text=""):
        self.f06, self.timed_out, self.name, self.beats, self.log_text = f06, timed_out, name, beats, log_text
        self.deck = None
        self.workdir = None

    def __call__(self, exe, workdir, deck_name, *, timeout, heartbeat=None):
        self.workdir = workdir
        with open(os.path.join(workdir, deck_name), encoding="utf-8") as fh:
            self.deck = fh.read()
        for _ in range(self.beats):
            heartbeat()
        path = None
        if self.f06 is not None:
            path = os.path.join(workdir, self.name)
            with open(path, "w", encoding="latin-1") as fh:
                fh.write(self.f06)
        return RunResult(returncode=0, timed_out=self.timed_out, f06_path=path, log_text=self.log_text)


def _sha_mtime(path: str):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest(), os.stat(path).st_mtime_ns


def test_pass_stores_f06_and_deck_shape(db, storage, model_file):
    run = FakeRunner((FIX / "pass.f06").read_text(encoding="latin-1"), name="DECK.F06")
    run_solve_check(db, storage, model_file.id, runner=run, nastran_exe="x.exe")
    row = db.get(models.SolveCheck, model_file.id)
    assert row.state == "pass" and row.error_types == [] and row.warning_count == 1
    assert row.groups == 2 and row.spc_nodes == 4 and row.fixed_node_ids == [1, 2, 11, 12]
    summary = db.get(models.ModelSummary, model_file.id)
    assert row.model_key == summary.key and row.has_f06 and row.finished_at and row.elapsed >= 0
    with open(to_long(f06_path(storage, row.model_key)), "rb") as fh:
        assert b"END OF JOB" in fh.read()
    # 해석용 BDF: 실행·케이스 제어 교체, INCLUDE 풀기, 원본 경계조건·하중 보존, 우리 sid
    deck = run.deck.splitlines()
    assert deck[:6] == ["SOL 101", "CEND", "ECHO = NONE", "SPC = 990001", "LOAD = 990001", "BEGIN BULK"]
    assert "SUBCASE 1" not in deck and not any(ln.startswith("INCLUDE") for ln in deck)
    assert "CQUAD4,1,5,1,2,3,4" in deck and "SPC1,1,123456,1" in deck and "GRAV,2,,9810.,0.,0.,-1." in deck
    assert "SPC1,990001,123456,1,2,11,12" in deck and deck[-1] == "ENDDATA"
    # 임시 폴더는 지워졌고, 저장소에는 f06 말고 아무것도 생기지 않았다
    assert not os.path.exists(run.workdir)
    assert not str(run.workdir).startswith(str(storage.root))


def test_original_untouched(db, storage, model_file):
    main_path = file_path(db, storage, model_file)
    mesh_path = os.path.join(os.path.dirname(main_path), "mesh.bdf")
    before = (_sha_mtime(main_path), _sha_mtime(mesh_path), sorted(os.listdir(os.path.dirname(main_path))))
    run_solve_check(db, storage, model_file.id, nastran_exe="x.exe",
                    runner=FakeRunner((FIX / "rbedup.f06").read_text(encoding="latin-1")))
    after = (_sha_mtime(main_path), _sha_mtime(mesh_path), sorted(os.listdir(os.path.dirname(main_path))))
    assert before == after
    assert db.query(models.File).count() == 2     # 파일 목록에 새 파일이 붙지 않는다


def test_fail_classifies(db, storage, model_file):
    run_solve_check(db, storage, model_file.id, nastran_exe="x.exe",
                    runner=FakeRunner((FIX / "rbedup.f06").read_text(encoding="latin-1")))
    row = db.get(models.SolveCheck, model_file.id)
    assert row.state == "fail" and row.error_types == ["rbe_dependent_dup"]
    assert row.fatals[0]["code"] == 5289 and row.message.startswith("FATAL 5289")


def test_timeout_keeps_partial_f06(db, storage, model_file):
    run_solve_check(db, storage, model_file.id, nastran_exe="x.exe",
                    runner=FakeRunner(" *** USER WARNING MESSAGE 9058 (X)\n", timed_out=True))
    row = db.get(models.SolveCheck, model_file.id)
    assert row.state == "error" and row.error_types == ["timeout"] and row.has_f06


def test_no_f06(db, storage, model_file):
    run_solve_check(db, storage, model_file.id, nastran_exe="x.exe", runner=FakeRunner(None))
    row = db.get(models.SolveCheck, model_file.id)
    assert row.state == "error" and row.error_types == ["no_f06"] and not row.has_f06


def test_nastran_missing(db, storage, model_file):
    def missing(*a, **k):
        raise NastranMissing("x.exe")

    run_solve_check(db, storage, model_file.id, nastran_exe="x.exe", runner=missing)
    row = db.get(models.SolveCheck, model_file.id)
    assert row.state == "error" and row.error_types == ["nastran_missing"] and row.spc_nodes == 4
    # 진짜 실행기도 없는 exe 는 실행 전에 알아본다
    with pytest.raises(NastranMissing):
        run_nastran(r"C:\__no_nastran__\nastran.exe", str(storage.root), "deck.bdf", timeout=5)


def test_include_missing(db, storage, make_entry_file):
    _e, f = make_entry_file(name="lonely.bdf", kind="model")
    _write(db, storage, f, "BEGIN BULK\nINCLUDE 'gone.bdf'\nGRID,1,,0.,0.,0.\nGRID,2,,1.,0.,0.\nCROD,1,1,1,2\n"
                           "PROD,1,1,1.\nMAT1,1,1.,,0.3\nENDDATA\n")
    run_convert(db, storage, f)
    assert db.get(models.ModelSummary, f.id).state == "done"
    run = FakeRunner("never")
    run_solve_check(db, storage, f.id, nastran_exe="x.exe", runner=run)
    row = db.get(models.SolveCheck, f.id)
    assert row.state == "error" and row.error_types == ["include_missing"] and "gone.bdf" in row.message
    assert run.deck is None     # 해석하지 않는다


def test_not_ready(db, storage, make_entry_file):
    _e, f = make_entry_file(name="q.bdf", kind="model")
    db.add(models.ModelSummary(file_id=f.id, state="queued"))
    db.commit()
    run_solve_check(db, storage, f.id, runner=FakeRunner("x"))
    assert db.get(models.SolveCheck, f.id).error_types == ["model_not_ready"]


def test_enqueue_clears_old_result_and_is_idempotent(db, storage, model_file):
    run_solve_check(db, storage, model_file.id, nastran_exe="x.exe",
                    runner=FakeRunner((FIX / "pass.f06").read_text(encoding="latin-1")))
    row = enqueue_solve(db, model_file, "A100001")
    db.commit()
    assert row.state == "queued" and row.model_key is None and row.fixed_node_ids is None and not row.has_f06
    enqueue_solve(db, model_file, "A100002")      # 이미 대기 중 — 그대로
    db.commit()
    assert db.query(models.Job).filter_by(type="solve_check").count() == 1
    assert db.get(models.SolveCheck, model_file.id).requested_by == "A100001"


def test_solve_claimed_after_other_heavy_jobs(db):
    jobs.enqueue(db, "solve_check", 1)
    jobs.enqueue(db, "convert_model", 2)
    jobs.enqueue(db, "extract_file", 3)
    jobs.enqueue(db, "write_meta", 4)
    db.commit()
    order = [jobs.claim_next(db).type for _ in range(4)]
    assert order[0] == "write_meta" and order[-1] == "solve_check"


def test_worker_runs_solve_with_heartbeat(db, storage, model_file, monkeypatch):
    import app.worker as worker
    from app.ingest.inbox import InboxWatcher
    from app.ops.state import get_state

    enqueue_solve(db, model_file, "A100001")
    db.commit()
    seen = {}
    run = FakeRunner((FIX / "pass.f06").read_text(encoding="latin-1"), beats=2)

    def wrapped(db_, storage_, file_id, *, heartbeat=None):
        def beat():
            heartbeat()
            from app import database
            s = database.SessionLocal()
            try:
                seen["updated_at"] = s.query(models.Job).filter_by(type="solve_check").one().updated_at
            finally:
                s.close()
        return run_solve_check(db_, storage_, file_id, runner=functools.partial(_with_beat, run, beat),
                               nastran_exe="x.exe")

    # 실행 전에 작업 시각을 옛날로 돌려 둔다 — 박동이 갱신했는지 본다
    old = datetime.now().replace(microsecond=0) - timedelta(hours=1)
    db.query(models.Job).update({"updated_at": old})
    db.commit()
    monkeypatch.setattr(worker, "run_solve_check", wrapped)
    stats = worker.run_once(db, storage, InboxWatcher(storage, owner_of=lambda p: None))
    assert stats["processed"] >= 1 and stats["failed"] == 0
    db.expire_all()
    assert db.get(models.SolveCheck, model_file.id).state == "pass"
    assert seen["updated_at"] > old
    assert get_state(db, "worker_heartbeat") is not None


def _with_beat(run, beat, exe, workdir, deck_name, *, timeout, heartbeat=None):
    return run(exe, workdir, deck_name, timeout=timeout, heartbeat=beat)


def test_final_failure_marks_error(db, storage, model_file):
    from app.worker import _final_failure

    enqueue_solve(db, model_file, "A100001")
    db.commit()
    job = db.query(models.Job).filter_by(type="solve_check").one()
    _final_failure(db, job, "boom")
    row = db.get(models.SolveCheck, model_file.id)
    assert row.state == "error" and "boom" in row.message


def _script(tmp: Path, body: str) -> None:
    (tmp / "deck.bdf").write_text(body, encoding="utf-8")


def test_real_runner_timeout_kills_and_beats(tmp_path):
    # python 을 'nastran' 으로 쓰고 deck.bdf 를 스크립트로 — 실행기 자체(타임아웃·박동·트리 종료)를 시험한다
    _script(tmp_path, "import time\ntime.sleep(60)\n")
    beats = []
    res = run_nastran(sys.executable, str(tmp_path), "deck.bdf", timeout=2, heartbeat=lambda: beats.append(1),
                      heartbeat_seconds=0.5)
    assert res.timed_out and res.f06_path is None and len(beats) >= 2


def test_real_runner_finds_f06_case_insensitive(tmp_path):
    _script(tmp_path, "open('DECK.F06', 'w').write('* * * END OF JOB * * *')\nprint('done')\n")
    res = run_nastran(sys.executable, str(tmp_path), "deck.bdf", timeout=60)
    assert not res.timed_out and res.returncode == 0
    assert res.f06_path and os.path.basename(res.f06_path) == "DECK.F06" and "done" in res.log_text
