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

// "Last Name", "last_name", "LastName", "E-Mail" -> "lastname", "email".
function membership_normalize_header($h) {
    $h = preg_replace('/^\xEF\xBB\xBF/', '', (string)$h);
    return str_replace([' ', '_', '-', '.', '/', '#'], ['', '', '', '', '', 'number'], strtolower(trim($h)));
}

// Known fields -> accepted (normalized) header names. Same aliases the CarShow
// members-import.php recognizes, plus the membership-specific dates/status.
// Any column not listed here is still kept, under its original header, in
// each member's "fields" map, so nothing in the export is dropped.
function membership_field_aliases() {
    return [
        'memberNumber' => ['membernumber', 'memberno', 'membernum', 'memberid', 'id', 'number'],
        'lastName' => ['lastname', 'last', 'surname'],
        'firstName' => ['firstname', 'first'],
        'spouseFirstName' => ['spousefirstname', 'spouse', 'spousename'],
        'email' => ['email', 'emailaddress', 'primaryemail'],
        'phone' => ['phone', 'phonenumber', 'homephone', 'cellphone', 'mobilephone', 'primaryphone'],
        'address' => ['address', 'address1', 'streetaddress', 'primaryaddress', 'primaryaddress1'],
        'city' => ['city', 'primarycity'],
        'state' => ['state', 'primarystate'],
        'zip' => ['zip', 'zipcode', 'postalcode', 'primaryzip', 'primaryzipcode', 'primarypostalcode'],
        'membershipType' => ['membershiptype', 'membertype', 'membershiplevel', 'level'],
        'status' => ['status', 'memberstatus', 'membershipstatus'],
        'joinDate' => ['joindate', 'datejoined', 'joined', 'membersince', 'memberjoindate', 'originaljoindate', 'startdate', 'membershipstartdate'],
        'expirationDate' => ['expirationdate', 'expiredate', 'expires', 'expiration', 'renewaldate', 'membershipexpirationdate'],
        'year' => ['year', 'corvetteyear', 'modelyear'],
        'model' => ['model', 'corvettemodel'],
        'color' => ['color', 'corvettecolor'],
    ];
}

// Accepts the date shapes exports commonly use (2024-03-05, 3/5/2024,
// 3/5/24, 03-05-2024, "Mar 5, 2024", "2024-03-05 10:15:00") and returns
// "YYYY-MM-DD", or '' if the value isn't a recognizable date.
function membership_parse_date($raw) {
    $s = trim((string)$raw);
    if ($s === '') return '';
    if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})/', $s, $m)) {
        $y = (int)$m[1]; $mo = (int)$m[2]; $d = (int)$m[3];
    } elseif (preg_match('/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})\b/', $s, $m)) {
        $mo = (int)$m[1]; $d = (int)$m[2]; $y = (int)$m[3];
        // Two-digit years: 00-49 -> 2000s, 50-99 -> 1900s.
        if (strlen($m[3]) === 2) $y += $y < 50 ? 2000 : 1900;
    } else {
        $ts = strtotime($s);
        if ($ts === false) return '';
        $y = (int)date('Y', $ts); $mo = (int)date('n', $ts); $d = (int)date('j', $ts);
    }
    if (!checkdate($mo, $d, $y)) return '';
    return sprintf('%04d-%02d-%02d', $y, $mo, $d);
}

// Parses a membership export CSV file. Returns
//   ['ok' => true, 'columns' => [...], 'members' => [...], 'found' => [...]]
// or ['ok' => false, 'error' => '...'].
// Uses fgetcsv (not per-line str_getcsv) so quoted values with embedded
// newlines, like multi-line addresses, stay in one row.
function membership_parse_csv($path) {
    $raw = @file_get_contents($path);
    if ($raw === false) return ['ok' => false, 'error' => 'Could not read the uploaded file.'];
    // Excel often saves CSVs as Windows-1252; convert anything that isn't
    // valid UTF-8 so names like "José" survive and json_encode can't fail.
    if (!preg_match('//u', $raw)) {
        $raw = function_exists('mb_convert_encoding')
            ? mb_convert_encoding($raw, 'UTF-8', 'Windows-1252')
            : (string)@iconv('Windows-1252', 'UTF-8//IGNORE', $raw);
    }
    $fh = fopen('php://temp', 'r+');
    fwrite($fh, $raw);
    rewind($fh);
    $header = fgetcsv($fh, 0, ',', '"', '');
    if (!$header || count(array_filter($header, function ($h) { return trim((string)$h) !== ''; })) === 0) {
        fclose($fh);
        return ['ok' => false, 'error' => 'That file looks empty.'];
    }
    $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string)$header[0]);
    $header = array_map(function ($h) { return trim((string)$h); }, $header);

    $aliases = membership_field_aliases();
    $idx = array_fill_keys(array_keys($aliases), null);
    foreach ($header as $i => $h) {
        $n = membership_normalize_header($h);
        foreach ($aliases as $field => $names) {
            if ($idx[$field] === null && in_array($n, $names, true)) { $idx[$field] = $i; break; }
        }
    }
    if ($idx['lastName'] === null || $idx['firstName'] === null) {
        fclose($fh);
        return ['ok' => false, 'error' => 'The CSV needs "First Name" and "Last Name" columns (any spacing/underscore/case).'];
    }

    $members = [];
    while (($cols = fgetcsv($fh, 0, ',', '"', '')) !== false) {
        if ($cols === [null] || trim(implode('', $cols)) === '') continue;
        $member = [];
        foreach ($idx as $field => $i) {
            $member[$field] = $i !== null ? trim((string)($cols[$i] ?? '')) : '';
        }
        if ($member['lastName'] === '' && $member['firstName'] === '') continue;
        $member['joinDateRaw'] = $member['joinDate'];
        $member['joinDate'] = membership_parse_date($member['joinDate']);
        $member['expirationDateRaw'] = $member['expirationDate'];
        $member['expirationDate'] = membership_parse_date($member['expirationDate']);
        $fields = [];
        foreach ($header as $i => $h) {
            if ($h === '') continue;
            $fields[$h] = trim((string)($cols[$i] ?? ''));
        }
        $member['fields'] = $fields;
        $members[] = $member;
    }
    fclose($fh);

    if (!$members) return ['ok' => false, 'error' => 'No member rows were found under the header row.'];

    usort($members, function ($a, $b) {
        $c = strcasecmp($a['lastName'], $b['lastName']);
        return $c !== 0 ? $c : strcasecmp($a['firstName'], $b['firstName']);
    });
    $labels = ['memberNumber' => 'Member Number', 'lastName' => 'Last Name', 'firstName' => 'First Name',
        'spouseFirstName' => 'Spouse First Name', 'email' => 'Email', 'phone' => 'Phone', 'address' => 'Address',
        'city' => 'City', 'state' => 'State', 'zip' => 'Zip', 'membershipType' => 'Membership Type',
        'status' => 'Status', 'joinDate' => 'Join Date', 'expirationDate' => 'Expiration Date',
        'year' => 'Corvette Year', 'model' => 'Model', 'color' => 'Color'];
    $found = [];
    foreach ($idx as $field => $i) if ($i !== null) $found[] = $labels[$field];
    return ['ok' => true, 'columns' => array_values(array_filter($header, 'strlen')), 'members' => $members, 'found' => $found];
}
