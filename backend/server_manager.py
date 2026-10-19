"""Hi-TESS LogBook Server Manager — API(9095)·Worker·보고서 색인 워커를 하나의 GUI 창에서 관리한다.

- 세 자식을 각각 Popen 으로 품고, 로그를 한 창에 Tee 한다.
- 크래시 시 지수 백오프로 자동 재시작(각자 독립 예산).
- API 는 HTTP 좀비 감지 — 3분(15초×12) 응답 없으면 강제 재시작.
- Worker·Index 는 HTTP endpoint 가 없어 프로세스 생존만 판정(BackgroundChild 한 틀).
- Index(41) = `app.report_index.worker --loop`. 145 는 작업 스케줄러를 쓰지 않아 여기서 띄운다.
- Update 버튼: git pull + requirements 변경 시 pip install + 재시작.
- 중복 실행 방지: PID 파일.
- 로그온 자동 시작: install-autostart.ps1 가 shell:startup 폴더에 바로가기 생성.
"""
import json
import os
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from tkinter import messagebox, scrolledtext

import psutil

from serverguard import diagnostics, events, health, pidfile, proctree
from serverguard.backoff import RestartPolicy

BASE_DIR = Path(__file__).resolve().parent      # ...\backend
REPO_ROOT = BASE_DIR.parent                     # ...\Logbook
LOG_DIR = BASE_DIR / "logs"

HEALTH_INTERVAL_MS = health.CHECK_INTERVAL_SEC * 1000
RESTART_DELAY_MS = 3000

# venv 자동 탐색 — .venv 가 없으면 현재 실행 중인 python 사용
_venv_python = BASE_DIR / ".venv" / "Scripts" / "python.exe"
if _venv_python.exists():
    PYTHON = str(_venv_python)
    PIP = str(_venv_python.parent / "pip.exe")
else:
    PYTHON = sys.executable
    PIP = str(Path(sys.executable).parent / "pip.exe")

API_CMD = [PYTHON, "-m", "uvicorn", "app.main:app",
           "--host", "0.0.0.0", "--port", "9095", "--no-access-log"]
WORKER_CMD = [PYTHON, "-m", "app.worker"]
INDEX_CMD = [PYTHON, "-m", "app.report_index.worker", "--loop"]
HEALTH_URL = "http://127.0.0.1:9095/api/system/health"
API_PORT = 9095

# 자식 python 이 로그를 UTF-8 로 쓰고 버퍼에 묶이지 않게 — Windows 기본 CP949 로
# 출력하면 한글이 깨지고(`��Ŀ`), 버퍼링이 켜져 있으면 급사 시 마지막 줄이 사라진다.
_CHILD_ENV = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}

# UI 색
BG = "#1e2130"
PANEL = "#252a3a"
ACCENT = "#4f8ef7"
GREEN = "#3ecf8e"
RED = "#f76f6f"
YELLOW = "#f7c94f"
FG = "#e8eaf0"
FG_DIM = "#8890a8"
LOG_BG = "#161925"
LOG_FG = "#c8d0e0"


class BackgroundChild:
    """HTTP 없이 프로세스 생존만 보는 자식(Worker·Index) 하나의 상태.

    name 은 화면 라벨·로그 머리·이벤트 이름(소문자)에 쓴다. 로그는 logs\\<subdir>\\YYYYMMDD.log."""

    def __init__(self, name, cmd, subdir, tag):
        self.name = name
        self.key = name.lower()
        self.cmd = cmd
        self.subdir = subdir
        self.tag = tag
        self.proc = None
        self.log = events.DailyLogWriter(LOG_DIR, subdir=subdir)
        self.policy = RestartPolicy()
        self.dot = None
        self.label = None

    def running(self):
        return self.proc is not None and self.proc.poll() is None


