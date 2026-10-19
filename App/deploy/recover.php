<?php
// Emergency password recovery — for when BOTH the website login password and
// the developer password are lost.
//
// This is deliberately NOT a hardcoded password: anyone who ever read a fixed
// backdoor password (in this file, in git history, in a chat log) would have
// permanent access no matter how often the real passwords are changed. Two
// out-of-band proofs are accepted instead, each one-shot and time-limited:
//
//   A. FTP trigger — upload an EMPTY file named data/RESET-PASSWORDS into this
//      app's deploy folder (you need FTP access, the same access that protects
//      secrets.php). Valid for 15 minutes.
//   B. Emailed link — press "Email me a recovery link"; a link is sent to the
//      club's recovery mailbox ($RECOVERY_EMAIL in secrets.php, never an
//      address typed into this page). Valid for 30 minutes; only its SHA-256
//      hash is stored. At most one email per 15 minutes, from anyone.
//
// Either way, confirming replaces BOTH passwords with new random ones, shown
// ONCE on screen, and signs out every other browser. Log in, open the
// Developer menu, and set passwords of your own choosing.
// See App/deploy/README.md "Password recovery".

// secrets.php is optional here so the FTP method still works if it is broken.
@include __DIR__ . '/secrets.php';
require __DIR__ . '/lib.php';
require __DIR__ . '/mailer.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer'); // the emailed URL carries a one-time token

const MEMBERSHIP_RECOVERY_MAX_AGE = 900; // FTP trigger lifetime: 15 minutes

function recover_trigger_file() { return membership_data_dir() . '/RESET-PASSWORDS'; }
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function recover_btn($label, $danger = false) {
    return '<button type="submit" style="background:' . ($danger ? '#b0141e' : '#0b5cad') . ';border:0;color:#fff;padding:12px 20px;' .
        'border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">' . h($label) . '</button>';
}
function recover_page($body) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' .
        '<title>ETCC Membership — Password Recovery</title>' .
        '<body style="font:15px/1.5 -apple-system,\'Segoe UI\',Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#1a1a1a">' .
        '<h1 style="font-size:20px;margin-bottom:4px">Password Recovery</h1>' . $body . '</body>';
    exit;
}
function recover_done($pw) {
    $code = 'font-size:16px;background:#f2f4f7;padding:2px 6px;border-radius:4px';
    recover_page(
        '<p style="color:#147d3a;font-weight:600">Both passwords were reset. Write these down now — each is shown only this once:</p>' .
        '<p>Website login password:&nbsp; <code style="' . $code . '">' . h($pw['site']) . '</code></p>' .
        '<p>Developer password:&nbsp; <code style="' . $code . '">' . h($pw['dev']) . '</code></p>' .
        '<p>Every other signed-in browser has been signed out. Log in with the website password, then open the ' .
        '<strong>Developer</strong> menu and change both passwords to ones of your own choosing.</p>'
    );
}
function recover_options($note = '') {
    $present = is_file(recover_trigger_file());
    $age = $present ? time() - filemtime(recover_trigger_file()) : 0;
    recover_page(
        ($note !== '' ? $note : '') .
        '<p>This page replaces the website login password and the developer password with new random ones, for when both are lost. ' .
        'Choose one way to prove you are an administrator:</p>' .
        '<h3 style="margin:18px 0 4px;font-size:15px">Option 1 — email a recovery link</h3>' .
        '<p style="margin-top:0">Sends a one-time link (valid 30 minutes) to the club\'s recovery mailbox.</p>' .
        '<form method="post"><input type="hidden" name="action" value="request_email">' . recover_btn('Email me a recovery link') . '</form>' .
        '<h3 style="margin:22px 0 4px;font-size:15px">Option 2 — upload a file by FTP</h3>' .
        '<p style="margin-top:0">Upload an empty file named <code>data/RESET-PASSWORDS</code> into this app\'s <code>deploy</code> folder, then reload this page ' .
        'within 15 minutes.' . ($present ? ' <strong>A request file was found but it is too old (' . (int)$age . ' seconds); delete it and upload a fresh one.</strong>' : '') . '</p>'
    );
}

