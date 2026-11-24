"""app/serve.py(2026-11-24) — uvicorn 프로세스 하나가 9095 와 덧붙인 포트(80)를 함께 연다. 포트 처리와 실제 응답."""
import socket
import sys
import threading
import time
import urllib.request

import pytest

from app import serve


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _close(socks):
    for s in socks:
        s.close()


def test_parse_ports():
    assert serve.parse_ports("80, 8080;x, 70000, 9095, 80", primary=9095) == (80, 8080)
    assert serve.parse_ports("") == () and serve.parse_ports(None) == ()


def test_opens_primary_and_extra():
    a, b = _free_port(), _free_port()
    socks, opened, skipped = serve.open_sockets(a, (b,), host="127.0.0.1")
    try:
        assert opened == [a, b] and skipped == []
    finally:
        _close(socks)


def test_extra_port_taken_is_skipped_not_fatal():
    """덧붙인 포트를 이미 다른 프로그램(예: 남아 있는 Windows 포트 전달)이 받고 있으면 건너뛰고 주 포트로 계속한다."""
    a, b = _free_port(), _free_port()
    other = socket.socket()
    other.bind(("127.0.0.1", b))
    other.listen(1)
    try:
        socks, opened, skipped = serve.open_sockets(a, (b,), host="127.0.0.1")
        try:
            assert opened == [a] and [p for p, _why in skipped] == [b]
        finally:
            _close(socks)
    finally:
        other.close()


@pytest.mark.skipif(sys.platform != "win32", reason="운영 서버(Windows)의 포트 규칙")
def test_primary_port_failure_raises():
    """이미 듣고 있는 프로그램(옛 API 프로세스 등)이 있으면 겹쳐 열지 않고 실패한다 — 재사용 옵션을 켜면 겹쳐 열린다."""
    a = _free_port()
    other = socket.socket()
    other.bind(("127.0.0.1", a))
    other.listen(1)
    try:
        with pytest.raises(OSError):
            serve.open_sockets(a, (), host="127.0.0.1")
    finally:
        other.close()


def test_one_process_answers_on_both_ports_with_client_ip():
    """두 포트 모두 같은 앱이 받고, 접속한 쪽 주소가 그대로 보인다(포트 전달과 달리 127.0.0.1 로 바뀌지 않는다는 근거)."""
    async def app(scope, receive, send):
        if scope["type"] != "http":
            return
        body = f"{scope['client'][0]}|{scope['server'][1]}".encode()
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
        await send({"type": "http.response.body", "body": body})

    a, b = _free_port(), _free_port()
    server, socks, opened, _skipped = serve.build_server(app, a, (b,), host="127.0.0.1")
    assert opened == [a, b]
    thread = threading.Thread(target=lambda: server.run(sockets=socks), daemon=True)
    thread.start()
    try:
        for _ in range(50):
            if server.started:
                break
            time.sleep(0.1)
        for port in (a, b):
            got = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5).read().decode()
            assert got == f"127.0.0.1|{port}"
    finally:
        server.should_exit = True
        thread.join(10)


def test_skipped_port_opens_later_without_restart():
    """처음에 못 연 포트(포트 전달이 쥐고 있던 80번)는 그 프로그램이 놓으면 다시 시작하지 않아도 스스로 연다."""
    async def app(scope, receive, send):
        if scope["type"] != "http":
            return
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    a, b = _free_port(), _free_port()
    other = socket.socket()
    other.bind(("127.0.0.1", b))
    other.listen(1)
    server, socks, opened, skipped = serve.build_server(app, a, (b,), host="127.0.0.1", retry_sec=0.2)
    assert opened == [a] and [p for p, _why in skipped] == [b]
    thread = threading.Thread(target=lambda: server.run(sockets=socks), daemon=True)
    thread.start()
    try:
        for _ in range(50):
            if server.started:
                break
            time.sleep(0.1)
        assert urllib.request.urlopen(f"http://127.0.0.1:{a}/", timeout=5).read() == b"ok"
        time.sleep(0.5)
        assert server.opened_later == []          # 아직 남이 쥐고 있다
        other.close()
        for _ in range(50):
            if server.opened_later:
                break
            time.sleep(0.1)
        assert server.opened_later == [b]
        assert urllib.request.urlopen(f"http://127.0.0.1:{b}/", timeout=5).read() == b"ok"
    finally:
        other.close()
        server.should_exit = True
        thread.join(10)


def test_settings_extra_ports_default():
    from app.config import load_settings

    assert 9095 not in load_settings().extra_ports
