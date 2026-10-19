/* Run with: node test/run-tests.js   (Node only; no PHP needed — the CSV
 * parsing, validation, matching and every metric live in src/*.js.) */
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var L = require("../src/logic.js");
var I = require("../src/csvimport.js");
var R = require("../src/reports.js");

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

var NOW = new Date("2026-10-19T12:00:00Z");
var TODAY = "2026-10-19";

function load(file) {
  var bytes = fs.readFileSync(path.join(__dirname, "fixtures", file));
  var dec = I.decodeBytes(bytes);
  var rows = I.parseCsv(dec.text);
  var sug = I.suggestMapping(rows[0]);
  var built = I.buildMembers(rows, sug.mapping, { now: NOW });
  return { dec: dec, rows: rows, sug: sug, built: built, members: built.members };
}
var fx = load("clubexpress-sample.csv");
var members = fx.members;
function byLast(l) { return members.filter(function (m) { return m.lastName === l; }); }

console.log("CSV parsing");
test("handles quotes, embedded commas, embedded newlines, escaped quotes, CRLF and a missing final newline", function () {
  var rows = I.parseCsv('a,b,c\r\n1,"x, y","line1\nline2"\r\n"say ""hi""",,3');
  eq(rows, [["a", "b", "c"], ["1", "x, y", "line1\nline2"], ['say "hi"', "", "3"]]);
});
test("decodes UTF-8 (with or without BOM) and falls back to Windows-1252", function () {
  eq(I.decodeBytes(Buffer.from("\uFEFFJos\u00E9", "utf8")).text, "Jos\u00E9");
  var cp = I.decodeBytes(Buffer.from("Jos\xE9", "latin1"));
  eq([cp.text, cp.encoding], ["Jos\u00E9", "windows-1252"]);
});
test("reports replacement characters already present in the file", function () {
  assert.ok(fx.dec.replacementChars > 0);
});

console.log("Dates");
test("parses common formats to YYYY-MM-DD", function () {
  eq(I.parseDate("3/9/2025", 2026), "2025-03-09");
  eq(I.parseDate("12/21/2022", 2026), "2022-12-21");
  eq(I.parseDate("2024-03-05 10:15:00", 2026), "2024-03-05");
  eq(I.parseDate("Mar 5, 2024", 2026), "2024-03-05");
  eq(I.parseDate("03-05-2024", 2026), "2024-03-05");
});
test("two-digit years: up to the current year is 20xx, later is 19xx", function () {
  eq(I.parseDate("3/5/24", 2026), "2024-03-05");
  eq(I.parseDate("3/5/49", 2026), "1949-03-05");
});
test("rejects impossible or non-date values (no free-text like 'today')", function () {
  eq(I.parseDate("13/45/2024", 2026), "");
  eq(I.parseDate("2/30/2024", 2026), "");
  eq(I.parseDate("today", 2026), "");
  eq(I.parseDate("", 2026), "");
});

console.log("Column mapping (real ClubExpress headers)");
test("maps every required and key field, no required column missing", function () {
  eq(fx.sug.missingRequired, []);
  var h = fx.rows[0], m = fx.sug.mapping;
  eq(h[m.memberNumber], "member_number");
  eq(h[m.primaryMemberNumber], "primary_member_number");
  eq(h[m.email], "primary_email");
  eq(h[m.phone], "phone");
  eq(h[m.cellPhone], "cell_phone");
  eq(h[m.joinDate], "date_joined");
  eq(h[m.expirationDate], "expiration_date");
  eq(h[m.year], "Corvette Year");
});
test("reports missing required columns", function () {
  eq(I.suggestMapping(["Name", "Email"]).missingRequired, ["Last Name", "First Name"]);
});

