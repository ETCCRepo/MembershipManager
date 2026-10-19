<?php
// "Forgot Developer password", linked from the Developer unlock form. Mirrors forgot-password.php but resets the DEVELOPER
// password, and (like the CarShow app) is gated behind the website's own login: reaching the Developer unlock form already
// requires being logged in. Logic: membership_forgot_handle('dev') in lib.php; the link opens dev-reset-password.php.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
@include __DIR__ . '/secrets.php';
require __DIR__ . '/lib.php';
membership_forgot_handle('dev');
