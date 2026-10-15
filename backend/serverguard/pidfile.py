"""서버 매니저 PID 파일 — 중복 실행 방지.

L1(server_manager.py)이 기동 시 자기 PID 를 쓰고 정상 종료 시 지운다.
파일이 있으면 다른 매니저가 떠 있는지 확인해 중복 기동을 막는다.
"""
from pathlib import Path

PID_FILENAME = "server_manager.pid"


def write(log_dir, pid):
    """PID 를 기록한다.

    실패를 전파한다 — 삼키면 중복 방지가 조용히 무력화된다. 호출자는 이 예외를
    잡아 이벤트로 기록하되, 그 실패로 매니저 자체의 기동을 막지 말 것.
    """
    path = Path(log_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / PID_FILENAME).write_text(str(pid), encoding="utf-8")


def read(log_dir):
    """기록된 PID 를 int 로 반환한다.

    파일이 없거나 내용이 파싱되지 않으면 "유효한 기록 없음"이 확정된 상태이므로
    None 을 반환한다. 그 외(PermissionError 등)는 "L1 생사 알 수 없음"이라는
    다른 상태이므로 전파한다.
    """
    try:
        raw = (Path(log_dir) / PID_FILENAME).read_text(encoding="utf-8").strip()
        return int(raw)
    except (FileNotFoundError, ValueError):
        return None


def clear(log_dir):
    """PID 파일을 삭제한다. 없어도 조용히 넘어간다."""
    try:
        (Path(log_dir) / PID_FILENAME).unlink()
    except Exception:
        pass
