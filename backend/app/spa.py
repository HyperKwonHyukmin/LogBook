r"""frontend/dist 서빙.

⚠ 회사 DRM 규칙(WorkBench CLAUDE.md): FileResponse/StaticFiles 는 stat 크기로
Content-Length 를 보내 DRM 이 파일 크기를 바꿔 놓은 경우 ERR_CONTENT_LENGTH_MISMATCH 가 난다.
그래서 항상 read() 한 바이트로 응답한다.

⚠ 보안: full_path 는 인증 없이 누구나 보내는 값이다. 백슬래시(UNC 경로 구분자, 예: \\server\share)나
드라이브 문자(콜론, 예: C:\...)가 섞인 값을 Path.resolve()/is_file() 에 먼저 넘기면, Windows 가
그 경로를 실제로 열어보려 시도해 (1) UNC 대상 서버로 인증 핸드셰이크(NTLM 해시)가 새거나
(2) 죽은 공유에 물려 요청 스레드가 멈추는(SMB 타임아웃 DoS) 문제가 생긴다. 그래서 파일
시스템을 건드리기 *전에* 문자열만으로 먼저 걸러낸다 — resolve()/is_file() 은 dist 안으로
정규화가 끝난 경로에만 호출한다. (raw string — 위 백슬래시 예시가 이스케이프로 해석되지 않게.)
"""
import mimetypes
from pathlib import Path, PurePosixPath

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("font/woff2", ".woff2")


def _bytes_response(path: Path) -> Response:
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if media_type.startswith("text/") or media_type == "application/javascript":
        media_type += "; charset=utf-8"
    return Response(content=path.read_bytes(), media_type=media_type)


def mount_spa(app: FastAPI, dist: Path | None) -> None:
    if dist is None or not (dist / "index.html").is_file():
        return
    root = dist.resolve()
    index = root / "index.html"

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(full_path: str):
        if full_path.lower() == "api" or full_path.lower().startswith("api/"):
            raise HTTPException(status_code=404, detail="not_found")

        if not full_path:
            return _bytes_response(index)

        # 백슬래시(UNC·윈도 경로 구분자)나 콜론(드라이브 문자)이 있으면 파일시스템을
        # 전혀 건드리지 않고 바로 index 로 돌린다.
        if "\\" in full_path or ":" in full_path:
            return _bytes_response(index)

        rel = PurePosixPath(full_path)
        if rel.is_absolute() or ".." in rel.parts:
            return _bytes_response(index)

        candidate = root.joinpath(*rel.parts)
        if candidate.is_file() and candidate.resolve().is_relative_to(root):
            return _bytes_response(candidate)

        # assets/ 아래거나 확장자가 있는 요청인데 실제 파일이 없으면 404 —
        # 오타난 정적 자산 요청을 SPA 라우트로 착각해 index.html 을 주지 않는다.
        if full_path.startswith("assets/") or "." in rel.name:
            raise HTTPException(status_code=404, detail="not_found")

        return _bytes_response(index)
