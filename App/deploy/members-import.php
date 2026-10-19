<?php
// Officer-only import API. The browser parses and previews the ClubExpress
// CSV (App/src/csvimport.js); once the officer confirms, it POSTs the cleaned
// records here as JSON. This script re-validates every record, applies the
// import to members-data.json (gitignored PII, denied to HTTP by .htaccess),
// writes a dated snapshot for history reports, and logs the batch.
//
//   POST (JSON, X-CSRF-Token header)  commit an import
//   GET  ?download=rejected&batch=ID  CSV of the rows that were rejected
//
// Gated by the same PHP session as index.php. No raw CSV is ever stored.
require __DIR__ . '/lib.php';
membership_session_start();
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

function membership_json_out($status, $payload) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if (empty($_SESSION['membership_authenticated'])) {
    membership_json_out(401, ['ok' => false, 'error' => 'Please log in first.']);
}

// ---- download of rejected rows ------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (($_GET['download'] ?? '') !== 'rejected' || !preg_match('/^\d{14}$/', (string)($_GET['batch'] ?? ''))) {
        membership_json_out(400, ['ok' => false, 'error' => 'Unknown request.']);
    }
    $file = membership_data_dir('batches') . '/' . $_GET['batch'] . '-rejected.json';
    $rows = membership_read_json($file, null);
    if ($rows === null) membership_json_out(404, ['ok' => false, 'error' => 'No rejected-row file for that import.']);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="import-' . $_GET['batch'] . '-rejected-rows.csv"');
    echo "\xEF\xBB\xBF" . implode(',', array_map('membership_csv_cell', ['Row', 'Reason', 'Original values'])) . "\r\n";
    foreach ($rows as $r) {
        echo implode(',', array_map('membership_csv_cell', [$r['rowNumber'] ?? '', $r['reason'] ?? '', $r['values'] ?? ''])) . "\r\n";
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') membership_json_out(405, ['ok' => false, 'error' => 'Method not allowed.']);

$token = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
if (empty($_SESSION['membership_csrf']) || !hash_equals($_SESSION['membership_csrf'], $token)) {
    membership_json_out(403, ['ok' => false, 'error' => 'Your session expired — reload the page and try again.']);
}
$raw = file_get_contents('php://input', false, null, 0, 40 * 1024 * 1024 + 1);
if ($raw === false || strlen($raw) > 40 * 1024 * 1024) membership_json_out(413, ['ok' => false, 'error' => 'That import is too large.']);
$body = json_decode($raw, true);
if (!is_array($body) || !is_array($body['members'] ?? null)) membership_json_out(400, ['ok' => false, 'error' => 'Malformed import.']);

$mode = ($body['mode'] ?? '') === 'partial' ? 'partial' : 'full';
if (count($body['members']) > MEMBERSHIP_MAX_MEMBERS) membership_json_out(413, ['ok' => false, 'error' => 'Too many rows for a membership export.']);

$incoming = [];
$rejected = [];
$seenKeys = [];
foreach ($body['members'] as $i => $m) {
    $v = membership_validate_member($m);
    if (is_string($v)) { $rejected[] = ['rowNumber' => $i + 2, 'reason' => $v, 'values' => '']; continue; }
    if (isset($seenKeys[$v['key']])) { $rejected[] = ['rowNumber' => $i + 2, 'reason' => 'Duplicate record key.', 'values' => '']; continue; }
    $seenKeys[$v['key']] = true;
    $incoming[] = $v;
}
// Rows the browser rejected (kept so the officer can download them later).
foreach ((is_array($body['rejected'] ?? null) ? array_slice($body['rejected'], 0, 5000) : []) as $r) {
    $vals = is_array($r['row'] ?? null) ? implode(' | ', array_map('membership_clean_str', array_slice($r['row'], 0, 60))) : '';
    $rejected[] = ['rowNumber' => (int)($r['rowNumber'] ?? 0), 'reason' => membership_clean_str($r['reason'] ?? ''), 'values' => $vals];
}
if (!$incoming) membership_json_out(422, ['ok' => false, 'error' => 'No valid member rows to import.']);

date_default_timezone_set('America/New_York');
$sourceFile = basename(membership_clean_str($body['sourceFile'] ?? 'upload.csv'));
$id = date('YmdHis');

$result = membership_with_lock(membership_members_file(), function () use ($incoming, $mode, $sourceFile, $id, $rejected) {
    $data = membership_read_json(membership_members_file(), []);
    $current = isset($data['members']) && is_array($data['members']) ? $data['members'] : [];
    $applied = membership_apply_import($current, $incoming, $mode);
    $now = gmdate('c');
    $saved = membership_write_json(membership_members_file(), [
        'importedAt' => $now,
        'sourceFile' => $sourceFile,
        'members' => $applied['roster'],
    ]);
    if (!$saved) return false;
    $summary = membership_snapshot_summary($applied['roster'], $id, $mode, $sourceFile, $applied, count($rejected));
    // Only a FULL file is a snapshot of the whole club; a partial file is
    // logged as a batch but never becomes a point on a history chart.
    if ($mode === 'full') membership_write_json(membership_data_dir('snapshots') . '/' . $id . '.json', $summary);
    if ($rejected) membership_write_json(membership_data_dir('batches') . '/' . $id . '-rejected.json', $rejected);
    membership_append_json_list(membership_import_log_file(), [
        'id' => $id, 'timestamp' => $now, 'mode' => $mode, 'sourceFile' => $sourceFile,
        'count' => count($incoming), 'added' => $applied['added'], 'updated' => $applied['updated'],
        'unchanged' => $applied['unchanged'], 'notInFile' => $applied['notInFile'], 'rejected' => count($rejected),
        'rosterSize' => count($applied['roster']),
    ]);
    return $applied + ['summary' => $summary];
});

if (!$result) membership_json_out(500, ['ok' => false, 'error' => 'Could not save the member list — please try again.']);
unset($result['roster'], $result['summary']['keys']);
membership_json_out(200, ['ok' => true, 'batch' => $id, 'mode' => $mode, 'added' => $result['added'], 'updated' => $result['updated'],
    'unchanged' => $result['unchanged'], 'notInFile' => $result['notInFile'], 'rejected' => count($rejected), 'summary' => $result['summary']]);
