# Stores the daily-sync token as a Windows USER environment variable (MEMBERSHIP_SYNC_TOKEN) so the scheduled
# task can use it. The token comes from the website's Developer menu -> Daily sync -> Create sync token.
# It is typed as a hidden prompt, never written to a file, and never printed.
#
#   powershell -ExecutionPolicy Bypass -File sync\set-token.ps1
$ErrorActionPreference = "Stop"
$secure = Read-Host "Paste the sync token (input is hidden)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$token = $token.Trim()
if ($token -notmatch '^mmsync_[0-9a-f]{48}$') {
  throw "That does not look like a sync token (it should start with mmsync_ and be 55 characters). Nothing was saved."
}
[Environment]::SetEnvironmentVariable("MEMBERSHIP_SYNC_TOKEN", $token, "User")
Write-Host "Saved. New terminals and the scheduled task will see MEMBERSHIP_SYNC_TOKEN."
Write-Host "Test it with:  node sync\sync-members.js --dry-run   (no upload)   then   node sync\sync-members.js"