console.log("Import: building and validating members");
test("rejects the nameless row and the exact duplicate row, with reasons", function () {
  eq(fx.built.rejected.length, 2);
  assert.ok(fx.built.rejected.some(function (r) { return /No first or last name/.test(r.reason); }));
  assert.ok(fx.built.rejected.some(function (r) { return /Duplicate of row 2/.test(r.reason); }));
  assert.strictEqual(members.length, fx.rows.length - 1 - 2);
});
test("accepts ragged rows (37 columns) alongside full 40-column rows", function () {
  assert.ok(fx.rows.some(function (r) { return r.length === 37; }));
  assert.ok(fx.rows.some(function (r) { return r.length === 40; }));
  assert.strictEqual(byLast("Sample1")[0].year, "" + byLast("Sample1")[0].year);
});
test("keeps ZIP+4 and text identifiers as text", function () {
  assert.ok(members.some(function (m) { return /^\d{5}-\d{4}$/.test(m.zip); }));
  eq(I.buildMembers([["last_name", "first_name", "zip", "member_number"], ["A", "B", "1234", "007"]], I.suggestMapping(["last_name", "first_name", "zip", "member_number"]).mapping, { now: NOW }).members[0].memberNumber, "007");
});
test("restores a ZIP's lost leading zero and flags it", function () {
  var h = ["last_name", "first_name", "zip"];
  var m = I.buildMembers([h, ["A", "B", "1234"]], I.suggestMapping(h).mapping, { now: NOW }).members[0];
  eq([m.zip, m.flags.indexOf("zipPadded") !== -1], ["01234", true]);
});
test("never stores credentials or sensitive personal columns", function () {
  var f = members[0].fields;
  ["login_name", "date_of_birth", "spouse_birthday", "anniversary", "gender", "pronoun_name"].forEach(function (k) { assert.ok(!(k in f), k); });
  assert.ok("primary_email" in f && "member_number" in f);
});
test("normalizes a membership type that lost its dash (U+FFFD)", function () {
  eq(byLast("Dashed")[0].membershipType, "ETCC Only - Single");
});
test("two different people sharing a member number are kept, flagged, with distinct keys", function () {
  var sh = members.filter(function (m) { return (m.flags || []).indexOf("sharedMemberNumber") !== -1; });
  eq(sh.length, 2);
  eq(new Set(sh.map(function (m) { return m.key; })).size, 2);
});
test("a member with no number is matched by name+ZIP and flagged", function () {
  var m = byLast("Numberless")[0];
  assert.ok(/^x:/.test(m.key));
  assert.ok(m.flags.indexOf("noMemberNumber") !== -1);
});
test("unreadable dates are kept raw, left blank, and flagged", function () {
  var m = byLast("Baddate")[0];
  eq([m.joinDate, m.joinDateRaw, m.flags.indexOf("badDate:joinDate") !== -1], ["", "13/45/2024", true]);
});
test("household comes from primary_member_number; role accounts are identified", function () {
  eq(byLast("Sample1").map(function (m) { return m.household; }), ["1001", "1001"]);
  eq(members.filter(function (m) { return m.isRole; }).length, 3);
});

console.log("Import: repeated imports and snapshot semantics");
test("first import adds everyone; importing the same file again changes nothing", function () {
  var first = I.diffAgainst([], members, "full");
  eq([first.added.length, first.updated.length, first.unchanged.length], [members.length, 0, 0]);
  var again = I.diffAgainst(members, load("clubexpress-sample.csv").members, "full");
  eq([again.added.length, again.updated.length, again.unchanged.length, again.notInFile.length], [0, 0, members.length, 0]);
});
test("a changed field is an update, not a new member", function () {
  var edited = JSON.parse(JSON.stringify(members));
  edited[0].email = "new@example.com";
  var d = I.diffAgainst(members, edited, "full");
  eq([d.added.length, d.updated.length, d.unchanged.length], [0, 1, members.length - 1]);
});
test("members missing from a FULL snapshot are reported but never treated as resigned", function () {
  var d = I.diffAgainst(members, members.slice(0, 10), "full");
  eq(d.notInFile.length, members.length - 10);
  eq(I.diffAgainst(members, members.slice(0, 10), "partial").notInFile.length, 0);
});
test("partial import merges; full import replaces", function () {
  var part = members.slice(0, 5).map(function (m) { var c = JSON.parse(JSON.stringify(m)); c.city = "Changed"; return c; });
  var merged = I.applyImport(members, part, "partial");
  eq(merged.length, members.length);
  eq(merged[0].city, "Changed");
  eq(I.applyImport(members, part, "full").length, 5);
});

