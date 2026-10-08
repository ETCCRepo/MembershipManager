<?php
// Destroys the PHP session and returns to the login screen — used by the
// hamburger menu's "Logout" item (App/src/app.js).
session_start();
session_unset();
session_destroy();
header('Location: index.php');
exit;
