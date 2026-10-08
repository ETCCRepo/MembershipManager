/* logic.js — pure, DOM-free helpers for the Membership and Reports tabs.
 * Loaded as a plain <script> in the built page (exposes window.MembershipLogic)
 * and require()d by test/run-tests.js under Node.
 */
(function (root) {
  "use strict";

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  // Columns shown on the Membership tab, in order. `key` is the field name
  // members-import.php / lib.php stores for each member.
  var MEMBER_COLUMNS = [
    { key: "memberNumber", label: "Member #", num: true },
    { key: "lastName", label: "Last Name" },
    { key: "firstName", label: "First Name" },
    { key: "spouseFirstName", label: "Spouse" },
    { key: "membershipType", label: "Membership Type" },
    { key: "status", label: "Status" },
    { key: "joinDate", label: "Join Date", date: true },
    { key: "expirationDate", label: "Expiration Date", date: true },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "zip", label: "Zip" },
    { key: "year", label: "Corvette Year" },
    { key: "model", label: "Model" },
    { key: "color", label: "Color" }
  ];

  // Only columns that have a value for at least one member — an export
  // without, say, a Spouse column shouldn't show an empty Spouse column.
  function visibleColumns(members) {
    return MEMBER_COLUMNS.filter(function (c) {
      if (c.key === "lastName" || c.key === "firstName") return true;
      return members.some(function (m) { return String(m[c.key] || "").trim() !== ""; });
    });
  }

  // "2024-03-05" -> "3/5/2024". Anything else is returned unchanged.
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    return Number(m[2]) + "/" + Number(m[3]) + "/" + m[1];
  }

  function displayValue(member, col) {
    if (col.date) {
      // Show the parsed date when there is one; otherwise whatever the export
      // had (so an unparseable value is still visible rather than blank).
      return member[col.key] ? formatDate(member[col.key]) : (member[col.key + "Raw"] || "");
    }
    return String(member[col.key] == null ? "" : member[col.key]);
  }

  function fullName(member) {
    var first = String(member.firstName || "").trim();
    var last = String(member.lastName || "").trim();
    return first && last ? first + " " + last : (first || last);
  }

  // Case-insensitive match of every whitespace-separated term against any of
  // the member's values (known fields and every original export column).
  function searchMembers(members, query) {
    var terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return members.slice();
    return members.filter(function (m) {
      var hay = MEMBER_COLUMNS.map(function (c) { return displayValue(m, c); });
      if (m.fields) Object.keys(m.fields).forEach(function (k) { hay.push(m.fields[k]); });
      var text = hay.join(" \u0001 ").toLowerCase();
      return terms.every(function (t) { return text.indexOf(t) !== -1; });
    });
  }

  function compareValues(a, b, col) {
    var av = String(a[col.key] || ""), bv = String(b[col.key] || "");
    // Blanks always sort last, in either direction (handled by caller).
    if (col.num) {
      var an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
    }
    return av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true });
  }

  function sortMembers(members, key, dir) {
    var col = MEMBER_COLUMNS.filter(function (c) { return c.key === key; })[0] || MEMBER_COLUMNS[1];
    var sign = dir === "desc" ? -1 : 1;
    return members.slice().sort(function (a, b) {
      var ab = String(a[col.key] || "") === "", bb = String(b[col.key] || "") === "";
      if (ab !== bb) return ab ? 1 : -1;
      var c = compareValues(a, b, col) * sign;
      if (c !== 0) return c;
      return (String(a.lastName || "").localeCompare(String(b.lastName || ""), undefined, { sensitivity: "base" }) ||
        String(a.firstName || "").localeCompare(String(b.firstName || ""), undefined, { sensitivity: "base" }));
    });
  }

  // Distinct join years, newest first.
  function joinYears(members) {
    var seen = {};
    members.forEach(function (m) {
      var y = /^(\d{4})-/.exec(m.joinDate || "");
      if (y) seen[y[1]] = true;
    });
    return Object.keys(seen).sort().reverse();
  }

  function monthLabel(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(key);
    return m ? MONTH_NAMES[Number(m[2]) - 1] + " " + m[1] : key;
  }

  // Monthly Membership Report: the members who joined in each month.
  //   year = "2025" -> all twelve months of 2025, including empty ones.
  //   year = "all"  -> every month that has at least one join, oldest first.
  // Members within a month are ordered by join date, then name.
  // Returns { months: [{ key, label, members }], total, undated }.
  function monthlyJoinReport(members, year) {
    var byMonth = {};
    var undated = 0;
    members.forEach(function (m) {
      var d = /^(\d{4})-(\d{2})-\d{2}$/.exec(m.joinDate || "");
      if (!d) { undated++; return; }
      if (year !== "all" && d[1] !== String(year)) return;
      var key = d[1] + "-" + d[2];
      (byMonth[key] = byMonth[key] || []).push(m);
    });
    var keys;
    if (year === "all") {
      keys = Object.keys(byMonth).sort();
    } else {
      keys = [];
      for (var i = 1; i <= 12; i++) keys.push(year + "-" + (i < 10 ? "0" : "") + i);
    }
    var total = 0;
    var months = keys.map(function (key) {
      var list = (byMonth[key] || []).slice().sort(function (a, b) {
        return a.joinDate < b.joinDate ? -1 : a.joinDate > b.joinDate ? 1 :
          (String(a.lastName || "").localeCompare(String(b.lastName || ""), undefined, { sensitivity: "base" }) ||
           String(a.firstName || "").localeCompare(String(b.firstName || ""), undefined, { sensitivity: "base" }));
      });
      total += list.length;
      return { key: key, label: monthLabel(key), members: list };
    });
    return { months: months, total: total, undated: undated };
  }

  var api = {
    MEMBER_COLUMNS: MEMBER_COLUMNS,
    visibleColumns: visibleColumns,
    formatDate: formatDate,
    displayValue: displayValue,
    fullName: fullName,
    searchMembers: searchMembers,
    sortMembers: sortMembers,
    joinYears: joinYears,
    monthLabel: monthLabel,
    monthlyJoinReport: monthlyJoinReport
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MembershipLogic = api;
})(typeof window !== "undefined" ? window : this);
