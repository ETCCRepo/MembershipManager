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


// ---- "Forgot password" — the same mechanism as the CarShow app. A public page emails a one-time link to the club's
// admin address (never an address typed into the page); the link opens a page where the NEW password is chosen.
// Two independent resets: the website login password ('site': forgot-password.php / reset-password.php) and the
// developer password ('dev': dev-forgot-password.php / dev-reset-password.php, the first only reachable when logged
// in). Only a SHA-256 hash of each token is stored (data/password-reset.json, data/dev-password-reset.json), and the
// new password's hash goes to data/auth.json like a change made in the Developer menu.
const MEMBERSHIP_RESET_TTL = 86400;       // links are valid 24 hours
const MEMBERSHIP_RESET_RESEND_WAIT = 300; // one email per 5 minutes per password, so the public page cannot flood the admin inbox

function membership_reset_file($kind) {
    return membership_data_dir() . '/' . ($kind === 'dev' ? 'dev-password-reset.json' : 'password-reset.json');
}

// Seconds until another reset email for this password may be sent (0 = allowed now).
function membership_reset_wait($kind) {
    $r = membership_read_json(membership_reset_file($kind), []);
    return max(0, (int)($r['sentAt'] ?? 0) + MEMBERSHIP_RESET_RESEND_WAIT - time());
}

// Creates a new token (replacing any pending one) and returns it, or false if it could not be saved.
function membership_reset_start($kind) {
    $token = bin2hex(random_bytes(32));
    $now = time();
    $ok = membership_write_json(membership_reset_file($kind), ['hash' => hash('sha256', $token), 'expiresAt' => $now + MEMBERSHIP_RESET_TTL, 'sentAt' => $now]);
    return $ok ? $token : false;
}

function membership_reset_valid($kind, $token) {
    $r = membership_read_json(membership_reset_file($kind), []);
    if (empty($r['hash']) || empty($r['expiresAt']) || time() >= (int)$r['expiresAt']) return false;
    return is_string($token) && $token !== '' && hash_equals($r['hash'], hash('sha256', $token));
}

function membership_reset_consume($kind) {
    @unlink(membership_reset_file($kind));
}

function membership_reset_base_url($script) {
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    return ($https ? 'https://' : 'http://') . preg_replace('/[^a-z0-9.:\-]/i', '', $_SERVER['HTTP_HOST'] ?? 'localhost') .
        rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\') . '/' . $script;
}

