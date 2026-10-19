<?php
// The login gate and the live data-stitching template, same design as the
// CarShow app's index.php: serves _login.html until the PHP session is
// authenticated, then reads app-bundle.html (a copy of the built
// App/ETCCMembership.html, uploaded by ftp-deploy.sh) and injects the
// current members-data.json and import log as an inline boot script. A new
// member import is live on the next page load with no rebuild or redeploy.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// $PASSWORD_HASH comes from secrets.php (gitignored — see secrets.example.php).
require __DIR__ . '/secrets.php';
require __DIR__ . '/lib.php';
membership_session_start();

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'login') {
    header('Content-Type: application/json');
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $wait = membership_login_lockout_remaining($ip);
    if ($wait > 0) {
        http_response_code(429);
        header('Retry-After: ' . $wait);
        echo json_encode(['success' => false, 'locked' => true, 'retryAfter' => $wait]);
        exit;
    }
    $pw = (string)($_POST['password'] ?? '');
    $ok = membership_verify_password($pw, membership_site_hash());
    membership_login_record($ip, $ok);
    if ($ok) {
        membership_login_success();
        echo json_encode(['success' => true]);
    } else {
        http_response_code(401);
        echo json_encode(['success' => false]);
    }
    exit;
}

if (!membership_is_authenticated()) {
    readfile(__DIR__ . '/_login.html');
    exit;
}

header('Content-Type: text/html; charset=utf-8');

$bundle = @file_get_contents(__DIR__ . '/app-bundle.html');
if ($bundle === false) {
    http_response_code(500);
    echo 'app-bundle.html is missing on the server — run deploy/ftp-deploy.sh (after node build.js) to upload it.';
    exit;
}

$data = membership_read_json(membership_members_file(), []);
$members = isset($data['members']) && is_array($data['members']) ? $data['members'] : [];
$importLog = array_reverse(membership_read_json(membership_import_log_file(), []));

$siteConfig = ['importUrl' => 'members-import.php', 'logoutUrl' => 'logout.php', 'developerUrl' => 'developer.php', 'csrf' => membership_csrf_token()];
$siteConfigScript = "<script>window.__membershipSite = " . membership_safe_inline_json($siteConfig) . ";</script>\n";
$bundle = str_replace('<head>', "<head>\n" . $siteConfigScript, $bundle);

$bootScript = "\n<script>\n(function(){\n  function boot(){\n" .
    "    window.__membership.ingestMembers(" . membership_safe_inline_json($members) . ", " .
    membership_safe_inline_json($data['importedAt'] ?? null) . ");\n" .
    "    window.__membership.ingestImportLog(" . membership_safe_inline_json($importLog) . ");\n" .
    "    window.__membership.ingestSnapshots(" . membership_safe_inline_json(membership_snapshots()) . ");\n" .
    "    window.__membership.ingestSettings(" . membership_safe_inline_json(membership_settings_read()) . ");\n" .
    "  }\n  if (document.readyState === \"loading\") document.addEventListener(\"DOMContentLoaded\", boot);\n  else boot();\n})();\n</script>\n";
$bundle = str_replace('</body>', $bootScript . '</body>', $bundle);

echo $bundle;
