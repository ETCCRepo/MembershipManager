<?php
// Copy this file to secrets.php (gitignored) and fill in the real value.
// $PASSWORD_HASH: generate with
//   openssl passwd -6 -salt "$(openssl rand -hex 8)" 'the-actual-password'
// Left empty, every login attempt is rejected.
$PASSWORD_HASH = '';

// ---- Emailed password-recovery link (recover.php). Optional: without it the
// FTP-upload recovery method still works. The link always goes to
// $RECOVERY_EMAIL, never to an address typed into the page.
$RECOVERY_EMAIL = 'etccwebsite.webmanager@gmail.com';
$SMTP = [
    'host' => '',          // your mailbox provider's SMTP host; empty = fall back to PHP mail()
    'port' => 587,         // 587 with 'tls' (STARTTLS), or 465 with 'ssl'
    'secure' => 'tls',     // 'tls' | 'ssl' | '' (none; not recommended)
    'username' => '',      // the mailbox login
    'password' => '',      // the mailbox password
    'from' => '',          // sender address, usually the same mailbox
    'fromName' => 'ETCC Membership Manager',
];
