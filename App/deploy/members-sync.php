<?php
// Daily-sync endpoint, called by the scheduled task on the club's computer (App/sync/sync-members.js),
// not by a browser. It carries the full roster parsed from the ClubExpress "Additional Member Data"
// export, or a failure report, authenticated with a sync token generated in the Developer menu
// (header X-Sync-Token; only the token's SHA-256 hash is stored here).
//
//   POST JSON { members: [...], rejected: [...], sourceFile }   apply the roster as a full import
//   POST JSON { status: "failed", error: "..." }                record that the sync could not run
//   POST JSON { status: "poll" }                                 "Sync now" pressed? -> { requested: true } once
//
// A full import that is identical to the current roster writes nothing (no new snapshot or log row);
// one smaller than half the current roster is refused as a probable truncated export.
require __DIR__ . '/lib.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Content-Type: application/json');

function sync_out($status, $payload) {
    http_response_code($status);
    echo json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') sync_out(405, ['ok' => false, 'error' => 'Method not allowed.']);

$token = (string)($_SERVER['HTTP_X_SYNC_TOKEN'] ?? '');
if ($token === '') {
    $h = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''));
    if (stripos($h, 'Bearer ') === 0) $token = trim(substr($h, 7));
}

// Same lockout idea as the login: 5 wrong tokens from one address blocks it for 15 minutes.
$key = 'sync:' . (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
$wait = membership_login_lockout_remaining($key);
if ($wait > 0) {
    header('Retry-After: ' . $wait);
    sync_out(429, ['ok' => false, 'error' => 'Too many attempts.']);
}
$authorized = membership_sync_token_ok($token);
membership_login_record($key, $authorized);
if (!$authorized) sync_out(401, ['ok' => false, 'error' => 'Invalid or missing sync token.']);

$raw = file_get_contents('php://input', false, null, 0, 40 * 1024 * 1024 + 1);
if ($raw === false || strlen($raw) > 40 * 1024 * 1024) sync_out(413, ['ok' => false, 'error' => 'That payload is too large.']);
$body = json_decode($raw, true);
if (!is_array($body)) sync_out(400, ['ok' => false, 'error' => 'Malformed request.']);

// The small poll task on the club's computer asks whether "Sync now" was pressed; the first poll after a press claims it.
if (($body['status'] ?? '') === 'poll') {
    $trig = membership_sync_claim();
    sync_out(200, ['ok' => true, 'requested' => $trig !== false, 'trigger' => $trig]);
}

// The task could not produce an export (ClubExpress signed out, page changed...): show it on the site.
if (($body['status'] ?? '') === 'failed') {
    membership_sync_status_write(false, 'Daily sync failed: ' . membership_clean_str($body['error'] ?? 'unknown error'));
    sync_out(200, ['ok' => true, 'recorded' => 'failure']);
}

$r = membership_import_commit($body['members'] ?? null, $body['rejected'] ?? [], 'full', (string)($body['sourceFile'] ?? 'daily-sync.csv'), 'scheduled',
    ['minRosterFraction' => 0.5, 'skipIfUnchanged' => true]);
$p = $r['payload'];
if (!empty($p['ok'])) {
    $msg = $p['changed'] ? ($p['added'] . ' added, ' . $p['updated'] . ' updated, ' . $p['notInFile'] . ' no longer in the export') : 'No changes since the last sync';
    membership_sync_status_write(true, $msg, ['changed' => $p['changed'], 'rows' => count($body['members']), 'added' => $p['added'], 'updated' => $p['updated'], 'notInFile' => $p['notInFile'], 'rejected' => $p['rejected']]);
} else {
    membership_sync_status_write(false, 'Daily sync refused: ' . ($p['error'] ?? 'import failed'));
}
sync_out($r['status'], $p);