// The small standalone page shared by the four forgot/reset pages (same look as the CarShow app's).
function membership_reset_page($heading, $sub, $bodyHtml) {
    header('Content-Type: text/html; charset=utf-8');
    $h = function ($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' .
        '<title>ETCC Membership — ' . $h($heading) . '</title><link rel="icon" type="image/png" href="ETCClogoWhiteBackground.png">' .
        '<style>:root{--red:#b0141e;--red-dark:#7d0e15;--ink:#1a1a1a;--muted:#667085;--line:#e3e6ea;--bg:#f4f6f8;--panel:#fff;--good:#147d3a}' .
        '*{box-sizing:border-box}body{font:15px/1.5 "Segoe UI",Arial,sans-serif;color:var(--ink);background:var(--bg);margin:0;padding:40px 16px}' .
        '.wrap{max-width:440px;margin:0 auto}h1{font-size:20px;text-align:center;margin:0 0 2px}.sub{text-align:center;color:var(--muted);font-size:13px;margin-bottom:22px}' .
        '.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px}.form-row{margin:12px 0}label{display:block;font-weight:600;font-size:13px;margin-bottom:4px}' .
        'input[type=password]{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:7px;font-size:14px;font-family:inherit}' .
        '.btn{background:var(--red);border:1px solid var(--red-dark);color:#fff;padding:11px 18px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;width:100%}.btn:hover{background:var(--red-dark)}' .
        '.errors{background:#fff5f5;border-left:4px solid var(--red);border-radius:6px;padding:10px 14px;margin-bottom:14px;color:var(--red-dark);font-size:13px}' .
        '.success{color:var(--good);font-weight:600;text-align:center}.back{display:block;text-align:center;margin-top:18px;color:var(--muted);font-size:13px}</style></head><body>' .
        '<div class="wrap"><h1>' . $h($heading) . '</h1><div class="sub">' . $h($sub) . '</div><div class="panel">' . $bodyHtml . '</div>' .
        '<a class="back" href="index.php">&larr; Back to login</a></div></body></html>';
    exit;
}

// forgot-password.php / dev-forgot-password.php: email the admin address a reset link.
function membership_forgot_handle($kind) {
    require_once __DIR__ . '/mailer.php';
    $isDev = ($kind === 'dev');
    $heading = $isDev ? 'Forgot Developer Password' : 'Forgot Password';
    $h = function ($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };
    if ($isDev) {
        // Gated behind the website's own login (like the CarShow app): reaching the Developer unlock form already
        // requires being logged in, so there is no "locked out of everything" case to rescue here.
        membership_session_start();
        if (!membership_is_authenticated()) {
            membership_reset_page($heading, 'East Tennessee Corvette Club — Membership Manager', '<p>Please <a href="index.php">log in</a> first.</p>');
        }
    }
    $sent = false;
    $errors = [];
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $wait = membership_reset_wait($kind);
        if ($wait > 0) {
            $errors[] = 'A reset link was already emailed a moment ago. Check the admin inbox (and its spam folder), or try again in ' . (int)ceil($wait / 60) . ' minute(s).';
        } else {
            $token = membership_reset_start($kind);
            if ($token === false) {
                $errors[] = 'Could not start a password reset right now — please try again in a moment.';
            } else {
                $url = membership_reset_base_url($isDev ? 'dev-reset-password.php' : 'reset-password.php') . '?token=' . $token;
                $what = $isDev ? "Developer password" : "website login password";
                $body = "A reset of the Membership Manager's $what was requested.\n\n" .
                    "Reset it here (link expires in 24 hours):\n" . $url . "\n\n" .
                    "If you didn't request this, you can ignore this email — the link expires on its own and nothing changes until someone opens it.";
                if (membership_send_mail(membership_mail_recipient(), 'ETCC Membership Manager — ' . $what . ' reset requested', $body) === true) {
                    $sent = true;
                } else {
                    membership_reset_consume($kind); // nothing was delivered, so no live link should remain
                    $errors[] = 'Could not send the reset email — email may not be set up (see secrets.php) or the send failed. Ask a developer to reset the password directly (see deploy/README.md).';
                }
            }
        }
    }
    if ($sent) {
        $html = '<p class="success">A reset link has been emailed. Check the club\'s admin inbox — it\'s valid for 24 hours.</p>';
    } else {
        $html = '';
        if ($errors) $html .= '<div class="errors">' . implode('', array_map(function ($e) use ($h) { return '<p style="margin:0">' . $h($e) . '</p>'; }, $errors)) . '</div>';
        $html .= '<p style="text-align:center">This site has one shared ' . ($isDev ? 'developer password' : 'login') . ', so resets go to the club\'s admin email rather than one you\'d type here.</p>' .
            '<form method="post" style="text-align:center"><button type="submit" class="btn">Email a reset link</button></form>';
    }
    membership_reset_page($heading, 'East Tennessee Corvette Club — Membership Manager', $html);
}