console.log("CSV export safety");
test("formula-looking cells are neutralised and quotes/commas escaped", function () {
  eq(I.csvCell("=SUM(A1)"), "'=SUM(A1)");
  eq(I.csvCell("+1"), "'+1");
  eq(I.csvCell("-1"), "'-1");
  eq(I.csvCell("@cmd"), "'@cmd");
  eq(I.csvCell('a "b", c'), '"a ""b"", c"');
  eq(I.toCsv(["h"], [["=x"]]), "h\r\n'=x\r\n");
});

console.log("Reporting periods (timezone America/New_York, inclusive dates)");
test("today is computed in Eastern time, not UTC", function () {
  eq(R.todayET(new Date("2026-10-20T02:30:00Z")), "2026-10-19");
});
test("month arithmetic clamps to month end", function () {
  eq(R.addMonths("2026-03-31", -1), "2026-02-28");
  eq(R.addMonths("2024-03-31", -1), "2024-02-29");
});
test("rolling periods end today; calendar periods are whole completed months", function () {
  var r1 = R.period("1m", TODAY, "rolling");
  eq([r1.start, r1.end, r1.kind], ["2026-09-20", "2026-10-19", "rolling"]);
  var r3 = R.period("3m", TODAY, "calendar");
  eq([r3.start, r3.end, r3.kind], ["2026-07-01", "2026-09-30", "calendar"]);
  eq([r3.prevStart, r3.prevEnd], ["2026-04-01", "2026-06-30"]);
  var r12 = R.period("12m", TODAY, "rolling");
  eq([r12.start, r12.prevEnd], ["2025-10-20", "2025-10-19"]);
});
test("custom range is ordered and gets an equal-length prior period", function () {
  var c = R.period("custom", TODAY, "rolling", { start: "2026-03-10", end: "2026-03-01" });
  eq([c.start, c.end, c.prevEnd], ["2026-03-01", "2026-03-10", "2026-02-28"]);
  eq(R.daysBetween(c.prevStart, c.prevEnd), R.daysBetween(c.start, c.end));
});
test("'all' starts in 1958", function () { eq(R.period("all", TODAY, "rolling").start, "1958-01-01"); });
test("percent change is undefined (not infinity) when the prior period is zero", function () {
  eq(R.compare(5, 0).pct, null);
  eq(R.compare(0, 0).text, "no change (0 in both periods)");
  eq(R.compare(12, 10).text, "+2 (+20%)");
  eq(R.compare(5, 10).text, "-5 (-50%)");
});

