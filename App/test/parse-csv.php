<?php
// Test helper: runs deploy/lib.php's membership_parse_csv() on a file and
// prints the result as JSON, so test/run-tests.js can assert on it.
require __DIR__ . '/../deploy/lib.php';
echo json_encode(membership_parse_csv($argv[1]));
