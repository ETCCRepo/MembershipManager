<?php
// Officer-only page to import the ETCC membership export (CSV) into
// members-data.json (gitignored, contains member PII, blocked from direct
// HTTP access by .htaccess). Each import REPLACES the stored roster with the
// file's contents, same as the CarShow app's members-import.php.
//
// Columns are matched by name, ignoring case/spaces/underscores/hyphens/
// periods (see membership_field_aliases() in lib.php). Only First Name and
// Last Name are required. Join Date drives the Reports tab's Monthly
// Membership Report. Every column in the file, recognized or not, is kept
// under its original header and shown on the member's detail view.
//
// Gated by the same PHP session as index.php.
session_start();
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

require __DIR__ . '/secrets.php';
require __DIR__ . '/lib.php';

date_default_timezone_set('America/New_York');

if (empty($_SESSION['membership_authenticated'])) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><body style="font:15px sans-serif;padding:40px;text-align:center">' .
        '<p>Please <a href="index.php">log in</a> first.</p></body>';
    exit;
}

if (empty($_SESSION['membership_csrf'])) $_SESSION['membership_csrf'] = bin2hex(random_bytes(16));
$csrf = $_SESSION['membership_csrf'];

$MAX_BYTES = 5 * 1024 * 1024;
$errors = [];
$result = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $file = $_FILES['members_csv'] ?? null;
    if (!hash_equals($csrf, (string)($_POST['csrf'] ?? ''))) {
        $errors[] = 'Your session expired — reload this page and try again.';
    } elseif (!$file || $file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        $errors[] = 'Upload failed — choose a CSV file and try again.';
    } elseif ($file['size'] > $MAX_BYTES) {
        $errors[] = 'That file is larger than 5 MB — is it the right export?';
    } else {
        $parsed = membership_parse_csv($file['tmp_name']);
        if (!$parsed['ok']) {
            $errors[] = $parsed['error'];
        } else {
            $now = gmdate('c');
            $saved = membership_write_json(membership_members_file(), [
                'importedAt' => $now,
                'sourceFile' => basename((string)$file['name']),
                'columns' => $parsed['columns'],
                'members' => $parsed['members'],
            ]);
            if ($saved) {
                $withJoin = count(array_filter($parsed['members'], function ($m) { return $m['joinDate'] !== ''; }));
                membership_append_json_list(membership_import_log_file(), [
                    'timestamp' => $now,
                    'count' => count($parsed['members']),
                    'withJoinDate' => $withJoin,
                    'sourceFile' => basename((string)$file['name']),
                ]);
                $result = ['count' => count($parsed['members']), 'withJoin' => $withJoin, 'found' => $parsed['found']];
            } else {
                $errors[] = 'Could not save the member list — please try again.';
            }
        }
    }
}