console.log("Metrics");
var suspect = R.suspectJoinDates(members);
var peoplePool = R.pool(members, {});
test("role accounts are excluded from member counts by default", function () {
  eq(peoplePool.length, members.length - 3);
  eq(R.pool(members, { includeRoles: true }).length, members.length);
});
test("household unit counts one record per primary membership", function () {
  var hh = R.pool(members, { unit: "households" });
  eq(hh.length, new Set(peoplePool.map(function (m) { return m.household; })).size);
  assert.ok(hh.length < peoplePool.length);
  assert.ok(hh.every(function (m) { return m.memberLevel === "1"; }));
});
test("a block of members sharing one join date is flagged as a bulk-load date", function () {
  assert.ok(suspect["2022-12-21"] >= 40);
  eq(Object.keys(suspect), ["2022-12-21"]);
});
test("new-member counts leave out the bulk-load date and say how many", function () {
  var nm = R.newMembers(peoplePool, "2022-01-01", TODAY, suspect);
  assert.ok(nm.excludedBulkDate >= 40);
  assert.ok(nm.members.every(function (m) { return m.joinDate !== "2022-12-21"; }));
});
test("chart buckets and the supporting totals agree (monthly, yearly, period)", function () {
  var p = R.period("12m", TODAY, "rolling");
  var months = R.monthlyNew(peoplePool, p.start, p.end, suspect);
  var total = months.reduce(function (s, m) { return s + m.count; }, 0);
  eq(total, R.newMembers(peoplePool, p.start, p.end, suspect).members.length);
  eq(months.length, 13);
  eq(months.every(function (m) { return m.members.length === m.count; }), true);
  var years = R.yearlyNew(peoplePool, p.start, p.end, suspect);
  eq(years.map(function (y) { return y.label; }), ["2025", "2026"]);
  eq(years.reduce(function (s, y) { return s + y.count; }, 0), total);
  var wide = R.yearlyNew(peoplePool, "2023-01-01", TODAY, suspect);
  eq(wide.reduce(function (s, y) { return s + y.count; }, 0), R.newMembers(peoplePool, "2023-01-01", TODAY, suspect).members.length);
});
test("every distribution accounts for every member exactly once", function () {
  [function (m) { return m.status; }, function (m) { return m.membershipType; }, function (m) { return R.tenureBucket(m, TODAY, suspect); }, function (m) { return m.city; }]
    .forEach(function (fn) {
      var d = R.distribution(peoplePool, fn);
      eq(d.reduce(function (s, r) { return s + r.count; }, 0), peoplePool.length);
    });
  var capped = R.distribution(peoplePool, function (m) { return m.city; }, { top: 3 });
  eq(capped.reduce(function (s, r) { return s + r.count; }, 0), peoplePool.length);
});
test("tenure puts bulk-date and undated members in their own buckets", function () {
  var d = R.distribution(peoplePool, function (m) { return R.tenureBucket(m, TODAY, suspect); });
  var labels = d.map(function (r) { return r.label; });
  assert.ok(labels.indexOf("Bulk-import join date (tenure unknown)") !== -1);
  assert.ok(labels.indexOf("No join date") !== -1);
  eq(R.tenureBucket(byLast("Founder")[0], TODAY, suspect), "10+ years");
});
test("renewals: expired-but-active, due soon, and no-expiry (role) are separated", function () {
  var r = R.renewals(members, TODAY);
  eq(r.expiredStillActive.map(function (m) { return m.lastName; }), ["Lapsed"]);
  assert.ok(r.due30.concat(r.due60).concat(r.due90).some(function (m) { return m.lastName === "Soon"; }));
  eq(r.noExpiry.filter(function (m) { return m.isRole; }).length, 3);
});
test("anniversaries and long service ignore unreliable join dates", function () {
  var ls = R.longServing(peoplePool, TODAY, 10, suspect);
  eq(ls.map(function (m) { return m.lastName; }), ["Founder", "Veteran"]);
  var an = R.upcomingAnniversaries(peoplePool, "2026-03-01", 366, suspect);
  assert.ok(an.every(function (a) { return a.member.joinDate !== "2022-12-21"; }));
});
test("data-quality report lists the planted problems", function () {
  var dq = R.dataQuality(members, TODAY);
  function c(label) { return dq.filter(function (x) { return x.label === label; })[0].count; }
  eq(c("Active but past expiration"), 1);
  eq(c("Member number shared with another person"), 2);
  eq(c("No member number"), 1);
  eq(c("Unreadable date value"), 1);
});
test("household report: 2-person households count households, not people", function () {
  var s = R.householdSizes(peoplePool);
  var two = s.filter(function (r) { return r.key === "2"; })[0];
  eq(two.count * 2, two.members.length);
});

