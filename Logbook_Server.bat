@echo off
rem Hi-TESS LogBook Server Manager - GUI 하나가 API(9095) + Worker 두 자식을 품는다.
rem   · 좀비 감지(API 3분 무응답 → 강제 재시작)
rem   · 크래시 자동 재시작(지수 백오프)
rem   · 수동 Start/Stop/Update 버튼
rem   · 중복 실행 방지(PID 파일)
rem   · 로그온 자동 시작은 install-autostart.ps1 로 등록

cd /d "%~dp0"
set PYTHON=%~dp0backend\.venv\Scripts\python.exe

if not exist "%PYTHON%" (
    echo [X] 가상환경이 없습니다: %PYTHON%
    echo     backend 폴더에서 python -m venv .venv 로 만든 뒤
    echo     .venv\Scripts\python.exe -m pip install -r requirements.txt 를 실행하세요.
    pause
    exit /b 1
)

if not exist "%~dp0backend\.env" (
    echo [X] backend\.env 가 없습니다.
    echo     backend\.env.example 을 복사해 값을 채운 뒤 다시 실행하세요.
    pause
    exit /b 1
)

cd backend
"%PYTHON%" server_manager.py
