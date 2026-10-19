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

  // "Show" setting (Members / Households / Both) is site-wide and remembered in this browser.
  function loadView() {
    try { var v = localStorage.getItem("mm.view"); return v === "members" || v === "households" ? v : "both"; } catch (e) { return "both"; }
  }

  var state = {
    tab: "dashboard",
    members: [], importedAt: null, importLog: [], snapshots: [],
    unit: "people", includeRoles: false,
    filters: { status: "", type: "", state: "", city: "" },
    preset: "12m", periodMode: "rolling", custom: { start: "", end: "" },
    report: "new",
    search: "", sortKey: "lastName", sortDir: "asc",
    detailMember: null, list: null, menuOpen: false,
    imp: null, chartPage: null, view: loadView(),
    meetingEnd: null, meetingOpts: { joined: true, summary: true, renewals: true, anniversaries: true },
    dev: { loading: false, unlocked: false, system: null, message: "", error: "" }
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
  // Every count card shows members/households. households = single members + couple members / 2.
  function viewKinds() { return state.view === "both" ? ["members", "households"] : [state.view]; }
  function kindCount(list, kind) { return kind === "households" ? R.householdTotal(list) : list.length; }
  function viewCounts(list) { return viewKinds().map(function (k) { return kindCount(list, k); }); }
  function viewNames(prefix) {
    return viewKinds().map(function (k) { var w = (prefix || "") + (k === "households" ? "households" : "members"); return w.charAt(0).toUpperCase() + w.slice(1); });
  }
  function viewWord() { return state.view === "both" ? "members/households" : state.view; }
  function viewNoun() { return state.view === "households" ? "households" : "members"; }
  // One number per chart bar: households in Households view, otherwise members.
  function chartVal(list) { return state.view === "households" ? R.householdTotal(list) : list.length; }
  function chartRows(rows) { return rows.map(function (r) { var o = Object.assign({}, r); o.count = chartVal(r.members); return o; }); }
  function distV() { return chartRows(R.distribution.apply(R, arguments)); }
  // Card text: 361/217 (Both), 361 (Members) or 217 (Households).
  function mmhh(list) { return viewCounts(list).map(num).join("/"); }
  function signed(n) { var r = Math.round(n * 10) / 10; return (r > 0 ? "+" : "") + num(r); }
  function mmhhDelta(cur, prev) { return viewKinds().map(function (k) { return signed(kindCount(cur, k) - kindCount(prev, k)); }).join("/"); }
  var vdelta = mmhhDelta;
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
  // People-level records under the current filters, regardless of the Count selector
  // (household figures use the club's formula on people records).
  function peoplePoolFiltered() {
    var f = state.filters;
    return R.pool(state.members, { includeRoles: state.includeRoles, unit: "people",
      status: f.status ? [f.status] : null, types: f.type ? [f.type] : null, states: f.state ? [f.state] : null, cities: f.city ? [f.city] : null });
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
    var dev = el("button", { class: "hdr-menu-item" }, ["🛠 Developer"]);
    dev.addEventListener("click", function () { state.menuOpen = false; renderHeaderMenu(); openDeveloper(); });
    menu.appendChild(dev);
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
      state.tab === "import" ? buildImportView() : state.tab === "developer" ? buildDeveloperView() : state.tab === "meeting" ? buildMeetingView() : buildDashboardView();
    app.appendChild(view);
    renderListModal();
    renderDetailModal();
    renderChartPage();
  }
  function buildTabs() {
    var tabs = [["dashboard", "Dashboard"], ["reports", "Reports"], ["meeting", "Monthly Meeting"], ["members", "Members"], ["import", "Import"]];
    var bar = el("div", { class: "tabs no-print", role: "tablist" }, tabs.map(function (t) {
      var d = el("div", { class: "tab" + (state.tab === t[0] ? " active" : ""), text: t[1], role: "tab", tabindex: "0" });
      d.addEventListener("click", function () { selectTab(t[0]); });
      d.addEventListener("keydown", function (e) { if (e.key === "Enter") selectTab(t[0]); });
      return d;
    }));
    bar.appendChild(el("span", { class: "spacer" }));
    // Applies to every page: cards, charts and report tables show members, households, or both.
    var pick = select("Show", [["members", "Members"], ["households", "Households"], ["both", "Both"]], state.view, function (v) {
      state.view = v;
      try { localStorage.setItem("mm.view", v); } catch (e) { /* private mode: setting just isn't remembered */ }
      renderViews();
    });
    pick.className += " view-pick";
    bar.appendChild(pick);
    return bar;
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
    body.push(st.members.length ? el("div", { class: "tablewrap modal-table" }, [tkEnhanceTable(el("table", { class: "grid" }, [thead, tbody]), st.tkKey || (st.tkKey = "list#" + (++tkSeq)))]) : el("div", { class: "empty-state", text: "No members." }));
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
  function chartPanel(title, node, help, onOpen) {
    var card = el("div", { class: "panel chart-panel" + (onOpen ? " openable" : ""), title: onOpen ? "Click for the full-page view" : null, tabindex: onOpen ? "0" : null }, [
      el("h3", {}, [title, onOpen ? el("span", { class: "open-hint no-print", text: "⤢ full page" }) : null]), help ? el("div", { class: "hint", text: help }) : null, node]);
    if (onOpen) {
      // Clicking a bar still lists its members; clicking anywhere else on the card opens the full page.
      card.addEventListener("click", function (e) { if (e.target.closest && e.target.closest('[role="button"]')) return; onOpen(); });
      card.addEventListener("keydown", function (e) { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } });
    }
    return card;
  }

  function buildDashboardView() {
    var view = el("div", { class: "view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }
    view.appendChild(filterBar(true));
    var t = today(), pool = filteredPool(), suspect = R.suspectJoinDates(state.members);
    var active = pool.filter(R.isActive);
    var uw = unitWord;
    var latest = state.importedAt ? fmtDateTime(state.importedAt) : "—";
    view.appendChild(el("div", { class: "loadedinfo", text: "Showing " + viewWord() + " (households = single members + couple members ÷ 2) · reporting timezone " + R.TZ + " · today is " + L.formatDate(t) }));

    var grid = el("div", { class: "kpi-grid" });
    var hbMember = R.householdBreakdown(active);
    grid.appendChild(kpi("Membership", mmhh(active), viewWord() + " with status Active · " + num(hbMember.singleHouseholds) + " single + " + num(hbMember.couples.length) + " couple members ÷ 2", function () { openList("Membership (active members)", active); }));
    var others = [["Last month", "1m"], ["Last 3 months", "3m"], ["Last 6 months", "6m"], ["Last year", "12m"], ["Last 5 years", "60m"]];
    others.forEach(function (o) {
      var p = R.period(o[1], t, "rolling");
      var cur = R.newMembers(pool, p.start, p.end, suspect).members, prev = R.newMembers(pool, p.prevStart, p.prevEnd, suspect).members;
      var cmp = R.compare(cur.length, prev.length);
      grid.appendChild(kpi("New: " + o[0].toLowerCase(), mmhh(cur), "prior period " + mmhh(prev) + " · change " + mmhhDelta(cur, prev), function () { openList("New members — " + p.label, cur, p.start + " to " + p.end); }));
    });
    var withJoin = pool.filter(function (m) { return m.joinDate; });
    var earliest = withJoin.reduce(function (a, m) { return !a || m.joinDate < a ? m.joinDate : a; }, "");
    var hpAct = peoplePoolFiltered().filter(R.isActive), hbAct = R.householdBreakdown(hpAct);
    grid.appendChild(kpi("In records since 1958", mmhh(withJoin), "current roster with a join date; earliest " + (earliest ? L.formatDate(earliest) : "—") + ". Not a complete club history.", function () { openList("Roster members with a join date", withJoin); }));
    var ren = R.renewals(pool, t);
    grid.appendChild(kpi("Renewals due in 30 days", mmhh(ren.due30), mmhh(ren.due90) + " within 90 days", function () { openList("Renewals due within 30 days", ren.due30); }));
    var rs = R.renewalStatus(pool, t), tgt = L.formatDate(rs.target);
    grid.appendChild(kpi("Renewed", mmhh(rs.renewed), "expire " + tgt + " or later (already renewed)", function () { openList("Renewed — expire " + tgt + " or later", rs.renewed); }));
    grid.appendChild(kpi("Left to renew", mmhh(rs.left), "current, but expire before " + tgt, function () { openList("Left to renew — expire before " + tgt, rs.left); }));
    grid.appendChild(kpi("Expired", mmhh(rs.expired), "expiration date before today", function () { openList("Expired — expiration date before today", rs.expired); }));
    grid.appendChild(kpi("Latest import", latest, state.importLog.length ? state.importLog[0].sourceFile || "" : ""));
    view.appendChild(grid);
    view.appendChild(caveats(pool));

    var p12 = R.period("12m", t, "rolling");
    var vH = state.view === "households", vM = state.view === "members", noun = viewNoun();
    var months = vH ? R.householdsMonthly(peoplePoolFiltered(), p12.start, p12.end, suspect) : chartRows(R.monthlyNew(pool, p12.start, p12.end, suspect));
    var charts = el("div", { class: "chart-grid" });
    charts.appendChild(chartPanel("New " + noun + " by month (last 12 months)", C.bar(months, {
      ariaLabel: "New " + noun + " by month", onSelect: function (d) { openList("New members — " + d.label, d.members); }
    }), vH ? "Each couple member counts as half a household." : "Click a bar to see who joined. Bulk-load join dates are left out.", function () { openChartPage(vH ? "hnew" : "new"); }));
    var byStatus = distV(pool, function (m) { return m.status; });
    var hByType = R.householdsByType(hpAct);
    if (!vM) charts.appendChild(chartPanel("Households by membership type", C.bar(hByType, { ariaLabel: "Households by membership type", onSelect: function (d) { openList("Households: " + d.label, d.members); } }), "Households = single members + couple members ÷ 2.", function () { openChartPage("htype"); }));
    var hMonths = R.householdsMonthly(peoplePoolFiltered(), p12.start, p12.end, suspect);
    if (state.view === "both") charts.appendChild(chartPanel("New households by month (last 12 months)", C.bar(hMonths, { ariaLabel: "New households by month", onSelect: function (d) { openList("New members — " + d.label, d.members); } }), "Each couple member counts as half a household.", function () { openChartPage("hnew"); }));
    charts.appendChild(chartPanel("Membership status", C.donut(byStatus, { ariaLabel: "Status", centerLabel: viewNoun(), onSelect: function (d) { openList("Status: " + d.label, d.members); } })));
    var byType = distV(pool, function (m) { return m.membershipType; });
    charts.appendChild(chartPanel("Membership type", C.donut(byType, { ariaLabel: "Membership type", centerLabel: viewNoun(), onSelect: function (d) { openList("Type: " + d.label, d.members); } })));
    charts.appendChild(chartPanel("Active " + noun + " over time", snapshotChart(), "Built only from dated full imports saved by this site."));
    view.appendChild(charts);
    return view;
  }

  function snapshotChart() {
    var series = R.snapshotSeries(state.snapshots).map(function (s) { return { label: s.date, count: state.view === "households" ? s.households : s.count, members: [] }; });
    if (series.length < 2) {
      return el("div", { class: "chart-empty" }, [series.length === 1 ?
        "Only one full import is saved so far (" + series[0].label + ": " + num(series[0].count) + " " + viewNoun() + "). A trend line appears after the next full import." :
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
        header: [label].concat(viewNames("")).concat(["% of total"]),
        rows: dist.map(function (d) { return [d.label].concat(viewCounts(d.members)).concat([pct(d.count, total)]); }), members: dist.map(function (d) { return d.members; }), note: extra || ""
      };
    }
    if (state.report === "new") {
      var nm = R.newMembers(pool, p.start, p.end, suspect), pv = p.prevStart ? R.newMembers(pool, p.prevStart, p.prevEnd, suspect) : null;
      var ya = R.yearAgo(p), yy = p.kind === "all" ? null : R.newMembers(pool, ya.start, ya.end, suspect);
      spec.explain = "Counts " + uw(2) + " in the current roster whose join date falls between " + L.formatDate(p.start) + " and " + L.formatDate(p.end) + " (" + p.label + ", " + p.kind + "). This is when people joined, not how many were members at the time. " +
        (nm.excludedBulkDate ? num(nm.excludedBulkDate) + " in this range share a bulk-load date and are excluded. " : "") + (nm.undated ? num(nm.undated) + " have no join date. " : "");
      var months = chartRows(R.monthlyNew(pool, p.start < "1958-01-01" ? "1958-01-01" : p.start, p.end, suspect));
      if (p.kind === "all") months = months.filter(function (m) { return m.count; });
      spec.sections.push({ title: "New " + viewNoun() + " by month", chart: function () { return C.bar(months, { ariaLabel: "New members by month", onSelect: function (d) { openList("New members — " + d.label, d.members); } }); },
        header: ["Month"].concat(viewNames("New ")).concat(["Cumulative in range"]), rows: months.map(function (m, i) { var cum = months.slice(0, i + 1).reduce(function (a, x) { return a + x.count; }, 0); return [m.label].concat(viewCounts(m.members)).concat([cum]); }), members: months.map(function (m) { return m.members; }) });
      var years = chartRows(R.yearlyNew(pool, p.start, p.end, suspect));
      if (p.kind === "all") years = years.filter(function (y) { return y.count; });
      spec.sections.push({ title: "New " + viewNoun() + " by year", chart: function () { return C.bar(years, { ariaLabel: "New members by year", onSelect: function (d) { openList("New members — " + d.label, d.members); } }); },
        header: ["Year"].concat(viewNames("New ")), rows: years.map(function (y) { return [y.label].concat(viewCounts(y.members)); }), members: years.map(function (y) { return y.members; }), note: "Years with a partial range count only the part inside the selected dates." });
      var cmpRows = [["This period (" + p.start + " to " + p.end + ")"].concat(viewCounts(nm.members)).concat(["", ""])];
      if (pv) { var c1 = R.compare(chartVal(nm.members), chartVal(pv.members)); cmpRows.push(["Previous period (" + p.prevStart + " to " + p.prevEnd + ")"].concat(viewCounts(pv.members)).concat([vdelta(nm.members, pv.members), c1.pct == null ? "n/a (prior was 0)" : (Math.round(c1.pct * 10) / 10) + "%"])); }
      if (yy) { var c2 = R.compare(chartVal(nm.members), chartVal(yy.members)); cmpRows.push(["Same dates a year earlier (" + ya.start + " to " + ya.end + ")"].concat(viewCounts(yy.members)).concat([vdelta(nm.members, yy.members), c2.pct == null ? "n/a (prior was 0)" : (Math.round(c2.pct * 10) / 10) + "%"])); }
      spec.sections.push({ title: "Comparison", header: ["Period"].concat(viewNames("New ")).concat(["Change vs this period", "% change"]), rows: cmpRows, members: cmpRows.map(function (r, i) { return i === 0 ? nm.members : i === 1 && pv ? pv.members : yy.members; }),
        note: "Change = this period minus the comparison period. % change is shown as n/a when the comparison period had none." });
    } else if (state.report === "status") {
      spec.explain = "Current roster " + uw(2) + " grouped by the Status column of the latest import.";
      var d = distV(pool, function (m) { return m.status; });
      var s = distSection("Status", d, "Status");
      s.chart = function () { return C.donut(d, { ariaLabel: "Status", centerLabel: viewNoun(), onSelect: function (x) { openList("Status: " + x.label, x.members); } }); };
      spec.sections.push(s);
    } else if (state.report === "type") {
      spec.explain = "Current roster " + uw(2) + " grouped by membership type. A Couple membership is two people but one household.";
      var d2 = distV(pool, function (m) { return m.membershipType; });
      var s2 = distSection("Membership type", d2, "Membership type");
      s2.chart = function () { return C.donut(d2, { ariaLabel: "Membership type", centerLabel: viewNoun(), onSelect: function (x) { openList("Type: " + x.label, x.members); } }); };
      spec.sections.push(s2);
    } else if (state.report === "tenure") {
      spec.explain = "How long current " + uw(2) + " have belonged, from join date to today (" + L.formatDate(t) + "). Members with a bulk-load join date or no join date cannot be measured and are shown separately rather than guessed.";
      var d3 = distV(pool, function (m) { return R.tenureBucket(m, t, suspect); }, { order: R.TENURE_ORDER });
      var s3 = distSection("Tenure", d3, "Tenure");
      s3.chart = function () { return C.bar(d3, { ariaLabel: "Tenure", onSelect: function (x) { openList("Tenure: " + x.label, x.members); } }); };
      spec.sections.push(s3);
    } else if (state.report === "geo") {
      spec.explain = "Where current " + uw(2) + " live, from the address columns of the latest import. Blank means the export had no value.";
      var dc = distV(pool, function (m) { return m.city; }, { top: 12 });
      var sc = distSection("By city (top 12)", dc, "City"); sc.chart = function () { return C.bar(dc, { ariaLabel: "By city", onSelect: function (x) { openList("City: " + x.label, x.members); } }); };
      var ds = distV(pool, function (m) { return m.state; });
      var ss = distSection("By state", ds, "State"); ss.chart = function () { return C.donut(ds, { ariaLabel: "By state", centerLabel: viewNoun(), onSelect: function (x) { openList("State: " + x.label, x.members); } }); };
      var dz = distV(pool, function (m) { return R.zip5(m); }, { top: 12 });
      var sz = distSection("By ZIP code (top 12)", dz, "ZIP"); sz.chart = function () { return C.bar(dz, { ariaLabel: "By ZIP", onSelect: function (x) { openList("ZIP: " + x.label, x.members); } }); };
      spec.sections.push(sc, ss, sz);
    } else if (state.report === "renewals") {
      var r = R.renewals(pool, t);
      var rs2 = R.renewalStatus(pool, t), tg2 = L.formatDate(rs2.target);
      spec.explain = "Renewed = expiration date on or after the renewal target (" + tg2 + "), Left to renew = still current but expiring before it, Expired = expiration date already passed; the target is the year-end renewals are working toward (renewal season is assumed to start October 1). Uses the expiration date column. Due = expires between today and the stated number of days; Expired = status Active but the date has passed (so it needs attention). Expirations more than five years out (role/lifetime accounts) are shown as no expiry. ClubExpress memberships here usually expire together on one date, so expect one large month.";
      spec.sections.push({ title: "Expirations by month", chart: function () { return C.bar(chartRows(r.byExpirationMonth), { ariaLabel: "Expirations by month", onSelect: function (x) { openList("Expiring " + x.label, x.members); } }); },
        header: ["Month"].concat(viewNames("")), rows: r.byExpirationMonth.map(function (m) { return [m.label].concat(viewCounts(m.members)); }), members: r.byExpirationMonth.map(function (m) { return m.members; }) });
      var sum = [["Renewed (expire " + tg2 + " or later)", rs2.renewed], ["Left to renew (expire before " + tg2 + ")", rs2.left], ["Expired (date before today)", rs2.expired], ["Active but past expiration", r.expiredStillActive], ["Due within 30 days", r.due30], ["Due within 60 days", r.due60], ["Due within 90 days", r.due90], ["No expiry (far-future date)", r.noExpiry]];
      spec.sections.push({ title: "Renewal status", header: ["Group"].concat(viewNames("")), rows: sum.map(function (x) { return [x[0]].concat(viewCounts(x[1])); }), members: sum.map(function (x) { return x[1]; }) });
    } else if (state.report === "history") {
      var series = R.snapshotSeries(state.snapshots);
      spec.explain = "A current roster cannot show how many people belonged in the past, so this report uses only the dated FULL imports saved by this site. Each point is the number of active " + uw(2) + " in that import. Partial imports are never used. Gaps between points mean no full import was done in between — nothing is estimated.";
      var pts = series.map(function (s) { return { label: s.date, count: state.view === "households" ? s.households : s.count, members: [] }; });
      spec.sections.push({ title: "Active " + uw(2) + " at each saved import", chart: function () { return snapshotChart(); }, header: ["Import date"].concat(viewNames("Active ")), rows: series.map(function (sn) { return [sn.date].concat(viewKinds().map(function (k) { return k === "households" ? sn.households : sn.count; })); }), members: pts.map(function () { return []; }) });
      var ch = R.snapshotChanges(state.snapshots);
      spec.sections.push({ title: "Movement between imports (people)", header: ["From", "To", "Kept", "Retention", "New", "Not in newer file", "Returned"],
        rows: ch.map(function (c) { return [c.from, c.to, c.retained, c.retentionPct == null ? "—" : Math.round(c.retentionPct * 10) / 10 + "%", c.joined.length, c.lost.length, c.reactivated.length]; }), members: ch.map(function () { return []; }),
        note: ch.length ? "“Not in newer file” means absent from the later full export — it may be a lapse, a resignation or a data issue; this site does not decide which." : "Needs at least two full imports. Import a fresh full export next time and this fills in." });
    } else if (state.report === "households") {
      var hp = peoplePoolFiltered(), hb = R.householdBreakdown(hp), hf = R.period("12m", t, "rolling");
      spec.explain = "A household is counted as: single members + (couple members ÷ 2). Every non-couple membership type counts as one household; a Couple membership is two people and counts as one. " +
        "This report counts households; cards elsewhere show members/households. A couple with only one record in the export shows as half a household.";
      var ht = R.householdsByType(hp);
      spec.sections.push({ title: "Households by membership type", chart: function () { return C.bar(ht, { ariaLabel: "Households by membership type", onSelect: function (x) { openList("Households: " + x.label, x.members); } }); },
        header: ["Membership type", "People", "Households"], rows: ht.map(function (x) { return [x.label, x.people, x.count]; }).concat([["Total", hp.length, hb.total]]), members: ht.map(function (x) { return x.members; }).concat([hp]),
        note: "Households = people for single types, people ÷ 2 for couple types." });
      var comp = [{ label: "Single households", count: hb.singleHouseholds, members: hb.singles }, { label: "Couple households", count: hb.coupleHouseholds, members: hb.couples }];
      spec.sections.push({ title: "Household composition", chart: function () { return C.donut(comp, { ariaLabel: "Household composition", centerLabel: "households", onSelect: function (x) { openList(x.label, x.members); } }); },
        header: ["Kind", "Households", "People", "% of households"], rows: comp.map(function (x) { return [x.label, x.count, x.members.length, pct(x.count, hb.total)]; }).concat([["Total", hb.total, hp.length, "100%"]]), members: comp.map(function (x) { return x.members; }).concat([hp]) });
      var hm = R.householdsMonthly(hp, hf.start, hf.end, suspect);
      spec.sections.push({ title: "New households by month (last 12 months)", chart: function () { return C.bar(hm, { ariaLabel: "New households by month", onSelect: function (x) { openList("New members — " + x.label, x.members); } }); },
        header: ["Month", "New households", "New people"], rows: hm.map(function (x) { return [x.label, x.count, x.people]; }), members: hm.map(function (x) { return x.members; }),
        note: "Counts when each person joined, with each couple member as half a household, so a month can show .5 when partners' join dates fall in different months. Bulk-load join dates are excluded." });
      var hs = R.snapshotSeries(state.snapshots).map(function (x) { return { label: x.date, count: x.households, members: [] }; });
      spec.sections.push({ title: "Households over time (saved full imports)", chart: function () { return hs.length > 1 ? C.line(hs, { ariaLabel: "Households over time" }) : el("div", { class: "chart-empty", text: hs.length ? "Only one full import is saved so far; a trend line appears after the next one." : "No full import has been saved yet." }); },
        header: ["Import date", "Households"], rows: hs.map(function (x) { return [x.label, x.count]; }), members: hs.map(function () { return []; }) });
      var hz = R.householdSizes(hp);
      spec.sections.push({ title: "Check: households grouped by primary member number", chart: null, header: ["Household size", "Households", "People"], rows: hz.map(function (x) { return [x.label, x.count, x.members.length]; }), members: hz.map(function (x) { return x.members; }),
        note: "A second way to count households. It should equal the total above; if it doesn't, a couple has a missing or extra record." });
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
      el("div", { class: "count", text: (needsPeriod ? p.label + " · " + p.start + " to " + p.end + " · " : "") + "counts are " + (state.report === "households" ? "households" : viewWord()) + " · " + R.TZ + " · as of " + L.formatDate(t) })]));
    area.appendChild(el("div", { class: "panel explain" }, [el("strong", { text: "What this shows. " }), spec.explain]));
    spec.sections.forEach(function (s, i) { area.appendChild(renderSection(s, "report:" + state.report + "#" + i)); });
    view.appendChild(area);

    var actions = el("div", { class: "toolbar no-print" });
    var exp = el("button", { class: "btn" }, ["⬇ Export report CSV"]);
    exp.addEventListener("click", function () {
      var out = [[title], [(needsPeriod ? p.label + " (" + p.start + " to " + p.end + ")" : "") + " counts are " + (state.report === "households" ? "households" : viewWord())]];
      spec.sections.forEach(function (s) { out.push([]); out.push([s.title]); out.push(s.header); s.rows.forEach(function (r) { out.push(r); }); });
      download("report-" + state.report + ".csv", out.map(function (r) { return r.map(I.csvCell).join(","); }).join("\r\n") + "\r\n");
    });
    var pr = el("button", { class: "btn" }, ["🖨 Print"]);
    pr.addEventListener("click", function () { window.print(); });
    actions.appendChild(exp); actions.appendChild(pr);
    view.appendChild(actions);
    return view;
  }

  function renderSection(s, key) {
    var panel = el("div", { class: "panel chart-panel" }, [el("h3", { text: s.title })]);
    if (s.chart) panel.appendChild(s.chart());
    var thead = el("thead", {}, [el("tr", {}, s.header.map(function (h) { return el("th", { text: h }); }))]);
    var tbody = el("tbody");
    s.rows.forEach(function (r, i) {
      var tr = el("tr", {}, r.map(function (c, ci) { return el("td", { text: String(c), class: typeof c === "number" ? "num" : "" }); }));
      var list = s.members && s.members[i];
      if (String(r[0]) === "Total") tr.className = "cc-total"; // stays at the bottom and is re-summed under filters
      if (list && list.length) {
        tr.className = (tr.className ? tr.className + " " : "") + "click";
        tr.setAttribute("title", "Click to list these members");
        tr.addEventListener("click", function () { if (s.detail) { state.detailMember = list[0]; renderDetailModal(); } else openList(s.title + " — " + r[0], list); });
      }
      tbody.appendChild(tr);
    });
    if (!s.rows.length) tbody.appendChild(el("tr", {}, [el("td", { colspan: String(s.header.length), class: "empty-state", text: "Nothing to show for this selection." })]));
    var det = el("details", { class: "support", open: "open" }, [el("summary", { text: "Supporting table" }), el("div", { class: "tablewrap" }, [tkEnhanceTable(el("table", { class: "grid static" }, [thead, tbody]), "section:" + key)])]);
    panel.appendChild(det);
    if (s.note) panel.appendChild(el("div", { class: "hint", text: s.note }));
    return panel;
  }

  // ---------- TableKit column headers (the standard sort/filter header) ----------
  // Ported from the CarShow app / Silent Auction Manager js/table.js. Every column title gets a ▼ button
  // that opens a panel: Sort A→Z, Sort Z→A, Clear Filter, and a checklist of the column's values with
  // (Select All). tkFillHeader() builds one header cell from a small config; tkEnhance() applies the
  // header to an already-built static table (rows are hidden / reordered in place, "Total" rows stay put
  // and are re-summed for the rows left showing). Sort/filter choices live in state.tkTables[key].
  var tkSeq = 0;
  function tkCloseAll() {
    Array.prototype.forEach.call(document.querySelectorAll(".tk-dropdown.open"), function (p) { p.classList.remove("open"); });
  }
  function tkBindClose() {
    if (window._tkCloseBound) return;
    window._tkCloseBound = true;
    document.addEventListener("click", tkCloseAll);
  }
  // cfg: { label, num, getSort() -> 1|-1|0, setSort(dir), getValues() -> [string], getChecked() -> Set|null,
  //        setChecked(Set|null) }. Returns { refresh() } which re-reads the sort/filter marks.
  function tkFillHeader(th, cfg) {
    tkBindClose();
    th.textContent = "";
    var drop = el("button", { type: "button", class: "tk-drop-btn", "aria-label": "Sort and filter " + cfg.label, "aria-haspopup": "true" }, ["▼"]);
    var inner = el("div", { class: "tk-th-inner" + (cfg.num ? " tk-num" : "") }, [el("span", { class: "tk-th-label", text: cfg.label }), drop]);
    var asc = el("button", { type: "button", class: "tk-sort-btn" }, ["▲  Sort A → Z"]);
    var desc = el("button", { type: "button", class: "tk-sort-btn" }, ["▼  Sort Z → A"]);
    var clr = el("button", { type: "button", class: "tk-sort-btn" }, ["✕  Clear Filter"]);
    var listWrap = el("div", { class: "tk-checklist-wrap" });
    var panel = el("div", { class: "tk-dropdown" }, [asc, desc, clr, el("div", { class: "tk-dropdown-divider" }), listWrap]);
    function refresh() {
      clr.disabled = !cfg.getChecked();
      var d = cfg.getSort();
      if (d) inner.setAttribute("data-sort", d === 1 ? "asc" : "desc"); else inner.removeAttribute("data-sort");
      asc.classList.toggle("active", d === 1);
      desc.classList.toggle("active", d === -1);
      inner.setAttribute("data-filtered", cfg.getChecked() ? "true" : "false");
    }
    function buildList() {
      listWrap.innerHTML = "";
      var vals = cfg.getValues().slice().sort(function (p, q) { return p.localeCompare(q, undefined, { numeric: true, sensitivity: "base" }); });
      function item(text, checked, isAll) {
        var cb = el("input", { type: "checkbox" });
        cb.checked = checked;
        listWrap.appendChild(el("label", { class: "tk-checklist-item" + (isAll ? " tk-checklist-all" : "") }, [cb, el("span", { text: text })]));
        return cb;
      }
      var cur = cfg.getChecked();
      var allCb = item("(Select All)", !cur, true);
      allCb.addEventListener("change", function () { cfg.setChecked(allCb.checked ? null : new Set()); refresh(); buildList(); });
      vals.forEach(function (v) {
        var cb = item(v || "(blank)", !cur || cur.has(v), false);
        cb.addEventListener("change", function () {
          var set = cfg.getChecked() || new Set(vals);
          if (cb.checked) set.add(v); else set.delete(v);
          cfg.setChecked(set.size === vals.length ? null : set);
          var a2 = listWrap.querySelector(".tk-checklist-all input");
          if (a2) a2.checked = !cfg.getChecked();
          refresh();
        });
      });
    }
    function sortClick(dir) { cfg.setSort(cfg.getSort() === dir ? 0 : dir); refresh(); panel.classList.remove("open"); }
    asc.addEventListener("click", function () { sortClick(1); });
    desc.addEventListener("click", function () { sortClick(-1); });
    clr.addEventListener("click", function () { cfg.setChecked(null); refresh(); buildList(); });
    drop.addEventListener("click", function (e) {
      e.stopPropagation();
      var was = panel.classList.contains("open");
      tkCloseAll();
      if (!was) {
        buildList();
        var rect = drop.getBoundingClientRect();
        panel.style.top = (rect.bottom + 4) + "px";
        panel.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 240)) + "px";
        panel.classList.add("open");
      }
    });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    th.appendChild(inner);
    th.appendChild(panel);
    refresh();
    return { refresh: refresh };
  }

  // Compares two cell texts: dates, then numbers/money, then text (numeric-aware).
  function tkCompare(a, b) {
    var D = /^\d{1,2}\/\d{1,2}\/\d{2,4}|^\d{4}-\d{2}-\d{2}/;
    var da = D.test(a) ? Date.parse(a) : NaN, db = D.test(b) ? Date.parse(b) : NaN;
    if (!isNaN(da) && !isNaN(db)) return da - db;
    var NUM = /^-?\$?-?[\d,]*\.?\d+%?$/;
    var na = parseFloat(a.replace(/[$,%]/g, "")), nb = parseFloat(b.replace(/[$,%]/g, ""));
    if (!isNaN(na) && !isNaN(nb) && NUM.test(a.replace(/\s/g, "")) && NUM.test(b.replace(/\s/g, ""))) return na - nb;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }

  // Adds the column-header dropdown to one static table (needs a <thead> and a <tbody>).
  function tkEnhance(table, key) {
    var thead = table.tHead, tbody = table.tBodies[0];
    if (!thead || !thead.rows.length || !tbody || table._tk) return;
    table._tk = true;
    state.tkTables = state.tkTables || {};
    var st = state.tkTables[key] || (state.tkTables[key] = { col: null, dir: 1, checked: {} });
    var hr = thead.rows[0];
    function isFixed(r) {
      if (r.classList.contains("cc-total")) return true;
      return Array.prototype.some.call(r.cells, function (c) { return c.colSpan > 1; });
    }
    function cellText(r, i) { var c = r.cells[i]; return c ? String(c.textContent).trim() : ""; }
    var all = Array.prototype.slice.call(tbody.rows);
    all.forEach(function (r, i) { r._tkIdx = i; });
    var fixed = all.filter(isFixed), data = all.filter(function (r) { return !isFixed(r); });
    var totalRows = fixed.filter(function (r) { return r.classList.contains("cc-total"); });
    var MONEY = /^-?\$[\d,]+(\.\d+)?$/, PLAIN = /^-?[\d,]*\.?\d+$/;
    function colStart(r, idx) { var n = 0; for (var k = 0; k < idx; k++) n += r.cells[k].colSpan; return n; }
    function numOf(t) { var n = parseFloat(String(t).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
    var cap = null;
    function apply() {
      data.sort(function (p, q) {
        if (st.col == null) return p._tkIdx - q._tkIdx;
        return tkCompare(cellText(p, st.col), cellText(q, st.col)) * st.dir;
      });
      var anchor = null;
      for (var i = 0; i < tbody.rows.length; i++) { if (isFixed(tbody.rows[i])) { anchor = tbody.rows[i]; break; } }
      data.forEach(function (r) { tbody.insertBefore(r, anchor); });
      var filtered = false;
      data.forEach(function (r) {
        var show = Object.keys(st.checked).every(function (c) { var set = st.checked[c]; return !set || set.has(cellText(r, +c)); });
        r.style.display = show ? "" : "none";
        if (!show) filtered = true;
      });
      var visible = data.filter(function (r) { return r.style.display !== "none"; });
      if (cap) cap.style.display = Object.keys(st.checked).length ? "" : "none";
      totalRows.forEach(function (tr) {
        Array.prototype.forEach.call(tr.cells, function (c, idx) {
          if (c._tkOrig === undefined) c._tkOrig = c.textContent;
          var orig = c._tkOrig.trim(), isMoney = MONEY.test(orig);
          if (!isMoney && !PLAIN.test(orig)) return;
          if (!filtered) { c.textContent = c._tkOrig; return; }
          var col = colStart(tr, idx), sum = 0;
          visible.forEach(function (r) { sum += numOf(cellText(r, col)); });
          c.textContent = isMoney ? (sum < 0 ? "-" : "") + "$" + Math.abs(sum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : sum.toLocaleString(undefined, { maximumFractionDigits: 1 });
        });
      });
    }
    var heads = [];
    var clearAll = el("button", { type: "button", class: "btn no-print", style: "font-size:12px; padding:2px 8px" }, ["✕ Clear all column filters"]);
    clearAll.addEventListener("click", function () { st.checked = {}; apply(); heads.forEach(function (x) { x.refresh(); }); });
    cap = table.createCaption();
    cap.className = "tk-caption no-print";
    cap.appendChild(clearAll);
    Array.prototype.forEach.call(hr.cells, function (th, i) {
      var label = th.textContent.trim();
      if (!label) return;
      heads.push(tkFillHeader(th, {
        label: label, num: th.classList.contains("num"),
        getSort: function () { return st.col === i ? st.dir : 0; },
        setSort: function (d) { if (!d) st.col = null; else { st.col = i; st.dir = d; } apply(); heads.forEach(function (x) { x.refresh(); }); },
        getValues: function () { var seen = []; data.forEach(function (r) { var v = cellText(r, i); if (seen.indexOf(v) === -1) seen.push(v); }); return seen; },
        getChecked: function () { return st.checked[i] || null; },
        setChecked: function (set) { if (set) st.checked[i] = set; else delete st.checked[i]; apply(); }
      }));
    });
    apply();
  }
  function tkEnhanceTable(table, key) { tkEnhance(table, key); return table; }

  // ---------- Members directory ----------
  function buildMembersView() {
    var view = el("div", { class: "view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }
    if (state.importedAt) view.appendChild(el("div", { class: "loadedinfo", text: "Last imported " + fmtDateTime(state.importedAt) + " · " + state.members.length + " records" }));
    view.appendChild(filterBar(false));
    var search = el("input", { type: "search", placeholder: "Search name, number, email, city…", value: state.search, "aria-label": "Search members" });
    var countEl = el("span", { class: "count" });
    var exp = el("button", { class: "btn" }, ["⬇ CSV"]);
    var toolbar = el("div", { class: "toolbar" }, [search, countEl, el("span", { class: "spacer" }), exp]);
    view.appendChild(toolbar);
    var columns = L.visibleColumns(state.members);
    var thead = el("thead"), headRow = el("tr"), heads = [];
    state.colChecked = state.colChecked || {};
    function filterBase() {
      var f = state.filters;
      return R.pool(state.members, { includeRoles: true, status: f.status ? [f.status] : null, types: f.type ? [f.type] : null, states: f.state ? [f.state] : null, cities: f.city ? [f.city] : null })
        .filter(function (m) { return state.includeRoles || !R.isRole(m); });
    }
    function refreshHeads() { heads.forEach(function (h) { h.refresh(); }); }
    columns.forEach(function (c) {
      var th = el("th", { class: c.num ? "num" : "" });
      heads.push(tkFillHeader(th, {
        label: c.label, num: !!c.num,
        getSort: function () { return state.sortKey === c.key ? (state.sortDir === "asc" ? 1 : -1) : 0; },
        setSort: function (d) {
          if (!d) { state.sortKey = "lastName"; state.sortDir = "asc"; } else { state.sortKey = c.key; state.sortDir = d === 1 ? "asc" : "desc"; }
          renderBody(); refreshHeads();
        },
        getValues: function () { var seen = {}; filterBase().forEach(function (m) { seen[L.displayValue(m, c)] = true; }); return Object.keys(seen); },
        getChecked: function () { return state.colChecked[c.key] || null; },
        setChecked: function (set) { if (set) state.colChecked[c.key] = set; else delete state.colChecked[c.key]; renderBody(); refreshHeads(); }
      }));
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    var clrCols = el("button", { class: "btn" }, ["✕ Clear column filters"]);
    clrCols.addEventListener("click", function () { state.colChecked = {}; renderBody(); refreshHeads(); });
    toolbar.insertBefore(clrCols, toolbar.querySelector(".spacer"));
    var tbody = el("tbody"), table = el("table", { class: "grid" }, [thead, tbody]), shown = [];
    function renderBody() {
      var base = filterBase().filter(function (m) {
        return columns.every(function (c) { var set = state.colChecked[c.key]; return !set || set.has(L.displayValue(m, c)); });
      });
      clrCols.style.display = Object.keys(state.colChecked).length ? "" : "none";
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

  // ---------- Monthly Meeting ----------
  // A meeting month runs from the Wednesday after one month's first Tuesday through
  // (and including) the next month's first Tuesday, the meeting day.
  function buildMeetingView() {
    var view = el("div", { class: "view meeting-view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }
    var t = today(), periods = R.meetingPeriods(t, 24), suspect = R.suspectJoinDates(state.members);
    var lastDone = periods.filter(function (p) { return p.completed; })[0];
    var sel = periods.filter(function (p) { return p.end === state.meetingEnd; })[0] || lastDone;
    var prev = periods[periods.indexOf(sel) + 1] || null, nxt = R.meetingPeriodAfter(sel.end);
    var effEnd = sel.completed ? sel.end : t; // a month still in progress counts through today
    var pool = R.pool(state.members, {}), active = pool.filter(R.isActive);
    var o = state.meetingOpts;
    var isLast = sel === lastDone;
    var joinedTitle = isLast ? "Members who joined last month" : sel.inProgress ? "Members who joined this month so far" : "Members who joined that month";

    function optLabel(p) {
      var meet = "meeting " + L.formatDate(p.end);
      if (p.inProgress) return "This month so far - " + p.label + " (" + meet + ")";
      if (p === lastDone) return "Last month - " + p.label + " (" + meet + ")";
      return "Meeting " + L.formatDate(p.end) + " - " + p.label;
    }
    var picker = select("Meeting month", periods.map(function (p) { return [p.end, optLabel(p)]; }), sel.end, function (v) { state.meetingEnd = v; renderViews(); });
    var optBar = el("div", { class: "toolbar no-print opts" }, [picker]);
    [["joined", joinedTitle], ["summary", "Summary counts"], ["renewals", "Expirations"], ["anniversaries", "Anniversaries next month"]].forEach(function (x) {
      var cb = el("input", { type: "checkbox" });
      cb.checked = !!o[x[0]];
      cb.addEventListener("change", function () { o[x[0]] = cb.checked; renderViews(); });
      optBar.appendChild(el("label", { class: "ctl" }, [cb, " " + x[1]]));
    });
    view.appendChild(optBar);

    var nm = R.newMembers(pool, sel.start, effEnd, suspect);
    var joined = nm.members.slice().sort(function (a, b) { return a.joinDate < b.joinDate ? -1 : a.joinDate > b.joinDate ? 1 : memberLine(a).localeCompare(memberLine(b)); });
    var area = el("div", { class: "report-area" });
    area.appendChild(el("div", { class: "report-head" }, [el("h2", { text: "Monthly Meeting" }),
      el("div", { class: "count", text: (isLast ? "Last month: " : sel.inProgress ? "This month so far: " : "Meeting month: ") + L.formatDate(sel.start) + " to " + L.formatDate(sel.end) + " · meeting " + L.formatDate(sel.end) + " · " + R.TZ })]));
    area.appendChild(el("div", { class: "panel explain" }, [el("strong", { text: "How the month is counted. " }),
      "A meeting month starts the Wednesday after a month's first Tuesday and ends on the next month's first Tuesday, both days included. " +
      (sel.inProgress ? "This month is still in progress, so numbers run through today (" + L.formatDate(t) + "); it ends on " + L.formatDate(sel.end) + ". " : "") +
      "Counts are for the current roster; role accounts are excluded and bulk-load join dates are left out of new-member counts."]));

    if (o.summary) {
      var prevNm = prev ? R.newMembers(pool, prev.start, prev.end, suspect).members : null;
      var cmp = prevNm ? R.compare(joined.length, prevNm.length) : null;
      var hAct = R.householdBreakdown(active), hNew = R.householdTotal(joined);
      var expNext = R.expiringInRange(active, nxt.start, nxt.end, t);
      var grid = el("div", { class: "kpi-grid" });
      grid.appendChild(kpi("Membership", mmhh(active), viewWord() + " today · " + num(hAct.singleHouseholds) + " single + " + num(hAct.couples.length) + " couple members ÷ 2", function () { openList("Membership (active members)", active); }));
      grid.appendChild(kpi("New " + viewWord(), mmhh(joined), viewWord() + " · " + L.formatDate(sel.start) + " to " + L.formatDate(effEnd), function () { openList(joinedTitle, joined); }));
      if (cmp) grid.appendChild(kpi("Vs previous month", mmhhDelta(joined, prevNm), mmhh(prevNm) + " new in " + L.formatDate(prev.start) + " to " + L.formatDate(prev.end) + (cmp.pct == null ? "" : " (" + (cmp.abs >= 0 ? "+" : "") + Math.round(cmp.pct * 10) / 10 + "%)"), function () { openList("New members in previous month", prevNm); }));
      grid.appendChild(kpi("Expiring next month", mmhh(expNext), L.formatDate(nxt.start) + " to " + L.formatDate(nxt.end), function () { openList("Expiring " + nxt.label, expNext); }));
      area.appendChild(grid);
    }

    var sections = [];
    if (o.joined) {
      sections.push({ title: joinedTitle + " (" + joined.length + ")", detail: true,
        header: ["Joined", "Name", "Member #", "Membership type", "Spouse", "City", "State"],
        rows: joined.map(function (m) { return [L.formatDate(m.joinDate), memberLine(m), m.memberNumber || "", m.membershipType || "", m.spouseFirstName || "", m.city || "", m.state || ""]; }),
        members: joined.map(function (m) { return [m]; }),
        note: (nm.excludedBulkDate ? num(nm.excludedBulkDate) + " member(s) with a bulk-load join date in this range are not listed. " : "") + (nm.undated ? num(nm.undated) + " member(s) have no join date and cannot be placed in a month. " : "") + "Click a row for the member's details." });
    }
    if (o.renewals) {
      var expNext2 = R.expiringInRange(active, nxt.start, nxt.end, t), expThis = R.expiringInRange(pool, sel.start, effEnd, t);
      function expRows(list) { return list.map(function (m) { return [L.formatDate(m.expirationDate), memberLine(m), m.memberNumber || "", m.membershipType || "", m.status || ""]; }); }
      sections.push({ title: "Memberships expiring next month (" + nxt.label + ") (" + expNext2.length + ")", detail: true, header: ["Expires", "Name", "Member #", "Membership type", "Status"], rows: expRows(expNext2), members: expNext2.map(function (m) { return [m]; }),
        note: "Expiration dates in the next meeting month, for active members." });
      sections.push({ title: "Expiration dates that fell in this meeting month (" + expThis.length + ")", detail: true, header: ["Expired", "Name", "Member #", "Membership type", "Status"], rows: expRows(expThis), members: expThis.map(function (m) { return [m]; }),
        note: "Anyone listed with status Active whose date has passed still needs to renew or be updated in ClubExpress." });
    }
    if (o.anniversaries) {
      var an = R.anniversariesInRange(pool, nxt.start, nxt.end, suspect);
      sections.push({ title: "Membership anniversaries next month (" + nxt.label + ") (" + an.length + ")", detail: true, header: ["Date", "Name", "Years"], rows: an.map(function (a) { return [L.formatDate(a.date), memberLine(a.member), a.years]; }), members: an.map(function (a) { return [a.member]; }),
        note: "Only trustworthy join dates are used; bulk-load and missing dates are skipped." });
    }
    sections.forEach(function (s, i) { area.appendChild(renderSection(s, "meeting#" + s.header[0] + i)); });
    if (!o.joined && !o.summary && !o.renewals && !o.anniversaries) area.appendChild(el("div", { class: "empty-state", text: "Tick at least one item above." }));
    view.appendChild(area);

    var actions = el("div", { class: "toolbar no-print" });
    var exp = el("button", { class: "btn" }, ["⬇ Export meeting CSV"]);
    exp.addEventListener("click", function () {
      var out = [["Monthly Meeting"], [sel.start + " to " + effEnd + " (meeting " + sel.end + "), " + R.TZ]];
      sections.forEach(function (s) { out.push([]); out.push([s.title]); out.push(s.header); s.rows.forEach(function (r) { out.push(r); }); });
      download("monthly-meeting-" + sel.end + ".csv", out.map(function (r) { return r.map(I.csvCell).join(","); }).join("\r\n") + "\r\n");
    });
    var pr = el("button", { class: "btn" }, ["🖨 Print"]);
    pr.addEventListener("click", function () { window.print(); });
    actions.appendChild(exp); actions.appendChild(pr);
    view.appendChild(actions);
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
      kpi("Will be added", mmhh(dfn.added), "new to this site"), kpi("Will be updated", mmhh(dfn.updated), "same member, changed data"),
      kpi("Unchanged", mmhh(dfn.unchanged), ""), kpi("Rejected", num(b.rejected.length), "see reasons below"),
      kpi("Not in this file", mmhh(dfn.notInFile), imp.mode === "full" ? "stay unmarked; just absent" : "n/a for partial")
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
    panel.appendChild(el("div", { class: "tablewrap" }, [tkEnhanceTable(el("table", { class: "grid static" }, [
      el("thead", {}, [el("tr", {}, head.map(function (h) { return el("th", { text: h }); }))]),
      el("tbody", {}, rows.map(function (r) { return el("tr", {}, r.map(function (c) { return el("td", { text: String(c) }); })); }))
    ]), "importHistory")]));
    return panel;
  }

  // ---------- Full-page chart view (opened from a dashboard chart card) ----------
  var CHART_PRESETS = [["1m", "Last month"], ["3m", "Last 3 months"], ["6m", "Last 6 months"], ["12m", "Last year"], ["24m", "Last 2 years"], ["60m", "Last 5 years"], ["120m", "Last 10 years"], ["all", "Since 1958"]];
  function openChartPage(kind) {
    state.chartPage = { kind: kind, preset: (state.chartPage && state.chartPage.preset) || "12m" };
    renderChartPage();
  }
  function closeChartPage() { state.chartPage = null; renderChartPage(); }
  function renderChartPage() {
    var host = $("#chartPageHost");
    if (!host) return;
    host.innerHTML = "";
    document.body.classList.toggle("report-open", !!state.chartPage);
    var cp = state.chartPage;
    if (!cp) return;
    var t = today(), p = R.period(cp.preset, t, "rolling"), suspect = R.suspectJoinDates(state.members);
    var pool = peoplePoolFiltered(), isAll = cp.preset === "all", gran = R.granularityFor(cp.preset);
    var granWord = { week: "week", month: "month", year: "year" }[gran];
    var title, chart, header, rows, members, intro;

    if (cp.kind === "htype") {
      // Households by membership type among current active members who joined in the period.
      // "Since 1958" is every current active member, including those without a usable join date.
      var act = pool.filter(R.isActive);
      var inWin = isAll ? act : R.newMembers(act, p.start, p.end, suspect).members;
      var hb = R.householdBreakdown(inWin), ht = R.householdsByType(inWin);
      title = "Households by membership type";
      intro = isAll ? "All current active members (no date filter): " + mmhh(inWin) + " members/households."
        : "Current active members who joined " + L.formatDate(p.start) + " to " + L.formatDate(p.end) + ": " + mmhh(inWin) + " members/households. Bulk-load join dates are left out.";
      chart = C.bar(ht, { height: 380, ariaLabel: title, onSelect: function (d) { openList("Households: " + d.label, d.members); } });
      header = ["Membership type", "Members", "Households", "% of households"];
      rows = ht.map(function (x) { return [x.label, x.people, x.count, pct(x.count, hb.total)]; }).concat([["Total", inWin.length, hb.total, "100%"]]);
      members = ht.map(function (x) { return x.members; }).concat([inWin]);
    } else {
      var buckets = R.bucketsNew(pool, p.start, p.end, suspect, gran);
      var nm = R.newMembers(pool, p.start, p.end, suspect);
      var isH = cp.kind === "hnew";
      var data = buckets.map(function (b) { return { key: b.key, label: b.label, count: isH ? R.householdTotal(b.members) : b.count, members: b.members }; });
      title = (isH ? "New households by " : "New members by ") + granWord;
      intro = mmhh(nm.members) + " members/households joined " + L.formatDate(p.start) + " to " + L.formatDate(p.end) + " (bars by " + granWord + (gran === "week" ? ", each starting on the date shown" : "") + "). " +
        (nm.excludedBulkDate ? num(nm.excludedBulkDate) + " members with a bulk-load join date are left out. " : "") + (nm.undated ? num(nm.undated) + " have no join date. " : "") +
        (isH ? "Each couple member counts as half a household, so a bar can show .5." : "");
      chart = C.bar(data, { height: 380, ariaLabel: title, onSelect: function (d) { openList("New members — " + d.label, d.members); } });
      header = [gran === "week" ? "Week starting" : gran === "month" ? "Month" : "Year", "Members", "Households", "Cumulative " + (isH ? "households" : "members")];
      var cum = 0;
      rows = buckets.map(function (b) { cum += isH ? R.householdTotal(b.members) : b.count; return [b.label, b.count, R.householdTotal(b.members), cum]; });
      rows.push(["Total", nm.members.length, R.householdTotal(nm.members), ""]);
      members = buckets.map(function (b) { return b.members; }); members.push(nm.members);
    }

    var back = el("button", { class: "btn" }, ["← Back"]);
    back.addEventListener("click", closeChartPage);
    var presetSel = select("Period", CHART_PRESETS, cp.preset, function (v) { cp.preset = v; renderChartPage(); });
    var pr = el("button", { class: "btn" }, ["🖨 Print"]);
    pr.addEventListener("click", function () { window.print(); });
    var exp = el("button", { class: "btn" }, ["⬇ CSV"]);
    exp.addEventListener("click", function () {
      var out = [[title], [p.label + " (" + p.start + " to " + p.end + "), " + R.TZ], [], header].concat(rows);
      download("chart-" + cp.kind + "-" + cp.preset + ".csv", out.map(function (r) { return r.map(I.csvCell).join(","); }).join("\r\n") + "\r\n");
    });
    var head = el("div", { class: "api-page-head no-print" }, [el("div", { class: "left" }, [back]), el("h2", { text: title }), el("div", { class: "right" }, [presetSel, exp, pr])]);

    var table = el("table", { class: "grid static" }, [
      el("thead", {}, [el("tr", {}, header.map(function (h, i) { return el("th", { text: h, class: i ? "num" : "" }); }))]),
      el("tbody", {}, rows.map(function (r, i) {
        var tr = el("tr", { class: String(r[0]) === "Total" ? "cc-total" : "" }, r.map(function (c, ci) { return el("td", { text: String(c), class: ci ? "num" : "" }); }));
        if (members[i] && members[i].length) { tr.classList.add("click"); tr.addEventListener("click", function () { openList(title + " — " + r[0], members[i]); }); }
        return tr;
      }))
    ]);
    tkEnhance(table, "chartpage:" + cp.kind + ":" + cp.preset);
    var body = el("div", { class: "api-page-inner wide" }, [
      el("div", { class: "report-head" }, [el("h2", { text: title }), el("div", { class: "count", text: p.label + " · " + R.TZ + " · as of " + L.formatDate(t) })]),
      el("div", { class: "panel explain" }, [intro]),
      el("div", { class: "panel chart-panel" }, [chart]),
      el("div", { class: "panel" }, [el("h3", { text: "Supporting table" }), el("div", { class: "tablewrap" }, [table]),
        el("div", { class: "hint", text: "Click a row or bar for the members behind it. Cards and tables show members/households; households = single members + couple members ÷ 2." })])
    ]);
    host.appendChild(el("div", { class: "api-page", role: "dialog", "aria-modal": "true", "aria-label": title }, [head, el("div", { class: "api-page-body" }, [body])]));
  }

  // ---------- Developer (password protected) ----------
  // Passwords are typed into password fields, sent once over HTTPS to
  // developer.php, and never kept in `state`. The server stores only hashes.
  var MIN_PASSWORD = 8;
  function devApi(action, payload) {
    var body = { action: action };
    Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
    return fetch(SITE.developerUrl || "developer.php", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": SITE.csrf || "" }, body: JSON.stringify(body)
    }).then(function (res) { return res.json().then(function (j) { j.httpStatus = res.status; return j; }); });
  }
  function applyDev(j, keepMessage) {
    state.dev.loading = false;
    if (j && j.ok) {
      state.dev.unlocked = !!j.unlocked;
      state.dev.system = j.system || null;
      state.dev.error = "";
      state.dev.message = keepMessage ? (j.message || "") : "";
    } else {
      state.dev.error = (j && j.error) || "Something went wrong.";
      if (j && j.httpStatus === 403 && /locked/i.test(state.dev.error)) { state.dev.unlocked = false; state.dev.system = null; }
    }
    if (state.tab === "developer") renderViews();
  }
  function openDeveloper() {
    state.dev.error = ""; state.dev.message = "";
    state.dev.loading = true;
    selectTab("developer");
    devApi("status").then(function (j) { applyDev(j); }).catch(function () { state.dev.loading = false; state.dev.error = "Could not reach the server."; renderViews(); });
  }
  function passwordField(label, autocomplete) {
    var input = el("input", { type: "password", autocomplete: autocomplete || "off", "aria-label": label, maxlength: "200" });
    return { input: input, row: el("label", { class: "ctl stack" }, [label, input]) };
  }
  // Runs one password-changing form: validates, posts, clears the fields.
  function passwordForm(title, help, fields, action, buildPayload, submitLabel) {
    var msg = el("div", { class: "hint", role: "status" });
    var btn = el("button", { class: "btn primary", type: "submit" }, [submitLabel]);
    var form = el("form", { class: "panel pw-form", autocomplete: "off" }, [el("h3", { text: title }), el("div", { class: "hint", text: help })]);
    fields.forEach(function (f) { form.appendChild(f.row); });
    form.appendChild(el("div", { class: "toolbar" }, [btn]));
    form.appendChild(msg);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var newPw = fields[fields.length - 2].input.value, last = fields[fields.length - 1].input.value;
      if (newPw.length < MIN_PASSWORD) { msg.className = "errors"; msg.textContent = "Use at least " + MIN_PASSWORD + " characters."; return; }
      if (newPw !== last) { msg.className = "errors"; msg.textContent = "The two new passwords don't match."; return; }
      btn.disabled = true; msg.className = "hint"; msg.textContent = "Saving…";
      devApi(action, buildPayload()).then(function (j) {
        btn.disabled = false;
        if (j && j.ok) {
          fields.forEach(function (f) { f.input.value = ""; });
          state.dev.system = j.system || state.dev.system;
          msg.className = "success"; msg.textContent = j.message || "Saved.";
          renderSystemCheck();
        } else { msg.className = "errors"; msg.textContent = (j && j.error) || "Could not save."; if (j && j.httpStatus === 403) { state.dev.unlocked = false; renderViews(); } }
      }).catch(function () { btn.disabled = false; msg.className = "errors"; msg.textContent = "Could not reach the server. Nothing was changed."; });
    });
    return form;
  }
  function renderSystemCheck() {
    var host = $("#devSystem");
    if (!host) return;
    host.innerHTML = "";
    var s = state.dev.system;
    if (!s) return;
    var rows = [
      ["PHP version", s.phpVersion], ["Data folder writable", s.dataFolderWritable ? "Yes" : "NO — imports cannot be saved"],
      ["Roster file", s.rosterFilePresent ? s.rosterRecords + " records" : "None yet"], ["Last import", s.lastImport ? fmtDateTime(s.lastImport) : "—"],
      ["Saved full-import snapshots", String(s.snapshots)], ["Import batches logged", String(s.importBatches)],
      ["Website password stored in", s.websitePasswordSource], ["Developer password", s.developerPasswordIsInitial ? "Still the INITIAL password — change it" : "Changed"],
      ["Passwords last changed", s.passwordsUpdatedAt ? fmtDateTime(s.passwordsUpdatedAt) : "Never"],
      ["Website login idle timeout", s.sessionIdleHours + " hours"], ["Developer unlock idle timeout", s.developerIdleMinutes + " minutes"], ["Connection is HTTPS", s.https ? "Yes" : "No"], ["Emailed password recovery", s.recoveryEmail]
    ];
    host.appendChild(el("table", { class: "grid static" }, [el("tbody", {}, rows.map(function (r) { return el("tr", {}, [el("td", { text: r[0] }), el("td", { text: r[1] })]); }))]));
  }

  function buildDeveloperView() {
    var view = el("div", { class: "view dev-view" });
    var d = state.dev;
    var head = el("div", { class: "report-head" }, [el("h2", { text: "Developer" })]);
    view.appendChild(head);
    if (d.loading) { view.appendChild(el("div", { class: "panel hint", text: "Loading…" })); return view; }
    if (d.error && d.unlocked) view.appendChild(el("div", { class: "errors", text: d.error }));
    if (!d.unlocked) {
      var pw = passwordField("Developer password", "off");
      var go = el("button", { class: "btn primary", type: "submit" }, ["Unlock"]);
      var form = el("form", { class: "panel pw-form", autocomplete: "off" }, [el("h3", { text: "Developer password required" }),
        el("div", { class: "hint", text: "This area changes passwords and shows server details. It stays unlocked for 30 idle minutes." }), pw.row, el("div", { class: "toolbar" }, [go])]);
      if (d.error) form.appendChild(el("div", { class: "errors", text: d.error }));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!pw.input.value) return;
        go.disabled = true;
        devApi("unlock", { password: pw.input.value }).then(function (j) { pw.input.value = ""; applyDev(j); })
          .catch(function () { d.error = "Could not reach the server."; renderViews(); });
      });
      view.appendChild(form);
      setTimeout(function () { try { pw.input.focus(); } catch (e) { /* ignore */ } }, 0);
      return view;
    }
    if (d.system && d.system.developerPasswordIsInitial) {
      view.appendChild(el("div", { class: "errors", text: "The developer password is still the initial one. Change it below." }));
    }
    var lock = el("button", { class: "btn" }, ["🔒 Lock developer menu"]);
    lock.addEventListener("click", function () { devApi("lock").then(function (j) { applyDev(j); }); });
    view.appendChild(el("div", { class: "toolbar" }, [lock]));

    var n1 = passwordField("New website password", "new-password"), n2 = passwordField("Confirm new website password", "new-password");
    view.appendChild(passwordForm("Change website login password",
      "The password everyone uses to open this site. Changing it signs out all other browsers immediately. At least " + MIN_PASSWORD + " characters.",
      [n1, n2], "change_site_password", function () { return { newPassword: n1.input.value }; }, "Change website password"));

    var c0 = passwordField("Current developer password", "current-password"), d1 = passwordField("New developer password", "new-password"), d2 = passwordField("Confirm new developer password", "new-password");
    view.appendChild(passwordForm("Change developer password",
      "The password for this Developer area. You must enter the current one. At least " + MIN_PASSWORD + " characters.",
      [c0, d1, d2], "change_dev_password", function () { return { currentPassword: c0.input.value, newPassword: d1.input.value }; }, "Change developer password"));

    view.appendChild(el("div", { class: "panel" }, [el("h3", { text: "System check" }), el("div", { id: "devSystem" })]));
    setTimeout(renderSystemCheck, 0);
    return view;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (state.detailMember) { state.detailMember = null; renderDetailModal(); }
    else if (state.list) { state.list = null; renderListModal(); }
    else if (state.chartPage) { closeChartPage(); }
  });

  function init() {
    var h = (location.hash || "").replace("#", "");
    if (["dashboard", "reports", "meeting", "members", "import"].indexOf(h) !== -1) state.tab = h;
    buildHeaderMenu();
    renderViews();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