console.log("Households = single members + couple members / 2");
test("total follows the club's formula and agrees with the primary-number grouping when couples are complete", function () {
  var singles = peoplePool.filter(function (m) { return !/couple/i.test(m.membershipType); }).length;
  var couples = peoplePool.filter(function (m) { return /couple/i.test(m.membershipType); }).length;
  eq(R.householdTotal(peoplePool), singles + couples / 2);
  eq(R.householdTotal(peoplePool), R.pool(members, { unit: "households" }).length);
});
test("an unpaired couple member counts as half a household", function () {
  eq(R.householdTotal([{ membershipType: "Couple" }]), 0.5);
  eq(R.householdTotal([{ membershipType: "Couple" }, { membershipType: "Couple" }, { membershipType: "Single" }, { membershipType: "ETCC Only - Single" }]), 3);
});
test("households by type adds up to the total; people column adds up to head-count", function () {
  var rows = R.householdsByType(peoplePool);
  eq(rows.reduce(function (a, r) { return a + r.count; }, 0), R.householdTotal(peoplePool));
  eq(rows.reduce(function (a, r) { return a + r.people; }, 0), peoplePool.length);
  var couple = rows.filter(function (r) { return r.label === "Couple"; })[0];
  eq(couple.count * 2, couple.people);
});
test("composition splits single and couple households", function () {
  var b = R.householdBreakdown(peoplePool);
  eq(b.singleHouseholds + b.coupleHouseholds, b.total);
  eq(b.total, R.householdTotal(peoplePool));
});
test("new households by month sum to the households among the new members (chart = table)", function () {
  var p = R.period("12m", TODAY, "rolling");
  var months = R.householdsMonthly(peoplePool, p.start, p.end, suspect);
  var nm = R.newMembers(peoplePool, p.start, p.end, suspect).members;
  eq(months.reduce(function (a, m) { return a + m.count; }, 0), R.householdTotal(nm));
  eq(months.reduce(function (a, m) { return a + m.people; }, 0), nm.length);
});

console.log("Renewal status (renewed / left to renew / expired)");
test("renewal target is the year-end renewals are working toward (season starts Oct 1)", function () {
  eq(R.renewalTarget("2026-10-19"), "2027-12-31");
  eq(R.renewalTarget("2026-09-30"), "2026-12-31");
  eq(R.renewalTarget("2027-02-10"), "2027-12-31");
  eq(R.renewalTarget("2026-12-31"), "2027-12-31");
});
test("every member lands in exactly one renewal group; groups follow the dates", function () {
  var rs = R.renewalStatus(peoplePool, TODAY);
  eq(rs.target, "2027-12-31");
  eq(rs.renewed.length + rs.left.length + rs.expired.length + rs.noExpiry.length, peoplePool.length);
  eq(rs.renewed.map(function (m) { return m.lastName; }).sort(), ["Founder", "Honor", "Veteran"]);
  eq(rs.expired.map(function (m) { return m.lastName; }), ["Lapsed"]);
  assert.ok(rs.left.some(function (m) { return m.lastName === "Soon"; }));
  assert.ok(rs.left.every(function (m) { return m.expirationDate >= TODAY && m.expirationDate < "2027-12-31"; }));
});
test("after the year-end passes, unrenewed members are expired and renewed ones are current", function () {
  var rs = R.renewalStatus([{ expirationDate: "2026-12-31" }, { expirationDate: "2027-12-31" }], "2027-02-01");
  eq([rs.expired.length, rs.renewed.length, rs.left.length], [1, 1, 0]);
});

