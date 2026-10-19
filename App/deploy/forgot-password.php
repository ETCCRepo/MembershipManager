<?php
// Public "forgot password" page for the WEBSITE login password, linked from the login page. Same mechanism as the CarShow
// app's forgot-password.php: this site has ONE shared password, so a self-service reset with no identity check would just
// let anyone reset it. Instead it emails a time-limited reset link (24 h) to the club's fixed admin address ($RECOVERY_EMAIL,
// default etccwebsite.webmanager@gmail.com) through the SMTP mailbox in secrets.php. The visitor never supplies or sees an email
// address. Logic: membership_forgot_handle() in lib.php; the link opens reset-password.php.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
@include __DIR__ . '/secrets.php';
require __DIR__ . '/lib.php';
membership_forgot_handle('site');