// reset-password.php / dev-reset-password.php: the page the emailed link opens, where the new password is chosen.
function membership_reset_handle($kind) {
    $isDev = ($kind === 'dev');
    $heading = $isDev ? 'Reset Developer Password' : 'Reset Password';
    $h = function ($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };
    $token = (string)($_GET['token'] ?? $_POST['token'] ?? '');
    $valid = membership_reset_valid($kind, $token);
    $errors = [];
    $done = false;
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $valid) {
        $pw1 = (string)($_POST['password'] ?? '');
        $pw2 = (string)($_POST['password2'] ?? '');
        $problem = membership_password_problem($pw1);
        if ($problem !== '') {
            $errors[] = $problem;
        } elseif ($pw1 !== $pw2) {
            $errors[] = 'Passwords do not match.';
        } elseif (membership_auth_update([$isDev ? 'devHash' : 'siteHash' => membership_hash_password($pw1)])) {
            membership_reset_consume($kind); // one-time use
            $done = true;
        } else {
            $errors[] = 'Could not save the new password — please try again.';
        }
    }
    if ($done) {
        $html = '<p class="success">' . ($isDev ? 'Developer password changed. Use it to unlock the Developer menu (it also works to log in to the website).' : 'Password changed. You can log in with it now.') . '</p>';
    } elseif (!$valid) {
        $html = '<div class="errors"><p style="margin:0">This reset link is invalid or has expired. Request a new one.</p></div>';
    } else {
        $html = '';
        if ($errors) $html .= '<div class="errors">' . implode('', array_map(function ($e) use ($h) { return '<p style="margin:0">' . $h($e) . '</p>'; }, $errors)) . '</div>';
        $html .= '<form method="post"><input type="hidden" name="token" value="' . $h($token) . '">' .
            '<div class="form-row"><label for="f-pw1">New Password</label><input type="password" id="f-pw1" name="password" required minlength="' . MEMBERSHIP_PASSWORD_MIN . '" autofocus></div>' .
            '<div class="form-row"><label for="f-pw2">Confirm New Password</label><input type="password" id="f-pw2" name="password2" required minlength="' . MEMBERSHIP_PASSWORD_MIN . '"></div>' .
            '<button type="submit" class="btn">Set New Password</button></form>';
    }
    membership_reset_page($heading, 'East Tennessee Corvette Club — Membership Manager', $html);
}



// ---- Club settings edited in the Developer menu (data/settings.json, denied to HTTP).
// Renewal start/end are month-day strings ("10-01", "12-31"); memberships expire on the end date.
function membership_settings_file() {
    return membership_data_dir() . '/settings.json';
}

function membership_settings_defaults() {
    // sync*: when the automatic data import runs. syncStart/syncEnd are Eastern dates (YYYY-MM-DD); '' = no limit.
    return ['renewalStart' => '10-01', 'renewalEnd' => '12-31', 'syncEnabled' => true, 'syncFrequency' => 'daily',
        'syncTime' => '06:30', 'syncStart' => '', 'syncEnd' => ''];
}

function membership_valid_mmdd($s) {
    return is_string($s) && preg_match('/^(\d{2})-(\d{2})$/', $s, $m) === 1 && checkdate((int)$m[1], (int)$m[2], 2001);
}

function membership_valid_hhmm($s) {
    return is_string($s) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $s) === 1;
}

function membership_valid_ymd($s) {
    return is_string($s) && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m) === 1 && checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}

function membership_setting_valid($k, $v) {
    switch ($k) {
        case 'syncTime': return membership_valid_hhmm($v);
        case 'syncEnabled': return is_bool($v);
        case 'syncFrequency': return $v === 'daily' || $v === 'hourly';
        case 'syncStart': case 'syncEnd': return $v === '' || membership_valid_ymd($v);
        default: return membership_valid_mmdd($v);
    }
}

function membership_settings_read() {
    $defaults = membership_settings_defaults();
    $stored = membership_read_json(membership_settings_file(), []);
    $out = $defaults;
    foreach ($defaults as $k => $_) {
        if (isset($stored[$k]) && membership_setting_valid($k, $stored[$k])) $out[$k] = $stored[$k];
    }
    return $out;
}

// Merges validated changes into settings.json under a lock. Returns the new settings or false.
function membership_settings_update($changes) {
    $file = membership_settings_file();
    return membership_with_lock($file, function () use ($file, $changes) {
        $cur = membership_settings_read();
        foreach (array_keys(membership_settings_defaults()) as $k) {
            if (isset($changes[$k])) $cur[$k] = $changes[$k];
        }
        $cur['updatedAt'] = gmdate('c');
        return membership_write_json($file, $cur) ? membership_settings_read() : false;
    });
}


