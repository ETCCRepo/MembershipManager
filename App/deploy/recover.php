<?php
// Password recovery — "forgot password" for the website login password, the developer password, or both.
// Linked from the login page (?for=site) and from the Developer unlock form (?for=dev).
//
// This is deliberately NOT a hardcoded password: anyone who ever read a fixed backdoor password (in this
// file, in git history, in a chat log) would have permanent access no matter how often the real passwords are
// changed. Two out-of-band proofs are accepted instead, each one-shot and time-limited:
//
//   A. Emailed link — press "Email me a recovery link"; a link goes to the club's recovery mailbox
//      ($RECOVERY_EMAIL in secrets.php, never an address typed into this page). Valid 30 minutes; only its
//      SHA-256 hash is stored. At most one email per 15 minutes per password, from anyone.
//   B. FTP trigger — upload an EMPTY file into this app's deploy folder (you need FTP access, the same access
//      that protects secrets.php), then open this page within 15 minutes:
//        data/RESET-SITE-PASSWORD   resets the website login password
//        data/RESET-DEV-PASSWORD    resets the developer password
//        data/RESET-PASSWORDS       resets both
//
// Confirming replaces ONLY the chosen password(s) with new random ones, shown ONCE on screen. Resetting the
// website password also signs out every other browser. See App/deploy/README.md "Password recovery".

// secrets.php is optional here so the FTP method still works if it is broken.
@include __DIR__ . '/secrets.php';
require __DIR__ . '/lib.php';
require __DIR__ . '/mailer.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer'); // the emailed URL carries a one-time token

const MEMBERSHIP_RECOVERY_MAX_AGE = 900; // FTP trigger lifetime: 15 minutes

function recover_trigger_names() { return ['site' => 'RESET-SITE-PASSWORD', 'dev' => 'RESET-DEV-PASSWORD', 'both' => 'RESET-PASSWORDS']; }
function recover_trigger_path($scope) { return membership_data_dir() . '/' . recover_trigger_names()[$scope]; }
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function recover_btn($label, $danger = false) {
    return '<button type="submit" style="background:' . ($danger ? '#b0141e' : '#0b5cad') . ';border:0;color:#fff;padding:12px 20px;' .
        'border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">' . h($label) . '</button>';
}
function recover_page($body, $scope = 'both') {
    header('Content-Type: text/html; charset=utf-8');
    $title = ['site' => 'Forgot website password', 'dev' => 'Forgot developer password', 'both' => 'Password Recovery'][$scope];
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' .
        '<title>ETCC Membership — ' . h($title) . '</title>' .
        '<body style="font:15px/1.5 -apple-system,\'Segoe UI\',Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#1a1a1a">' .
        '<h1 style="font-size:20px;margin-bottom:4px">' . h($title) . '</h1>' . $body .
        '<p style="margin-top:28px;font-size:13px"><a href="index.php">&larr; Back to the website</a></p></body>';
    exit;
}
function recover_done($pw, $scope) {
    $code = 'font-size:16px;background:#f2f4f7;padding:2px 6px;border-radius:4px';
    $html = '<p style="color:#147d3a;font-weight:600">The ' . h(membership_recovery_scope_label($scope)) . ' ' . ($scope === 'both' ? 'were' : 'was') . ' reset. Write ' . ($scope === 'both' ? 'these' : 'this') . ' down now — shown only this once:</p>';
    if (isset($pw['site'])) $html .= '<p>Website login password:&nbsp; <code style="' . $code . '">' . h($pw['site']) . '</code></p>';
    if (isset($pw['dev'])) $html .= '<p>Developer password:&nbsp; <code style="' . $code . '">' . h($pw['dev']) . '</code></p>';
    if (isset($pw['site'])) $html .= '<p>Every other signed-in browser has been signed out. Log in with the website password above, then open the <strong>Developer</strong> menu and change it to one of your own choosing.</p>';
    else $html .= '<p>Log in to the website as usual, open the <strong>Developer</strong> menu, unlock it with the password above, and change it to one of your own choosing. (A changed developer password also works as the website login.)</p>';
    recover_page($html, $scope);
}
function recover_options($scope, $note = '') {
    $name = recover_trigger_names()[$scope];
    $present = is_file(recover_trigger_path($scope));
    $age = $present ? time() - filemtime(recover_trigger_path($scope)) : 0;
    $what = membership_recovery_scope_label($scope);
    recover_page(
        $note .
        '<p>This page replaces the ' . h($what) . ' with ' . ($scope === 'both' ? 'new random ones' : 'a new random one') . ', for when ' . ($scope === 'both' ? 'both are' : 'it is') . ' forgotten. ' .
        'Choose one way to prove you are an administrator:</p>' .
        '<h3 style="margin:18px 0 4px;font-size:15px">Option 1 — email a recovery link</h3>' .
        '<p style="margin-top:0">Sends a one-time link (valid 30 minutes) to the club\'s recovery mailbox.</p>' .
        '<form method="post"><input type="hidden" name="action" value="request_email"><input type="hidden" name="for" value="' . h($scope) . '">' . recover_btn('Email me a recovery link') . '</form>' .
        '<h3 style="margin:22px 0 4px;font-size:15px">Option 2 — upload a file by FTP</h3>' .
        '<p style="margin-top:0">Upload an empty file named <code>data/' . h($name) . '</code> into this app\'s <code>deploy</code> folder, then reload this page ' .
        'within 15 minutes.' . ($present ? ' <strong>A request file was found but it is too old (' . (int)$age . ' seconds); delete it and upload a fresh one.</strong>' : '') . '</p>',
        $scope
    );
}

