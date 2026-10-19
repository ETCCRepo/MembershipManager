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

if (!membership_is_authenticated()) {
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

$r = membership_import_commit($body['members'], $body['rejected'] ?? [], $body['mode'] ?? 'full', (string)($body['sourceFile'] ?? 'upload.csv'), 'browser');
$p = $r['payload'];
// Browser uploads go in the Data Import sync log too, so it is the one place that lists every import.
membership_sync_log_add(['at' => gmdate('c'), 'ok' => !empty($p['ok']), 'trigger' => 'browser',
    'message' => !empty($p['ok']) ? ((string)($body['sourceFile'] ?? 'upload.csv') . ': ' . ($p['added'] ?? 0) . ' added, ' . ($p['updated'] ?? 0) . ' updated')
        : mb_substr('Upload refused: ' . ($p['error'] ?? 'import failed'), 0, 300),
    'rows' => count($body['members']), 'added' => $p['added'] ?? null, 'updated' => $p['updated'] ?? null]);
membership_json_out($r['status'], $p);
