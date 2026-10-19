/* reports.js — membership metrics, pure and DOM-free (browser + Node tests).
 *
 * Units — never mixed within one number:
 *   "people"     one record per person (each spouse is a record)
 *   "households" one per primary membership (primary_member_number)
 * Dates are "YYYY-MM-DD" strings in America/New_York; ranges are inclusive.
 *
 * Honesty rules: a current-roster export cannot reconstruct past membership
 * totals, so "members over time" comes only from stored dated snapshots, and
 * join-date reports never present "current members grouped by join date" as
 * history. A join date shared by a large block of members (a ClubExpress
 * migration/bulk-load date) is flagged and kept out of new-member counts.
 */
(function (root) {
  "use strict";

  var TZ = "America/New_York";
  var CLUB_FOUNDED = "1958-01-01";
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function parts(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  // Today in the reporting timezone (never the viewer's local zone).
  function todayET(now) {
    var f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
    return f.format(now || new Date());
  }
  function addDays(s, n) {
    var p = parts(s), t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  // Calendar-month arithmetic that clamps (Mar 31 - 1 month = Feb 28/29).
  function addMonths(s, n) {
    var p = parts(s), idx = p.y * 12 + (p.m - 1) + n, y = Math.floor(idx / 12), m = idx % 12 + 1;
    return ymd(y, m, Math.min(p.d, daysInMonth(y, m)));
  }
  function monthKey(s) { return s.slice(0, 7); }
  function monthLabel(key) { var p = /^(\d{4})-(\d{2})$/.exec(key); return p ? MONTH_NAMES[+p[2] - 1].slice(0, 3) + " " + p[1] : key; }
  function daysBetween(a, b) { var pa = parts(a), pb = parts(b); return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000); }
  function yearsBetween(a, b) { // whole years from a to b
    var pa = parts(a), pb = parts(b), y = pb.y - pa.y;
    if (pb.m < pa.m || (pb.m === pa.m && pb.d < pa.d)) y--;
    return y;
  }

  // ---- reporting periods ----------------------------------------------------
  // preset: "1m" "3m" "6m" "12m" "60m" "all" "custom"
  // mode: "rolling" (ends today) | "calendar" (last completed whole months)
  function period(preset, today, mode, custom) {
    var months = { "1m": 1, "3m": 3, "6m": 6, "12m": 12, "24m": 24, "60m": 60, "120m": 120 }[preset];
    var names = { "1m": "month", "3m": "3 months", "6m": "6 months", "12m": "year", "24m": "2 years", "60m": "5 years", "120m": "10 years" };
    var p = { preset: preset, today: today, mode: mode, start: "", end: "", label: "", kind: "" };
    if (preset === "all") {
      p.start = CLUB_FOUNDED; p.end = today; p.kind = "all"; p.label = "All records since 1958";
      return p;
    }
    if (preset === "custom") {
      var c = custom || {};
      p.start = c.start || today; p.end = c.end || today;
      if (p.end < p.start) { var t = p.start; p.start = p.end; p.end = t; }
      p.kind = "custom"; p.label = p.start + " to " + p.end;
      p.prevEnd = addDays(p.start, -1);
      p.prevStart = addDays(p.prevEnd, -(daysBetween(p.start, p.end)));
      return p;
    }
    if (mode === "calendar") {
      var cur = parts(today), firstThis = ymd(cur.y, cur.m, 1);
      p.end = addDays(firstThis, -1);
      p.start = addMonths(firstThis, -months);
      p.prevEnd = addDays(p.start, -1);
      p.prevStart = addMonths(p.start, -months);
      p.kind = "calendar";
      p.label = "Last " + (months === 1 ? "completed month" : "completed " + names[preset]);
    } else {
      p.end = today;
      p.start = addDays(addMonths(today, -months), 1);
      p.prevEnd = addDays(p.start, -1);
      p.prevStart = addDays(addMonths(p.start, -months), 0);
      p.kind = "rolling";
      p.label = "Last " + (months === 1 ? "month" : names[preset]) + " (rolling)";
    }
    return p;
  }
  function yearAgo(p) { return { start: addMonths(p.start, -12), end: addMonths(p.end, -12) }; }

  // ---- comparisons ------------------------------------------------------------
  // Percent change is undefined when the prior value is zero — say so.
  function compare(current, prior) {
    var abs = current - prior;
    if (prior === 0) return { current: current, prior: prior, abs: abs, pct: null, text: current === 0 ? "no change (0 in both periods)" : "+" + abs + " (no members in the prior period, so no % change)" };
    var pct = abs / prior * 100;
    var r = Math.round(pct * 10) / 10;
    return { current: current, prior: prior, abs: abs, pct: pct, text: (abs >= 0 ? "+" : "") + abs + " (" + (abs >= 0 ? "+" : "") + r + "%)" };
  }

  // ---- member pool ------------------------------------------------------------
  function isActive(m) { return /^active$/i.test(m.status || ""); }
  function isRole(m) { return !!m.isRole || /^role$/i.test(m.membershipType || ""); }

  // opts: { includeRoles, status:[..]|null, types:[..]|null, states, cities, unit }
  function pool(members, opts) {
    opts = opts || {};
    var out = members.filter(function (m) {
      if (!opts.includeRoles && isRole(m)) return false;
      if (opts.status && opts.status.length && opts.status.indexOf(m.status || "(blank)") === -1) return false;
      if (opts.types && opts.types.length && opts.types.indexOf(m.membershipType || "(blank)") === -1) return false;
      if (opts.states && opts.states.length && opts.states.indexOf(m.state || "(blank)") === -1) return false;
      if (opts.cities && opts.cities.length && opts.cities.indexOf(m.city || "(blank)") === -1) return false;
      return true;
    });
    return opts.unit === "households" ? households(out) : out;
  }
  // One representative per household: the level-1 (primary) record if present.
  function households(members) {
    var by = {}, order = [];
    members.forEach(function (m) {
      var h = m.household || m.key;
      if (!by[h]) { by[h] = m; order.push(h); }
      else if (String(m.memberLevel) === "1" && String(by[h].memberLevel) !== "1") by[h] = m;
    });
    return order.map(function (h) { return by[h]; });
  }

  // ---- suspicious join dates --------------------------------------------------
  // A single date shared by many members is a data-load artifact, not a join day.
  function suspectJoinDates(members) {
    var count = {}, dated = 0;
    members.forEach(function (m) { if (m.joinDate && !isRole(m)) { count[m.joinDate] = (count[m.joinDate] || 0) + 1; dated++; } });
    var threshold = Math.max(15, Math.ceil(dated * 0.05)), out = {};
    Object.keys(count).forEach(function (d) { if (count[d] >= threshold) out[d] = count[d]; });
    return out;
  }
  function reliableJoin(m, suspect) { return !!m.joinDate && !suspect[m.joinDate]; }

  // ---- new members ------------------------------------------------------------
  // Returns the members who joined within [start, end] with trustworthy dates,
  // plus what was left out and why.
  function newMembers(members, start, end, suspect) {
    var inRange = [], bulk = 0, undated = 0;
    members.forEach(function (m) {
      if (!m.joinDate) { undated++; return; }
      if (m.joinDate < start || m.joinDate > end) return;
      if (suspect[m.joinDate]) { bulk++; return; }
      inRange.push(m);
    });
    return { members: inRange, excludedBulkDate: bulk, undated: undated };
  }

  function bucketMembers(list) { return { count: list.length, members: list }; }

  // Months from start to end inclusive, zeros included.
  function monthlyNew(members, start, end, suspect) {
    var keys = [], cur = monthKey(start), last = monthKey(end);
    while (cur <= last) { keys.push(cur); var p = /^(\d{4})-(\d{2})$/.exec(cur); cur = addMonths(ymd(+p[1], +p[2], 1), 1).slice(0, 7); }
    var by = {};
    keys.forEach(function (k) { by[k] = []; });
    newMembers(members, start, end, suspect).members.forEach(function (m) { by[monthKey(m.joinDate)].push(m); });
    return keys.map(function (k) { return { key: k, label: monthLabel(k), count: by[k].length, members: by[k] }; });
  }
  // Calendar years touched by [start, end]; each year counts only the part of
  // the range that falls inside it, so the buckets always sum to the period total.
  function yearlyNew(members, start, end, suspect) {
    var out = [];
    for (var y = +start.slice(0, 4); y <= +end.slice(0, 4); y++) {
      var lo = y + "-01-01" < start ? start : y + "-01-01", hi = y + "-12-31" > end ? end : y + "-12-31";
      var list = newMembers(members, lo, hi, suspect).members;
      out.push({ key: String(y), label: String(y), count: list.length, members: list });
    }
    return out;
  }

  // Time buckets of new members across [start, end]: "week" (7-day steps from `start`),
  // "month" or "year". For years, leading empty years are dropped so a "since 1958" chart
  // starts at the first join instead of showing decades of nothing.
  function bucketsNew(members, start, end, suspect, gran) {
    if (gran === "month") return monthlyNew(members, start, end, suspect);
    if (gran === "year") {
      var ys = yearlyNew(members, start, end, suspect), i = 0;
      while (i < ys.length - 1 && !ys[i].count) i++;
      return ys.slice(i);
    }
    var nm = newMembers(members, start, end, suspect).members, out = [], ws = start;
    while (ws <= end) {
      var we = addDays(ws, 6); if (we > end) we = end;
      var list = nm.filter(function (m) { return m.joinDate >= ws && m.joinDate <= we; }), p = parts(ws);
      out.push({ key: ws, label: MONTH_NAMES[p.m - 1].slice(0, 3) + " " + p.d, count: list.length, members: list });
      ws = addDays(we, 1);
    }
    return out;
  }
  // Dates to sample for a total-over-time line inside [start, end]: the start (baseline), then
  // weekly / month-end / year-end dates, then the end.
  function sampleDates(start, end, gran) {
    var out = [start], d, y, m;
    if (gran === "week") {
      for (d = addDays(start, 7); d < end; d = addDays(d, 7)) out.push(d);
    } else if (gran === "month") {
      var p = parts(start);
      for (y = p.y, m = p.m; ; ) {
        var me = ymd(y, m, daysInMonth(y, m));
        if (me >= end) break;
        if (me > start) out.push(me);
        if (++m > 12) { m = 1; y++; }
      }
    } else {
      for (y = +start.slice(0, 4); ; y++) { var ye = y + "-12-31"; if (ye >= end) break; if (ye > start) out.push(ye); }
    }
    if (out[out.length - 1] !== end) out.push(end);
    return out;
  }
  // Totals over time from TODAY's roster: at each date, how many current members had a recorded join
  // date on or before it. This is not the club's past membership (people who left are not in the
  // roster), and a bulk-load join date appears as a jump. The last point (today) counts everyone,
  // including members with no join date, so it equals the Membership card.
  function totalsOverTime(members, start, end, gran) {
    var dated = members.filter(function (m) { return m.joinDate; });
    return sampleDates(start, end, gran).map(function (d) {
      var list = d === end ? members : dated.filter(function (m) { return m.joinDate <= d; });
      return { date: d, members: list.length, households: householdTotal(list), list: list };
    });
  }
  // Bar width that keeps a chart readable: weeks for a month, years for 5+ years, else months.
  function granularityFor(preset) {
    return preset === "1m" ? "week" : (preset === "60m" || preset === "120m" || preset === "all") ? "year" : "month";
  }

  // ---- distributions ------------------------------------------------------------
  function distribution(members, labelFn, opts) {
    opts = opts || {};
    var by = {}, order = [];
    members.forEach(function (m) {
      var l = labelFn(m) || "(blank)";
      if (!by[l]) { by[l] = []; order.push(l); }
      by[l].push(m);
    });
    var rows = order.map(function (l) { return { key: l, label: l, count: by[l].length, members: by[l] }; });
    if (opts.order) rows.sort(function (a, b) { return opts.order.indexOf(a.label) - opts.order.indexOf(b.label); });
    else rows.sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
    if (opts.top && rows.length > opts.top) {
      var rest = rows.slice(opts.top), merged = [];
      rest.forEach(function (r) { merged = merged.concat(r.members); });
      rows = rows.slice(0, opts.top).concat([{ key: "(other)", label: "Other (" + rest.length + ")", count: merged.length, members: merged }]);
    }
    return rows;
  }
  var TENURE_ORDER = ["Under 1 year", "1 to 2 years", "2 to 5 years", "5 to 10 years", "10+ years", "Bulk-import join date (tenure unknown)", "No join date"];
  function tenureBucket(m, today, suspect) {
    if (!m.joinDate) return "No join date";
    if (suspect[m.joinDate]) return "Bulk-import join date (tenure unknown)";
    var y = yearsBetween(m.joinDate, today);
    return y < 1 ? TENURE_ORDER[0] : y < 2 ? TENURE_ORDER[1] : y < 5 ? TENURE_ORDER[2] : y < 10 ? TENURE_ORDER[3] : TENURE_ORDER[4];
  }
  function zip5(m) { var x = /^(\d{5})/.exec(m.zip || ""); return x ? x[1] : ""; }

  // ---- renewals -----------------------------------------------------------------
  // Memberships with an expiration far in the future (e.g. role/lifetime
  // accounts) are treated as "no expiry" for renewal purposes.
  function renewals(members, today) {
    var horizon = addMonths(today, 60);
    var expired = [], due30 = [], due60 = [], due90 = [], noExpiry = [], byMonth = {};
    members.forEach(function (m) {
      var e = m.expirationDate;
      if (!e || e > horizon) { noExpiry.push(m); return; }
      if (e < today) { if (isActive(m)) expired.push(m); return; }
      var d = daysBetween(today, e);
      if (d <= 30) due30.push(m);
      if (d <= 60) due60.push(m);
      if (d <= 90) due90.push(m);
      (byMonth[monthKey(e)] = byMonth[monthKey(e)] || []).push(m);
    });
    var months = Object.keys(byMonth).sort().map(function (k) { return { key: k, label: monthLabel(k), count: byMonth[k].length, members: byMonth[k] }; });
    return { expiredStillActive: expired, due30: due30, due60: due60, due90: due90, noExpiry: noExpiry, byExpirationMonth: months };
  }

  // ---- renewal cycle ----------------------------------------------------------------
  // ClubExpress memberships here expire on 12/31. Renewal season is assumed to start on
  // October 1: from then until the next September, "renewal target" is the coming year-end
  // after next-year renewals open (12/31 of next year before that, of this year after).
  //   Oct 1 2026 .. Dec 31 2026 -> target 12/31/2027   (members who already renewed for 2027)
  //   Jan 1 2027 .. Sep 30 2027 -> target 12/31/2027   (members paid up for 2027)
  var RENEWAL_SEASON_START_MONTH = 10;
  function renewalTarget(today) {
    var p = parts(today);
    return ymd(p.y + (p.m >= RENEWAL_SEASON_START_MONTH ? 1 : 0), 12, 31);
  }
  // Renewed = expires on/after the target; Left to renew = still current but expires before the
  // target; Expired = expiration date already passed; No expiry = far-future (role/lifetime) dates.
  function renewalStatus(members, today) {
    var target = renewalTarget(today), horizon = addMonths(today, 60);
    var out = { target: target, renewed: [], left: [], expired: [], noExpiry: [] };
    members.forEach(function (m) {
      var e = m.expirationDate;
      if (!e || e > horizon) out.noExpiry.push(m);
      else if (e < today) out.expired.push(m);
      else if (e >= target) out.renewed.push(m);
      else out.left.push(m);
    });
    return out;
  }

  // ---- anniversaries & long service ------------------------------------------------
  function upcomingAnniversaries(members, today, days, suspect) {
    var t = parts(today), out = [];
    members.forEach(function (m) {
      if (!reliableJoin(m, suspect)) return;
      var j = parts(m.joinDate);
      var y = t.y; var d = j.m === 2 && j.d === 29 && daysInMonth(y, 2) < 29 ? 28 : j.d;
      var next = ymd(y, j.m, d);
      if (next < today) { y++; d = j.m === 2 && j.d === 29 && daysInMonth(y, 2) < 29 ? 28 : j.d; next = ymd(y, j.m, d); }
      var away = daysBetween(today, next), years = y - j.y;
      if (away <= days && years >= 1) out.push({ member: m, date: next, years: years });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function longServing(members, today, minYears, suspect) {
    return members.filter(function (m) { return reliableJoin(m, suspect) && yearsBetween(m.joinDate, today) >= minYears; })
      .sort(function (a, b) { return a.joinDate < b.joinDate ? -1 : 1; });
  }

  // ---- data quality ---------------------------------------------------------------
  function dataQuality(members, today) {
    function f(label, pred, help) { var l = members.filter(pred); return { label: label, help: help, count: l.length, members: l }; }
    return [
      f("No email", function (m) { return !m.email; }, "Cannot be reached by email."),
      f("No street address", function (m) { return !m.address; }, ""),
      f("No city or ZIP", function (m) { return !m.city || !m.zip; }, "Left out of geography reports."),
      f("No join date", function (m) { return !m.joinDate && !isRole(m); }, "Left out of new-member and tenure reports."),
      f("Unreadable date value", function (m) { return (m.flags || []).some(function (x) { return x.indexOf("badDate") === 0; }); }, "A date column had text that is not a recognizable date."),
      f("Expires before join date", function (m) { return (m.flags || []).indexOf("expiresBeforeJoin") !== -1; }, ""),
      f("Active but past expiration", function (m) { return isActive(m) && m.expirationDate && m.expirationDate < today && !isRole(m); }, "Status says Active, expiration date is in the past."),
      f("Member number shared with another person", function (m) { return (m.flags || []).indexOf("sharedMemberNumber") !== -1; }, "ClubExpress gave two people the same member number; they are kept as separate people."),
      f("No member number", function (m) { return (m.flags || []).indexOf("noMemberNumber") !== -1; }, "Matched on name and ZIP at import."),
      f("ZIP code had its leading zero restored", function (m) { return (m.flags || []).indexOf("zipPadded") !== -1; }, "")
    ];
  }

  // ---- household report ------------------------------------------------------------
  function householdSizes(members) {
    var by = {};
    members.forEach(function (m) { var h = m.household || m.key; (by[h] = by[h] || []).push(m); });
    var sizes = {};
    Object.keys(by).forEach(function (h) { var n = by[h].length; (sizes[n] = sizes[n] || []).push.apply(sizes[n], by[h]); });
    return Object.keys(sizes).sort(function (a, b) { return a - b; }).map(function (n) {
      return { key: n, label: n + (n === "1" ? " person" : " people") + " in household", count: sizes[n].length / n, members: sizes[n] };
    });
  }

  // ---- households, by the club's definition ------------------------------------
  // households = single members + (couple members / 2). A Couple membership is two
  // people, each counted as half; every other type (Single, Honorary - Single,
  // ETCC Only - Single…) counts as one. Couples with only one record show as .5.
  function isCouple(m) { return /couple/i.test(m.membershipType || ""); }
  function householdWeight(m) { return isCouple(m) ? 0.5 : 1; }
  function householdTotal(members) {
    return members.reduce(function (a, m) { return a + householdWeight(m); }, 0);
  }
  // [{label, count: households, people, members}] per membership type.
  function householdsByType(members) {
    return distribution(members, function (m) { return m.membershipType; }).map(function (r) {
      return { key: r.key, label: r.label, count: householdTotal(r.members), people: r.members.length, members: r.members };
    }).sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
  }
  // {singles, couplePeople, coupleHouseholds, total} for the composition chart.
  function householdBreakdown(members) {
    var singles = members.filter(function (m) { return !isCouple(m); }), couples = members.filter(isCouple);
    return { singles: singles, couples: couples, singleHouseholds: singles.length, coupleHouseholds: couples.length / 2, total: singles.length + couples.length / 2 };
  }
  // Each bucket's count is households (singles + couple members / 2); `people` is the head-count.
  function householdsMonthly(members, start, end, suspect) {
    return monthlyNew(members, start, end, suspect).map(function (m) {
      return { key: m.key, label: m.label, count: householdTotal(m.members), people: m.count, members: m.members };
    });
  }

  // ---- monthly meeting periods ----------------------------------------------------
  // A meeting "month" starts the Wednesday after a calendar month's first Tuesday
  // and ends (inclusive) on the NEXT month's first Tuesday — the meeting day.
  function firstTuesday(y, m) {
    var dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday, 2 = Tuesday
    return ymd(y, m, 1 + (2 - dow + 7) % 7);
  }
  function shiftMonth(y, m, n) { var idx = y * 12 + (m - 1) + n; return { y: Math.floor(idx / 12), m: idx % 12 + 1 }; }
  function rangeLabel(start, end) {
    var a = parts(start), b = parts(end), mo = function (p) { return MONTH_NAMES[p.m - 1].slice(0, 3); };
    return mo(a) + " " + a.d + (a.y !== b.y ? ", " + a.y : "") + " - " + mo(b) + " " + b.d + ", " + b.y;
  }
  // The period that ends on the first Tuesday of (y, m).
  function meetingPeriodEndingIn(y, m) {
    var prev = shiftMonth(y, m, -1), end = firstTuesday(y, m), start = addDays(firstTuesday(prev.y, prev.m), 1);
    return { start: start, end: end, label: rangeLabel(start, end) };
  }
  // The period immediately after the one ending on `end` (a first Tuesday).
  function meetingPeriodAfter(end) {
    var p = parts(end), nx = shiftMonth(p.y, p.m, 1), e = firstTuesday(nx.y, nx.m), st = addDays(end, 1);
    return { start: st, end: e, label: rangeLabel(st, e) };
  }
  // Newest first: [0] is the period in progress (ends on the next first Tuesday
  // after today); [1] is "last month", the latest period whose meeting day is today
  // or earlier. `completed` is true once the meeting day has arrived.
  function meetingPeriods(today, count) {
    var t = parts(today), list = [];
    for (var i = -1; i < count + 2; i++) {
      var sm = shiftMonth(t.y, t.m, 1 - (i + 1)); // month whose first Tuesday ends this period
      var per = meetingPeriodEndingIn(sm.y, sm.m);
      per.completed = per.end <= today;
      list.push(per);
    }
    var firstDone = 0;
    while (firstDone < list.length && !list[firstDone].completed) firstDone++;
    var out = list.slice(Math.max(0, firstDone - 1), Math.max(0, firstDone - 1) + count + 1);
    out.forEach(function (p) { p.inProgress = !p.completed; });
    return out;
  }
  // Join anniversaries (reliable join dates, 1+ years) that fall inside [start, end].
  function anniversariesInRange(members, start, end, suspect) {
    var out = [], y0 = +start.slice(0, 4), y1 = +end.slice(0, 4);
    members.forEach(function (m) {
      if (!reliableJoin(m, suspect)) return;
      var j = parts(m.joinDate);
      for (var y = y0; y <= y1; y++) {
        var d = j.m === 2 && j.d === 29 && daysInMonth(y, 2) < 29 ? 28 : j.d, date = ymd(y, j.m, d), years = y - j.y;
        if (date >= start && date <= end && years >= 1) out.push({ member: m, date: date, years: years });
      }
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  // Memberships whose expiration date falls in [start, end] (far-future "no expiry" dates ignored).
  function expiringInRange(members, start, end, today) {
    var horizon = addMonths(today, 60);
    return members.filter(function (m) { return m.expirationDate && m.expirationDate >= start && m.expirationDate <= end && m.expirationDate <= horizon; })
      .sort(function (a, b) { return a.expirationDate < b.expirationDate ? -1 : a.expirationDate > b.expirationDate ? 1 : 0; });
  }

  // ---- snapshots (the only valid source of totals over time) ----------------------
  // snapshots: [{ id, date, mode:"full"|"partial", keys:[personKeys], households:[...] }]
  function snapshotSeries(snapshots) {
    return snapshots.filter(function (s) { return s.mode === "full"; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .map(function (s) { return { key: s.id, label: s.date, date: s.date, count: s.people, households: s.households, members: [] }; });
  }
  // Movement between consecutive full snapshots, by person key.
  function snapshotChanges(snapshots) {
    var full = snapshots.filter(function (s) { return s.mode === "full" && s.keys; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var ever = {}, out = [];
    full.forEach(function (s, i) {
      var now = {}; s.keys.forEach(function (k) { now[k] = true; });
      if (i > 0) {
        var prev = {}; full[i - 1].keys.forEach(function (k) { prev[k] = true; });
        var joined = [], lost = [], reactivated = [], kept = 0;
        s.keys.forEach(function (k) { if (prev[k]) kept++; else if (ever[k]) reactivated.push(k); else joined.push(k); });
        full[i - 1].keys.forEach(function (k) { if (!now[k]) lost.push(k); });
        out.push({ from: full[i - 1].date, to: s.date, retained: kept, retentionPct: full[i - 1].keys.length ? kept / full[i - 1].keys.length * 100 : null, joined: joined, lost: lost, reactivated: reactivated });
      }
      s.keys.forEach(function (k) { ever[k] = true; });
    });
    return out;
  }

  var api = {
    TZ: TZ, CLUB_FOUNDED: CLUB_FOUNDED, todayET: todayET, addDays: addDays, addMonths: addMonths, daysBetween: daysBetween, yearsBetween: yearsBetween,
    monthLabel: monthLabel, period: period, yearAgo: yearAgo, compare: compare, isActive: isActive, isRole: isRole, pool: pool, households: households,
    suspectJoinDates: suspectJoinDates, reliableJoin: reliableJoin, newMembers: newMembers, monthlyNew: monthlyNew, yearlyNew: yearlyNew,
    distribution: distribution, tenureBucket: tenureBucket, TENURE_ORDER: TENURE_ORDER, zip5: zip5, renewals: renewals,
    upcomingAnniversaries: upcomingAnniversaries, longServing: longServing, dataQuality: dataQuality, householdSizes: householdSizes,
    isCouple: isCouple, householdWeight: householdWeight, householdTotal: householdTotal, householdsByType: householdsByType,
    householdBreakdown: householdBreakdown, householdsMonthly: householdsMonthly,
    firstTuesday: firstTuesday, rangeLabel: rangeLabel, meetingPeriodEndingIn: meetingPeriodEndingIn, meetingPeriodAfter: meetingPeriodAfter,
    meetingPeriods: meetingPeriods, anniversariesInRange: anniversariesInRange, expiringInRange: expiringInRange,
    bucketsNew: bucketsNew, granularityFor: granularityFor, sampleDates: sampleDates, totalsOverTime: totalsOverTime,
    renewalTarget: renewalTarget, renewalStatus: renewalStatus,
    snapshotSeries: snapshotSeries, snapshotChanges: snapshotChanges, bucketMembers: bucketMembers
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MembershipReports = api;
})(typeof window !== "undefined" ? window : this);
