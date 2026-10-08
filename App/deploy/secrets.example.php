<?php
// Copy this file to secrets.php (gitignored) and fill in the real value.
// $PASSWORD_HASH: generate with
//   openssl passwd -6 -salt "$(openssl rand -hex 8)" 'the-actual-password'
// Left empty, every login attempt is rejected.
$PASSWORD_HASH = '';
