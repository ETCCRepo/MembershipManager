/* Run with: node test/run-tests.js  (needs `php` on PATH for the import tests) */
var assert = require("assert");
var path = require("path");
var execFileSync = require("child_process").execFileSync;
var L = require("../src/logic.js");

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

function parseFixture(file) {
  var out = execFileSync("php", [path.join(__dirname, "parse-csv.php"), path.join(__dirname, "fixtures", file)]);
  return JSON.parse(out.toString());
}

console.log("Import (deploy/lib.php)");
var parsed = parseFixture("members.csv");
var byLast = {};
(parsed.members || []).forEach(function (m) { byLast[m.lastName] = m; });

test("parses every member row, sorted by last name", function () {
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.members.map(function (m) { return m.lastName; }), ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
});
test("matches headers regardless of case/spacing/punctuation (BOM, Member #, E-Mail)", function () {
  assert.strictEqual(byLast.Alpha.memberNumber, "101");
  assert.strictEqual(byLast.Alpha.email, "alpha@example.com");
  assert.strictEqual(byLast.Alpha.spouseFirstName, "Pat");
  assert.strictEqual(byLast.Alpha.model, "C7");
});
test("normalizes join dates in several formats to YYYY-MM-DD", function () {
  assert.strictEqual(byLast.Alpha.joinDate, "2025-01-15");
  assert.strictEqual(byLast.Bravo.joinDate, "2025-01-03");
  assert.strictEqual(byLast.Charlie.joinDate, "2025-03-09");
  assert.strictEqual(byLast.Delta.joinDate, "2024-03-22");
  assert.strictEqual(byLast.Echo.joinDate, "");
});
test("keeps a quoted multi-line address in one row", function () {
  assert.strictEqual(byLast.Bravo.address, "2 Example Ave\nApt 3");
  assert.strictEqual(byLast.Bravo.city, "Maryville");
});
test("keeps unrecognized columns under their original header", function () {
  assert.strictEqual(byLast.Alpha.fields["Emergency Contact"], "Example Contact");
  assert.strictEqual(byLast.Alpha.fields["Member #"], "101");
});
test("rejects a file without first/last name columns", function () {
  var fs = require("fs"), os = require("os");
  var tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mm-")), "bad.csv");
  fs.writeFileSync(tmp, "Name,Email\nSomeone,a@example.com\n");
  var out = JSON.parse(execFileSync("php", [path.join(__dirname, "parse-csv.php"), tmp]).toString());
  assert.strictEqual(out.ok, false);
  assert.ok(/First Name/.test(out.error));
});

console.log("Monthly Membership Report (src/logic.js)");
var members = parsed.members;
test("join years are listed newest first", function () {
  assert.deepStrictEqual(L.joinYears(members), ["2025", "2024"]);
});
test("a single year lists all twelve months, with joins in the right month", function () {
  var r = L.monthlyJoinReport(members, "2025");
  assert.strictEqual(r.months.length, 12);
  assert.strictEqual(r.months[0].label, "January 2025");
  assert.deepStrictEqual(r.months[0].members.map(function (m) { return m.lastName; }), ["Bravo", "Alpha"]);
  assert.deepStrictEqual(r.months[2].members.map(function (m) { return m.lastName; }), ["Charlie"]);
  assert.strictEqual(r.months[1].members.length, 0);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.undated, 1);
});
test("all years lists only months with joins, oldest first", function () {
  var r = L.monthlyJoinReport(members, "all");
  assert.deepStrictEqual(r.months.map(function (m) { return m.key; }), ["2024-03", "2025-01", "2025-03"]);
  assert.strictEqual(r.total, 4);
});

console.log("Membership tab (src/logic.js)");
test("search matches any field, all terms required", function () {
  assert.deepStrictEqual(L.searchMembers(members, "knoxville").map(function (m) { return m.lastName; }), ["Alpha", "Charlie"]);
  assert.deepStrictEqual(L.searchMembers(members, "knoxville c2").map(function (m) { return m.lastName; }), ["Charlie"]);
  assert.deepStrictEqual(L.searchMembers(members, "example contact").map(function (m) { return m.lastName; }), ["Alpha"]);
});
test("sorting by join date puts blanks last in both directions", function () {
  assert.deepStrictEqual(L.sortMembers(members, "joinDate", "asc").map(function (m) { return m.lastName; }), ["Delta", "Bravo", "Alpha", "Charlie", "Echo"]);
  assert.deepStrictEqual(L.sortMembers(members, "joinDate", "desc").map(function (m) { return m.lastName; }), ["Charlie", "Alpha", "Bravo", "Delta", "Echo"]);
});
test("member numbers sort numerically", function () {
  var ms = [{ memberNumber: "9", lastName: "A" }, { memberNumber: "10", lastName: "B" }];
  assert.deepStrictEqual(L.sortMembers(ms, "memberNumber", "asc").map(function (m) { return m.memberNumber; }), ["9", "10"]);
});
test("dates display as M/D/YYYY", function () {
  assert.strictEqual(L.formatDate("2025-03-09"), "3/9/2025");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