class LogbookManager:
    def __init__(self, root):
        self.root = root
        self.api_proc = None
        self.intentional_stop = False
        self.is_updating = False
        self.uvicorn_log = events.DailyLogWriter(LOG_DIR, subdir="uvicorn")
        self.health_tracker = health.HealthTracker()
        self.api_restart_policy = RestartPolicy()
        self.children = [BackgroundChild("Worker", WORKER_CMD, "worker", "worker"),
                         BackgroundChild("Index", INDEX_CMD, "report-index", "index")]

        if self._abort_if_already_running():
            self.aborted = True
            self.root.destroy()
            return
        self.aborted = False

        self._setup_window()
        self._build_ui()
        self._write_pidfile()
        events.append_event(LOG_DIR, "L1", "manager_start", {"pid": os.getpid()})
        events.prune_events(LOG_DIR)
        for subdir in ["uvicorn"] + [c.subdir for c in self.children]:
            events.prune_uvicorn_logs(LOG_DIR, subdir=subdir)

        self._start_api()
        for child in self.children:
            self._start_child(child)
        self.root.after(HEALTH_INTERVAL_MS, self._health_tick)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ── 중복 실행 차단 ───────────────────────────────────────────────────
    def _find_running_manager(self):
        try:
            pid = pidfile.read(LOG_DIR)
        except Exception:
            return None
        if not pid or pid == os.getpid():
            return None
        try:
            proc = psutil.Process(pid)
            if not proc.is_running():
                return None
            if "server_manager.py" in " ".join(proc.cmdline()).lower():
                return pid
        except Exception:
            return None
        return None

    def _abort_if_already_running(self):
        other = self._find_running_manager()
        if other is None:
            return False
        events.append_event(LOG_DIR, "L1", "duplicate_launch_blocked", {"running_pid": other})
        self.root.withdraw()
        messagebox.showwarning(
            "Hi-TESS LogBook — Server Manager",
            f"이미 실행 중입니다 (PID {other}).\n\n"
            "두 개를 동시에 띄우면 서로의 서버를 종료시킵니다.\n"
            "작업 표시줄에서 기존 창을 찾아 주세요.",
        )
        return True

    def _write_pidfile(self):
        try:
            pidfile.write(LOG_DIR, os.getpid())
        except Exception as exc:
            self._log(f"PID 파일을 쓰지 못했습니다: {exc}", "error")
            events.append_event(LOG_DIR, "L1", "pidfile_write_failed",
                                {"error": f"{type(exc).__name__}: {exc}"[:300]})

    # ── 창 ───────────────────────────────────────────────────────────────
    def _setup_window(self):
        self.root.title("Hi-TESS LogBook — Server Manager")
        self.root.configure(bg=BG)
        self.root.geometry("840x620")
        self.root.minsize(640, 480)

    def _build_ui(self):
        header = tk.Frame(self.root, bg=PANEL, pady=14)
        header.pack(fill="x")
        tk.Label(header, text="Hi-TESS LogBook", font=("Segoe UI", 16, "bold"),
                 bg=PANEL, fg=FG).pack(side="left", padx=20)
        tk.Label(header, text="Server Manager", font=("Segoe UI", 11),
                 bg=PANEL, fg=FG_DIM).pack(side="left")

        state = tk.Frame(self.root, bg=BG, pady=12, padx=20)
        state.pack(fill="x")

        # API 상태
        api_box = tk.Frame(state, bg=BG)
        api_box.pack(side="left", padx=(0, 24))
        self.api_dot = tk.Label(api_box, text="●", font=("Segoe UI", 18), bg=BG, fg=RED)
        self.api_dot.pack(side="left")
        tk.Label(api_box, text="API", font=("Segoe UI", 11, "bold"),
                 bg=BG, fg=FG).pack(side="left", padx=(4, 2))
        self.api_label = tk.Label(api_box, text="Stopped", font=("Segoe UI", 11),
                                  bg=BG, fg=RED)
        self.api_label.pack(side="left", padx=(4, 0))
        self.api_port = tk.Label(api_box, text="", font=("Segoe UI", 9),
                                 bg=BG, fg=FG_DIM)
        self.api_port.pack(side="left", padx=(6, 0))

        # Worker·Index 상태
        for child in self.children:
            box = tk.Frame(state, bg=BG)
            box.pack(side="left", padx=(0, 24))
            child.dot = tk.Label(box, text="●", font=("Segoe UI", 18), bg=BG, fg=RED)
            child.dot.pack(side="left")
            tk.Label(box, text=child.name, font=("Segoe UI", 11, "bold"),
                     bg=BG, fg=FG).pack(side="left", padx=(4, 2))
            child.label = tk.Label(box, text="Stopped", font=("Segoe UI", 11), bg=BG, fg=RED)
            child.label.pack(side="left", padx=(4, 0))

        # 버튼
        btn_frame = tk.Frame(state, bg=BG)
        btn_frame.pack(side="right")
        self.toggle_btn = tk.Button(btn_frame, text="Stop All", width=10,
                                    font=("Segoe UI", 10, "bold"),
                                    bg=RED, fg="white", activebackground="#d45f5f",
                                    relief="flat", cursor="hand2", pady=6,
                                    command=self._toggle_all)
        self.toggle_btn.pack(side="left", padx=(0, 8))
        self.update_btn = tk.Button(btn_frame, text="⟳  Update", width=12,
                                    font=("Segoe UI", 10, "bold"),
                                    bg=ACCENT, fg="white", activebackground="#3a7ae0",
                                    relief="flat", cursor="hand2", pady=6,
                                    command=self._run_update)
        self.update_btn.pack(side="left")

        tk.Frame(self.root, bg=PANEL, height=1).pack(fill="x")
        log_header = tk.Frame(self.root, bg=BG, pady=6, padx=20)
        log_header.pack(fill="x")
        tk.Label(log_header, text="Server Log", font=("Segoe UI", 9, "bold"),
                 bg=BG, fg=FG_DIM).pack(side="left")
        self.clear_btn = tk.Button(log_header, text="Clear", font=("Segoe UI", 8),
                                   bg=PANEL, fg=FG_DIM, activebackground=BG,
                                   relief="flat", cursor="hand2", pady=2, padx=8,
                                   command=self._clear_log)
        self.clear_btn.pack(side="right")

        self.log_text = scrolledtext.ScrolledText(
            self.root, font=("Consolas", 9),
            bg=LOG_BG, fg=LOG_FG, insertbackground=LOG_FG,
            relief="flat", bd=0, wrap="word", state="disabled",
            padx=12, pady=8
        )
        self.log_text.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.log_text.tag_config("info", foreground=LOG_FG)
        self.log_text.tag_config("success", foreground=GREEN)
        self.log_text.tag_config("warning", foreground=YELLOW)
        self.log_text.tag_config("error", foreground=RED)
        self.log_text.tag_config("dim", foreground=FG_DIM)
        self.log_text.tag_config("api", foreground="#8bc1ff")
        self.log_text.tag_config("worker", foreground="#f7c994")
        self.log_text.tag_config("index", foreground="#c9a7f7")

    def _log(self, message, tag="info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{timestamp}] ", "dim")
        self.log_text.insert("end", message + "\n", tag)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _clear_log(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    def _set_api_state(self, running):
        if running:
            self.api_dot.configure(fg=GREEN)
            self.api_label.configure(text="Running", fg=GREEN)
            self.api_port.configure(text="  :9095")
        else:
            self.api_dot.configure(fg=RED)
            self.api_label.configure(text="Stopped", fg=RED)
            self.api_port.configure(text="")

    def _set_child_state(self, child, running):
        color = GREEN if running else RED
        child.dot.configure(fg=color)
        child.label.configure(text="Running" if running else "Stopped", fg=color)

    def _kill_port(self, port):
        try:
            result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            pids = set()
            for line in result.stdout.splitlines():
                if f":{port}" in line and ("LISTENING" in line or "0.0.0.0:0" in line):
                    parts = line.split()
                    if parts:
                        pids.add(parts[-1])
            for pid in pids:
                if pid.isdigit() and pid != "0":
                    subprocess.run(["taskkill", "/PID", pid, "/F"],
                                   capture_output=True,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
                    self._log(f"  기존 포트 {port} 프로세스 종료: PID {pid}", "warning")
        except Exception as e:
            self._log(f"  포트 정리 중 오류: {e}", "error")

    # ── API 시작/스트리밍/종료 ──────────────────────────────────────────
    def _start_api(self):
        if self.api_proc and self.api_proc.poll() is None:
            return True
        self.intentional_stop = False
        self._log("API 시작 중...", "info")
        self._kill_port(API_PORT)
        try:
            self.api_proc = subprocess.Popen(
                API_CMD, cwd=str(BASE_DIR),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                env=_CHILD_ENV,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            self.health_tracker.reset()
            self._set_api_state(True)
            self._log(f"API 시작됨 (PID {self.api_proc.pid}, :{API_PORT})", "success")
            events.append_event(LOG_DIR, "L1", "api_start", {"pid": self.api_proc.pid})
            threading.Thread(target=self._stream_api,
                             args=(self.api_proc,), daemon=True).start()
            return True
        except OSError as exc:
            self._log(f"API 시작 실패: {type(exc).__name__}: {exc}", "error")
            events.append_event(LOG_DIR, "L1", "api_start_failed",
                                {"error": f"{type(exc).__name__}: {exc}"[:300]})
            return False

    def _stream_api(self, proc):
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            self.uvicorn_log.write(line)
            tag = "api"
            lower = line.lower()
            if "error" in lower:
                tag = "error"
            elif "warning" in lower:
                tag = "warning"
            elif "application startup complete" in lower or "started server" in lower:
                tag = "success"
            self.root.after(0, self._log, "[API] " + line, tag)
        self.root.after(0, self._on_api_exit, proc)

    def _on_api_exit(self, proc):
        if proc is not self.api_proc:
            return
        self._set_api_state(False)
        if self.is_updating or self.intentional_stop:
            return
        self._log("API 가 예기치 않게 종료되었습니다.", "error")
        detail = diagnostics.collect()
        if self.api_proc is not None:
            detail["crashed_pid"] = self.api_proc.pid
            detail["exit_code"] = self.api_proc.poll()
        events.append_event(LOG_DIR, "L1", "api_crash", detail)
        self._schedule_api_restart()

    # ── Worker·Index 시작/스트리밍/종료 ────────────────────────────────
    def _start_child(self, child):
        if child.running():
            return True
        self._log(f"{child.name} 시작 중...", "info")
        try:
            child.proc = subprocess.Popen(
                child.cmd, cwd=str(BASE_DIR),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
                env=_CHILD_ENV,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            self._set_child_state(child, True)
            self._log(f"{child.name} 시작됨 (PID {child.proc.pid})", "success")
            events.append_event(LOG_DIR, "L1", f"{child.key}_start", {"pid": child.proc.pid})
            threading.Thread(target=self._stream_child,
                             args=(child, child.proc), daemon=True).start()
            return True
        except OSError as exc:
            self._log(f"{child.name} 시작 실패: {type(exc).__name__}: {exc}", "error")
            events.append_event(LOG_DIR, "L1", f"{child.key}_start_failed",
                                {"error": f"{type(exc).__name__}: {exc}"[:300]})
            return False

    def _stream_child(self, child, proc):
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            child.log.write(line)
            tag = child.tag
            lower = line.lower()
            if "error" in lower:
                tag = "error"
            elif "warning" in lower:
                tag = "warning"
            self.root.after(0, self._log, f"[{child.name}] " + line, tag)
        self.root.after(0, self._on_child_exit, child, proc)

    def _on_child_exit(self, child, proc):
        if proc is not child.proc:
            return
        self._set_child_state(child, False)
        if self.is_updating or self.intentional_stop:
            return
        self._log(f"{child.name} 가 예기치 않게 종료되었습니다.", "error")
        detail = {"crashed_pid": proc.pid, "exit_code": proc.poll()}
        events.append_event(LOG_DIR, "L1", f"{child.key}_crash", detail)
        self._schedule_child_restart(child)

    # ── 자동 재시작 ─────────────────────────────────────────────────────
    def _schedule_api_restart(self):
        now = time.monotonic()
        action, delay = self.api_restart_policy.on_crash(now)
        if action == "wait":
            minutes = round(delay / 60, 1)
            self._log(f"API 연속 실패 — {minutes}분 뒤 다시 시도.", "error")
            events.append_event(LOG_DIR, "L1", "api_backoff_wait",
                                {"delay_sec": round(delay),
                                 "level": self.api_restart_policy.backoff_level})
            self.root.after(int(delay * 1000), self._api_restart_fire)
            return
        self._log(f"{RESTART_DELAY_MS // 1000}초 뒤 API 자동 재시작.", "warning")
        self.root.after(RESTART_DELAY_MS, self._api_restart_fire)

    def _schedule_child_restart(self, child):
        now = time.monotonic()
        action, delay = child.policy.on_crash(now)
        if action == "wait":
            minutes = round(delay / 60, 1)
            self._log(f"{child.name} 연속 실패 — {minutes}분 뒤 다시 시도.", "error")
            events.append_event(LOG_DIR, "L1", f"{child.key}_backoff_wait",
                                {"delay_sec": round(delay), "level": child.policy.backoff_level})
            self.root.after(int(delay * 1000), self._child_restart_fire, child)
            return
        self._log(f"{RESTART_DELAY_MS // 1000}초 뒤 {child.name} 자동 재시작.", "warning")
        self.root.after(RESTART_DELAY_MS, self._child_restart_fire, child)

    def _api_restart_fire(self):
        if self.is_updating or self.intentional_stop:
            return
        if self.api_proc and self.api_proc.poll() is None:
            return
        if self._start_api():
            events.append_event(LOG_DIR, "L1", "api_restart_done", {"reason": "crash"})
        else:
            self._schedule_api_restart()

    def _child_restart_fire(self, child):
        if self.is_updating or self.intentional_stop:
            return
        if child.running():
            return
        if self._start_child(child):
            events.append_event(LOG_DIR, "L1", f"{child.key}_restart_done", {"reason": "crash"})
        else:
            self._schedule_child_restart(child)

    # ── 좀비 감지 (API 만, Worker·Index 는 HTTP endpoint 없음) ──────────
    def _health_tick(self):
        self.root.after(HEALTH_INTERVAL_MS, self._health_tick)
        proc = self.api_proc
        if self.is_updating or not (proc and proc.poll() is None):
            self.health_tracker.reset()
            return
        threading.Thread(target=self._probe_health, args=(proc,), daemon=True).start()

    def _probe_health(self, proc):
        ok = health.probe(url=HEALTH_URL)
        self.root.after(0, self._on_health_result, ok, proc)

    def _on_health_result(self, ok, proc):
        if proc is not self.api_proc:
            return
        state, changed = self.health_tracker.record(ok, now=time.time())
        if not changed:
            return
        if state == health.HEALTHY:
            self._log("API 응답 회복.", "success")
            events.append_event(LOG_DIR, "L1", "health_recovered")
            self.api_restart_policy.record_success()
        elif state == health.SUSPECT:
            self._log("API 응답 없음 — 관찰 중.", "warning")
            events.append_event(LOG_DIR, "L1", "health_degraded",
                                {"fail_streak": self.health_tracker.fail_streak})
        elif state == health.ZOMBIE:
            self._force_restart_zombie()

    def _force_restart_zombie(self):
        if self.api_proc is None or self.api_proc.poll() is not None:
            self.health_tracker.reset()
            return
        pid = self.api_proc.pid
        self._log("3분간 응답 없음 — API 강제 재시작.", "error")
        snapshot = diagnostics.collect(uvicorn_pid=pid)
        children = proctree.snapshot_tree(pid)
        snapshot["fail_streak"] = self.health_tracker.fail_streak
        last_ok = self.health_tracker.last_ok_at
        snapshot["last_ok"] = (
            datetime.fromtimestamp(last_ok, tz=timezone.utc).astimezone().isoformat(timespec="seconds")
            if last_ok is not None else None
        )
        snapshot["children"] = children
        events.append_event(LOG_DIR, "L1", "zombie_detected", snapshot)
        events.append_event(LOG_DIR, "L1", "api_restart_begin", {"reason": "zombie"})

        if self.api_proc and self.api_proc.poll() is None:
            try:
                self.api_proc.terminate()
                try:
                    self.api_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.api_proc.kill()
            except Exception as exc:
                self._log(f"  API 종료 실패: {exc}", "error")
        self.api_proc = None
        self._set_api_state(False)

        if children:
            try:
                attempted = proctree.kill_survivors(children)
                if attempted:
                    self._log(f"  자손 프로세스 {len(attempted)}개 정리", "warning")
                    events.append_event(LOG_DIR, "L1", "orphan_killed",
                                        {"attempted": len(attempted),
                                         "entries": attempted})
            except Exception as exc:
                events.append_event(LOG_DIR, "L1", "orphan_cleanup_failed",
                                    {"error": f"{type(exc).__name__}: {exc}"[:300]})

        self._kill_port(API_PORT)
        self.health_tracker.reset()

        now = time.monotonic()
        action, delay = self.api_restart_policy.on_crash(now)
        if action == "wait":
            self.root.after(int(delay * 1000), self._api_restart_fire)
        else:
            self.root.after(RESTART_DELAY_MS, self._api_restart_fire)

    # ── 수동 Stop/Start ────────────────────────────────────────────────
    def _stop_api(self):
        if self.api_proc and self.api_proc.poll() is None:
            self._log("API 중지...", "warning")
            try:
                self.api_proc.terminate()
                try:
                    self.api_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.api_proc.kill()
            except Exception as exc:
                self._log(f"  API 종료 실패: {exc}", "error")
            self.api_proc = None
        self._set_api_state(False)

    def _stop_child(self, child):
        if child.running():
            self._log(f"{child.name} 중지...", "warning")
            try:
                child.proc.terminate()
                try:
                    child.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.proc.kill()
            except Exception as exc:
                self._log(f"  {child.name} 종료 실패: {exc}", "error")
            child.proc = None
        self._set_child_state(child, False)

    def _stop_children(self):
        for child in self.children:
            self._stop_child(child)

    def _toggle_all(self):
        running = ((self.api_proc and self.api_proc.poll() is None)
                   or any(c.running() for c in self.children))
        if running:
            self.intentional_stop = True
            self._stop_api()
            self._stop_children()
            self._log("모든 서비스가 중지되었습니다.", "warning")
            self.toggle_btn.configure(text="Start All", bg=GREEN,
                                     activebackground="#2db87a")
        else:
            self.intentional_stop = False
            self.api_restart_policy.reset()
            self._start_api()
            for child in self.children:
                child.policy.reset()
                self._start_child(child)
            self.toggle_btn.configure(text="Stop All", bg=RED,
                                     activebackground="#d45f5f")

    # ── Update ─────────────────────────────────────────────────────────
    def _run_update(self):
        if self.is_updating:
            return
        self.is_updating = True
        self.update_btn.configure(state="disabled", text="Updating...")
        threading.Thread(target=self._update_worker, daemon=True).start()

    def _update_worker(self):
        self.root.after(0, self._log, "=" * 50, "dim")
        self.root.after(0, self._log, "업데이트 시작.", "info")

        self.root.after(0, self._log, "[1/4] 서비스 중지", "info")
        self.root.after(0, self._stop_api)
        self.root.after(0, self._stop_children)

        self.root.after(0, self._log, "[2/4] git pull origin main", "info")
        before = self._get_git_hash()
        if before:
            self.root.after(0, self._log, f"  Before: {before}", "dim")
        ok, lines = self._run_cmd_capture(["git", "pull", "origin", "main"],
                                           cwd=str(REPO_ROOT))
        if not ok:
            self.root.after(0, self._log, "git pull 실패. Update aborted.", "error")
            for line in lines[-5:]:
                self.root.after(0, self._log, f"  {line}", "error")
            self._finish_update()
            return
        after = self._get_git_hash()
        if after:
            self.root.after(0, self._log, f"  After:  {after}", "dim")

        self.root.after(0, self._log, "[3/4] 의존성 변경 확인", "info")
        if self._requirements_changed():
            self.root.after(0, self._log, "  requirements.txt 변경 — pip install", "warning")
            self._run_cmd([PIP, "install", "-r", "requirements.txt"], cwd=str(BASE_DIR))
        else:
            self.root.after(0, self._log, "  의존성 변경 없음", "dim")

        self.root.after(0, self._log, "[4/4] 서비스 재시작", "success")
        self.root.after(0, self._post_update_start)
        time.sleep(5)
        self._health_check_after_update()
        self.root.after(0, self._log, "업데이트 완료.", "success")
        self.root.after(0, self._log, "=" * 50, "dim")
        self._finish_update()

    def _post_update_start(self):
        self.intentional_stop = False
        self.api_restart_policy.reset()
        if not self._start_api():
            self._schedule_api_restart()
        for child in self.children:
            child.policy.reset()
            if not self._start_child(child):
                self._schedule_child_restart(child)

    def _get_git_hash(self):
        try:
            r = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                               cwd=str(REPO_ROOT),
                               capture_output=True, text=True,
                               creationflags=subprocess.CREATE_NO_WINDOW)
            return r.stdout.strip() if r.returncode == 0 else ""
        except Exception:
            return ""

    def _run_cmd_capture(self, cmd, cwd):
        lines = []
        try:
            proc = subprocess.Popen(cmd, cwd=cwd,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, encoding="utf-8", errors="replace",
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    lines.append(line)
                    self.root.after(0, self._log, f"  {line}", "dim")
            proc.wait()
            return proc.returncode == 0, lines
        except Exception as e:
            self.root.after(0, self._log, f"  오류: {e}", "error")
            return False, [str(e)]

    def _requirements_changed(self):
        try:
            r = subprocess.run(
                ["git", "diff", "HEAD@{1}", "HEAD", "--", "backend/requirements.txt"],
                cwd=str(REPO_ROOT), capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            if r.returncode != 0:
                return True
            return bool(r.stdout.strip())
        except Exception:
            return True

    def _run_cmd(self, cmd, cwd):
        try:
            proc = subprocess.Popen(cmd, cwd=cwd,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, encoding="utf-8", errors="replace",
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    self.root.after(0, self._log, f"  {line}", "dim")
            proc.wait()
            return proc.returncode == 0
        except Exception as e:
            self.root.after(0, self._log, f"  오류: {e}", "error")
            return False

    def _health_check_after_update(self):
        try:
            req = urllib.request.urlopen(HEALTH_URL, timeout=5)
            data = json.loads(req.read().decode())
            ver = data.get("version", "?")
            self.root.after(0, self._log, f"  Server: v{ver}", "success")
        except Exception as e:
            self.root.after(0, self._log, f"  헬스 체크 실패: {e}", "warning")

    def _finish_update(self):
        self.is_updating = False
        self.root.after(0, self.update_btn.configure,
                        {"state": "normal", "text": "⟳  Update"})

    # ── 종료 ───────────────────────────────────────────────────────────
    def _on_close(self):
        self.intentional_stop = True
        self._stop_api()
        self._stop_children()
        events.append_event(LOG_DIR, "L1", "manager_stop")
        pidfile.clear(LOG_DIR)
        self.uvicorn_log.close()
        for child in self.children:
            child.log.close()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = LogbookManager(root)
    if not app.aborted:
        root.mainloop()
