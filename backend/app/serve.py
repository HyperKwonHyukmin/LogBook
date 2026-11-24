"""API 실행(2026-11-24) — uvicorn 프로세스 하나가 9095 와 덧붙인 포트(기본 80)를 함께 연다.

왜: 사내 DNS logbook.hd.com 은 포트 없이(80번) 들어온다. 처음에는 145 의 Windows 포트 전달(netsh portproxy, 80 을 9095 로)로
넘겼는데, 그 길로 온 사용자는 모두 127.0.0.1 로 보인다. 그래서 Windows 로그인 제한기(windows_auth — IP 별 실패 20번,
누구인지 모르는 실패 4번, 동시 협상 10개)가 80번 사용자 전체를 한 사람으로 세고, 감사 기록의 IP 도 127.0.0.1 이 됐다.
같은 프로세스가 80번을 직접 열면 접속한 PC 의 IP 가 그대로 보인다.

- 프로세스는 하나여야 한다(NTLM 협상 상태가 프로세스 메모리에 있다 — README). 그래서 포트마다 서버를 따로 띄우지 않는다.
- 9095 는 반드시 연다(못 열면 끝낸다 — 예전 `python -m uvicorn` 과 같다).
- 덧붙인 포트는 못 열어도 9095 만으로 뜨고, 뜬 뒤에도 RETRY_SEC 마다 다시 열어 본다. 그래서 포트 전달이나 다른 프로그램이
  80번을 놓으면 다시 시작하지 않아도 스스로 연다(한 번 놓쳤다고 다음 재시작까지 80번이 빠져 있지 않게 — Codex 검토).
- ⚠ Windows 에서 SO_REUSEADDR 를 켜지 않는다. 켜면 남이 듣고 있는 포트에도 겹쳐 열려(옛 API 프로세스, 포트 전달) 요청이
  어느 쪽으로 갈지 알 수 없다. 켜지 않으면 이미 쓰는 포트는 여는 데서 실패한다(asyncio 가 Windows 에서 하는 것과 같다).

server_manager.API_CMD 가 `python -m app.serve` 로 띄운다. 개발 PC 의 `python -m uvicorn app.main:app --port 9095` 는 그대로 된다.
uvicorn 은 requirements.txt 에 0.40.0 으로 고정 — 뜬 뒤 포트를 더하는 부분(_open_later)이 Server.startup 의 프로토콜 생성 방식을 따른다.
"""
import argparse
import asyncio
import socket
import sys

import uvicorn

DEFAULT_PORT = 9095
RETRY_SEC = 30.0
STARTUP_FAILURE = 3          # uvicorn.main 과 같은 종료 코드(앱 시작 실패)


def parse_ports(text: str, primary: int = DEFAULT_PORT) -> tuple[int, ...]:
    """'80, 8080' → (80, 8080). 숫자가 아니거나 범위 밖, 주 포트와 같은 값, 겹친 값은 버린다."""
    out: list[int] = []
    for part in (text or "").replace(";", ",").split(","):
        part = part.strip()
        if part.isdigit() and 0 < int(part) < 65536 and int(part) != primary and int(part) not in out:
            out.append(int(part))
    return tuple(out)


