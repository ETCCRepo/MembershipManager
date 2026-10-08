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

function membership_write_json($file, $value) {
    $fh = fopen($file, 'c+');
    if (!$fh || !flock($fh, LOCK_EX)) {
        if ($fh) fclose($fh);
        return false;
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($value, JSON_PRETTY_PRINT));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return true;
}

function membership_append_json_list($file, $record) {
    $fh = fopen($file, 'c+');
    if (!$fh || !flock($fh, LOCK_EX)) {
        if ($fh) fclose($fh);
        return false;
    }
    $size = filesize($file) ?: 0;
    $raw = $size > 0 ? fread($fh, $size) : '';
    $list = $raw ? json_decode($raw, true) : [];
    if (!is_array($list)) $list = [];
    $list[] = $record;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($list, JSON_PRETTY_PRINT));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return true;
}

// JSON safe to drop inside an inline <script>: no "</script" and no raw
// U+2028/U+2029 line terminators.
function membership_safe_inline_json($value) {
    $json = json_encode($value);
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
    $fh = @fopen($path, 'r');
    if (!$fh) return ['ok' => false, 'error' => 'Could not read the uploaded file.'];
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
