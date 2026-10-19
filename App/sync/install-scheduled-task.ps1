# Registers (or re-registers) the Windows scheduled task behind the member sync.
# Modeled on the CarShow app's installer. Run once per computer:
#
#   powershell -ExecutionPolicy Bypass -File sync\install-scheduled-task.ps1
#
# Switches:
#   -PollMinutes 5     how often the task asks the website whether a sync is due (default 5). The website decides:
#                      the daily time is set in Developer -> Daily sync (default 6:30 AM Eastern), and the
#                      "Sync now" button there runs one at the next check. The check is one tiny request; Chrome
#                      only starts when a sync actually runs.
#   -UserId DOMAIN\name  the account the task runs as (default: whoever runs this script). It must own the
#                      ClubExpress Chrome profile and the MEMBERSHIP_SYNC_TOKEN environment variable.
#   -Uninstall         remove the task
#
# The task runs only while that user is signed in (Interactive): on this computer the "run whether logged on or not"
# mode was refused for the sibling CarShow task. StartWhenAvailable runs it when the computer wakes if it missed a check.
[CmdletBinding()]
param(
  [int]$PollMinutes = 5,
  [string]$UserId = "$env:USERDOMAIN\$env:USERNAME",
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"

$TaskName = "membership-sync-members"
$AppDir = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $PSScriptRoot "sync-members.js"
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
  } else { Write-Host "No scheduled task named '$TaskName'." }
  return
}

# ---- preflight: fail now rather than silently every morning ---------------------------------------------------
if (-not $NodeExe) { throw "node.exe is not on PATH. Install Node.js first." }
if (-not (Test-Path $Script)) { throw "Cannot find $Script" }
if (-not (Test-Path (Join-Path $AppDir "node_modules\playwright-core"))) { throw "playwright-core is not installed. Run 'npm install' in $AppDir first." }
try {
  $sid = (New-Object System.Security.Principal.NTAccount($UserId)).Translate([System.Security.Principal.SecurityIdentifier]).Value
} catch { throw "Unknown account '$UserId'. Pass -UserId DOMAIN\name." }
$token = $null
if (Test-Path "Registry::HKEY_USERS\$sid\Environment") {
  $token = (Get-ItemProperty "Registry::HKEY_USERS\$sid\Environment" -ErrorAction SilentlyContinue).MEMBERSHIP_SYNC_TOKEN
}
if (-not $token) { throw "MEMBERSHIP_SYNC_TOKEN is not set for $UserId. Create a token in the website's Developer menu -> Daily sync, then run sync\set-token.ps1." }
$profileRoot = (Get-ItemProperty "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid" -ErrorAction SilentlyContinue).ProfileImagePath
if (-not $profileRoot -or -not (Test-Path (Join-Path $profileRoot "AppData\Local\ETCC\clubexpress-profile"))) {
  throw "No ClubExpress Chrome profile for $UserId. Run 'node sync\clubexpress-login.js' and sign in first."
}

Write-Host "node   : $NodeExe"
Write-Host "script : $Script"
Write-Host "checks : every $PollMinutes minutes as $UserId"

# conhost --headless runs node without flashing a console window on the desktop (Windows 10 1809+/11).
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -Argument "--headless `"$NodeExe`" `"$Script`" --if-due" -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes $PollMinutes)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Replaced the existing '$TaskName' task."
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Every $PollMinutes minutes: runs the ClubExpress member export and import when the website says a sync is due (daily time or Sync now)." | Out-Null

Write-Host ""
Write-Host "Registered '$TaskName'. Try it now with:"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Get-ScheduledTaskInfo -TaskName $TaskName | Select LastRunTime,LastTaskResult,NextRunTime"
Write-Host "LastTaskResult 0 = fine (including 'no changes'). Anything else: see sync\sync-members.local.log or the dashboard."
