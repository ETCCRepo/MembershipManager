# Registers (or re-registers) the Windows scheduled task that runs the daily member sync.
# Modeled on the CarShow app's installer. Run once per computer:
#
#   powershell -ExecutionPolicy Bypass -File sync\install-scheduled-task.ps1
#
# Switches:
#   -Time "06:30"      time of day to run (default 6:30 AM)
#   -UserId DOMAIN\name  the account the task runs as (default: whoever runs this script). It must own the
#                      ClubExpress Chrome profile and the MEMBERSHIP_SYNC_TOKEN environment variable.
#   -Uninstall         remove the task
#
# The task runs only while that user is signed in (Interactive): on this computer the "run whether logged on or not"
# mode was refused for the sibling CarShow task. StartWhenAvailable runs it when the computer wakes if it missed 6:30.
[CmdletBinding()]
param(
  [string]$Time = "06:30",
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
Write-Host "daily  : $Time as $UserId"

# conhost --headless runs node without flashing a console window on the desktop (Windows 10 1809+/11).
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -Argument "--headless `"$NodeExe`" `"$Script`"" -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Replaced the existing '$TaskName' task."
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Daily: exports the ClubExpress Additional Member Data report and imports it into the Membership Manager website." | Out-Null

Write-Host ""
Write-Host "Registered '$TaskName'. Try it now with:"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Get-ScheduledTaskInfo -TaskName $TaskName | Select LastRunTime,LastTaskResult,NextRunTime"
Write-Host "LastTaskResult 0 = fine (including 'no changes'). Anything else: see sync\sync-members.local.log or the dashboard."
