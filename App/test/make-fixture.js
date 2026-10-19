/* Regenerates test/fixtures/clubexpress-sample.csv: a SYNTHETIC export with the
 * same 40-column layout and quirks as the real ClubExpress "Additional Member
 * Data" report (ragged rows, shared member numbers, Role rows, a bulk-load join
 * date, a lost-dash membership type, ZIP+4, d/m/yyyy without padding).
 * Fake names and example.com addresses only — never paste real data here.
 * Usage: node test/make-fixture.js
 */
var fs = require("fs");
var path = require("path");

var HEADER = ["last_name", "first_name", "middle_initial", "member_number", "address1", "address2", "city", "state", "zip",
  "country_name", "use_alt_address", "phone", "cell_phone", "primary_email", "status", "membership_type", "company",
  "expiration_date", "date_joined", "member_level", "primary_member_number", "spouse_first_name", "spouse_last_name",
  "personal_website", "gender", "pronoun_name", "visibility", "date_of_birth", "spouse_birthday", "anniversary", "fax",
  "salutation", "last_renewal_date", "sponsor_name", "login_name", "nickname", "automatic_renewal_opt_in",
  "Corvette Year", "Corvette Color", "Corvette Model"];

var seed = 12345;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
var CITIES = [["Knoxville", "37919"], ["Knoxville", "37922"], ["Maryville", "37801"], ["Oak Ridge", "37830"], ["Farragut", "37934"], ["Powell", "37849"], ["Lenoir City", "37771"], ["Sevierville", "37862"]];
var TYPES_C = ["Couple"], TYPES_S = ["Single"];
var COLORS = ["Red", "Blue", "White", "Black", "Torch Red"], MODELS = ["C5", "C6", "C7", "C8", "C3"];

function d(y, m, day) { return m + "/" + day + "/" + y; }
function randomJoin() {
  // 2023-01 .. 2026-09, never the bulk date
  var y = 2023 + Math.floor(rnd() * 4), m = 1 + Math.floor(rnd() * (y === 2026 ? 9 : 12)), day = 1 + Math.floor(rnd() * 28);
  return d(y, m, day);
}

