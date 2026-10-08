<?php
// The login gate and the live data-stitching template, same design as the
// CarShow app's index.php: serves _login.html until the PHP session is
// authenticated, then reads app-bundle.html (a copy of the built
// App/ETCCMembership.html, uploaded by ftp-deploy.sh) and injects the
// current members-data.json and import log as an inline boot script. A new
// member import is live on the next page load with no rebuild or redeploy.
session_start();
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// $PASSWORD_HASH comes from secrets.php (gitignored — see secrets.example.php).
require __DIR__ . '/secrets.php';
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'login') {
    header('Content-Type: application/json');
    $pw = (string)($_POST['password'] ?? '');
    $ok = $pw !== '' && !empty($PASSWORD_HASH) && hash_equals($PASSWORD_HASH, crypt($pw, $PASSWORD_HASH));
    if ($ok) {
        session_regenerate_id(true);
        $_SESSION['membership_authenticated'] = true;
        echo json_encode(['success' => true]);
    } else {
        http_response_code(401);
        echo json_encode(['success' => false]);
    }
    exit;
}

if (empty($_SESSION['membership_authenticated'])) {
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

$siteConfig = ['importUrl' => 'members-import.php', 'logoutUrl' => 'logout.php'];
$siteConfigScript = "<script>window.__membershipSite = " . membership_safe_inline_json($siteConfig) . ";</script>\n";
$bundle = str_replace('<head>', "<head>\n" . $siteConfigScript, $bundle);

$bootScript = "\n<script>\n(function(){\n  function boot(){\n" .
    "    window.__membership.ingestMembers(" . membership_safe_inline_json($members) . ", " .
    membership_safe_inline_json($data['importedAt'] ?? null) . ");\n" .
    "    window.__membership.ingestImportLog(" . membership_safe_inline_json($importLog) . ");\n" .
    "  }\n  if (document.readyState === \"loading\") document.addEventListener(\"DOMContentLoaded\", boot);\n  else boot();\n})();\n</script>\n";
$bundle = str_replace('</body>', $bootScript . '</body>', $bundle);

echo $bundle;
