# Logbook 워커 실행(작업 스케줄러가 시작 시 한 번 부른다). 콘솔 출력은 backend\logs\worker-console.log 에 덧붙인다.
# 워커 자체 로그는 공유 폴더 90_System\logs\worker.log 에 따로 쓴다.
#
# 다시 띄우기는 이 스크립트가 직접 한다 — 작업 스케줄러의 '실패 시 다시 시작'은 작업이 0 이 아닌 종료 코드로
# 끝났다고 다시 띄우지 않는다. 워커가 끝나면 종료 코드를 로그에 남기고 60초 뒤 다시 띄운다.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Backend = Join-Path $Root 'backend'
$Python = Join-Path $Backend '.venv\Scripts\python.exe'
$LogDir = Join-Path $Backend 'logs'
$Log = Join-Path $LogDir 'worker-console.log'
$MaxBytes = 10MB
$RestartDelaySeconds = 60

function Write-RunLog([string]$Message) {
    Add-Content -Path $Log -Encoding UTF8 -Value ("==== {0} {1} ====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Backend
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUNBUFFERED = '1'   # 로그가 버퍼에 묶여 있다가 죽을 때 사라지지 않게
# PowerShell 5.1 의 *>> 는 UTF-16 으로 쓰고, 네이티브 stderr 를 오류로 바꿔 'Stop' 에서 멈춘다 —
# cmd 의 리다이렉션으로 바이트 그대로 덧붙인다.
$ErrorActionPreference = 'Continue'

while ($true) {
    # 다시 띄울 때마다 크기를 본다 — 10MB 를 넘으면 worker-console.log.1 로 바꾼다(한 세대만 둔다)
    if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt $MaxBytes)) {
        Move-Item -Force -Path $Log -Destination "$Log.1"
    }
    Write-RunLog '워커 시작'
    cmd.exe /d /c "`"$Python`" -m app.worker >> `"$Log`" 2>&1"
    $code = $LASTEXITCODE
    Write-RunLog ("워커 종료(코드 {0}), {1}초 뒤 다시 시작" -f $code, $RestartDelaySeconds)
    Start-Sleep -Seconds $RestartDelaySeconds
}
