"""자손 프로세스 수집과 정리.

uvicorn 을 죽여도 그 아래에서 돌던 자식 프로세스(파일 변환 subprocess 등)는
살아남을 수 있다. 정리하지 않으면 재시작에는 성공해도 리소스가 묶여 있다.

수집은 죽이기 전에, 정리는 죽인 후에 해야 한다 — 부모가 사라진 뒤에는
자손 관계를 더 이상 조회할 수 없다.
"""
import os
import time

import psutil

KILL_CONFIRM_TIMEOUT_SEC = 3


def snapshot_tree(pid):
    """pid 의 모든 자손 프로세스 정보를 수집한다."""
    try:
        parent = psutil.Process(pid)
        children = parent.children(recursive=True)
    except (psutil.Error, ValueError):
        return []

    entries = []
    for child in children:
        try:
            entries.append({
                "pid": child.pid,
                "name": child.name(),
                "create_time": child.create_time(),
            })
        except psutil.Error:
            continue
    return entries


def kill_survivors(snapshot, *, proc_factory=psutil.Process, timeout=KILL_CONFIRM_TIMEOUT_SEC):
    """snapshot 중 아직 살아있는 프로세스에 종료를 시도하고,
    시도한 항목 전체를 "terminated" 플래그와 함께 반환한다.

    create_time 이 일치할 때만 죽인다. Windows 는 PID 를 재활용하므로, 이 확인이
    없으면 그사이 같은 PID 를 받은 무관한 프로세스를 죽이는 사고가 난다.

    자기 자신의 PID(os.getpid())는 절대 건드리지 않는다.
    """
    own_pid = os.getpid()
    attempted = []
    for entry in snapshot:
        if entry.get("pid") == own_pid:
            continue
        try:
            proc = proc_factory(entry["pid"])
            if proc.create_time() != entry["create_time"]:
                continue
            proc.kill()
        except psutil.Error:
            continue
        attempted.append((entry, proc))

    deadline = time.monotonic() + timeout
    results = []
    for entry, proc in attempted:
        remaining = max(0.0, deadline - time.monotonic())
        try:
            proc.wait(timeout=remaining)
            terminated = True
        except psutil.TimeoutExpired:
            terminated = False
        results.append({**entry, "terminated": terminated})
    return results
