<?php
// Copy this file to secrets.php (gitignored) and fill in the real value.
// $PASSWORD_HASH: generate with
//   openssl passwd -6 -salt "$(openssl rand -hex 8)" 'the-actual-password'
// Left empty, every login attempt is rejected.
$PASSWORD_HASH = '';

// ---- "Forgot password" emails (same settings as the Car Show app's secrets.php). A mailbox created in Hostinger
// hPanel > Emails works: port 465 is implicit TLS, 587 is STARTTLS. Without these the Forgot password pages cannot send.
$SMTP_HOST = 'smtp.hostinger.com';
$SMTP_PORT = 465;
$SMTP_USER = 'replace-with-real-mailbox@etccapps.com';
$SMTP_PASS = 'replace-with-real-mailbox-password';
$SMTP_FROM = 'replace-with-real-mailbox@etccapps.com';
// Optional: who receives the reset links (default etccwebsite.webmanager@gmail.com).
// $RECOVERY_EMAIL = 'etccwebsite.webmanager@gmail.com';