console.log("Chart-page periods and buckets");
test("2-year and 10-year rolling periods", function () {
  var p2 = R.period("24m", TODAY, "rolling"), p10 = R.period("120m", TODAY, "rolling");
  eq([p2.start, p2.end, p2.label], ["2024-10-20", "2026-10-19", "Last 2 years (rolling)"]);
  eq([p10.start, p10.label], ["2016-10-20", "Last 10 years (rolling)"]);
});
test("bar width: weeks for a month, months up to 2 years, years beyond", function () {
  eq(["1m", "3m", "6m", "12m", "24m", "60m", "120m", "all"].map(R.granularityFor), ["week", "month", "month", "month", "month", "year", "year", "year"]);
});
test("every bucket size sums to the period total (chart = table), including weeks and years", function () {
  ["1m", "3m", "12m", "24m", "60m", "120m", "all"].forEach(function (k) {
    var p = R.period(k, TODAY, "rolling"), g = R.granularityFor(k);
    var b = R.bucketsNew(peoplePool, p.start, p.end, suspect, g);
    eq(b.reduce(function (a, x) { return a + x.count; }, 0), R.newMembers(peoplePool, p.start, p.end, suspect).members.length, k);
    eq(b.every(function (x) { return x.members.length === x.count; }), true);
  });
});
test("weekly buckets cover the range with no gaps; years drop leading empty years", function () {
  var p = R.period("1m", TODAY, "rolling"), w = R.bucketsNew(peoplePool, p.start, p.end, suspect, "week");
  eq(w[0].key, p.start);
  eq(w.length, 5);
  var y = R.bucketsNew(peoplePool, "1958-01-01", TODAY, suspect, "year");
  eq(y[0].label, "1958"); // the fixture has a real 1958 join
  var none = R.bucketsNew([{ joinDate: "2020-05-05", membershipType: "Single" }], "1958-01-01", TODAY, {}, "year");
  eq(none[0].label, "2020");
});

console.log("Monthly meeting periods (Wednesday after the first Tuesday through the next first Tuesday)");
test("first Tuesday of a month, including months starting on a Tuesday and year boundaries", function () {
  eq(R.firstTuesday(2026, 10), "2026-10-06");
  eq(R.firstTuesday(2026, 9), "2026-09-01"); // the 1st is itself a Tuesday
  eq(R.firstTuesday(2026, 12), "2026-12-01");
  eq(R.firstTuesday(2027, 1), "2027-01-05");
});
test("a period starts the Wednesday after one first Tuesday and ends on the next", function () {
  var p = R.meetingPeriodEndingIn(2026, 10);
  eq([p.start, p.end], ["2026-09-02", "2026-10-06"]);
  eq(new Date(p.start + "T00:00:00Z").getUTCDay(), 3); // Wednesday
  eq(new Date(p.end + "T00:00:00Z").getUTCDay(), 2);   // Tuesday
  var q = R.meetingPeriodEndingIn(2027, 1);
  eq([q.start, q.end], ["2026-12-02", "2027-01-05"]);
  eq(R.meetingPeriodAfter("2026-10-06").end, "2026-11-03");
  eq(R.meetingPeriodAfter("2026-10-06").start, "2026-10-07");
});
test("last month = latest period whose meeting day has arrived; in-progress period comes first", function () {
  var l = R.meetingPeriods("2026-10-19", 4);
  eq([l[0].start, l[0].end, l[0].inProgress], ["2026-10-07", "2026-11-03", true]);
  eq([l[1].start, l[1].end, l[1].completed], ["2026-09-02", "2026-10-06", true]);
  eq(l.length, 5);
});
test("on the meeting day the just-ended period is already 'last month'; the day after, the next has begun", function () {
  eq(R.meetingPeriods("2026-10-06", 2)[1].end, "2026-10-06");
  eq(R.meetingPeriods("2026-10-06", 2)[0].end, "2026-11-03");
  eq(R.meetingPeriods("2026-10-07", 2)[0].start, "2026-10-07");
  eq(R.meetingPeriods("2026-10-05", 2)[0].end, "2026-10-06"); // meeting still ahead
  eq(R.meetingPeriods("2026-10-05", 2)[1].end, "2026-09-01");
});
test("periods tile the calendar with no gaps or overlaps, across a year end", function () {
  var l = R.meetingPeriods("2027-01-20", 14);
  for (var i = 0; i < l.length - 1; i++) eq(R.addDays(l[i + 1].end, 1), l[i].start);
  assert.ok(l.some(function (p) { return p.end === "2027-01-05"; }) && l.some(function (p) { return p.end === "2026-12-01"; }));
});
test("members joined: the meeting day ending the period is included, the previous meeting day is not", function () {
  var p = R.meetingPeriodEndingIn(2026, 10);
  var ms = [["2026-09-01", "meetingBefore"], ["2026-09-02", "firstDay"], ["2026-10-06", "lastDay"], ["2026-10-07", "nextPeriod"]]
    .map(function (x) { return { joinDate: x[0], lastName: x[1], membershipType: "Single" }; });
  eq(R.newMembers(ms, p.start, p.end, {}).members.map(function (m) { return m.lastName; }), ["firstDay", "lastDay"]);
});
test("anniversaries and expirations inside a range, across the year end; no-expiry dates ignored", function () {
  var ms = [{ joinDate: "2020-12-20", lastName: "A" }, { joinDate: "2020-01-03", lastName: "B" }, { joinDate: "2025-12-20", lastName: "C" }, { joinDate: "2026-12-20", lastName: "D" }];
  var an = R.anniversariesInRange(ms, "2026-12-02", "2027-01-05", {});
  eq(an.map(function (a) { return a.member.lastName + a.years; }), ["A6", "C1", "B7"]);
  var ex = R.expiringInRange([{ expirationDate: "2026-11-15", lastName: "x" }, { expirationDate: "2066-01-01", lastName: "role" }, { expirationDate: "2026-12-01", lastName: "y" }], "2026-11-01", "2026-12-31", "2026-10-19");
  eq(ex.map(function (m) { return m.lastName; }), ["x", "y"]);
});