// ---- Import commit shared by the browser importer (members-import.php) and the daily sync
// (members-sync.php). Re-validates every record, applies the import, and writes the roster,
// a dated snapshot (full imports that changed something), rejected rows and the batch log.
// $opts: minRosterFraction (refuse a FULL import smaller than that share of the current roster —
// protects against a truncated export), skipIfUnchanged (an identical roster writes nothing).
// Returns ['status' => HTTP code, 'payload' => array].
function membership_import_commit($rawMembers, $rawRejected, $mode, $sourceFile, $source, $opts = []) {
    if (!is_array($rawMembers)) return ['status' => 400, 'payload' => ['ok' => false, 'error' => 'Malformed import.']];
    if (count($rawMembers) > MEMBERSHIP_MAX_MEMBERS) return ['status' => 413, 'payload' => ['ok' => false, 'error' => 'Too many rows for a membership export.']];
    $mode = $mode === 'partial' ? 'partial' : 'full';
    $incoming = [];
    $rejected = [];
    $seenKeys = [];
    foreach ($rawMembers as $i => $m) {
        $v = membership_validate_member($m);
        if (is_string($v)) { $rejected[] = ['rowNumber' => $i + 2, 'reason' => $v, 'values' => '']; continue; }
        if (isset($seenKeys[$v['key']])) { $rejected[] = ['rowNumber' => $i + 2, 'reason' => 'Duplicate record key.', 'values' => '']; continue; }
        $seenKeys[$v['key']] = true;
        $incoming[] = $v;
    }
    // Rows the sender rejected (kept so they can be downloaded later).
    foreach ((is_array($rawRejected) ? array_slice($rawRejected, 0, 5000) : []) as $r) {
        $vals = is_array($r['row'] ?? null) ? implode(' | ', array_map('membership_clean_str', array_slice($r['row'], 0, 60))) : '';
        $rejected[] = ['rowNumber' => (int)($r['rowNumber'] ?? 0), 'reason' => membership_clean_str($r['reason'] ?? ''), 'values' => $vals];
    }
    if (!$incoming) return ['status' => 422, 'payload' => ['ok' => false, 'error' => 'No valid member rows to import.']];

    date_default_timezone_set('America/New_York');
    $sourceFile = basename(membership_clean_str($sourceFile !== '' ? $sourceFile : 'upload.csv'));
    $id = date('YmdHis');
    $guard = (float)($opts['minRosterFraction'] ?? 0);
    $skipUnchanged = !empty($opts['skipIfUnchanged']);

    $result = membership_with_lock(membership_members_file(), function () use ($incoming, $rejected, $mode, $sourceFile, $source, $id, $guard, $skipUnchanged) {
        $data = membership_read_json(membership_members_file(), []);
        $current = isset($data['members']) && is_array($data['members']) ? $data['members'] : [];
        if ($mode === 'full' && $guard > 0 && count($current) >= 20 && count($incoming) < $guard * count($current)) {
            return ['refused' => 'The export has ' . count($incoming) . ' members but the site has ' . count($current) . '; that looks incomplete, so nothing was changed.'];
        }
        $applied = membership_apply_import($current, $incoming, $mode);
        $changed = ($applied['added'] + $applied['updated'] + $applied['notInFile']) > 0;
        if ($skipUnchanged && !$changed) return $applied + ['changed' => false, 'summary' => null];
        $now = gmdate('c');
        $saved = membership_write_json(membership_members_file(), [
            'importedAt' => $now,
            'sourceFile' => $sourceFile,
            'members' => $applied['roster'],
        ]);
        if (!$saved) return false;
        $summary = membership_snapshot_summary($applied['roster'], $id, $mode, $sourceFile, $applied, count($rejected));
        // Only a FULL file is a snapshot of the whole club; a partial file is logged as a batch
        // but never becomes a point on a history chart.
        if ($mode === 'full') membership_write_json(membership_data_dir('snapshots') . '/' . $id . '.json', $summary);
        if ($rejected) membership_write_json(membership_data_dir('batches') . '/' . $id . '-rejected.json', $rejected);
        membership_append_json_list(membership_import_log_file(), [
            'id' => $id, 'timestamp' => $now, 'mode' => $mode, 'sourceFile' => $sourceFile, 'source' => $source,
            'count' => count($incoming), 'added' => $applied['added'], 'updated' => $applied['updated'],
            'unchanged' => $applied['unchanged'], 'notInFile' => $applied['notInFile'], 'rejected' => count($rejected),
            'rosterSize' => count($applied['roster']),
        ]);
        return $applied + ['changed' => true, 'summary' => $summary];
    });

    if ($result === false) return ['status' => 500, 'payload' => ['ok' => false, 'error' => 'Could not save the member list — please try again.']];
    if (isset($result['refused'])) return ['status' => 409, 'payload' => ['ok' => false, 'error' => $result['refused']]];
    if (is_array($result['summary'] ?? null)) unset($result['summary']['keys']);
    return ['status' => 200, 'payload' => [
        'ok' => true, 'batch' => $result['changed'] ? $id : null, 'mode' => $mode, 'changed' => $result['changed'],
        'added' => $result['added'], 'updated' => $result['updated'], 'unchanged' => $result['unchanged'], 'notInFile' => $result['notInFile'],
        'rejected' => count($rejected), 'summary' => $result['summary'] ?? null,
    ]];
}

