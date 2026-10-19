<?php
// Developer menu API: unlock with the developer password, then change the
// website login password and the developer password, and read a system check.
// POST JSON only, session + CSRF protected. Only password HASHES are stored
// (data/auth.json, denied to HTTP); passwords are never logged or returned.
require __DIR__ . '/secrets.php';
require __DIR__ . '/lib.php';
membership_session_start();
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Content-Type: application/json');

function dev_out($status, $payload) {
    http_response_code($status);
    echo json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function dev_status() {
    global $SMTP;
    $auth = membership_auth_read();
    $out = ['ok' => true, 'unlocked' => membership_dev_unlocked()];
    $out['settings'] = membership_settings_read();
    if (!$out['unlocked']) return $out;
    $members = membership_read_json(membership_members_file(), []);
    $snapDir = membership_data_dir('snapshots');
    $out['system'] = [
        'phpVersion' => PHP_VERSION,
        'dataFolderWritable' => is_writable(membership_data_dir()),
        'rosterFilePresent' => is_file(membership_members_file()),
        'rosterRecords' => isset($members['members']) && is_array($members['members']) ? count($members['members']) : 0,
        'lastImport' => $members['importedAt'] ?? null,
        'snapshots' => count(glob($snapDir . '/*.json') ?: []),
        'importBatches' => count(membership_read_json(membership_import_log_file(), [])),
        'websitePasswordSource' => isset($auth['siteHash']) ? 'Developer menu' : 'secrets.php',
        'developerPasswordIsInitial' => !isset($auth['devHash']),
        'passwordsUpdatedAt' => $auth['updatedAt'] ?? null,
        'sessionIdleHours' => MEMBERSHIP_SESSION_IDLE / 3600,
        'developerIdleMinutes' => MEMBERSHIP_DEV_IDLE / 60,
        'https' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'recoveryEmail' => (is_array($SMTP ?? null) && !empty($SMTP['host'])) ? 'SMTP configured' : 'No SMTP in secrets.php (falls back to PHP mail(), may land in spam)',
    ];
    return $out;
}

if (!membership_is_authenticated()) dev_out(401, ['ok' => false, 'error' => 'Please log in first.']);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') dev_out(405, ['ok' => false, 'error' => 'Method not allowed.']);
$token = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
if (empty($_SESSION['membership_csrf']) || !hash_equals($_SESSION['membership_csrf'], $token)) {
    dev_out(403, ['ok' => false, 'error' => 'Your session expired — reload the page and try again.']);
}
$raw = file_get_contents('php://input', false, null, 0, 20000);
$body = json_decode((string)$raw, true);
if (!is_array($body)) dev_out(400, ['ok' => false, 'error' => 'Malformed request.']);
$action = (string)($body['action'] ?? '');

if ($action === 'status') {
    if (membership_dev_unlocked()) membership_dev_touch();
    dev_out(200, dev_status());
}

if ($action === 'lock') {
    unset($_SESSION['membership_dev_until']);
    dev_out(200, dev_status());
}

if ($action === 'unlock') {
    // Throttled separately from the website login: 5 wrong developer
    // passwords from one IP locks the developer menu for 15 minutes.
    $key = 'dev:' . (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $wait = membership_login_lockout_remaining($key);
    if ($wait > 0) {
        header('Retry-After: ' . $wait);
        dev_out(429, ['ok' => false, 'error' => 'Too many attempts. Try again in ' . ceil($wait / 60) . ' minute(s).']);
    }
    $ok = membership_verify_password($body['password'] ?? '', membership_dev_hash());
    membership_login_record($key, $ok);
    if (!$ok) dev_out(401, ['ok' => false, 'error' => 'Incorrect developer password.']);
    membership_dev_touch();
    dev_out(200, dev_status());
}

// Everything below needs the developer menu to be unlocked.
if (!membership_dev_unlocked()) dev_out(403, ['ok' => false, 'error' => 'The developer menu is locked. Enter the developer password.']);
membership_dev_touch();

if ($action === 'change_site_password') {
    $new = (string)($body['newPassword'] ?? '');
    $problem = membership_password_problem($new);
    if ($problem !== '') dev_out(422, ['ok' => false, 'error' => $problem]);
    $saved = membership_auth_update(['siteHash' => membership_hash_password($new)]);
    if (!$saved) dev_out(500, ['ok' => false, 'error' => 'Could not save the new password. Nothing was changed.']);
    // Every other browser is signed out; keep this one signed in.
    $_SESSION['membership_auth_version'] = (int)($saved['siteVersion'] ?? 0);
    dev_out(200, array_merge(dev_status(), ['message' => 'Website login password changed. Everyone else has been signed out.']));
}

if ($action === 'save_settings') {
    $changes = [];
    foreach (['renewalStart', 'renewalEnd'] as $k) {
        if (!isset($body[$k])) continue;
        if (!membership_valid_mmdd($body[$k])) dev_out(422, ['ok' => false, 'error' => 'Choose a valid month and day for the ' . ($k === 'renewalStart' ? 'renewal start' : 'renewal end') . ' (February 29 is not allowed).']);
        $changes[$k] = $body[$k];
    }
    if (!$changes) dev_out(422, ['ok' => false, 'error' => 'Nothing to save.']);
    $saved = membership_settings_update($changes);
    if (!$saved) dev_out(500, ['ok' => false, 'error' => 'Could not save the settings. Nothing was changed.']);
    dev_out(200, array_merge(dev_status(), ['message' => 'Renewal dates saved. Everyone sees them on their next page load.']));
}

if ($action === 'change_dev_password') {
    // Re-check the current developer password even though the menu is unlocked.
    if (!membership_verify_password($body['currentPassword'] ?? '', membership_dev_hash())) {
        dev_out(401, ['ok' => false, 'error' => 'The current developer password is incorrect.']);
    }
    $new = (string)($body['newPassword'] ?? '');
    $problem = membership_password_problem($new);
    if ($problem !== '') dev_out(422, ['ok' => false, 'error' => $problem]);
    $saved = membership_auth_update(['devHash' => membership_hash_password($new)]);
    if (!$saved) dev_out(500, ['ok' => false, 'error' => 'Could not save the new password. Nothing was changed.']);
    dev_out(200, array_merge(dev_status(), ['message' => 'Developer password changed.']));
}

dev_out(400, ['ok' => false, 'error' => 'Unknown request.']);
