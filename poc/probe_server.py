"""실험 3·6: 크롬 업로드가 평문으로 오는지, 팀원 PC 에서 9095 로 접속되는지 확인한다.

145 에서 실행(cmd.exe):
    set LOGBOOK_POC_DIR=\\\\storage.hpc.hd.com\\...\\999_LogBook\\_poc\\web
    .venv\\Scripts\\uvicorn.exe probe_server:app --host 0.0.0.0 --port 9095

145 에서 실행(PowerShell — `set` 은 환경변수를 바꾸지 못한다. `$env:` 를 쓴다):
    $env:LOGBOOK_POC_DIR = '\\\\storage.hpc.hd.com\\...\\999_LogBook\\_poc\\web'
    .venv\\Scripts\\uvicorn.exe probe_server:app --host 0.0.0.0 --port 9095

팀원 PC 크롬에서 http://10.14.42.145:9095 접속 → DRM 걸린 로컬 파일 업로드.
결과는 화면(저장 폴더 표시)과 <LOGBOOK_POC_DIR>\\upload_log.jsonl (UTF-8) 에 남는다.
"""
import html
import json
import os
from datetime import datetime
from pathlib import Path, PureWindowsPath

from fastapi import FastAPI, Request, UploadFile
from fastapi.responses import HTMLResponse

from drm_check import sniff

SAVE_DIR = Path(os.environ.get("LOGBOOK_POC_DIR", "out/web"))
SAVE_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH = SAVE_DIR / "upload_log.jsonl"

app = FastAPI()

PAGE = """<!doctype html><meta charset="utf-8"><title>Logbook PoC</title>
<h1>Logbook 업로드 실험</h1>
<p>접속 IP: {ip}</p>
<p>저장 폴더: {save_dir}</p>
<input type="file" id="f" multiple>
<pre id="out"></pre>
<script>
document.getElementById('f').onchange = async (e) => {{
  const out = document.getElementById('out');
  for (const file of e.target.files) {{
    const fd = new FormData(); fd.append('file', file);
    try {{
      const r = await fetch('/upload', {{method: 'POST', body: fd}});
      if (!r.ok) {{
        out.textContent += `[${{file.name}}] HTTP ${{r.status}}: ${{await r.text()}}\\n`;
        continue;
      }}
      out.textContent += JSON.stringify(await r.json()) + '\\n';
    }} catch (err) {{
      // 네트워크 오류 등으로 한 파일이 실패해도 나머지 파일 업로드는 계속한다.
      out.textContent += `[${{file.name}}] 오류: ${{err}}\\n`;
    }}
  }}
}};
</script>"""


def _safe_name(name: str) -> str:
    """경로 성분을 모두 버리고 파일명만 남긴다 (\\ 와 / 모두 처리)."""
    return PureWindowsPath(name or "upload.bin").name or "upload.bin"


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> str:
    ip = request.client.host if request.client else "?"
    return PAGE.format(ip=html.escape(ip), save_dir=html.escape(str(SAVE_DIR)))


@app.post("/upload")
async def upload(request: Request, file: UploadFile) -> dict:
    data = await file.read()
    target = SAVE_DIR / _safe_name(file.filename)
    target.write_bytes(data)
    with open(target, "rb") as fh:
        saved_head = fh.read(16)
    row = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "client": request.client.host if request.client else None,
        "name": file.filename,
        "size": len(data),
        "received_sniff": sniff(data[:16]),
        "saved_sniff": sniff(saved_head),
        # 어느 145 인스턴스/환경변수 설정으로 저장됐는지 로그·응답만 보고도
        # 알 수 있게 남긴다(환경변수가 잘못 설정돼 out/web 기본값으로 떨어진
        # 경우를 화면에서 바로 알아챌 수 있다).
        "save_dir": str(SAVE_DIR),
    }
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row