// ---- Daily sync: a one-time token (only its SHA-256 hash is stored in data/auth.json), a status
// file the sync updates after every run, and a throttle shared with the login throttle.
function membership_sync_status_file() {
    return membership_data_dir() . '/sync-status.json';
}

function membership_sync_status_write($ok, $message, $extra = []) {
    $file = membership_sync_status_file();
    return membership_with_lock($file, function () use ($file, $ok, $message, $extra) {
        $cur = membership_read_json($file, []);
        $now = gmdate('c');
        $cur['lastRunAt'] = $now;
        $cur['ok'] = (bool)$ok;
        $cur['message'] = mb_substr((string)$message, 0, 300);
        if ($ok) $cur['lastSuccessAt'] = $now;
        $trigger = (string)($cur['claimedTrigger'] ?? 'direct');
        unset($cur['requestedAt'], $cur['claimedAt'], $cur['claimedTrigger']); // a finished run satisfies a pending request
        membership_sync_log_add(['at' => $now, 'ok' => (bool)$ok, 'trigger' => $trigger, 'message' => mb_substr((string)$message, 0, 300),
            'rows' => $extra['rows'] ?? null, 'added' => $extra['added'] ?? null, 'updated' => $extra['updated'] ?? null]);
        foreach (['changed', 'rows', 'added', 'updated', 'notInFile', 'rejected'] as $k) {
            if (array_key_exists($k, $extra)) $cur[$k] = $extra[$k];
        }
        return membership_write_json($file, $cur);
    });
}

// Non-secret summary shown on the dashboard and in the Developer menu.
function membership_sync_public() {
    $s = membership_read_json(membership_sync_status_file(), []);
    $a = membership_auth_read();
    return [
        'tokenSet' => !empty($a['syncTokenHash']), 'tokenCreatedAt' => $a['syncTokenCreatedAt'] ?? null,
        'lastRunAt' => $s['lastRunAt'] ?? null, 'lastSuccessAt' => $s['lastSuccessAt'] ?? null, 'ok' => $s['ok'] ?? null,
        'message' => $s['message'] ?? '', 'changed' => $s['changed'] ?? null,
        'requestedAt' => $s['requestedAt'] ?? null, 'claimedAt' => $s['claimedAt'] ?? null,
        'schedule' => membership_sync_schedule(),
    ];
}

// "Sync now" and the daily time: the website cannot reach into the club's computer, so the button only records a request. A small task
// there asks members-sync.php every few minutes (status "poll"); the first poll after a request claims it and runs the
// normal export. A finished run (membership_sync_status_write) clears the request.
function membership_sync_request_set() {
    $file = membership_sync_status_file();
    return membership_with_lock($file, function () use ($file) {
        $cur = membership_read_json($file, []);
        unset($cur['claimedAt']);
        $cur['requestedAt'] = gmdate('c');
        return membership_write_json($file, $cur);
    });
}