def _bind(host: str, port: int) -> socket.socket:
    """그 포트를 연다. 이미 쓰는 프로그램이 있으면 OSError(Windows 는 재사용 옵션 없이, 그 밖은 asyncio 처럼 SO_REUSEADDR)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if sys.platform != "win32":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, port))
        sock.set_inheritable(True)
    except OSError:
        sock.close()
        raise
    return sock


def open_sockets(primary: int, extras: tuple[int, ...] = (), host: str = "0.0.0.0"):
    """→ (소켓 목록, 연 포트, [(못 연 포트, 사유)]). 주 포트를 못 열면 OSError 를 그대로 던진다."""
    socks, opened, skipped = [_bind(host, primary)], [primary], []
    for port in extras:
        try:
            socks.append(_bind(host, port))
            opened.append(port)
        except OSError as exc:
            skipped.append((port, f"{type(exc).__name__}: {exc}"))
    return socks, opened, skipped


class Server(uvicorn.Server):
    """처음에 못 연 덧붙인 포트를 뜬 뒤에도 다시 열어 본다."""

    def __init__(self, config, host: str, pending: list[int], retry_sec: float = RETRY_SEC):
        super().__init__(config)
        self._host, self._pending, self._retry_sec = host, list(pending), retry_sec
        self._retry_task: asyncio.Task | None = None
        self.opened_later: list[int] = []

    async def startup(self, sockets=None) -> None:
        await super().startup(sockets=sockets)
        if self.started and self._pending:
            self._retry_task = asyncio.create_task(self._open_later())

    async def shutdown(self, sockets=None) -> None:
        if self._retry_task is not None:
            self._retry_task.cancel()
        await super().shutdown(sockets=sockets)

    async def _open_later(self) -> None:
        loop = asyncio.get_running_loop()
        config = self.config

        def create_protocol(_loop=None):   # uvicorn.Server.startup 의 create_protocol 과 같다
            return config.http_protocol_class(config=config, server_state=self.server_state,
                                              app_state=self.lifespan.state, _loop=_loop)

        while self._pending and not self.should_exit:
            await asyncio.sleep(self._retry_sec)
            for port in list(self._pending):
                try:
                    sock = _bind(self._host, port)
                except OSError:
                    continue
                try:
                    self.servers.append(await loop.create_server(create_protocol, sock=sock, backlog=config.backlog))
                except Exception as exc:  # noqa: BLE001 — 덧붙인 포트 때문에 API 가 죽지 않게
                    sock.close()
                    self._pending.remove(port)
                    print(f"WARNING: 포트 {port} 을 더하지 못했습니다({type(exc).__name__}: {exc}). 다시 시도하지 않습니다", flush=True)
                    continue
                self._pending.remove(port)
                self.opened_later.append(port)
                print(f"INFO: 포트 {port} 을 열었습니다(이제 이 포트로도 받습니다)", flush=True)


def build_server(app, primary: int, extras: tuple[int, ...] = (), host: str = "0.0.0.0", retry_sec: float = RETRY_SEC):
    """→ (Server, 소켓 목록, 연 포트, 못 연 포트). 실행은 server.run(sockets=소켓 목록)."""
    socks, opened, skipped = open_sockets(primary, extras, host)
    config = uvicorn.Config(app, host=host, port=primary, access_log=False)   # 예전 명령의 --no-access-log 와 같다
    return Server(config, host, [p for p, _why in skipped], retry_sec), socks, opened, skipped


def main(argv: list[str] | None = None) -> int:
    from .config import settings

    parser = argparse.ArgumentParser(prog="python -m app.serve", description="LogBook API 를 9095 와 덧붙인 포트로 띄운다")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--extra-ports", default=None, help="쉼표로 여러 개. 기본은 LOGBOOK_EXTRA_PORTS(없으면 80), 빈 값이면 끈다")
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args(argv)
    extras = settings.extra_ports if args.extra_ports is None else parse_ports(args.extra_ports, args.port)
    extras = tuple(p for p in extras if p != args.port)
    try:
        server, socks, opened, skipped = build_server("app.main:app", args.port, extras, args.host)
    except OSError as exc:
        print(f"ERROR: 포트 {args.port} 을 열지 못했습니다: {type(exc).__name__}: {exc}", flush=True)
        return 1
    print(f"INFO: LogBook API 포트 {', '.join(str(p) for p in opened)} 에서 받습니다", flush=True)
    for port, why in skipped:
        print(f"WARNING: 포트 {port} 은 지금 열지 못했습니다({why}). 포트 {args.port} 로 계속하고 "
              f"{int(RETRY_SEC)}초마다 다시 열어 봅니다", flush=True)
    server.run(sockets=socks)
    return 0 if server.started else STARTUP_FAILURE


if __name__ == "__main__":
    sys.exit(main())
