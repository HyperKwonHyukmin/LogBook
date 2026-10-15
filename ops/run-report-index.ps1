# 22 — 보고서 본문 색인 워커 실행(작업 스케줄러 'Logbook Report Index' 가 시작 시 한 번 부른다).
# 콘솔 출력은 backend\logs\report-index-console.log 에 덧붙인다. 색인은 backend\.report-search\index.sqlite3(서버 로컬).
#
# run-worker.ps1 과 같은 방식: 다시 띄우기는 이 스크립트가 직접 한다(작업 스케줄러의 '실패 시 다시 시작'은
# 0 이 아닌 종료 코드로는 동작하지 않는다). 워커가 끝나면 종료 코드를 남기고 60초 뒤 다시 띄운다.
# 같은 색인에 워커가 둘 뜨면 두 번째는 WorkerLock 에 막혀 바로 끝난다(그래도 60초마다 다시 시도하니 첫 워커가
# 죽으면 이어받는다).
#
# 손으로 한 번만 돌리거나 상태를 볼 때는(backend 폴더):
#   .venv\Scripts\python.exe -m app.report_index.worker --once
#   .venv\Scripts\python.exe -m app.report_index.worker --status
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Backend = Join-Path $Root 'backend'
$Python = Join-Path $Backend '.venv\Scripts\python.exe'
$LogDir = Join-Path $Backend 'logs'
$Log = Join-Path $LogDir 'report-index-console.log'
$MaxBytes = 10MB
$RestartDelaySeconds = 60

function Write-RunLog([string]$Message) {
    Add-Content -Path $Log -Encoding UTF8 -Value ("==== {0} {1} ====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Backend
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUNBUFFERED = '1'
# PowerShell 5.1 의 *>> 는 UTF-16 으로 쓰고 네이티브 stderr 를 오류로 바꾼다 — cmd 리다이렉션으로 덧붙인다
$ErrorActionPreference = 'Continue'

while ($true) {
    if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt $MaxBytes)) {
        Move-Item -Force -Path $Log -Destination "$Log.1"
    }
    Write-RunLog '보고서 색인 워커 시작'
    cmd.exe /d /c "`"$Python`" -m app.report_index.worker --loop >> `"$Log`" 2>&1"
    $code = $LASTEXITCODE
    Write-RunLog ("보고서 색인 워커 종료(코드 {0}), {1}초 뒤 다시 시작" -f $code, $RestartDelaySeconds)
    Start-Sleep -Seconds $RestartDelaySeconds
}