// The poll task asks this every few minutes. Returns 'manual' (Sync now pressed) or 'scheduled' (today's sync time has
// passed and no run has finished since) once per run, else false. A claim older than 30 minutes is treated as lost.
function membership_sync_claim() {
    $file = membership_sync_status_file();
    return membership_with_lock($file, function () use ($file) {
        $cur = membership_read_json($file, []);
        $now = time();
        if (!empty($cur['claimedAt']) && $now - (int)strtotime($cur['claimedAt']) < 1800) return false;
        $trigger = false;
        if (!empty($cur['requestedAt'])) $trigger = 'manual';
        elseif (membership_sync_schedule_due($cur, $now)) $trigger = 'scheduled';
        if ($trigger === false) return false;
        $cur['claimedAt'] = gmdate('c');
        $cur['claimedTrigger'] = $trigger;
        return membership_write_json($file, $cur) ? $trigger : false;
    });
}

function membership_sync_schedule() {
    $s = membership_settings_read();
    return ['enabled' => $s['syncEnabled'], 'frequency' => $s['syncFrequency'], 'time' => $s['syncTime'], 'start' => $s['syncStart'], 'end' => $s['syncEnd']];
}

// Is a scheduled run due now? Needs the schedule enabled and today (Eastern) inside the optional start/end dates.
// Daily: today's time has passed and no run has finished since it. Hourly: none finished in the last hour.
function membership_sync_schedule_due($cur, $now) {
    $sc = membership_sync_schedule();
    if (!$sc['enabled']) return false;
    $today = (new DateTime('@' . $now))->setTimezone(new DateTimeZone('America/New_York'))->format('Y-m-d');
    if ($sc['start'] !== '' && $today < $sc['start']) return false;
    if ($sc['end'] !== '' && $today > $sc['end']) return false;
    $last = empty($cur['lastRunAt']) ? 0 : (int)strtotime($cur['lastRunAt']);
    if ($sc['frequency'] === 'hourly') return $now - $last >= 3600;
    $due = (new DateTime('today ' . $sc['time'], new DateTimeZone('America/New_York')))->getTimestamp();
    return $now >= $due && $last < $due;
}

// One row per sync run (newest first, last 200), shown in Developer -> Data Import.
function membership_sync_log_file() {
    return membership_data_dir() . '/sync-log.json';
}

function membership_sync_log_add($entry) {
    $file = membership_sync_log_file();
    return membership_with_lock($file, function () use ($file, $entry) {
        $log = membership_read_json($file, []);
        if (!is_array($log)) $log = [];
        array_unshift($log, $entry);
        return membership_write_json($file, array_slice($log, 0, 200));
    });
}

function membership_sync_log_read($n = 60) {
    $log = membership_read_json(membership_sync_log_file(), []);
    return is_array($log) ? array_slice($log, 0, $n) : [];
}

function membership_sync_token_ok($token) {
    $a = membership_auth_read();
    $h = (string)($a['syncTokenHash'] ?? '');
    return is_string($token) && strlen($token) >= 20 && $h !== '' && hash_equals($h, hash('sha256', $token));
}

// Creates a new token (replacing any old one) and returns it — the only time it is ever visible.
function membership_sync_token_new() {
    $token = 'mmsync_' . bin2hex(random_bytes(24));
    return membership_auth_update(['syncTokenHash' => hash('sha256', $token), 'syncTokenCreatedAt' => gmdate('c')]) ? $token : false;
}

function membership_sync_token_revoke() {
    return membership_auth_update(['syncTokenHash' => '', 'syncTokenCreatedAt' => null]);
}

// The developer password also opens the website (the owner's request), but only once it has been changed
// from the initial one: the initial password is a known default and must never unlock member data. A changed
// developer password is stored as devHash in data/auth.json; the initial one never is.
function membership_dev_password_login_ok($pw) {
    $a = membership_auth_read();
    $h = (string)($a['devHash'] ?? '');
    return $h !== '' && membership_verify_password($pw, $h);
}
