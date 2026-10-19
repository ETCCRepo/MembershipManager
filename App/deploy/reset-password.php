<?php
// Reached via the link forgot-password.php emails to the admin address: validates the one-time token, then lets the visitor
// choose a new website login password. Logic: membership_reset_handle() in lib.php.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
require __DIR__ . '/lib.php';
membership_reset_handle('site');