$current = membership_read_json(membership_members_file(), []);
$currentCount = isset($current['members']) && is_array($current['members']) ? count($current['members']) : 0;
$importLog = array_reverse(membership_read_json(membership_import_log_file(), []));
$h = function ($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ETCC Membership — Import Members</title>
<link rel="icon" type="image/png" href="ETCClogoWhiteBackground.png">
<style>
  :root { --red:#b0141e; --red-dark:#7d0e15; --ink:#1a1a1a; --muted:#667085; --line:#e3e6ea; --bg:#f4f6f8; --panel:#fff; --good:#147d3a; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 "Segoe UI", Arial, sans-serif; color: var(--ink); background: var(--bg); margin:0; padding: 28px 16px 60px; }
  .wrap { max-width: 600px; margin: 0 auto; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 2px; }
  .sub { text-align:center; color:var(--muted); font-size:13px; margin-bottom:22px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 22px 24px; }
  .form-row { margin: 14px 0; }
  label { display:block; font-weight:600; font-size:13px; margin-bottom:4px; }
  input[type=file] { width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:7px; font-size:14px; font-family:inherit; background:#fff; }
  .btn { background: var(--red); border: 1px solid var(--red-dark); color:#fff; padding: 11px 18px; border-radius:8px; font-size:15px; font-weight:700; cursor:pointer; width:100%; margin-top:6px; }
  .btn:hover { background: var(--red-dark); }
  .errors { background:#fff5f5; border-left:4px solid var(--red); border-radius:6px; padding:10px 14px; margin-bottom:14px; color:var(--red-dark); font-size:13px; }
  .errors ul { margin:4px 0 0; padding-left:18px; }
  .success { background:#f2fbf5; border:1px solid #bfe2c9; border-radius:8px; padding:12px 14px; margin-bottom:14px; color: var(--good); font-weight:600; font-size:14px; }
  .count { color: var(--muted); font-size:13px; margin-bottom: 14px; }
  .help { color: var(--muted); font-size:12px; margin-top: 14px; }
  .help code { background:#f2f4f7; padding:1px 4px; border-radius:4px; }
  .back { display:block; text-align:center; margin-top:18px; color: var(--muted); font-size:13px; }
  .import-log { margin-top:18px; padding-top:14px; border-top:1px solid var(--line); }
  .import-log h2 { font-size:14px; margin:0 0 8px; }
  .import-log table { width:100%; border-collapse:collapse; font-size:13px; }
  .import-log th, .import-log td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--line); }
  .import-log th { color:var(--muted); font-weight:600; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Import ETCC Membership Data</h1>
  <div class="sub">Loads the roster shown on the Membership tab and used by the Reports tab</div>
  <div class="panel">
    <?php if ($result !== null): ?>
      <div class="success">
        Imported <?php echo (int)$result['count']; ?> member<?php echo $result['count'] === 1 ? '' : 's'; ?>
        (<?php echo (int)$result['withJoin']; ?> with a join date).
        Recognized: <?php echo $h(implode(', ', $result['found'])); ?>.
      </div>
    <?php endif; ?>
    <?php if ($errors): ?>
      <div class="errors"><strong>Please fix the following:</strong><ul>
        <?php foreach ($errors as $e) echo '<li>' . $h($e) . '</li>'; ?>
      </ul></div>
    <?php endif; ?>
    <div class="count">Current roster: <strong><?php echo $currentCount; ?></strong> member<?php echo $currentCount === 1 ? '' : 's'; ?>. A new import replaces it.</div>
    <form method="post" enctype="multipart/form-data">
      <input type="hidden" name="csrf" value="<?php echo $h($csrf); ?>">
      <div class="form-row">
        <label for="f-csv">Membership CSV</label>
        <input type="file" id="f-csv" name="members_csv" accept=".csv,text/csv" required>
      </div>
      <button type="submit" class="btn">Import</button>
    </form>
    <div class="help">
      Needs <code>First Name</code> and <code>Last Name</code> columns. Also recognized:
      Member Number, Spouse First Name, Email, Phone, Address, City, State, Zip,
      Membership Type, Status, <strong>Join Date</strong> (used by the Monthly Membership Report),
      Expiration Date, and Corvette Year/Model/Color. Any other columns are kept too and shown on each member's details.
    </div>
  </div>
  <?php if ($importLog): ?>
    <div class="import-log">
      <h2>Import Log</h2>
      <table>
        <thead><tr><th>Imported</th><th>File</th><th>Members</th></tr></thead>
        <tbody>
          <?php foreach ($importLog as $entry): ?>
            <tr>
              <td><?php echo $h(date('n/j/Y g:i A', strtotime((string)($entry['timestamp'] ?? '')))); ?></td>
              <td><?php echo $h($entry['sourceFile'] ?? ''); ?></td>
              <td><?php echo (int)($entry['count'] ?? 0); ?></td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  <?php endif; ?>
  <a class="back" href="index.php">&larr; Back to the app</a>
</div>
</body>
</html>