var rows = [];
var num = 1000;
function add(o) {
  var r = HEADER.map(function (h) { return o[h] == null ? "" : o[h]; });
  if (!o["Corvette Year"]) r = r.slice(0, 37); // real export omits trailing Corvette columns when empty
  rows.push(r);
}
function base(last, first, extra) {
  var c = pick(CITIES);
  var o = { last_name: last, first_name: first, address1: Math.floor(rnd() * 900 + 100) + " Example St", city: c[0], state: "TN", zip: rnd() < 0.5 ? c[1] + "-" + (1000 + Math.floor(rnd() * 8999)) : c[1],
    country_name: "United States", use_alt_address: "No", phone: "555-01" + (10 + Math.floor(rnd() * 89)), primary_email: first.toLowerCase() + "." + last.toLowerCase() + "@example.com",
    status: "Active", expiration_date: "12/31/2026", visibility: "7", gender: "?", pronoun_name: "?", login_name: "login_" + last.toLowerCase() + first.toLowerCase(),
    date_of_birth: "6/15/1960", automatic_renewal_opt_in: "No" };
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

// 30 couples (60 people), 20 singles; 40 of the people carry the bulk date.
var bulk = "12/21/2022", bulkLeft = 40;
for (var i = 1; i <= 30; i++) {
  var primary = ++num, spouse = ++num, joined = bulkLeft > 0 ? (bulkLeft -= 2, bulk) : randomJoin();
  var last = "Sample" + i;
  var car = rnd() < 0.5 ? { "Corvette Year": String(1990 + Math.floor(rnd() * 34)), "Corvette Color": pick(COLORS), "Corvette Model": pick(MODELS) } : {};
  add(base(last, "Pat" + i, Object.assign({ member_number: primary, primary_member_number: primary, membership_type: "Couple", member_level: "1", date_joined: joined, spouse_first_name: "Alex" + i, spouse_last_name: last }, car)));
  add(base(last, "Alex" + i, { member_number: spouse, primary_member_number: primary, membership_type: "Couple", member_level: "2", date_joined: joined, primary_email: i % 4 ? "" : "alex" + i + "@example.com" }));
}
for (var j = 1; j <= 20; j++) {
  var n = ++num;
  add(base("Demo" + j, "Lee" + j, { member_number: n, primary_member_number: n, membership_type: "Single", member_level: "1", date_joined: j <= 8 ? (bulkLeft-- , bulk) : randomJoin(), last_renewal_date: j % 7 === 0 ? "3/2/2026" : "" }));
}
// Long-serving, pre-migration join dates that are real.
add(base("Founder", "Old", { member_number: 2, primary_member_number: 2, membership_type: "Single", member_level: "1", date_joined: "6/14/1958", expiration_date: "12/31/2027" }));
add(base("Veteran", "Sam", { member_number: 3, primary_member_number: 3, membership_type: "Single", member_level: "1", date_joined: "3/9/2008", expiration_date: "12/31/2027" }));
// Lost-dash type, honorary, expired-but-active, expiring soon, bad date, no join date.
add(base("Dashed", "Dee", { member_number: ++num, primary_member_number: num, membership_type: "ETCC Only � Single", member_level: "1", date_joined: "4/4/2025" }));
add(base("Honor", "Hal", { member_number: ++num, primary_member_number: num, membership_type: "Hononary - Single", member_level: "1", date_joined: "1/2/2024", expiration_date: "12/31/2030" }));
add(base("Lapsed", "Lou", { member_number: ++num, primary_member_number: num, membership_type: "Single", member_level: "1", date_joined: "2/2/2024", expiration_date: "6/30/2026" }));
add(base("Soon", "Sue", { member_number: ++num, primary_member_number: num, membership_type: "Single", member_level: "1", date_joined: "2/2/2025", expiration_date: "11/15/2026" }));
add(base("Baddate", "Bo", { member_number: ++num, primary_member_number: num, membership_type: "Single", member_level: "1", date_joined: "13/45/2024" }));
add(base("Nodate", "Ned", { member_number: ++num, primary_member_number: num, membership_type: "Single", member_level: "1", date_joined: "" }));
// Same member number on two different spouse rows (seen in the real export).
var shared = ++num, shP1 = ++num, shP2 = ++num;
add(base("Shared", "One", { member_number: shP1, primary_member_number: shP1, membership_type: "Couple", member_level: "1", date_joined: "5/5/2025" }));
add(base("Shared", "Two", { member_number: shared, primary_member_number: shP1, membership_type: "Couple", member_level: "2", date_joined: "5/5/2025" }));
add(base("Other", "Three", { member_number: shP2, primary_member_number: shP2, membership_type: "Couple", member_level: "1", date_joined: "6/6/2025" }));
add(base("Other", "Four", { member_number: shared, primary_member_number: shP2, membership_type: "Couple", member_level: "2", date_joined: "6/6/2025" }));
// A row with no member number at all.
add(base("Numberless", "Nan", { member_number: "", primary_member_number: "", membership_type: "Single", member_level: "1", date_joined: "7/7/2025" }));
// Role accounts (officers): no join date, expire in 2066.
["President", "Treasurer", "Secretary"].forEach(function (r) {
  var m = ++num;
  add(base("Office", r, { member_number: m, primary_member_number: m, membership_type: "Role", member_level: "1", expiration_date: "1/1/2066", date_joined: "" }));
});
// Exact duplicate of the first row, and a nameless row (both must be rejected).
rows.push(rows[0].slice());
add({ member_number: "9999", status: "Active" });

function esc(v) { v = String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
var out = [HEADER].concat(rows).map(function (r) { return r.map(esc).join(","); }).join("\r\n") + "\r\n";
fs.writeFileSync(path.join(__dirname, "fixtures", "clubexpress-sample.csv"), out, "utf8");
console.log("Wrote " + rows.length + " data rows");
