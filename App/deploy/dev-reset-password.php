<?php
// Reached via the link dev-forgot-password.php emails to the admin address: validates the one-time token, then lets the visitor
// choose a new DEVELOPER password. Logic: membership_reset_handle('dev') in lib.php.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
require __DIR__ . '/lib.php';
membership_reset_handle('dev');
