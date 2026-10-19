/* csvimport.js — ClubExpress "Additional Member Data" CSV import logic.
 * Pure and DOM-free: runs in the browser (preview happens locally, so a CSV is
 * never uploaded until the officer confirms) and under Node (test/run-tests.js).
 * The server (deploy/members-import.php) re-validates everything it receives.
 */
(function (root) {
  "use strict";

  // Target fields -> accepted normalized header names (see normalizeHeader).
  // Real ClubExpress headers seen in the sample export: last_name, first_name,
  // middle_initial, member_number, address1, address2, city, state, zip,
  // country_name, phone, cell_phone, primary_email, status, membership_type,
  // company, expiration_date, date_joined, member_level,
  // primary_member_number, spouse_first_name, spouse_last_name, last_renewal_date,
  // automatic_renewal_opt_in, "Corvette Year/Color/Model", plus others.
  var FIELDS = [
    { key: "memberNumber", label: "Member Number", aliases: ["membernumber", "memberno", "membernum", "memberid", "id"] },
    { key: "primaryMemberNumber", label: "Primary Member Number", aliases: ["primarymembernumber", "primarymemberno", "householdnumber"] },
    { key: "memberLevel", label: "Member Level", aliases: ["memberlevel", "level"] },
    { key: "lastName", label: "Last Name", aliases: ["lastname", "last", "surname"], required: true },
    { key: "firstName", label: "First Name", aliases: ["firstname", "first"], required: true },
    { key: "middleInitial", label: "Middle Initial", aliases: ["middleinitial", "middlename", "middle"] },
    { key: "spouseFirstName", label: "Spouse First Name", aliases: ["spousefirstname", "spouse", "spousename"] },
    { key: "spouseLastName", label: "Spouse Last Name", aliases: ["spouselastname"] },
    { key: "email", label: "Email", aliases: ["primaryemail", "email", "emailaddress"] },
    { key: "phone", label: "Phone", aliases: ["phone", "phonenumber", "homephone", "primaryphone"] },
    { key: "cellPhone", label: "Cell Phone", aliases: ["cellphone", "mobilephone", "mobile", "cell"] },
    { key: "address", label: "Address", aliases: ["address1", "address", "streetaddress", "primaryaddress", "primaryaddress1"] },
    { key: "address2", label: "Address 2", aliases: ["address2"] },
    { key: "city", label: "City", aliases: ["city", "primarycity"] },
    { key: "state", label: "State", aliases: ["state", "primarystate"] },
    { key: "zip", label: "ZIP", aliases: ["zip", "zipcode", "postalcode", "primaryzip", "primaryzipcode"] },
    { key: "country", label: "Country", aliases: ["countryname", "country"] },
    { key: "membershipType", label: "Membership Type", aliases: ["membershiptype", "membertype", "membershiplevel"] },
    { key: "status", label: "Status", aliases: ["status", "memberstatus", "membershipstatus"] },
    { key: "joinDate", label: "Date Joined", aliases: ["datejoined", "joindate", "joined", "membersince", "originaljoindate"] },
    { key: "expirationDate", label: "Expiration Date", aliases: ["expirationdate", "expiredate", "expires", "expiration"] },
    { key: "lastRenewalDate", label: "Last Renewal Date", aliases: ["lastrenewaldate", "renewaldate", "lastrenewed"] },
    { key: "autoRenew", label: "Automatic Renewal", aliases: ["automaticrenewaloptin", "autorenew"] },
    { key: "company", label: "Company", aliases: ["company"] },
    { key: "year", label: "Corvette Year", aliases: ["corvetteyear", "modelyear", "year"] },
    { key: "model", label: "Corvette Model", aliases: ["corvettemodel", "model"] },
    { key: "color", label: "Corvette Color", aliases: ["corvettecolor", "color"] }
  ];
  var DATE_FIELDS = ["joinDate", "expirationDate", "lastRenewalDate"];

  // Columns that are never stored, even in the "all columns" map: they are
  // credentials or sensitive personal data this app has no need for.
  var EXCLUDED_COLUMNS = ["login_name", "date_of_birth", "spouse_birthday", "anniversary", "gender", "pronoun_name"];

  var MAX_ROWS = 20000;

  function normalizeHeader(h) {
    return String(h == null ? "" : h).replace(/^﻿/, "").toLowerCase().replace(/#/g, "number").replace(/[\s_\-./]/g, "").trim();
  }

  // ---- decoding -----------------------------------------------------------
  // ArrayBuffer/Uint8Array -> { text, encoding, replacementChars }.
  function decodeBytes(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var text, encoding = "utf-8";
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(u8);
    } catch (e) {
      text = new TextDecoder("windows-1252").decode(u8);
      encoding = "windows-1252";
    }
    text = text.replace(/^﻿/, "");
    var repl = (text.match(/�/g) || []).length;
    return { text: text, encoding: encoding, replacementChars: repl };
  }

  // ---- CSV (RFC 4180): quoted fields, embedded commas/newlines, "" escapes ---
  function parseCsv(text) {
    var rows = [], row = [], field = "", i = 0, inQ = false, n = text.length, c;
    while (i < n) {
      c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === "") { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r" || c === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
        if (c === "\r" && text.charAt(i + 1) === "\n") i++;
        i++; continue;
      }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ---- dates --------------------------------------------------------------
  function validYmd(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  // -> "YYYY-MM-DD" or "". Two-digit years: values up to the current two-digit
  // year are 20xx, larger ones 19xx (a join date is never in the future).
  function parseDate(raw, nowYear) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    var curYear = nowYear || new Date().getFullYear();
    var m, y, mo, d;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(s)) || (m = /^(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})$/.exec(s))) {
      mo = +m[1]; d = +m[2]; y = +m[3];
      if (m[3].length === 2) y += (y <= curYear % 100) ? 2000 : 1900;
    } else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
      mo = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)]; d = +m[2]; y = +m[3];
    } else return "";
    return validYmd(y, mo, d) ? y + "-" + pad(mo) + "-" + pad(d) : "";
  }

  // ---- column mapping -----------------------------------------------------
  // -> { mapping: {field: colIndex|null}, missingRequired: [labels], unmapped: [header names] }
  function suggestMapping(header) {
    var mapping = {}, used = {};
    var norm = header.map(normalizeHeader);
    FIELDS.forEach(function (f) { mapping[f.key] = null; });
    // Exact alias priority: earlier alias wins, so "primary_email" beats "email".
    FIELDS.forEach(function (f) {
      for (var a = 0; a < f.aliases.length && mapping[f.key] === null; a++) {
        for (var i = 0; i < norm.length; i++) {
          if (!used[i] && norm[i] === f.aliases[a]) { mapping[f.key] = i; used[i] = true; break; }
        }
      }
    });
    var missing = FIELDS.filter(function (f) { return f.required && mapping[f.key] === null; }).map(function (f) { return f.label; });
    var unmapped = header.filter(function (h, i) { return !used[i] && String(h).trim() !== ""; });
    return { mapping: mapping, missingRequired: missing, unmapped: unmapped };
  }

  // ---- member construction ------------------------------------------------
  function clean(s) { return String(s == null ? "" : s).replace(/\u0000/g, "").trim(); }
  function normName(s) { return clean(s).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  // "ETCC Only � Couple" (a dash lost in the export) -> "ETCC Only - Couple".
  function normalizeType(s) {
    return clean(s).replace(/\s*[�–—]\s*/g, " - ").replace(/\s+/g, " ");
  }
  function normalizeZip(z, flags) {
    var s = clean(z);
    if (/^\d{3,4}$/.test(s)) { flags.push("zipPadded"); s = ("00000" + s).slice(-5); }
    if (/^\d{9}$/.test(s)) s = s.slice(0, 5) + "-" + s.slice(5);
    return s;
  }
  function zip5(z) { var m = /^(\d{5})/.exec(String(z || "")); return m ? m[1] : ""; }

  // rows = parseCsv(...) output; mapping = {field: colIndex|null}.
  // opts: { now: Date } for deterministic two-digit-year handling in tests.
  function buildMembers(rows, mapping, opts) {
    opts = opts || {};
    var nowYear = (opts.now || new Date()).getFullYear();
    var header = rows[0] || [];
    var members = [], rejected = [], seen = {}, warnings = [];
    var excluded = {};
    header.forEach(function (h, i) {
      if (EXCLUDED_COLUMNS.indexOf(String(h).replace(/^﻿/, "").trim().toLowerCase().replace(/[\s\-]+/g, "_")) !== -1) excluded[i] = true;
    });
    if (rows.length - 1 > MAX_ROWS) {
      return { members: [], rejected: [], warnings: ["The file has more than " + MAX_ROWS + " rows; that is not a membership export."], fatal: true };
    }
    for (var r = 1; r < rows.length; r++) {
      var cols = rows[r];
      var rowNumber = r + 1; // spreadsheet-style, header = row 1
      if (!cols || cols.every(function (c) { return clean(c) === ""; })) continue;
      var flags = [];
      var m = {};
      FIELDS.forEach(function (f) { m[f.key] = mapping[f.key] === null || mapping[f.key] === undefined ? "" : clean(cols[mapping[f.key]]); });
      if (!m.lastName && !m.firstName) { rejected.push({ rowNumber: rowNumber, reason: "No first or last name.", row: cols }); continue; }
      DATE_FIELDS.forEach(function (k) {
        m[k + "Raw"] = m[k];
        m[k] = parseDate(m[k], nowYear);
        if (m[k + "Raw"] && !m[k]) flags.push("badDate:" + k);
      });
      m.zip = normalizeZip(m.zip, flags);
      m.membershipType = normalizeType(m.membershipType);
      m.state = m.state.toUpperCase();
      m.isRole = /^role$/i.test(m.membershipType);
      if (m.joinDate && m.expirationDate && m.expirationDate < m.joinDate) flags.push("expiresBeforeJoin");
      m.fields = {};
      header.forEach(function (h, i) {
        var hn = clean(h);
        if (!hn || excluded[i]) return;
        var v = clean(cols[i]);
        if (v !== "") m.fields[hn] = v;
      });
      // Identity. ClubExpress member_number is the stable id; spouses in a
      // couple have their own number, and primary_member_number groups the
      // household. A repeated member_number can occur (seen in real exports),
      // so a repeat is only a duplicate if it is the same person.
      var nm = normName(m.firstName) + "|" + normName(m.lastName);
      var base;
      if (m.memberNumber) base = "n:" + m.memberNumber;
      else { base = "x:" + normName(m.lastName) + "|" + normName(m.firstName) + "|" + zip5(m.zip); flags.push("noMemberNumber"); }
      var key = base;
      if (seen[base]) {
        if (seen[base].name === nm) {
          rejected.push({ rowNumber: rowNumber, reason: "Duplicate of row " + seen[base].rowNumber + " (same member number and name).", row: cols });
          continue;
        }
        key = base + "|" + normName(m.firstName);
        flags.push("sharedMemberNumber");
        if (!seen[base].flagged) { seen[base].member.flags.push("sharedMemberNumber"); seen[base].flagged = true; }
      }
      m.key = key;
      m.household = m.primaryMemberNumber || m.memberNumber || key;
      m.flags = flags;
      var rec = { rowNumber: rowNumber, name: nm, member: m, flagged: false };
      if (!seen[base]) seen[base] = rec;
      members.push(m);
    }
    return { members: members, rejected: rejected, warnings: warnings };
  }

  // ---- comparison with the stored roster ------------------------------------
  var TRACKED = FIELDS.map(function (f) { return f.key; });
  function fingerprint(m) {
    return JSON.stringify(TRACKED.map(function (k) { return m[k] == null ? "" : m[k]; }));
  }
  // mode: "full" (file is the whole roster) | "partial" (only some members)
  function diffAgainst(current, incoming, mode) {
    var byKey = {};
    (current || []).forEach(function (m) { byKey[m.key] = m; });
    var added = [], updated = [], unchanged = [], inFile = {};
    incoming.forEach(function (m) {
      inFile[m.key] = true;
      var old = byKey[m.key];
      if (!old) added.push(m);
      else if (fingerprint(old) === fingerprint(m)) unchanged.push(m);
      else updated.push(m);
    });
    // Missing from a full snapshot is reported, never treated as resigned.
    var notInFile = mode === "full" ? (current || []).filter(function (m) { return !inFile[m.key]; }) : [];
    return { added: added, updated: updated, unchanged: unchanged, notInFile: notInFile };
  }

  // Applies an import to the stored roster. Full snapshot replaces the roster
  // (members absent from it are dropped from the current roster but remain in
  // earlier snapshots); partial merges by key.
  function applyImport(current, incoming, mode) {
    if (mode === "full") return incoming.slice();
    var byKey = {}, order = [];
    (current || []).forEach(function (m) { byKey[m.key] = m; order.push(m.key); });
    incoming.forEach(function (m) { if (!byKey[m.key]) order.push(m.key); byKey[m.key] = m; });
    return order.map(function (k) { return byKey[k]; });
  }

  // ---- CSV export with spreadsheet-formula-injection protection -----------
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(header, rows) {
    return [header].concat(rows).map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }

  var api = {
    FIELDS: FIELDS, EXCLUDED_COLUMNS: EXCLUDED_COLUMNS, MAX_ROWS: MAX_ROWS,
    normalizeHeader: normalizeHeader, decodeBytes: decodeBytes, parseCsv: parseCsv, parseDate: parseDate,
    suggestMapping: suggestMapping, buildMembers: buildMembers, diffAgainst: diffAgainst, applyImport: applyImport,
    fingerprint: fingerprint, csvCell: csvCell, toCsv: toCsv, zip5: zip5
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MembershipImport = api;
})(typeof window !== "undefined" ? window : this);
