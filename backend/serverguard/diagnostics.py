"""재시작 직전 진단 스냅샷 — 죽이면 사라지는 증거를 먼저 남긴다.

강제 재시작은 원인을 지운다. 그래서 프로세스를 죽이기 '전에' 호출해야 하며,
수집 자체가 실패하더라도 재시작을 막아서는 안 된다(모든 예외를 삼킨다).
"""
from pathlib import Path

import psutil

# psutil.disk_usage("/") 는 Windows 에서 "호출 시점의 프로세스 cwd 가 있는 드라이브" 를 본다 —
# 이 모듈 자신이 위치한 드라이브(저장소가 실제로 체크아웃된 드라이브)를 고정 앵커로 쓴다.
DISK_ANCHOR = str(Path(__file__).resolve().anchor)


def collect(uvicorn_pid=None):
    """호스트·프로세스 지표를 dict 로 반환한다. 실패한 항목은 키가 없다."""
    snapshot = {}

    try:
        snapshot["cpu"] = psutil.cpu_percent(interval=0.1)
        snapshot["mem_pct"] = psutil.virtual_memory().percent
        snapshot["disk_path"] = DISK_ANCHOR
        snapshot["disk_free_gb"] = round(psutil.disk_usage(DISK_ANCHOR).free / (1024 ** 3), 1)
    except Exception:
        pass

    if uvicorn_pid is None:
        return snapshot

    snapshot["uvicorn_pid"] = uvicorn_pid
    try:
        proc = psutil.Process(uvicorn_pid)
        snapshot["threads"] = proc.num_threads()
        snapshot["proc_mem_mb"] = round(proc.memory_info().rss / (1024 ** 2), 1)
    except Exception:
        pass

    return snapshot