$action = (string)($_POST['action'] ?? '');
$token = (string)($_POST['token'] ?? $_GET['token'] ?? '');
$triggerFile = recover_trigger_file();
$triggerPresent = is_file($triggerFile);
$triggerAge = $triggerPresent ? time() - filemtime($triggerFile) : null;
$triggerValid = $triggerPresent && $triggerAge <= MEMBERSHIP_RECOVERY_MAX_AGE;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($action === 'request_email') {
        $wait = membership_recovery_email_wait();
        if ($wait > 0) {
            recover_options('<p style="color:#b0141e">A recovery email was already sent recently. Check the mailbox (including spam), or try again in ' .
                (int)ceil($wait / 60) . ' minute(s).</p>');
        }
        $tok = bin2hex(random_bytes(32));
        if (!membership_recovery_token_store($tok)) {
            recover_options('<p style="color:#b0141e">Could not prepare a recovery link (the server\'s data folder is not writable). Use the FTP option.</p>');
        }
        $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
        $base = ($https ? 'https://' : 'http://') . preg_replace('/[^a-z0-9.:\-]/i', '', $_SERVER['HTTP_HOST'] ?? 'localhost') .
            rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\') . '/recover.php';
        $sent = membership_send_mail(
            membership_mail_recipient(),
            'ETCC Membership Manager — password recovery link',
            "Someone asked to reset the ETCC Membership Manager passwords.\n\n" .
            "If this was you, open this link within 30 minutes and press the reset button:\n\n$base?token=$tok\n\n" .
            "It replaces BOTH the website login password and the developer password with new random ones and signs everyone out.\n" .
            "If you did not ask for this, ignore this email; the link expires by itself and nothing has changed.\n"
        );
        if ($sent !== true) {
            membership_recovery_token_consume(); // nothing was delivered, so no live link should remain
            @unlink(membership_recovery_log_file()); // and a failed send must not start the cooldown
            recover_options('<p style="color:#b0141e">The recovery email could not be sent: ' . h($sent) . '</p>' .
                '<p>Use the FTP option below, or ask the site administrator to check the SMTP settings in <code>secrets.php</code>.</p>');
        }
        recover_page('<p style="color:#147d3a;font-weight:600">A recovery link was sent to the club\'s recovery mailbox.</p>' .
            '<p>Open it within 30 minutes (check spam if you don\'t see it). Nothing has been changed yet.</p>');
    }

    if ($action === 'confirm_token') {
        $ok = membership_recovery_token_valid($token);
        membership_recovery_token_consume(); // one try per emailed link
        if (!$ok) recover_options('<p style="color:#b0141e">That recovery link is invalid, expired or already used.</p>');
        $pw = membership_recovery_reset_passwords();
        if (!$pw) recover_options('<p style="color:#b0141e">Could not save the new passwords — nothing was changed. Request a new link and try again.</p>');
        recover_done($pw);
    }

    if ($action === 'confirm_trigger') {
        if ($triggerPresent) @unlink($triggerFile); // one upload = at most one attempt
        if (!$triggerValid) recover_options('<p style="color:#b0141e">No valid recovery request file was found (expired or already used).</p>');
        $pw = membership_recovery_reset_passwords();
        if (!$pw) recover_options('<p style="color:#b0141e">Could not save the new passwords — nothing was changed. Upload the request file again to retry.</p>');
        recover_done($pw);
    }
    recover_options();
}

// GET: show whichever confirmation is pending; nothing changes until a POST.
if ($token !== '') {
    if (membership_recovery_token_valid($token)) {
        recover_page('<p>Your emailed recovery link is valid.</p>' .
            '<p>Pressing the button immediately replaces <strong>both</strong> the website login password and the developer password with new random ones, ' .
            'and signs out every other browser.</p>' .
            '<form method="post"><input type="hidden" name="action" value="confirm_token"><input type="hidden" name="token" value="' . h($token) . '">' .
            recover_btn('Reset both passwords now', true) . '</form>');
    }
    recover_options('<p style="color:#b0141e">That recovery link is invalid, expired or already used.</p>');
}
if ($triggerValid) {
    recover_page('<p>A valid recovery request file was found, uploaded ' . (int)$triggerAge . ' second' . ($triggerAge === 1 ? '' : 's') . ' ago.</p>' .
        '<p>Pressing the button immediately replaces <strong>both</strong> the website login password and the developer password with new random ones, ' .
        'and signs out every other browser.</p>' .
        '<form method="post"><input type="hidden" name="action" value="confirm_trigger">' . recover_btn('Reset both passwords now', true) . '</form>');
}
recover_options();
