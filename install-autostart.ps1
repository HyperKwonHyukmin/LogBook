# Hi-TESS LogBook Server Manager 를 사용자 '시작 프로그램' 폴더에 등록한다.
# 로그온 시 자동 실행. 비밀번호·관리자 권한·보안 정책 설정 불필요.
#
# 설치: 그대로 실행
#   .\install-autostart.ps1
#
# 제거: -Uninstall
#   .\install-autostart.ps1 -Uninstall
[CmdletBinding()]
param(
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$BatPath = Join-Path $Root 'Logbook_Server.bat'
$StartupDir = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $StartupDir 'Hi-TESS LogBook.lnk'

if ($Uninstall) {
    if (Test-Path $ShortcutPath) {
        Remove-Item -Force $ShortcutPath
        Write-Host "자동 시작 등록을 제거했습니다: $ShortcutPath"
    } else {
        Write-Host "자동 시작 등록이 없습니다(건너뜀): $ShortcutPath"
    }
    exit 0
}

if (-not (Test-Path $BatPath)) {
    throw "Logbook_Server.bat 가 없습니다: $BatPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $BatPath
$shortcut.WorkingDirectory = $Root
$shortcut.Description = 'Hi-TESS LogBook Server Manager'
$shortcut.WindowStyle = 7      # Minimized — bat 창은 숨고 안의 GUI 만 뜬다
$shortcut.Save()

Write-Host "자동 시작 등록 완료:"
Write-Host "  바로가기: $ShortcutPath"
Write-Host "  대상:     $BatPath"
Write-Host ""
Write-Host "다음 로그온 때 Hi-TESS LogBook Server Manager 창이 자동으로 뜹니다."
Write-Host "지금 바로 띄우려면 Logbook_Server.bat 를 더블클릭하세요."
Write-Host ""
Write-Host "제거: .\install-autostart.ps1 -Uninstall"
