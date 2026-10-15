@echo off
rem Hi-TESS LogBook 서버 - API(9095)와 워커를 각각 다른 창에 띄운다.
rem 각 창의 PowerShell(ops\run-*.ps1)이 while 루프로 60초마다 다시 띄우므로
rem 이 bat 자체에는 재시작 로직이 없다. 창을 닫으면 그 서비스만 끝난다.
rem 재부팅 뒤 무인 자동 기동이 필요하면 ops\install-tasks.ps1 로 작업 스케줄러에 등록한다.

cd /d "%~dp0"
set PYTHON=%~dp0backend\.venv\Scripts\python.exe

if not exist "%PYTHON%" (
    echo [X] 가상환경이 없습니다: %PYTHON%
    echo     backend 폴더에서 다음을 실행해 만드세요:
    echo       cd backend
    echo       py -3.11 -m venv .venv
    echo       .venv\Scripts\python.exe -m pip install -r requirements.txt
    pause
    exit /b 1
)

if not exist "%~dp0backend\.env" (
    echo [X] backend\.env 가 없습니다.
    echo     backend\.env.example 을 복사해 값을 채운 뒤 다시 실행하세요.
    pause
    exit /b 1
)

echo.
echo === Hi-TESS LogBook ===
echo   API:     http://localhost:9095  ^(팀원 접속: http://10.14.42.145:9095^)
echo   로그:    backend\logs\api.log, worker-console.log
echo   창 2개가 뜹니다. 창을 닫으면 그 서비스가 끝납니다.
echo.

start "Logbook API"    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\run-api.ps1"
start "Logbook Worker" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\run-worker.ps1"

rem 보고서 본문 색인(README 13절, 선택). 쓰려면 아래 한 줄 주석 해제:
rem start "Logbook ReportIndex" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\run-report-index.ps1"

echo [OK] 두 창을 띄웠습니다.
timeout /t 5 >nul
