/* app.js — ETCC Membership Manager UI.
 * index.php injects data through window.__membership.ingest*() on every page
 * load; renderViews() rebuilds #app from `state`.
 *
 *   Dashboard  — headline counts and charts
 *   Reports    — period / filter driven reports, each with a chart, a
 *                supporting table, CSV export and print
 *   Members    — searchable, sortable, filterable directory
 *   Import     — ClubExpress CSV: local preview, mapping, validation, history
 *
 * All text is inserted with textContent (el() below) — never innerHTML.
 */
(function () {
  "use strict";

  var L = window.MembershipLogic, I = window.MembershipImport, R = window.MembershipReports, C = window.MembershipCharts;
  var SITE = window.__membershipSite || { importUrl: "members-import.php", logoutUrl: "logout.php", csrf: "" };

  var state = {
    tab: "dashboard",
    members: [], importedAt: null, importLog: [], snapshots: [],
    unit: "people", includeRoles: false,
    filters: { status: "", type: "", state: "", city: "" },
    preset: "12m", periodMode: "rolling", custom: { start: "", end: "" },
    report: "new",
    search: "", sortKey: "lastName", sortDir: "asc",
    detailMember: null, list: null, menuOpen: false,
    imp: null
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] == null) return;
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function num(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 }); }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", { timeZone: R.TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
  }
  function today() { return R.todayET(); }
  function unitWord(n) { return state.unit === "households" ? (n === 1 ? "household" : "households") : (n === 1 ? "person" : "people"); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 + "%" : "—"; }

  // ---------- data ingest (called by index.php's boot script) ----------
  window.__membership = {
    ingestMembers: function (members, importedAt) {
      state.members = Array.isArray(members) ? members : [];
      state.importedAt = importedAt || null;
      renderViews();
    },
    ingestImportLog: function (log) { state.importLog = Array.isArray(log) ? log : []; renderViews(); },
    ingestSnapshots: function (snaps) { state.snapshots = Array.isArray(snaps) ? snaps : []; renderViews(); }
  };

  // ---------- derived data ----------
  function filteredPool() {
    var f = state.filters;
    return R.pool(state.members, {
      includeRoles: state.includeRoles, unit: state.unit,
      status: f.status ? [f.status] : null, types: f.type ? [f.type] : null,
      states: f.state ? [f.state] : null, cities: f.city ? [f.city] : null
    });
  }
  function currentPeriod() { return R.period(state.preset, today(), state.periodMode, state.custom); }
  function distinct(key) {
    var seen = {};
    state.members.forEach(function (m) { seen[m[key] || "(blank)"] = true; });
    return Object.keys(seen).sort();
  }

  // ---------- header hamburger menu ----------
  function buildHeaderMenu() {
    var header = $("header.app");
    if (!header) return;
    var btn = el("button", { class: "hamburger-btn", title: "Menu", "aria-label": "Menu", "aria-expanded": "false" },
      [el("span", { class: "bar" }), el("span", { class: "bar" }), el("span", { class: "bar" })]);
    btn.addEventListener("click", function (e) { e.stopPropagation(); state.menuOpen = !state.menuOpen; renderHeaderMenu(); });
    var hdrLeft = header.querySelector(".hdr-left") || header;
    hdrLeft.insertBefore(btn, hdrLeft.firstChild);
    var backdrop = el("div", { class: "hdr-nav-backdrop" });
    backdrop.addEventListener("click", closeMenu);
    var menu = el("div", { class: "hdr-menu" });
    menu.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);
    document.addEventListener("click", closeMenu);
    renderHeaderMenu();
  }
  function closeMenu() { if (state.menuOpen) { state.menuOpen = false; renderHeaderMenu(); } }
  function renderHeaderMenu() {
    var btn = $(".hamburger-btn"), menu = $(".hdr-menu"), backdrop = $(".hdr-nav-backdrop");
    if (!menu) return;
    btn.classList.toggle("open", state.menuOpen);
    btn.setAttribute("aria-expanded", state.menuOpen ? "true" : "false");
    menu.classList.toggle("open", state.menuOpen);
    backdrop.classList.toggle("open", state.menuOpen);
    menu.innerHTML = "";
    var imp = el("button", { class: "hdr-menu-item" }, ["⬆ Import Members"]);
    imp.addEventListener("click", function () { state.menuOpen = false; renderHeaderMenu(); selectTab("import"); });
    menu.appendChild(imp);
    menu.appendChild(el("a", { class: "hdr-menu-item", href: SITE.logoutUrl }, ["⎋ Logout"]));
  }

  // ---------- shell ----------
  function selectTab(id) {
    state.tab = id;
    try { history.replaceState(null, "", "#" + id); } catch (e) { /* file:// previews */ }
    renderViews();
    window.scrollTo(0, 0);
  }
  function renderViews() {
    var app = $("#app");
    if (!app) return;
    app.innerHTML = "";
    app.appendChild(buildTabs());
    var view = state.tab === "reports" ? buildReportsView() : state.tab === "members" ? buildMembersView() :
      state.tab === "import" ? buildImportView() : buildDashboardView();
    app.appendChild(view);
    renderListModal();
    renderDetailModal();
  }
  function buildTabs() {
    var tabs = [["dashboard", "Dashboard"], ["reports", "Reports"], ["members", "Members"], ["import", "Import"]];
    return el("div", { class: "tabs no-print", role: "tablist" }, tabs.map(function (t) {
      var d = el("div", { class: "tab" + (state.tab === t[0] ? " active" : ""), text: t[1], role: "tab", tabindex: "0" });
      d.addEventListener("click", function () { selectTab(t[0]); });
      d.addEventListener("keydown", function (e) { if (e.key === "Enter") selectTab(t[0]); });
      return d;
    }));
  }
  function emptyRosterState() {
    var b = el("button", { class: "btn primary" }, ["⬆ Import Members"]);
    b.addEventListener("click", function () { selectTab("import"); });
    return el("div", { class: "panel empty-state" }, [el("p", { text: "No membership data has been imported yet." }), b]);
  }

  // ---------- shared controls ----------
  function select(label, options, value, onChange) {
    var s = el("select", { "aria-label": label });
    options.forEach(function (o) {
      var op = el("option", { value: o[0], text: o[1] });
      if (String(o[0]) === String(value)) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener("change", function () { onChange(s.value); });
    return el("label", { class: "ctl" }, [label + " ", s]);
  }
  function filterBar(withUnit) {
    var f = state.filters;
    function opts(key, all) { return [["", all]].concat(distinct(key).map(function (v) { return [v === "(blank)" ? "(blank)" : v, v]; })); }
    var bar = el("div", { class: "toolbar filters no-print" });
    if (withUnit) {
      bar.appendChild(select("Count", [["people", "People"], ["households", "Households"]], state.unit, function (v) { state.unit = v; renderViews(); }));
    }
    bar.appendChild(select("Status", opts("status", "All statuses"), f.status, function (v) { f.status = v; renderViews(); }));
    bar.appendChild(select("Type", opts("membershipType", "All types"), f.type, function (v) { f.type = v; renderViews(); }));
    bar.appendChild(select("State", opts("state", "All states"), f.state, function (v) { f.state = v; renderViews(); }));
    bar.appendChild(select("City", opts("city", "All cities"), f.city, function (v) { f.city = v; renderViews(); }));
    var roles = el("input", { type: "checkbox" });
    roles.checked = state.includeRoles;
    roles.addEventListener("change", function () { state.includeRoles = roles.checked; renderViews(); });
    bar.appendChild(el("label", { class: "ctl", title: "Role accounts (officer positions) are not members, so they are left out unless ticked." }, [roles, " Include role accounts"]));
    if (f.status || f.type || f.state || f.city) {
      var clr = el("button", { class: "btn" }, ["Clear filters"]);
      clr.addEventListener("click", function () { state.filters = { status: "", type: "", state: "", city: "" }; renderViews(); });
      bar.appendChild(clr);
    }
    return bar;
  }
  function memberLine(m) { return L.fullName(m) || "(no name)"; }
  function listColumns() {
    return [["Name", memberLine], ["Member #", function (m) { return m.memberNumber; }], ["Type", function (m) { return m.membershipType; }],
      ["Status", function (m) { return m.status; }], ["Joined", function (m) { return m.joinDate ? L.formatDate(m.joinDate) : m.joinDateRaw || ""; }],
      ["Expires", function (m) { return m.expirationDate ? L.formatDate(m.expirationDate) : ""; }], ["City", function (m) { return m.city; }]];
  }

  // Click-through: the members behind a number or a chart segment.
  function openList(title, members, note) {
    state.list = { title: title, members: members, note: note || "" };
    renderListModal();
  }
  function download(name, text) {
    var blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function memberRows(members) {
    var cols = L.MEMBER_COLUMNS;
    return { header: cols.map(function (c) { return c.label; }), rows: members.map(function (m) { return cols.map(function (c) { return L.displayValue(m, c); }); }) };
  }
  function renderListModal() {
    var host = $("#listHost");
    if (!host) return;
    host.innerHTML = "";
    var st = state.list;
    if (!st) return;
    function close() { state.list = null; renderListModal(); }
    var cols = listColumns();
    var thead = el("thead", {}, [el("tr", {}, cols.map(function (c) { return el("th", { text: c[0] }); }))]);
    var tbody = el("tbody");
    st.members.forEach(function (m) {
      var tr = el("tr", {}, cols.map(function (c) { return el("td", { text: c[1](m) || "" }); }));
      tr.addEventListener("click", function () { state.detailMember = m; renderDetailModal(); });
      tbody.appendChild(tr);
    });
    var closeBtn = el("button", { class: "btn" }, ["✕ Close"]);
    closeBtn.addEventListener("click", close);
    var exp = el("button", { class: "btn" }, ["⬇ CSV"]);
    exp.addEventListener("click", function () { var t = memberRows(st.members); download("members.csv", I.toCsv(t.header, t.rows)); });
    var body = [el("div", { class: "count", text: num(st.members.length) + " record" + (st.members.length === 1 ? "" : "s") + (st.note ? " · " + st.note : "") })];
    body.push(st.members.length ? el("div", { class: "tablewrap modal-table" }, [el("table", { class: "grid" }, [thead, tbody])]) : el("div", { class: "empty-state", text: "No members." }));
    var modal = el("div", { class: "modal wide", role: "dialog", "aria-modal": "true", "aria-label": st.title }, [
      el("div", { class: "modal-head" }, [el("h3", { text: st.title }), exp, closeBtn]),
      el("div", { class: "modal-body" }, body)
    ]);
    var backdrop = el("div", { class: "modal-backdrop no-print" }, [modal]);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    host.appendChild(backdrop);
  }

  function renderDetailModal() {
    var host = $("#detailHost");
    if (!host) return;
    host.innerHTML = "";
    var m = state.detailMember;
    if (!m) return;
    function close() { state.detailMember = null; renderDetailModal(); }
    var known = el("div", { class: "detail-grid" });
    L.MEMBER_COLUMNS.forEach(function (c) {
      var v = L.displayValue(m, c);
      if (!v) return;
      known.appendChild(el("div", { class: "k", text: c.label }));
      known.appendChild(el("div", { class: "v", text: v }));
    });
    var sections = [el("div", { class: "modal-section" }, [el("h4", { text: "Membership" }), known])];
    if ((m.flags || []).length) {
      sections.push(el("div", { class: "modal-section" }, [el("h4", { text: "Data notes" }), el("div", { class: "hint", text: m.flags.map(flagText).join(" · ") })]));
    }
    var fields = m.fields || {};
    var keys = Object.keys(fields).filter(function (k) { return String(fields[k]).trim() !== ""; });
    if (keys.length) {
      var all = el("div", { class: "detail-grid" });
      keys.forEach(function (k) { all.appendChild(el("div", { class: "k", text: k })); all.appendChild(el("div", { class: "v", text: fields[k] })); });
      sections.push(el("div", { class: "modal-section" }, [el("h4", { text: "All columns from the import" }), all]));
    }
    var closeBtn = el("button", { class: "btn" }, ["✕ Close"]);
    closeBtn.addEventListener("click", close);
    var modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "modal-head" }, [el("h3", { text: L.fullName(m) || "Member" }), closeBtn]),
      el("div", { class: "modal-body" }, sections)
    ]);
    var backdrop = el("div", { class: "modal-backdrop no-print top", }, [modal]);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    host.appendChild(backdrop);
  }
  function flagText(f) {
    if (f.indexOf("badDate:") === 0) return "unreadable " + f.slice(8);
    return { sharedMemberNumber: "member number shared with another person", noMemberNumber: "no member number in export", zipPadded: "ZIP leading zero restored", expiresBeforeJoin: "expires before join date" }[f] || f;
  }

  // ---------- plain-language banner of data caveats ----------
  function caveats(pool) {
    var suspect = R.suspectJoinDates(state.members), items = [];
    Object.keys(suspect).forEach(function (d) {
      items.push(num(suspect[d]) + " members share the join date " + L.formatDate(d) + ". That looks like a ClubExpress data-load date rather than a real join day, so these members are left out of new-member counts and tenure.");
    });
    var roles = state.members.filter(R.isRole).length;
    if (roles && !state.includeRoles) items.push(num(roles) + " role accounts (officer positions) are not counted as members.");
    items.push("This is a current roster. Members who left before the latest export are not in it, so totals over time come only from dated imports saved here (see Reports → Members over time).");
    var box = el("details", { class: "panel notes" }, [el("summary", { text: "About these numbers" })]);
    box.appendChild(el("ul", {}, items.map(function (t) { return el("li", { text: t }); })));
    return box;
  }

  // ---------- Dashboard ----------
  function kpi(label, value, sub, onClick) {
    var d = el("div", { class: "kpi" + (onClick ? " click" : ""), tabindex: onClick ? "0" : null, role: onClick ? "button" : null }, [
      el("div", { class: "kpi-label", text: label }), el("div", { class: "kpi-value", text: String(value) }), el("div", { class: "kpi-sub", text: sub || "" })
    ]);
    if (onClick) {
      d.addEventListener("click", onClick);
      d.addEventListener("keydown", function (e) { if (e.key === "Enter") onClick(); });
    }
    return d;
  }
  function chartPanel(title, node, help) {
    return el("div", { class: "panel chart-panel" }, [el("h3", { text: title }), help ? el("div", { class: "hint", text: help }) : null, node]);
  }

  function buildDashboardView() {
    var view = el("div", { class: "view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }
    view.appendChild(filterBar(true));
    var t = today(), pool = filteredPool(), suspect = R.suspectJoinDates(state.members);
    var active = pool.filter(R.isActive);
    var uw = unitWord;
    var latest = state.importedAt ? fmtDateTime(state.importedAt) : "—";
    view.appendChild(el("div", { class: "loadedinfo", text: "Counts are " + (state.unit === "households" ? "households (primary memberships)" : "people (each spouse counted)") + " · reporting timezone " + R.TZ + " · today is " + L.formatDate(t) }));

    var grid = el("div", { class: "kpi-grid" });
    grid.appendChild(kpi("Active members", num(active.length), uw(active.length) + " with status Active", function () { openList("Active members", active); }));
    var others = [["Last month", "1m"], ["Last 3 months", "3m"], ["Last 6 months", "6m"], ["Last year", "12m"], ["Last 5 years", "60m"]];
    others.forEach(function (o) {
      var p = R.period(o[1], t, "rolling");
      var cur = R.newMembers(pool, p.start, p.end, suspect).members, prev = R.newMembers(pool, p.prevStart, p.prevEnd, suspect).members;
      var cmp = R.compare(cur.length, prev.length);
      grid.appendChild(kpi("New: " + o[0].toLowerCase(), num(cur.length), "vs prior period: " + cmp.text, function () { openList("New members — " + p.label, cur, p.start + " to " + p.end); }));
    });
    var withJoin = pool.filter(function (m) { return m.joinDate; });
    var earliest = withJoin.reduce(function (a, m) { return !a || m.joinDate < a ? m.joinDate : a; }, "");
    grid.appendChild(kpi("In records since 1958", num(withJoin.length), "current roster with a join date; earliest " + (earliest ? L.formatDate(earliest) : "—") + ". Not a complete club history.", function () { openList("Roster members with a join date", withJoin); }));
    var ren = R.renewals(pool, t);
    grid.appendChild(kpi("Renewals due in 30 days", num(ren.due30.length), num(ren.due90.length) + " within 90 days", function () { openList("Renewals due within 30 days", ren.due30); }));
    grid.appendChild(kpi("Active but past expiration", num(ren.expiredStillActive.length), "status Active, expiration date passed", function () { openList("Active but past expiration", ren.expiredStillActive); }));
    grid.appendChild(kpi("Latest import", latest, state.importLog.length ? state.importLog[0].sourceFile || "" : ""));
    view.appendChild(grid);
    view.appendChild(caveats(pool));

    var p12 = R.period("12m", t, "rolling");
    var months = R.monthlyNew(pool, p12.start, p12.end, suspect);
    var charts = el("div", { class: "chart-grid" });
    charts.appendChild(chartPanel("New members by month (last 12 months)", C.bar(months, {
      ariaLabel: "New members by month", onSelect: function (d) { openList("New members — " + d.label, d.members); }
    }), "Click a bar to see who joined. Bulk-load join dates are left out."));
    var byStatus = R.distribution(pool, function (m) { return m.status; });
    charts.appendChild(chartPanel("Membership status", C.donut(byStatus, { ariaLabel: "Status", centerLabel: uw(2), onSelect: function (d) { openList("Status: " + d.label, d.members); } })));
    var byType = R.distribution(pool, function (m) { return m.membershipType; });
    charts.appendChild(chartPanel("Membership type", C.donut(byType, { ariaLabel: "Membership type", centerLabel: uw(2), onSelect: function (d) { openList("Type: " + d.label, d.members); } })));
    charts.appendChild(chartPanel("Active members over time", snapshotChart(), "Built only from dated full imports saved by this site."));
    view.appendChild(charts);
    return view;
  }

  function snapshotChart() {
    var series = R.snapshotSeries(state.snapshots).map(function (s) { return { label: s.date, count: state.unit === "households" ? s.households : s.count, members: [] }; });
    if (series.length < 2) {
      return el("div", { class: "chart-empty" }, [series.length === 1 ?
        "Only one full import is saved so far (" + series[0].label + ": " + num(series[0].count) + " " + unitWord(series[0].count) + "). A trend line appears after the next full import." :
        "No full import has been saved yet."]);
    }
    return C.line(series, { ariaLabel: "Active members over time" });
  }

  // ---------- Reports ----------
  var REPORTS = [
    ["new", "New members"], ["status", "Status distribution"], ["type", "Membership type"], ["tenure", "Membership tenure"],
    ["geo", "Geography"], ["renewals", "Renewals & expirations"], ["history", "Members over time (saved imports)"],
    ["households", "Household membership"], ["service", "Long-serving & anniversaries"], ["quality", "Missing or inconsistent data"]
  ];
  var PRESETS = [["1m", "Last month"], ["3m", "Last 3 months"], ["6m", "Last 6 months"], ["12m", "Last year"], ["60m", "Last 5 years"], ["all", "Since 1958"], ["custom", "Custom"]];

  // A report is { explain, sections: [{ title, chart(node)|null, header, rows, onRow, note }] }.
  function buildReportSpec(pool, p, suspect, t) {
    var uw = unitWord, spec = { explain: "", sections: [] };
    function distSection(title, dist, label, extra) {
      var total = dist.reduce(function (a, d) { return a + d.count; }, 0);
      return {
        title: title, dist: dist,
        header: [label, uw(2).charAt(0).toUpperCase() + uw(2).slice(1), "% of total"],
        rows: dist.map(function (d) { return [d.label, d.count, pct(d.count, total)]; }), members: dist.map(function (d) { return d.members; }), note: extra || ""
      };
    }
    if (state.report === "new") {
      var nm = R.newMembers(pool, p.start, p.end, suspect), pv = p.prevStart ? R.newMembers(pool, p.prevStart, p.prevEnd, suspect) : null;
      var ya = R.yearAgo(p), yy = p.kind === "all" ? null : R.newMembers(pool, ya.start, ya.end, suspect);
      spec.explain = "Counts " + uw(2) + " in the current roster whose join date falls between " + L.formatDate(p.start) + " and " + L.formatDate(p.end) + " (" + p.label + ", " + p.kind + "). This is when people joined, not how many were members at the time. " +
        (nm.excludedBulkDate ? num(nm.excludedBulkDate) + " in this range share a bulk-load date and are excluded. " : "") + (nm.undated ? num(nm.undated) + " have no join date. " : "");
      var months = R.monthlyNew(pool, p.start < "1958-01-01" ? "1958-01-01" : p.start, p.end, suspect);
      if (p.kind === "all") months = months.filter(function (m) { return m.count; });
      spec.sections.push({ title: "New members by month", chart: function () { return C.bar(months, { ariaLabel: "New members by month", onSelect: function (d) { openList("New members — " + d.label, d.members); } }); },
        header: ["Month", "New " + uw(2), "Cumulative in range"], rows: months.map(function (m, i) { var cum = months.slice(0, i + 1).reduce(function (a, x) { return a + x.count; }, 0); return [m.label, m.count, cum]; }), members: months.map(function (m) { return m.members; }) });
      var years = R.yearlyNew(pool, p.start, p.end, suspect);
      if (p.kind === "all") years = years.filter(function (y) { return y.count; });
      spec.sections.push({ title: "New members by year", chart: function () { return C.bar(years, { ariaLabel: "New members by year", onSelect: function (d) { openList("New members — " + d.label, d.members); } }); },
        header: ["Year", "New " + uw(2)], rows: years.map(function (y) { return [y.label, y.count]; }), members: years.map(function (y) { return y.members; }), note: "Years with a partial range count only the part inside the selected dates." });
      var cmpRows = [["This period (" + p.start + " to " + p.end + ")", nm.members.length, "", ""]];
      if (pv) { var c1 = R.compare(nm.members.length, pv.members.length); cmpRows.push(["Previous period (" + p.prevStart + " to " + p.prevEnd + ")", pv.members.length, c1.abs, c1.pct == null ? "n/a (prior was 0)" : (Math.round(c1.pct * 10) / 10) + "%"]); }
      if (yy) { var c2 = R.compare(nm.members.length, yy.members.length); cmpRows.push(["Same dates a year earlier (" + ya.start + " to " + ya.end + ")", yy.members.length, c2.abs, c2.pct == null ? "n/a (prior was 0)" : (Math.round(c2.pct * 10) / 10) + "%"]); }
      spec.sections.push({ title: "Comparison", header: ["Period", "New " + uw(2), "Change vs this period", "% change"], rows: cmpRows, members: cmpRows.map(function (r, i) { return i === 0 ? nm.members : i === 1 && pv ? pv.members : yy.members; }),
        note: "Change = this period minus the comparison period. % change is shown as n/a when the comparison period had none." });
    } else if (state.report === "status") {
      spec.explain = "Current roster " + uw(2) + " grouped by the Status column of the latest import.";
      var d = R.distribution(pool, function (m) { return m.status; });
      var s = distSection("Status", d, "Status");
      s.chart = function () { return C.donut(d, { ariaLabel: "Status", centerLabel: uw(2), onSelect: function (x) { openList("Status: " + x.label, x.members); } }); };
      spec.sections.push(s);
    } else if (state.report === "type") {
      spec.explain = "Current roster " + uw(2) + " grouped by membership type. A Couple membership is two people but one household.";
      var d2 = R.distribution(pool, function (m) { return m.membershipType; });
      var s2 = distSection("Membership type", d2, "Membership type");
      s2.chart = function () { return C.donut(d2, { ariaLabel: "Membership type", centerLabel: uw(2), onSelect: function (x) { openList("Type: " + x.label, x.members); } }); };
      spec.sections.push(s2);
    } else if (state.report === "tenure") {
      spec.explain = "How long current " + uw(2) + " have belonged, from join date to today (" + L.formatDate(t) + "). Members with a bulk-load join date or no join date cannot be measured and are shown separately rather than guessed.";
      var d3 = R.distribution(pool, function (m) { return R.tenureBucket(m, t, suspect); }, { order: R.TENURE_ORDER });
      var s3 = distSection("Tenure", d3, "Tenure");
      s3.chart = function () { return C.bar(d3, { ariaLabel: "Tenure", onSelect: function (x) { openList("Tenure: " + x.label, x.members); } }); };
      spec.sections.push(s3);
    } else if (state.report === "geo") {
      spec.explain = "Where current " + uw(2) + " live, from the address columns of the latest import. Blank means the export had no value.";
      var dc = R.distribution(pool, function (m) { return m.city; }, { top: 12 });
      var sc = distSection("By city (top 12)", dc, "City"); sc.chart = function () { return C.bar(dc, { ariaLabel: "By city", onSelect: function (x) { openList("City: " + x.label, x.members); } }); };
      var ds = R.distribution(pool, function (m) { return m.state; });
      var ss = distSection("By state", ds, "State"); ss.chart = function () { return C.donut(ds, { ariaLabel: "By state", centerLabel: uw(2), onSelect: function (x) { openList("State: " + x.label, x.members); } }); };
      var dz = R.distribution(pool, function (m) { return R.zip5(m); }, { top: 12 });
      var sz = distSection("By ZIP code (top 12)", dz, "ZIP"); sz.chart = function () { return C.bar(dz, { ariaLabel: "By ZIP", onSelect: function (x) { openList("ZIP: " + x.label, x.members); } }); };
      spec.sections.push(sc, ss, sz);
    } else if (state.report === "renewals") {
      var r = R.renewals(pool, t);
      spec.explain = "Uses the expiration date column. Due = expires between today and the stated number of days; Expired = status Active but the date has passed (so it needs attention). Expirations more than five years out (role/lifetime accounts) are shown as no expiry. ClubExpress memberships here usually expire together on one date, so expect one large month.";
      spec.sections.push({ title: "Expirations by month", chart: function () { return C.bar(r.byExpirationMonth, { ariaLabel: "Expirations by month", onSelect: function (x) { openList("Expiring " + x.label, x.members); } }); },
        header: ["Month", uw(2)], rows: r.byExpirationMonth.map(function (m) { return [m.label, m.count]; }), members: r.byExpirationMonth.map(function (m) { return m.members; }) });
      var sum = [["Active but past expiration", r.expiredStillActive], ["Due within 30 days", r.due30], ["Due within 60 days", r.due60], ["Due within 90 days", r.due90], ["No expiry (far-future date)", r.noExpiry]];
      spec.sections.push({ title: "Renewal status", header: ["Group", uw(2)], rows: sum.map(function (x) { return [x[0], x[1].length]; }), members: sum.map(function (x) { return x[1]; }) });
    } else if (state.report === "history") {
      var series = R.snapshotSeries(state.snapshots);
      spec.explain = "A current roster cannot show how many people belonged in the past, so this report uses only the dated FULL imports saved by this site. Each point is the number of active " + uw(2) + " in that import. Partial imports are never used. Gaps between points mean no full import was done in between — nothing is estimated.";
      var pts = series.map(function (s) { return { label: s.date, count: state.unit === "households" ? s.households : s.count, members: [] }; });
      spec.sections.push({ title: "Active " + uw(2) + " at each saved import", chart: function () { return snapshotChart(); }, header: ["Import date", "Active " + uw(2)], rows: pts.map(function (x) { return [x.label, x.count]; }), members: pts.map(function () { return []; }) });
      var ch = R.snapshotChanges(state.snapshots);
      spec.sections.push({ title: "Movement between imports (people)", header: ["From", "To", "Kept", "Retention", "New", "Not in newer file", "Returned"],
        rows: ch.map(function (c) { return [c.from, c.to, c.retained, c.retentionPct == null ? "—" : Math.round(c.retentionPct * 10) / 10 + "%", c.joined.length, c.lost.length, c.reactivated.length]; }), members: ch.map(function () { return []; }),
        note: ch.length ? "“Not in newer file” means absent from the later full export — it may be a lapse, a resignation or a data issue; this site does not decide which." : "Needs at least two full imports. Import a fresh full export next time and this fills in." });
    } else if (state.report === "households") {
      spec.explain = "Groups people by primary member number (the household). Household counts are always households, not people.";
      var hs = R.householdSizes(R.pool(state.members, { includeRoles: state.includeRoles, status: state.filters.status ? [state.filters.status] : null, types: state.filters.type ? [state.filters.type] : null, states: state.filters.state ? [state.filters.state] : null, cities: state.filters.city ? [state.filters.city] : null }));
      spec.sections.push({ title: "Households by size", chart: function () { return C.bar(hs, { ariaLabel: "Households by size", onSelect: function (x) { openList(x.label, x.members); } }); },
        header: ["Household size", "Households", "People"], rows: hs.map(function (x) { return [x.label, x.count, x.members.length]; }), members: hs.map(function (x) { return x.members; }) });
    } else if (state.report === "service") {
      var ls = R.longServing(pool, t, 10, suspect);
      var an = R.upcomingAnniversaries(pool, t, 60, suspect);
      spec.explain = "Long-serving = ten or more years since a trustworthy join date. Anniversaries = membership anniversaries in the next 60 days. Bulk-load and missing join dates are skipped because they would give wrong years.";
      spec.sections.push({ title: "Members of 10+ years", header: ["Name", "Joined", "Years"], rows: ls.map(function (m) { return [memberLine(m), L.formatDate(m.joinDate), R.yearsBetween(m.joinDate, t)]; }), members: ls.map(function (m) { return [m]; }) });
      spec.sections.push({ title: "Anniversaries in the next 60 days", header: ["Name", "Date", "Years"], rows: an.map(function (a) { return [memberLine(a.member), L.formatDate(a.date), a.years]; }), members: an.map(function (a) { return [a.member]; }) });
    } else if (state.report === "quality") {
      var dq = R.dataQuality(pool, t);
      spec.explain = "Things in the import that are missing, inconsistent or ambiguous. Nothing here is changed or deleted; fix them in ClubExpress and re-import.";
      spec.sections.push({ title: "Data checks", header: ["Check", uw(2), "What it means"], rows: dq.map(function (q) { return [q.label, q.count, q.help]; }), members: dq.map(function (q) { return q.members; }) });
    }
    return spec;
  }

  function buildReportsView() {
    var view = el("div", { class: "view reports-view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }
    var t = today(), pool = filteredPool(), suspect = R.suspectJoinDates(state.members), p = currentPeriod();

    var repSel = select("Report", REPORTS, state.report, function (v) { state.report = v; renderViews(); });
    view.appendChild(el("div", { class: "toolbar no-print" }, [repSel]));
    var needsPeriod = state.report === "new";
    if (needsPeriod) {
      var presets = el("div", { class: "preset-row no-print" });
      PRESETS.forEach(function (x) {
        var b = el("button", { class: "btn" + (state.preset === x[0] ? " primary" : "") }, [x[1]]);
        b.addEventListener("click", function () { state.preset = x[0]; renderViews(); });
        presets.appendChild(b);
      });
      view.appendChild(presets);
      var pc = el("div", { class: "toolbar no-print" });
      if (state.preset !== "all" && state.preset !== "custom") {
        pc.appendChild(select("Periods", [["rolling", "Rolling (ends today)"], ["calendar", "Completed calendar months"]], state.periodMode, function (v) { state.periodMode = v; renderViews(); }));
      }
      if (state.preset === "custom") {
        var a = el("input", { type: "date", value: state.custom.start || "", "aria-label": "Start date" }), b2 = el("input", { type: "date", value: state.custom.end || "", "aria-label": "End date" });
        a.addEventListener("change", function () { state.custom.start = a.value; renderViews(); });
        b2.addEventListener("change", function () { state.custom.end = b2.value; renderViews(); });
        pc.appendChild(el("label", { class: "ctl" }, ["From ", a])); pc.appendChild(el("label", { class: "ctl" }, ["To ", b2]));
      }
      view.appendChild(pc);
    }
    view.appendChild(filterBar(true));

    var spec = buildReportSpec(pool, p, suspect, t);
    var title = (REPORTS.filter(function (r) { return r[0] === state.report; })[0] || [0, ""])[1];
    var area = el("div", { class: "report-area" });
    area.appendChild(el("div", { class: "report-head" }, [el("h2", { text: title }),
      el("div", { class: "count", text: (needsPeriod ? p.label + " · " + p.start + " to " + p.end + " · " : "") + "counts are " + unitWord(2) + " · " + R.TZ + " · as of " + L.formatDate(t) })]));
    area.appendChild(el("div", { class: "panel explain" }, [el("strong", { text: "What this shows. " }), spec.explain]));
    spec.sections.forEach(function (s) { area.appendChild(renderSection(s)); });
    view.appendChild(area);

    var actions = el("div", { class: "toolbar no-print" });
    var exp = el("button", { class: "btn" }, ["⬇ Export report CSV"]);
    exp.addEventListener("click", function () {
      var out = [[title], [(needsPeriod ? p.label + " (" + p.start + " to " + p.end + ")" : "") + " counts are " + unitWord(2)]];
      spec.sections.forEach(function (s) { out.push([]); out.push([s.title]); out.push(s.header); s.rows.forEach(function (r) { out.push(r); }); });
      download("report-" + state.report + ".csv", out.map(function (r) { return r.map(I.csvCell).join(","); }).join("\r\n") + "\r\n");
    });
    var pr = el("button", { class: "btn" }, ["🖨 Print"]);
    pr.addEventListener("click", function () { window.print(); });
    actions.appendChild(exp); actions.appendChild(pr);
    view.appendChild(actions);
    return view;
  }

  function renderSection(s) {
    var panel = el("div", { class: "panel chart-panel" }, [el("h3", { text: s.title })]);
    if (s.chart) panel.appendChild(s.chart());
    var thead = el("thead", {}, [el("tr", {}, s.header.map(function (h) { return el("th", { text: h }); }))]);
    var tbody = el("tbody");
    s.rows.forEach(function (r, i) {
      var tr = el("tr", {}, r.map(function (c, ci) { return el("td", { text: String(c), class: typeof c === "number" ? "num" : "" }); }));
      var list = s.members && s.members[i];
      if (list && list.length) {
        tr.className = "click";
        tr.setAttribute("title", "Click to list these members");
        tr.addEventListener("click", function () { openList(s.title + " — " + r[0], list); });
      }
      tbody.appendChild(tr);
    });
    if (!s.rows.length) tbody.appendChild(el("tr", {}, [el("td", { colspan: String(s.header.length), class: "empty-state", text: "Nothing to show for this selection." })]));
    var det = el("details", { class: "support", open: "open" }, [el("summary", { text: "Supporting table" }), el("div", { class: "tablewrap" }, [el("table", { class: "grid static" }, [thead, tbody])])]);
    panel.appendChild(det);
    if (s.note) panel.appendChild(el("div", { class: "hint", text: s.note }));
    return panel;
  }

  // ---------- Members directory ----------
  function buildMembersView() {
    var view = el("div", { class: "view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }
    if (state.importedAt) view.appendChild(el("div", { class: "loadedinfo", text: "Last imported " + fmtDateTime(state.importedAt) + " · " + state.members.length + " records" }));
    view.appendChild(filterBar(false));
    var search = el("input", { type: "search", placeholder: "Search name, number, email, city…", value: state.search, "aria-label": "Search members" });
    var countEl = el("span", { class: "count" });
    var exp = el("button", { class: "btn" }, ["⬇ CSV"]);
    view.appendChild(el("div", { class: "toolbar" }, [search, countEl, el("span", { class: "spacer" }), exp]));
    var columns = L.visibleColumns(state.members);
    var thead = el("thead"), headRow = el("tr");
    columns.forEach(function (c) {
      var th = el("th", { class: c.num ? "num" : "" }, [c.label]);
      if (state.sortKey === c.key) th.appendChild(el("span", { class: "arrow", text: state.sortDir === "asc" ? "▲" : "▼" }));
      th.addEventListener("click", function () {
        if (state.sortKey === c.key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc"; else { state.sortKey = c.key; state.sortDir = "asc"; }
        renderViews();
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    var tbody = el("tbody"), table = el("table", { class: "grid" }, [thead, tbody]), shown = [];
    function renderBody() {
      var f = state.filters;
      var base = R.pool(state.members, { includeRoles: true, status: f.status ? [f.status] : null, types: f.type ? [f.type] : null, states: f.state ? [f.state] : null, cities: f.city ? [f.city] : null })
        .filter(function (m) { return state.includeRoles || !R.isRole(m); });
      shown = L.sortMembers(L.searchMembers(base, state.search), state.sortKey, state.sortDir);
      tbody.innerHTML = "";
      shown.forEach(function (m) {
        var tr = el("tr", {}, columns.map(function (c) { return el("td", { class: c.num ? "num" : "", text: L.displayValue(m, c) }); }));
        tr.addEventListener("click", function () { state.detailMember = m; renderDetailModal(); });
        tbody.appendChild(tr);
      });
      if (!shown.length) tbody.appendChild(el("tr", {}, [el("td", { colspan: String(columns.length), class: "empty-state", text: "No members match." })]));
      countEl.textContent = shown.length === state.members.length ? shown.length + " records" : shown.length + " of " + state.members.length + " records";
    }
    search.addEventListener("input", function () { state.search = search.value; renderBody(); });
    exp.addEventListener("click", function () { var t = memberRows(shown); download("members.csv", I.toCsv(t.header, t.rows)); });
    renderBody();
    view.appendChild(el("div", { class: "tablewrap" }, [table]));
    return view;
  }

  // ---------- Import ----------
  function buildImportView() {
    var view = el("div", { class: "view import-view" });
    var imp = state.imp;
    var panel = el("div", { class: "panel" }, [el("h3", { text: "Import ClubExpress membership data" })]);
    panel.appendChild(el("p", { class: "hint", text: "Use the ClubExpress “Additional Member Data” report export (CSV). The file is read and checked in your browser first; nothing is saved until you press Import." }));
    var file = el("input", { type: "file", accept: ".csv,text/csv", "aria-label": "Membership CSV" });
    file.addEventListener("change", function () { if (file.files[0]) readFile(file.files[0]); });
    panel.appendChild(file);
    if (imp && imp.error) panel.appendChild(el("div", { class: "errors", text: imp.error }));
    if (imp && imp.result) panel.appendChild(importResult(imp.result));
    else if (imp && imp.parsed) panel.appendChild(importPreview(imp));
    view.appendChild(panel);
    view.appendChild(importHistory());
    return view;
  }

  function readFile(f) {
    state.imp = { fileName: f.name, size: f.size };
    var reader = new FileReader();
    reader.onerror = function () { state.imp.error = "Could not read that file."; renderViews(); };
    reader.onload = function () {
      try {
        var dec = I.decodeBytes(new Uint8Array(reader.result));
        var rows = I.parseCsv(dec.text);
        if (rows.length < 2) { state.imp.error = "That file looks empty."; renderViews(); return; }
        var sug = I.suggestMapping(rows[0]);
        state.imp = { fileName: f.name, size: f.size, rows: rows, dec: dec, header: rows[0], mapping: sug.mapping, unmapped: sug.unmapped, missingRequired: sug.missingRequired, mode: null, parsed: true };
        rebuildImport();
      } catch (e) { state.imp = { error: "That file could not be read as a CSV: " + e.message }; }
      renderViews();
    };
    reader.readAsArrayBuffer(f);
  }
  function rebuildImport() {
    var imp = state.imp;
    imp.missingRequired = I.FIELDS.filter(function (f) { return f.required && (imp.mapping[f.key] === null || imp.mapping[f.key] === undefined); }).map(function (f) { return f.label; });
    if (imp.missingRequired.length) { imp.built = null; imp.diff = null; return; }
    imp.built = I.buildMembers(imp.rows, imp.mapping);
    if (imp.built.fatal) { imp.error = imp.built.warnings[0]; imp.built = null; return; }
    var cur = state.members;
    // Default: a file with most of the current roster is a full snapshot.
    if (imp.mode === null) imp.mode = (!cur.length || imp.built.members.length >= cur.length * 0.8) ? "full" : "partial";
    imp.diff = I.diffAgainst(cur, imp.built.members, imp.mode);
  }

  function importPreview(imp) {
    var box = el("div", { class: "import-preview" });
    box.appendChild(el("div", { class: "loadedinfo", text: imp.fileName + " · " + num(imp.rows.length - 1) + " data rows · " + imp.header.length + " columns · " + imp.dec.encoding + (imp.dec.replacementChars ? " · " + imp.dec.replacementChars + " damaged characters already in the file" : "") }));

    var mapRows = I.FIELDS.map(function (f) {
      var sel = el("select", { "aria-label": "Column for " + f.label });
      sel.appendChild(el("option", { value: "", text: f.required ? "— choose a column —" : "— not in file —" }));
      imp.header.forEach(function (h, i) { var o = el("option", { value: String(i), text: h }); if (imp.mapping[f.key] === i) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", function () { imp.mapping[f.key] = sel.value === "" ? null : Number(sel.value); rebuildImport(); renderViews(); });
      return el("tr", {}, [el("td", { text: f.label + (f.required ? " *" : "") }), el("td", {}, [sel])]);
    });
    box.appendChild(el("details", { class: "support", open: imp.missingRequired.length ? "open" : null }, [el("summary", { text: "Column mapping (" + (I.FIELDS.length - mapRows.filter(function (r, i) { return imp.mapping[I.FIELDS[i].key] === null; }).length) + " of " + I.FIELDS.length + " fields matched)" }),
      el("table", { class: "grid static" }, [el("tbody", {}, mapRows)])]));
    if (imp.missingRequired.length) {
      box.appendChild(el("div", { class: "errors", text: "Choose a column for: " + imp.missingRequired.join(", ") + "." }));
      return box;
    }
    var dfn = imp.diff, b = imp.built;
    var mode = el("div", { class: "toolbar" });
    ["full", "partial"].forEach(function (mv) {
      var r = el("input", { type: "radio", name: "mode", value: mv });
      r.checked = imp.mode === mv;
      r.addEventListener("change", function () { imp.mode = mv; rebuildImport(); renderViews(); });
      mode.appendChild(el("label", { class: "ctl" }, [r, mv === "full" ? " Full snapshot — this file is the whole current roster" : " Partial update — only some members; merge into the roster"]));
    });
    box.appendChild(mode);
    box.appendChild(el("div", { class: "hint", text: imp.mode === "full" ? "A full snapshot replaces the current roster and is saved as a dated point for history reports. Members missing from it are listed below but NOT treated as resigned or expired." : "A partial update changes only the members in the file. It is logged but never used for totals over time." }));

    var stats = el("div", { class: "kpi-grid small" }, [
      kpi("Will be added", num(dfn.added.length), "new to this site"), kpi("Will be updated", num(dfn.updated.length), "same member, changed data"),
      kpi("Unchanged", num(dfn.unchanged.length), ""), kpi("Rejected", num(b.rejected.length), "see reasons below"),
      kpi("Not in this file", num(dfn.notInFile.length), imp.mode === "full" ? "stay unmarked; just absent" : "n/a for partial")
    ]);
    box.appendChild(stats);

    var review = b.members.filter(function (m) { return (m.flags || []).length; });
    if (review.length) {
      var items = review.slice(0, 12).map(function (m) { return el("li", { text: memberLine(m) + " — " + m.flags.map(flagText).join(", ") }); });
      box.appendChild(el("details", { class: "support" }, [el("summary", { text: num(review.length) + " records flagged for review (still imported)" }), el("ul", {}, items.concat(review.length > 12 ? [el("li", { text: "…and " + (review.length - 12) + " more (see Reports → Missing or inconsistent data after importing)" })] : []))]));
    }
    if (b.rejected.length) {
      var rl = b.rejected.slice(0, 15).map(function (r) { return el("li", { text: "Row " + r.rowNumber + ": " + r.reason }); });
      var dl = el("button", { class: "btn" }, ["⬇ Download rejected rows (CSV)"]);
      dl.addEventListener("click", function () {
        download("rejected-rows.csv", I.toCsv(["Row", "Reason"].concat(imp.header), b.rejected.map(function (r) { return [r.rowNumber, r.reason].concat(r.row); })));
      });
      box.appendChild(el("details", { class: "support", open: "open" }, [el("summary", { text: num(b.rejected.length) + " rows rejected" }), el("ul", {}, rl), dl]));
    }
    if (dfn.notInFile.length && imp.mode === "full") {
      var nl = dfn.notInFile.slice(0, 10).map(function (m) { return el("li", { text: memberLine(m) + (m.memberNumber ? " (#" + m.memberNumber + ")" : "") }); });
      box.appendChild(el("details", { class: "support" }, [el("summary", { text: num(dfn.notInFile.length) + " current members are not in this file" }), el("ul", {}, nl)]));
    }
    var go = el("button", { class: "btn primary" }, ["Import " + num(b.members.length) + " members"]);
    go.addEventListener("click", function () { commitImport(go); });
    box.appendChild(el("div", { class: "toolbar" }, [go, el("span", { class: "hint", text: imp.mode === "full" ? "Replaces the current roster of " + num(state.members.length) + "." : "Merges into the current roster of " + num(state.members.length) + "." })]));
    return box;
  }

  function commitImport(btn) {
    var imp = state.imp;
    btn.disabled = true; btn.textContent = "Importing…";
    fetch(SITE.importUrl, {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": SITE.csrf || "" }, credentials: "same-origin",
      body: JSON.stringify({ mode: imp.mode, sourceFile: imp.fileName, members: imp.built.members, rejected: imp.built.rejected })
    }).then(function (res) { return res.json().then(function (j) { return { ok: res.ok, body: j }; }); })
      .then(function (r) {
        if (r.ok && r.body.ok) { imp.result = r.body; delete imp.parsed; } else imp.error = (r.body && r.body.error) || "The import failed.";
        renderViews();
      }).catch(function () { imp.error = "Could not reach the server. Nothing was saved."; renderViews(); });
  }

  function importResult(res) {
    var box = el("div", { class: "import-result" }, [
      el("div", { class: "success", text: "Import complete (" + (res.mode === "full" ? "full snapshot" : "partial update") + "): " + num(res.added) + " added, " + num(res.updated) + " updated, " + num(res.unchanged) + " unchanged, " + num(res.rejected) + " rejected." })
    ]);
    if (res.rejected) box.appendChild(el("a", { class: "btn", href: SITE.importUrl + "?download=rejected&batch=" + encodeURIComponent(res.batch) }, ["⬇ Download rejected rows"]));
    var reload = el("button", { class: "btn primary" }, ["View dashboard"]);
    reload.addEventListener("click", function () { try { history.replaceState(null, "", "#dashboard"); } catch (e) { /* ignore */ } location.reload(); });
    box.appendChild(reload);
    return box;
  }

  function importHistory() {
    var panel = el("div", { class: "panel" }, [el("h3", { text: "Import history" })]);
    if (!state.importLog.length) { panel.appendChild(el("div", { class: "hint", text: "No imports yet." })); return panel; }
    var head = ["Imported", "File", "Type", "Rows", "Added", "Updated", "Unchanged", "Rejected"];
    var rows = state.importLog.map(function (e) {
      return [fmtDateTime(e.timestamp), e.sourceFile || "", e.mode === "partial" ? "Partial" : "Full", e.count, e.added == null ? "" : e.added, e.updated == null ? "" : e.updated, e.unchanged == null ? "" : e.unchanged, e.rejected == null ? "" : e.rejected];
    });
    panel.appendChild(el("div", { class: "tablewrap" }, [el("table", { class: "grid static" }, [
      el("thead", {}, [el("tr", {}, head.map(function (h) { return el("th", { text: h }); }))]),
      el("tbody", {}, rows.map(function (r) { return el("tr", {}, r.map(function (c) { return el("td", { text: String(c) }); })); }))
    ])]));
    return panel;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (state.detailMember) { state.detailMember = null; renderDetailModal(); }
    else if (state.list) { state.list = null; renderListModal(); }
  });

  function init() {
    var h = (location.hash || "").replace("#", "");
    if (["dashboard", "reports", "members", "import"].indexOf(h) !== -1) state.tab = h;
    buildHeaderMenu();
    renderViews();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
