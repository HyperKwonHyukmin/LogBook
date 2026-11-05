"""자동 로그인 화면 조각 — 18 WorkBench 자동 로그인(/sso)과 55 Windows 계정 자동 로그인(/auth/windows)이 같이 쓴다.

토큰은 작은 HTML 이 localStorage 에 넣고 앱으로 넘어간다. ⚠ 토큰은 로그에 남기지 않는다."""
import json

from fastapi.responses import HTMLResponse

HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer",
           "X-Content-Type-Options": "nosniff"}

NEXT_MAX = 512
# 로그인 뒤 다시 로그인 경로로 가면 같은 일을 되풀이한다
NEXT_BLOCKED = ("/auth/", "/sso", "/login", "/api/")


def js(value) -> str:
    """HTML <script> 안에 넣을 JS 값 — JSON 으로 쓰고 </script>·주석·HTML 해석에 걸리는 글자를 \\u 로 바꾼다."""
    return (json.dumps(value, ensure_ascii=True).replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("&", "\\u0026").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def safe_next(value: str | None) -> str:
    """로그인 뒤 열 화면 — 이 앱 안의 경로만(열린 리다이렉트 방지). 아니면 첫 화면.

    `//host`·`/\\host` 는 브라우저가 다른 사이트로 읽으므로 막고, 제어 문자·로그인 경로·API 도 받지 않는다."""
    v = value or ""
    if (not v.startswith("/") or v.startswith("//") or "\\" in v or len(v) > NEXT_MAX
            or any(ord(c) < 32 or ord(c) == 127 for c in v)
            or any(v == p.rstrip("/") or v.startswith(p) for p in NEXT_BLOCKED)):
        return "/"
    return v


def success_page(token: str, employee_id: str, pick: dict | None = None, next_path: str = "/",
                 headers: dict | None = None) -> HTMLResponse:
    """토큰을 심고 next_path 로 넘어가는 HTML. pick = 18-b WorkBench 선택 모드(없으면 지운다)."""
    next_path = safe_next(next_path)
    # 다른 사람이 쓰던 창이면 그 사람이 보내지 못한 화면 설정(prefs)을 새 사용자에게 보내지 않게 지운다
    body = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>Hi-TESS LogBook</title></head><body>
<script>
(function () {{
  var token = {js(token)}, eid = {js(employee_id)}, pick = {js(pick or {})};
  try {{
    if (localStorage.getItem('logbook_saved_employee_id') !== eid) localStorage.removeItem('logbook.prefsUnsent.v1');
    localStorage.setItem('logbook_token', token);
    localStorage.setItem('logbook_saved_employee_id', eid);
  }} catch (e) {{}}
  // 18-b — 새 선택 모드마다 자동 검색 필터를 다시 한 번 켠다(같은 창을 다른 대상으로 다시 열 때)
  try {{ sessionStorage.setItem('logbook_wb', JSON.stringify(pick)); sessionStorage.removeItem('logbook_wb_filter_applied'); }} catch (e) {{}}
  location.replace({js(next_path)});
}})();
</script>
<noscript>JavaScript 가 꺼져 있어 로그인할 수 없습니다.</noscript>
</body></html>"""
    return HTMLResponse(body, status_code=200, headers=HEADERS | (headers or {}))


def redirect_page(path: str, status_code: int, headers: dict | None = None) -> HTMLResponse:
    """status_code 응답의 본문이 곧바로 path 로 넘어가게 하는 HTML(55 — 401 화면이 그대로 보이면 로그인 화면으로)."""
    body = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>Hi-TESS LogBook</title></head><body>
<script>location.replace({js(path)});</script>
<noscript><a href="/login">로그인 화면으로</a></noscript>
</body></html>"""
    return HTMLResponse(body, status_code=status_code, headers=HEADERS | (headers or {}))