$scope = membership_recovery_scope($_POST['for'] ?? $_GET['for'] ?? 'both');
$action = (string)($_POST['action'] ?? '');
$token = (string)($_POST['token'] ?? $_GET['token'] ?? '');

// Any FTP trigger file counts; it decides which password is reset (both beats site beats dev if several exist).
$trigger = null;
foreach (['both', 'site', 'dev'] as $sc) {
    $f = recover_trigger_path($sc);
    if (is_file($f)) { $age = time() - filemtime($f); $trigger = ['scope' => $sc, 'file' => $f, 'age' => $age, 'valid' => $age <= MEMBERSHIP_RECOVERY_MAX_AGE]; break; }
}
$triggerValid = $trigger && $trigger['valid'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($action === 'request_email') {
        $wait = membership_recovery_email_wait($scope);
        if ($wait > 0) {
            recover_options($scope, '<p style="color:#b0141e">A recovery email was already sent recently. Check the mailbox (including spam), or try again in ' .
                (int)ceil($wait / 60) . ' minute(s).</p>');
        }
        $tok = bin2hex(random_bytes(32));
        if (!membership_recovery_token_store($tok, $scope)) {
            recover_options($scope, '<p style="color:#b0141e">Could not prepare a recovery link (the server\'s data folder is not writable). Use the FTP option.</p>');
        }
        $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
        $base = ($https ? 'https://' : 'http://') . preg_replace('/[^a-z0-9.:\-]/i', '', $_SERVER['HTTP_HOST'] ?? 'localhost') .
            rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\') . '/recover.php';
        $what = membership_recovery_scope_label($scope);
        $sent = membership_send_mail(
            membership_mail_recipient(),
            'ETCC Membership Manager — ' . $what . ' recovery link',
            "Someone asked to reset the ETCC Membership Manager $what.\n\n" .
            "If this was you, open this link within 30 minutes and press the reset button:\n\n$base?token=$tok\n\n" .
            "It replaces the $what with " . ($scope === 'both' ? 'new random ones' : 'a new random one') . ($scope === 'dev' ? '.' : ' and signs everyone out.') . "\n" .
            "If you did not ask for this, ignore this email; the link expires by itself and nothing has changed.\n"
        );
        if ($sent !== true) {
            membership_recovery_token_consume(); // nothing was delivered, so no live link should remain
            @unlink(membership_recovery_log_file()); // and a failed send must not start the cooldown
            recover_options($scope, '<p style="color:#b0141e">The recovery email could not be sent: ' . h($sent) . '</p>' .
                '<p>Use the FTP option below, or ask the site administrator to check the SMTP settings in <code>secrets.php</code>.</p>');
        }
        recover_page('<p style="color:#147d3a;font-weight:600">A recovery link was sent to the club\'s recovery mailbox.</p>' .
            '<p>Open it within 30 minutes (check spam if you don\'t see it). Nothing has been changed yet.</p>', $scope);
    }

    if ($action === 'confirm_token') {
        $ok = membership_recovery_token_valid($token);
        $tokScope = membership_recovery_token_scope();
        membership_recovery_token_consume(); // one try per emailed link
        if (!$ok) recover_options($scope, '<p style="color:#b0141e">That recovery link is invalid, expired or already used.</p>');
        $pw = membership_recovery_reset_passwords($tokScope);
        if (!$pw) recover_options($tokScope, '<p style="color:#b0141e">Could not save the new password — nothing was changed. Request a new link and try again.</p>');
        recover_done($pw, $tokScope);
    }

    if ($action === 'confirm_trigger') {
        if ($trigger) @unlink($trigger['file']); // one upload = at most one attempt
        if (!$triggerValid) recover_options($scope, '<p style="color:#b0141e">No valid recovery request file was found (expired or already used).</p>');
        $pw = membership_recovery_reset_passwords($trigger['scope']);
        if (!$pw) recover_options($trigger['scope'], '<p style="color:#b0141e">Could not save the new password — nothing was changed. Upload the request file again to retry.</p>');
        recover_done($pw, $trigger['scope']);
    }
    recover_options($scope);
}

// GET: show whichever confirmation is pending; nothing changes until a POST.
if ($token !== '') {
    if (membership_recovery_token_valid($token)) {
        $ts = membership_recovery_token_scope();
        recover_page('<p>Your emailed recovery link is valid.</p>' .
            '<p>Pressing the button immediately replaces the <strong>' . h(membership_recovery_scope_label($ts)) . '</strong> with ' . ($ts === 'both' ? 'new random ones' : 'a new random one') .
            ($ts === 'dev' ? '.' : ' and signs out every other browser.') . '</p>' .
            '<form method="post"><input type="hidden" name="action" value="confirm_token"><input type="hidden" name="token" value="' . h($token) . '">' .
            recover_btn('Reset the ' . membership_recovery_scope_label($ts) . ' now', true) . '</form>', $ts);
    }
    recover_options($scope, '<p style="color:#b0141e">That recovery link is invalid, expired or already used.</p>');
}
if ($triggerValid) {
    $ts = $trigger['scope'];
    recover_page('<p>A valid recovery request file was found, uploaded ' . (int)$trigger['age'] . ' second' . ($trigger['age'] === 1 ? '' : 's') . ' ago.</p>' .
        '<p>Pressing the button immediately replaces the <strong>' . h(membership_recovery_scope_label($ts)) . '</strong> with ' . ($ts === 'both' ? 'new random ones' : 'a new random one') .
        ($ts === 'dev' ? '.' : ' and signs out every other browser.') . '</p>' .
        '<form method="post"><input type="hidden" name="action" value="confirm_trigger">' . recover_btn('Reset the ' . membership_recovery_scope_label($ts) . ' now', true) . '</form>', $ts);
}
recover_options($scope);
