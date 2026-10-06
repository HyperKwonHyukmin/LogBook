<#
.SYNOPSIS
  Logbook API·워커를 Windows 작업 스케줄러에 등록한다(145 서버용).

.DESCRIPTION
  - 작업 'Logbook API'·'Logbook Worker' 를 "시작 시 실행(30초 지연)" 으로 등록한다. 프로세스가 끝나면
    run-*.ps1 이 스스로 60초 뒤 다시 띄운다(작업 스케줄러의 재시작은 종료 코드로는 동작하지 않는다).
  - 공유 폴더 권한이 있는 도메인 계정으로 돌린다(SYSTEM 은 공유 폴더를 못 읽는다).
    그 계정에는 '일괄 작업으로 로그온'(SeBatchLogonRight) 권한이 있어야 한다.
  - 비밀번호는 PowerShell 을 거치지 않는다. 작업 정의(XML)를 만들어 schtasks.exe /Create /RP * 로 넘기면
    schtasks 가 직접 입력 창으로 묻는다. 변수·명령줄·PowerShell 로그(스크립트 블록 로깅)에 남지 않는다.
  - 방화벽 9095 인바운드 규칙(도메인·개인 프로필)이 없으면 만든다.
  - 관리자 권한 PowerShell 에서 실행한다.

.EXAMPLE
  .\install-tasks.ps1 -User HHI\a476854 -WhatIf     # 할 일만 보여 준다(등록하지 않는다)
  .\install-tasks.ps1 -User HHI\a476854             # 등록(작업마다 비밀번호를 묻는다)
  .\install-tasks.ps1 -Uninstall                    # 두 작업을 지운다
#>
[CmdletBinding()]
param(
    [string]$User,
    [switch]$WhatIf,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Tasks = @(
    @{ Name = 'Logbook API';    Script = (Join-Path $PSScriptRoot 'run-api.ps1') },
    @{ Name = 'Logbook Worker'; Script = (Join-Path $PSScriptRoot 'run-worker.ps1') }
)
$FirewallName = 'Logbook 9095'
$FirewallProfiles = 'Domain,Private'

function Get-TaskXml([string]$Name, [string]$Script, [string]$Account) {
    $esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$Script`""
    return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>$(& $esc "Logbook - $Name (ops\install-tasks.ps1 가 등록)")</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(& $esc $Account)</UserId>
      <LogonType>Password</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>$(& $esc $arguments)</Arguments>
      <WorkingDirectory>$(& $esc $Root)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
}

if ($Uninstall) {
    foreach ($t in $Tasks) {
        if ($WhatIf) {
            Write-Host "[WhatIf] 작업 '$($t.Name)' 를 멈추고 지웁니다."
            continue
        }
        if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
            Write-Host "작업 '$($t.Name)' 를 지웠습니다."
        } else {
            Write-Host "작업 '$($t.Name)' 가 없습니다(건너뜀)."
        }
    }
    Write-Host "남은 python 프로세스가 있으면 끝내세요(README 9 참고)."
    Write-Host "방화벽 규칙 '$FirewallName' 은 그대로 둡니다(필요하면 Remove-NetFirewallRule -DisplayName '$FirewallName')."
    exit 0
}

if (-not $User) {
    throw "-User <도메인\계정> 이 필요합니다. 공유 폴더 권한이 있는 계정을 지정하세요."
}
foreach ($t in $Tasks) {
    if (-not (Test-Path $t.Script)) { throw "스크립트가 없습니다: $($t.Script)" }
}

foreach ($t in $Tasks) {
    $xml = Get-TaskXml $t.Name $t.Script $User
    $null = [xml]$xml   # 형식 검사(깨진 XML 이면 여기서 멈춘다)
    if ($WhatIf) {
        Write-Host "[WhatIf] 작업 '$($t.Name)' 등록"
        Write-Host "         동작: powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$($t.Script)`""
        Write-Host "         트리거: 시작 시 + 30초 지연 / 실행 시간 제한 없음 / 중복 실행 무시 / 다시 띄우기는 스크립트 안 루프(60초)"
        Write-Host "         계정: $User (로그온 여부와 관계없이 실행, 가장 높은 권한, '일괄 작업으로 로그온' 권한 필요)"
        Write-Host "         명령: schtasks.exe /Create /TN `"$($t.Name)`" /XML <임시 XML> /RU $User /RP * /F  (비밀번호는 schtasks 가 직접 묻는다)"
        continue
    }
    $xmlPath = Join-Path ([IO.Path]::GetTempPath()) ("logbook-task-{0}.xml" -f [guid]::NewGuid())
    try {
        # 작업 스케줄러 XML 은 UTF-16 이어야 한다
        [IO.File]::WriteAllText($xmlPath, $xml, [Text.Encoding]::Unicode)
        Write-Host "작업 '$($t.Name)' 등록: $User 의 비밀번호를 입력하세요(화면에 보이지 않습니다)."
        & schtasks.exe /Create /TN $t.Name /XML $xmlPath /RU $User /RP '*' /F
        if ($LASTEXITCODE -ne 0) { throw "schtasks 등록 실패(작업 '$($t.Name)', 종료 코드 $LASTEXITCODE)" }
    } finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $xmlPath
    }
}

$exists = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
if ($WhatIf) {
    if ($exists) {
        Write-Host "[WhatIf] 방화벽 규칙 '$FirewallName' 이 이미 있어 건너뜁니다."
    } else {
        Write-Host "[WhatIf] 방화벽 규칙 '$FirewallName'(TCP 9095 인바운드 허용, 프로필 $FirewallProfiles)을 만듭니다."
    }
    Write-Host "[WhatIf] 실제로 등록하지 않았습니다. 저장소 루트: $Root"
    exit 0
}
if ($exists) {
    Write-Host "방화벽 규칙 '$FirewallName' 이 이미 있습니다(건너뜀)."
} else {
    New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Protocol TCP -LocalPort 9095 `
        -Action Allow -Profile Domain, Private | Out-Null
    Write-Host "방화벽 규칙 '$FirewallName'(프로필 $FirewallProfiles)을 만들었습니다."
}
Write-Host "지금 시작하려면: Start-ScheduledTask -TaskName 'Logbook API'; Start-ScheduledTask -TaskName 'Logbook Worker'"
