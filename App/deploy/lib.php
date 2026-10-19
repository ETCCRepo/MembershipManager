<?php
// Shared helpers for index.php, members-import.php and member-import-history.php.
// Same patterns as the CarShow app's lib.php: lock-guarded JSON read/write and
// safe inline-<script> JSON encoding, plus the membership CSV parser.

function membership_members_file() {
    return __DIR__ . '/members-data.json';
}

function membership_import_log_file() {
    return __DIR__ . '/member-import-history.json';
}

function membership_read_json($file, $default = []) {
    if (!is_file($file)) return $default;
    $raw = file_get_contents($file);
    $decoded = $raw ? json_decode($raw, true) : null;
    return is_array($decoded) ? $decoded : $default;
}

// Atomic replace: encode first (nothing is touched if that fails), write a
// temp file next to the target, then rename() over it. Readers see either
// the old file or the new one, never an empty or half-written one. Temp
// names end in .json so .htaccess blocks them too.
function membership_write_json($file, $value) {
    $json = json_encode($value, JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) return false;
    $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp.json';
    if (file_put_contents($tmp, $json) !== strlen($json) || !rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

// Runs $fn while holding an exclusive lock on a sidecar lock file, so
// read-modify-write cycles on $file don't interleave.
function membership_with_lock($file, $fn) {
    $fh = fopen(preg_replace('/\.json$/', '', $file) . '.lock.json', 'c');
    if (!$fh || !flock($fh, LOCK_EX)) {
        if ($fh) fclose($fh);
        return false;
    }
    try {
        return $fn();
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

function membership_append_json_list($file, $record) {
    return membership_with_lock($file, function () use ($file, $record) {
        $list = membership_read_json($file, []);
        $list[] = $record;
        return membership_write_json($file, $list);
    });
}

// ---- Login throttling: 5 failures within 15 minutes from one IP locks that
// IP out for 15 minutes. State lives in login-attempts.json (denied by
// .htaccess, never deployed).
const MEMBERSHIP_LOGIN_MAX_FAILURES = 5;
const MEMBERSHIP_LOGIN_WINDOW = 900;

function membership_login_attempts_file() {
    return __DIR__ . '/login-attempts.json';
}

// Seconds until $ip may try again, or 0 if it isn't locked out.
function membership_login_lockout_remaining($ip, $now = null) {
    $now = $now ?? time();
    $all = membership_read_json(membership_login_attempts_file(), []);
    $rec = $all[$ip] ?? null;
    if (!$rec || count($rec['failures'] ?? []) < MEMBERSHIP_LOGIN_MAX_FAILURES) return 0;
    $until = max($rec['failures']) + MEMBERSHIP_LOGIN_WINDOW;
    return max(0, $until - $now);
}

// Records a failure (or clears the IP's history on success). Old entries
// for every IP are pruned so the file stays small.
function membership_login_record($ip, $success, $now = null) {
    $now = $now ?? time();
    $file = membership_login_attempts_file();
    membership_with_lock($file, function () use ($file, $ip, $success, $now) {
        $all = membership_read_json($file, []);
        foreach ($all as $k => $rec) {
            $recent = array_values(array_filter($rec['failures'] ?? [], function ($t) use ($now) {
                return $t > $now - MEMBERSHIP_LOGIN_WINDOW;
            }));
            if ($recent) $all[$k]['failures'] = $recent; else unset($all[$k]);
        }
        if ($success) unset($all[$ip]);
        else $all[$ip]['failures'][] = $now;
        return membership_write_json($file, $all);
    });
}

// JSON safe to drop inside an inline <script>: no "</script" and no raw
// U+2028/U+2029 line terminators. Invalid UTF-8 is substituted rather than
// failing, so the boot script is always valid JavaScript.
function membership_safe_inline_json($value) {
    $json = json_encode($value, JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) $json = 'null';
    $json = str_replace(["\xE2\x80\xA8", "\xE2\x80\xA9"], ['\\u2028', '\\u2029'], $json);
    $json = str_ireplace('</script', '<\\/script', $json);
    return $json;
}

// ---- Sessions: HttpOnly + SameSite cookie (Secure over HTTPS) and an idle
// timeout, so a forgotten browser tab doesn't stay logged in indefinitely.
const MEMBERSHIP_SESSION_IDLE = 28800; // 8 hours

function membership_session_start() {
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
    $now = time();
    if (isset($_SESSION['membership_last_seen']) && $now - $_SESSION['membership_last_seen'] > MEMBERSHIP_SESSION_IDLE) {
        session_unset();
        session_destroy();
        session_start();
    }
    $_SESSION['membership_last_seen'] = $now;
}

function membership_csrf_token() {
    if (empty($_SESSION['membership_csrf'])) $_SESSION['membership_csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['membership_csrf'];
}

// ---- Data directory: snapshots, rejected-row files. Denied to HTTP both by
// the app .htaccess (every .json) and by its own .htaccess written here.
function membership_data_dir($sub = '') {
    $dir = __DIR__ . '/data' . ($sub !== '' ? '/' . $sub : '');
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
        $root = __DIR__ . '/data/.htaccess';
        if (!is_file($root)) @file_put_contents($root, "Require all denied\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
    }
    return $dir;
}

// ---- Import validation. The browser already parsed and checked the CSV; this
// is the server's own pass so nothing malformed or oversized is ever stored.
const MEMBERSHIP_MAX_MEMBERS = 20000;
const MEMBERSHIP_MAX_FIELD_LEN = 500;

function membership_tracked_fields() {
    return ['memberNumber', 'primaryMemberNumber', 'memberLevel', 'lastName', 'firstName', 'middleInitial', 'spouseFirstName',
        'spouseLastName', 'email', 'phone', 'cellPhone', 'address', 'address2', 'city', 'state', 'zip', 'country',
        'membershipType', 'status', 'joinDate', 'expirationDate', 'lastRenewalDate', 'autoRenew', 'company', 'year', 'model', 'color'];
}

function membership_date_fields() {
    return ['joinDate', 'expirationDate', 'lastRenewalDate'];
}

function membership_clean_str($v) {
    $s = is_scalar($v) ? (string)$v : '';
    $s = str_replace("\0", '', $s);
    if (!preg_match('//u', $s)) $s = mb_convert_encoding($s, 'UTF-8', 'UTF-8');
    return mb_substr(trim($s), 0, MEMBERSHIP_MAX_FIELD_LEN);
}

// Returns a sanitized member record, or a string describing why it was refused.
function membership_validate_member($m) {
    if (!is_array($m)) return 'Not a member record.';
    $out = [];
    foreach (membership_tracked_fields() as $f) $out[$f] = membership_clean_str($m[$f] ?? '');
    foreach (membership_date_fields() as $f) {
        $out[$f . 'Raw'] = membership_clean_str($m[$f . 'Raw'] ?? '');
        if ($out[$f] !== '' && (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $out[$f], $d) || !checkdate((int)$d[2], (int)$d[3], (int)$d[1]))) {
            return "Invalid date in $f.";
        }
    }
    if ($out['lastName'] === '' && $out['firstName'] === '') return 'No first or last name.';
    $key = membership_clean_str($m['key'] ?? '');
    if ($key === '') return 'Missing record key.';
    $out['key'] = $key;
    $out['household'] = membership_clean_str($m['household'] ?? '') ?: $key;
    $out['isRole'] = !empty($m['isRole']);
    $flags = [];
    foreach ((is_array($m['flags'] ?? null) ? $m['flags'] : []) as $fl) { $c = membership_clean_str($fl); if ($c !== '') $flags[] = $c; }
    $out['flags'] = array_slice($flags, 0, 20);
    $fields = [];
    if (is_array($m['fields'] ?? null)) {
        foreach (array_slice($m['fields'], 0, 100, true) as $k => $v) {
            $k = membership_clean_str($k);
            if ($k === '' || in_array(strtolower(str_replace([' ', '-'], '_', $k)), ['login_name', 'date_of_birth', 'spouse_birthday', 'anniversary', 'gender', 'pronoun_name'], true)) continue;
            $fields[$k] = membership_clean_str($v);
        }
    }
    $out['fields'] = $fields;
    return $out;
}

function membership_fingerprint($m) {
    $vals = [];
    foreach (membership_tracked_fields() as $f) $vals[] = (string)($m[$f] ?? '');
    return md5(json_encode($vals, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE));
}

// Applies an import to the stored roster. "full": the file is the whole
// roster. "partial": merge by key. Members absent from a full file are
// counted (notInFile) but never marked resigned — they simply are not in the
// current roster; earlier snapshots still record them.
function membership_apply_import($current, $incoming, $mode) {
    $byKey = [];
    foreach ($current as $m) $byKey[$m['key'] ?? ''] = $m;
    $added = $updated = $unchanged = 0;
    $seen = [];
    foreach ($incoming as $m) {
        $seen[$m['key']] = true;
        if (!isset($byKey[$m['key']])) $added++;
        elseif (membership_fingerprint($byKey[$m['key']]) === membership_fingerprint($m)) $unchanged++;
        else $updated++;
    }
    $notInFile = 0;
    if ($mode === 'full') {
        foreach ($byKey as $k => $_) if (!isset($seen[$k])) $notInFile++;
        $roster = $incoming;
    } else {
        $order = array_keys($byKey);
        foreach ($incoming as $m) { if (!isset($byKey[$m['key']])) $order[] = $m['key']; $byKey[$m['key']] = $m; }
        $roster = [];
        foreach ($order as $k) $roster[] = $byKey[$k];
    }
    return ['roster' => $roster, 'added' => $added, 'updated' => $updated, 'unchanged' => $unchanged, 'notInFile' => $notInFile];
}

// What the Reports tab may treat as "a member" in a snapshot: active, non-role.
function membership_snapshot_summary($roster, $id, $mode, $sourceFile, $counts, $rejectedCount) {
    $keys = [];
    $households = [];
    foreach ($roster as $m) {
        if (!empty($m['isRole']) || strcasecmp($m['status'] ?? '', 'Active') !== 0) continue;
        $keys[] = $m['key'];
        $households[$m['household'] ?? $m['key']] = true;
    }
    date_default_timezone_set('America/New_York');
    return [
        'id' => $id, 'date' => date('Y-m-d'), 'at' => gmdate('c'), 'mode' => $mode, 'sourceFile' => $sourceFile,
        'rows' => count($roster), 'people' => count($keys), 'households' => count($households),
        'added' => $counts['added'], 'updated' => $counts['updated'], 'unchanged' => $counts['unchanged'],
        'notInFile' => $counts['notInFile'], 'rejected' => $rejectedCount, 'keys' => $keys,
    ];
}

function membership_snapshots() {
    $dir = membership_data_dir('snapshots');
    $out = [];
    foreach (glob($dir . '/*.json') ?: [] as $f) {
        if (substr($f, -9) === '.tmp.json' || substr($f, -10) === '.lock.json') continue;
        $s = membership_read_json($f, null);
        if ($s && isset($s['id'])) $out[] = $s;
    }
    usort($out, function ($a, $b) { return strcmp($a['id'], $b['id']); });
    return array_slice($out, -120);
}

// CSV cell safe against spreadsheet formula injection.
function membership_csv_cell($v) {
    $s = (string)$v;
    if ($s !== '' && strpos("=+-@\t\r", $s[0]) !== false) $s = "'" . $s;
    return (strpbrk($s, "\",\r\n") !== false) ? '"' . str_replace('"', '""', $s) . '"' : $s;
}