console.log("History: snapshots are the only source of totals over time");
var snaps = [
  { id: "a", date: "2026-01-01", mode: "full", people: 3, households: 2, keys: ["n:1", "n:2", "n:3"] },
  { id: "b", date: "2026-06-01", mode: "full", people: 3, households: 2, keys: ["n:1", "n:3", "n:4"] },
  { id: "p", date: "2026-07-01", mode: "partial", people: 1, households: 1, keys: ["n:9"] },
  { id: "c", date: "2026-10-01", mode: "full", people: 3, households: 2, keys: ["n:1", "n:2", "n:4"] }
];
test("partial imports never become points on the totals-over-time line", function () {
  eq(R.snapshotSeries(snaps).map(function (s) { return s.date; }), ["2026-01-01", "2026-06-01", "2026-10-01"]);
});
test("retention, new, lost and reactivated are derived from consecutive full snapshots", function () {
  var ch = R.snapshotChanges(snaps);
  eq(ch.length, 2);
  eq([ch[0].retained, ch[0].joined, ch[0].lost, ch[0].reactivated], [2, ["n:4"], ["n:2"], []]);
  eq([ch[1].retained, ch[1].joined, ch[1].lost, ch[1].reactivated], [2, [], ["n:3"], ["n:2"]]);
  eq(Math.round(ch[0].retentionPct), 67);
});
test("fewer than two full snapshots yields no movement figures", function () {
  eq(R.snapshotChanges(snaps.slice(0, 1)), []);
});

console.log("Membership directory (src/logic.js)");
test("search matches any field, all terms required", function () {
  eq(L.searchMembers(members, "alex4@example.com").length, 1);
  eq(L.searchMembers(members, "sample1 alex1").length > 0, true);
  assert.ok(L.searchMembers(members, "oak ridge").length > 0);
});
test("sorting puts blanks last in both directions; member numbers sort numerically", function () {
  var ms = [{ memberNumber: "10", lastName: "B" }, { memberNumber: "9", lastName: "A" }, { memberNumber: "", lastName: "C" }];
  eq(L.sortMembers(ms, "memberNumber", "asc").map(function (m) { return m.lastName; }), ["A", "B", "C"]);
  eq(L.sortMembers(ms, "memberNumber", "desc").map(function (m) { return m.lastName; }), ["B", "A", "C"]);
});
test("dates display as M/D/YYYY", function () { eq(L.formatDate("2025-03-09"), "3/9/2025"); });

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
