<?php
// Minimal, dependency-free authenticated SMTP sender for the "forgot password" emails and the Developer menu's
// test email. Same settings as the CarShow app, in secrets.php (gitignored; see secrets.example.php):
//   $SMTP_HOST, $SMTP_PORT, $SMTP_USER, $SMTP_PASS, $SMTP_FROM   (a mailbox created in Hostinger hPanel > Emails)
//   $RECOVERY_EMAIL   optional: who receives reset links (default etccwebsite.webmanager@gmail.com)
// Port 465 is implicit TLS, anything else (587) is STARTTLS. PHP's raw mail() is deliberately NOT used: on this
// hosting it reports success while silently failing to deliver to Gmail (no SPF/DKIM behind it).
// The recipient is ALWAYS $RECOVERY_EMAIL — never a value from a request — so the pages cannot be used to spam
// other people or to probe for addresses.

function membership_mail_recipient() {
    global $RECOVERY_EMAIL;
    $r = trim((string)($RECOVERY_EMAIL ?? ''));
    return $r !== '' ? $r : 'etccwebsite.webmanager@gmail.com';
}

function membership_mail_header_safe($s) {
    return trim(preg_replace('/[\r\n]+/', ' ', (string)$s));
}

// The SMTP settings from secrets.php, or null if they are not (fully) set.
function membership_smtp_config() {
    global $SMTP_HOST, $SMTP_PORT, $SMTP_USER, $SMTP_PASS, $SMTP_FROM;
    if (empty($SMTP_HOST) || empty($SMTP_USER) || empty($SMTP_PASS)) return null;
    $port = !empty($SMTP_PORT) ? (int)$SMTP_PORT : 465;
    return ['host' => (string)$SMTP_HOST, 'port' => $port, 'secure' => $port === 465 ? 'ssl' : 'tls',
        'username' => (string)$SMTP_USER, 'password' => (string)$SMTP_PASS, 'from' => !empty($SMTP_FROM) ? (string)$SMTP_FROM : (string)$SMTP_USER,
        'fromName' => 'ETCC Membership Manager'];
}

// Returns true, or a string describing why the message could not be sent.
function membership_send_mail($to, $subject, $body) {
    $cfg = membership_smtp_config();
    if ($cfg === null) return 'Email is not set up: add the SMTP settings to secrets.php (see secrets.example.php).';
    return membership_smtp_send($cfg, membership_mail_header_safe($to), membership_mail_header_safe($subject), $body);
}

// Reads one SMTP reply; multi-line replies ("250-...") end at "250 ...".
function membership_smtp_read($fp) {
    $data = '';
    while (($line = fgets($fp, 1024)) !== false) {
        $data .= $line;
        if (preg_match('/^\d{3}( |$)/', $line)) break;
    }
    return $data;
}

// $label is used in errors instead of the command, so credentials can never end up in a message.
function membership_smtp_cmd($fp, $cmd, $expect, $label) {
    fwrite($fp, $cmd . "\r\n");
    $resp = membership_smtp_read($fp);
    if (!in_array((int)substr($resp, 0, 3), (array)$expect, true)) {
        throw new Exception("Mail server rejected $label: " . trim(substr($resp, 0, 200)));
    }
    return $resp;
}

function membership_smtp_send($cfg, $to, $subject, $body) {
    $host = (string)$cfg['host'];
    $port = (int)($cfg['port'] ?? 465);
    $secure = strtolower((string)($cfg['secure'] ?? 'ssl'));
    $from = membership_mail_header_safe($cfg['from'] ?? ($cfg['username'] ?? ''));
    $fromName = str_replace('"', '', membership_mail_header_safe($cfg['fromName'] ?? 'ETCC Membership Manager'));
    if ($from === '') return 'Set $SMTP_FROM (or $SMTP_USER) in secrets.php.';
    $fp = null;
    try {
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) return "Could not connect to the mail server ($errstr).";
        stream_set_timeout($fp, 15);
        membership_smtp_read($fp); // greeting
        $me = preg_replace('/[^a-z0-9.\-]/i', '', $_SERVER['SERVER_NAME'] ?? 'localhost') ?: 'localhost';
        membership_smtp_cmd($fp, "EHLO $me", 250, 'EHLO');
        if ($secure === 'tls') {
            membership_smtp_cmd($fp, 'STARTTLS', 220, 'STARTTLS');
            if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) return 'Could not start TLS with the mail server.';
            membership_smtp_cmd($fp, "EHLO $me", 250, 'EHLO');
        }
        membership_smtp_cmd($fp, 'AUTH LOGIN', 334, 'AUTH');
        membership_smtp_cmd($fp, base64_encode((string)$cfg['username']), 334, 'the SMTP username');
        membership_smtp_cmd($fp, base64_encode((string)($cfg['password'] ?? '')), 235, 'the SMTP password');
        membership_smtp_cmd($fp, "MAIL FROM:<$from>", 250, 'the From address');
        membership_smtp_cmd($fp, "RCPT TO:<$to>", [250, 251], 'the recipient');
        membership_smtp_cmd($fp, 'DATA', 354, 'DATA');
        $headers = "From: \"$fromName\" <$from>\r\nTo: <$to>\r\nSubject: =?UTF-8?B?" . base64_encode($subject) . "?=\r\n" .
            'Date: ' . date('r') . "\r\nMessage-ID: <" . bin2hex(random_bytes(8)) . '@' . $me . ">\r\n" .
            "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit";
        $text = preg_replace('/^\./m', '..', preg_replace('/\r\n|\r|\n/', "\r\n", $body)); // normalize + dot-stuff
        membership_smtp_cmd($fp, $headers . "\r\n\r\n" . $text . "\r\n.", 250, 'the message');
        @fwrite($fp, "QUIT\r\n");
        return true;
    } catch (Exception $e) {
        return $e->getMessage();
    } finally {
        if (is_resource($fp)) fclose($fp);
    }
}
