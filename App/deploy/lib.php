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
    $singles = 0;
    $couples = 0;
    foreach ($roster as $m) {
        if (!empty($m['isRole']) || strcasecmp($m['status'] ?? '', 'Active') !== 0) continue;
        $keys[] = $m['key'];
        // Club definition: households = single members + (couple members / 2).
        if (stripos((string)($m['membershipType'] ?? ''), 'couple') !== false) $couples++; else $singles++;
    }
    date_default_timezone_set('America/New_York');
    return [
        'id' => $id, 'date' => date('Y-m-d'), 'at' => gmdate('c'), 'mode' => $mode, 'sourceFile' => $sourceFile,
        'rows' => count($roster), 'people' => count($keys), 'singles' => $singles, 'couples' => $couples,
        'households' => $singles + $couples / 2,
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


// ---- Passwords --------------------------------------------------------------
// The website login hash comes from secrets.php until the Developer menu
// changes it; after that data/auth.json (denied to HTTP) overrides it. The
// developer password starts as the hash below (the owner's initial password,
// which the Developer menu warns about until it is changed) and is then
// stored in data/auth.json. Only hashes are ever stored.
const MEMBERSHIP_DEV_DEFAULT_HASH = '$6$fe4930a259b7e006$9/Cydo7OnSprM1nAvJQVBMtQvcGJ1v3PXEgXoilHU0QSpDycyJ0pICDch2tM1HmsAtuYXJnPwgo4hixJjlzqV/';
const MEMBERSHIP_DEV_IDLE = 1800; // developer unlock lasts 30 idle minutes
const MEMBERSHIP_PASSWORD_MIN = 8;
const MEMBERSHIP_PASSWORD_MAX = 200;

function membership_auth_file() {
    return membership_data_dir() . '/auth.json';
}

function membership_auth_read() {
    return membership_read_json(membership_auth_file(), []);
}

// Readable random password (no 0/O/1/l/I) for the FTP-triggered recovery flow.
function membership_generate_password($len = 14) {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $out = '';
    for ($i = 0; $i < $len; $i++) $out .= $chars[random_int(0, strlen($chars) - 1)];
    return $out;
}

function membership_hash_password($pw) {
    return crypt($pw, '$6$rounds=50000$' . bin2hex(random_bytes(8)) . '$');
}

function membership_verify_password($pw, $hash) {
    $pw = (string)$pw;
    if ($pw === '' || !is_string($hash) || strlen($hash) < 20) return false;
    return hash_equals($hash, crypt($pw, $hash));
}

function membership_site_hash() {
    global $PASSWORD_HASH;
    $a = membership_auth_read();
    return $a['siteHash'] ?? ($PASSWORD_HASH ?? '');
}

function membership_dev_hash() {
    $a = membership_auth_read();
    return $a['devHash'] ?? MEMBERSHIP_DEV_DEFAULT_HASH;
}

// Returns an error message, or '' if the new password is acceptable.
function membership_password_problem($pw) {
    $len = mb_strlen((string)$pw);
    if ($len < MEMBERSHIP_PASSWORD_MIN) return 'Use at least ' . MEMBERSHIP_PASSWORD_MIN . ' characters.';
    if ($len > MEMBERSHIP_PASSWORD_MAX) return 'That password is too long.';
    return '';
}

// Merges $changes into auth.json under a lock. Changing the website password
// bumps siteVersion, which signs out every other browser session.
function membership_auth_update($changes) {
    $file = membership_auth_file();
    return membership_with_lock($file, function () use ($file, $changes) {
        $a = membership_read_json($file, []);
        if (isset($changes['siteHash'])) $a['siteVersion'] = (int)($a['siteVersion'] ?? 0) + 1;
        foreach ($changes as $k => $v) $a[$k] = $v;
        $a['updatedAt'] = gmdate('c');
        return membership_write_json($file, $a) ? $a : false;
    });
}

function membership_site_version() {
    $a = membership_auth_read();
    return (int)($a['siteVersion'] ?? 0);
}

function membership_login_success() {
    session_regenerate_id(true);
    $_SESSION['membership_authenticated'] = true;
    $_SESSION['membership_auth_version'] = membership_site_version();
}

function membership_is_authenticated() {
    return !empty($_SESSION['membership_authenticated'])
        && ($_SESSION['membership_auth_version'] ?? -1) === membership_site_version();
}

function membership_dev_unlocked() {
    return membership_is_authenticated() && ($_SESSION['membership_dev_until'] ?? 0) > time();
}

function membership_dev_touch() {
    $_SESSION['membership_dev_until'] = time() + MEMBERSHIP_DEV_IDLE;
}


// ---- Emailed password-recovery links (see recover.php, mailer.php). Only a
// SHA-256 hash of the one-time token is stored, never the token itself. Recovery can target the website
// login password ('site'), the developer password ('dev') or both ('both').
const MEMBERSHIP_RECOVERY_TOKEN_TTL = 1800;     // emailed link is valid 30 minutes
const MEMBERSHIP_RECOVERY_EMAIL_COOLDOWN = 900; // at most one recovery email per 15 minutes per password, from anyone

function membership_recovery_scope($s) {
    return in_array($s, ['site', 'dev'], true) ? $s : 'both';
}

function membership_recovery_scope_label($scope) {
    return ['site' => 'website login password', 'dev' => 'developer password', 'both' => 'website login and developer passwords'][membership_recovery_scope($scope)];
}

function membership_recovery_token_file() {
    return membership_data_dir() . '/recovery-token.json';
}

function membership_recovery_log_file() {
    return membership_data_dir() . '/recovery-email-log.json';
}

// Seconds until another recovery email for this password may be sent (0 = allowed now).
function membership_recovery_email_wait($scope = 'both') {
    $log = membership_read_json(membership_recovery_log_file(), []);
    $last = (int)($log['sent'][membership_recovery_scope($scope)] ?? 0);
    return max(0, ($last + MEMBERSHIP_RECOVERY_EMAIL_COOLDOWN) - time());
}

// Replaces the pending token (so only the newest emailed link works), remembers which password it is for,
// and starts that password's send cooldown.
function membership_recovery_token_store($token, $scope = 'both') {
    $now = time();
    $scope = membership_recovery_scope($scope);
    $ok = membership_write_json(membership_recovery_token_file(), [
        'hash' => hash('sha256', $token), 'scope' => $scope, 'createdAt' => $now, 'expiresAt' => $now + MEMBERSHIP_RECOVERY_TOKEN_TTL,
    ]);
    $log = membership_read_json(membership_recovery_log_file(), []);
    $sent = is_array($log['sent'] ?? null) ? $log['sent'] : [];
    $sent[$scope] = $now;
    return $ok && membership_write_json(membership_recovery_log_file(), ['sent' => $sent]);
}

function membership_recovery_token_valid($token) {
    $rec = membership_read_json(membership_recovery_token_file(), []);
    if (empty($rec['hash']) || empty($rec['expiresAt']) || time() > (int)$rec['expiresAt']) return false;
    return is_string($token) && $token !== '' && hash_equals($rec['hash'], hash('sha256', $token));
}

// The password an emailed link resets (as recorded when it was created).
function membership_recovery_token_scope() {
    $rec = membership_read_json(membership_recovery_token_file(), []);
    return membership_recovery_scope($rec['scope'] ?? 'both');
}

// Used up by any confirm attempt, so a link is good for one try.
function membership_recovery_token_consume() {
    @unlink(membership_recovery_token_file());
}

// Replaces the chosen password(s) with new random ones. Resetting the website password signs out every
// session; resetting only the developer password does not. Returns ['site' => ..., 'dev' => ...] (only the
// ones reset) or false if nothing could be saved.
function membership_recovery_reset_passwords($scope = 'both') {
    $scope = membership_recovery_scope($scope);
    $new = [];
    $changes = [];
    if ($scope === 'site' || $scope === 'both') { $new['site'] = membership_generate_password(); $changes['siteHash'] = membership_hash_password($new['site']); }
    if ($scope === 'dev' || $scope === 'both') { $new['dev'] = membership_generate_password(); $changes['devHash'] = membership_hash_password($new['dev']); }
    return membership_auth_update($changes) ? $new : false;
}

// The developer password also opens the website (the owner's request), but only once it has been changed
// from the initial one: the initial password is a known default and must never unlock member data. A changed
// developer password is stored as devHash in data/auth.json; the initial one never is.
function membership_dev_password_login_ok($pw) {
    $a = membership_auth_read();
    $h = (string)($a['devHash'] ?? '');
    return $h !== '' && membership_verify_password($pw, $h);
}
