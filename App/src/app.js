/* app.js — ETCC Membership Manager UI.
 * index.php injects data through window.__membership.ingest*() on every page
 * load; renderViews() rebuilds #app from `state`.
 *
 *   Dashboard  — headline counts and charts
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
    filters: { status: "Active", type: "", state: "", city: "" }, // lapsed (Expired/Dropped) people are imported too; Members shows Active until changed
    preset: "12m", periodMode: "rolling", custom: { start: "", end: "" },
    report: "new",
    search: "", sortKey: "lastName", sortDir: "asc",
    detailMember: null, list: null, menuOpen: false,
    imp: null, chartPage: null, open: {}, secKeys: [], view: loadView(), settings: { renewalStart: "10-01", renewalEnd: "12-31", autoRenewDate: "10-01", renewalSnapshot: "02-01", renewalYears: {} }, sync: null,
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
  // Renewal start/end (month-day) set in the Developer menu and shared by every browser.
  // Per-year renewal start/end overrides (an empty PHP array arrives as []).
  function yearsOf(st) { return st && st.renewalYears && !Array.isArray(st.renewalYears) ? st.renewalYears : {}; }
  function renewalCfg() { return { start: state.settings.renewalStart, end: state.settings.renewalEnd, autoRenew: state.settings.autoRenewDate, snapshot: state.settings.renewalSnapshot, years: state.settings.renewalYears }; }
  function windowText(w, t) {
    return w.open ? "renewal window closes " + L.formatDate(w.end) + " (" + R.daysBetween(t, w.end) + " days)" : "next renewal window opens " + L.formatDate(w.nextStart);
  }
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
    ingestSnapshots: function (snaps) { state.snapshots = Array.isArray(snaps) ? snaps : []; renderViews(); },
    ingestSettings: function (st) { if (st && typeof st === "object") { state.settings = { renewalStart: st.renewalStart || "10-01", renewalEnd: st.renewalEnd || "12-31", autoRenewDate: st.autoRenewDate || "10-01", renewalSnapshot: st.renewalSnapshot || "02-01", renewalYears: yearsOf(st) }; renderViews(); } },
    ingestSync: function (sy) { state.sync = sy && typeof sy === "object" ? sy : null; renderViews(); }
  };

  // ---------- derived data ----------
  function filteredPool() {
    var f = state.filters;
    return R.pool(state.members, {
      includeRoles: state.includeRoles, unit: state.unit,
      status: f.status ? [f.status] : ["Active"], types: f.type ? [f.type] : null,
      states: f.state ? [f.state] : null, cities: f.city ? [f.city] : null
    });
  }
  // People-level records under the current filters, regardless of the Count selector
  // (household figures use the club's formula on people records).
  function peoplePoolFiltered() {
    var f = state.filters;
    return R.pool(state.members, { includeRoles: state.includeRoles, unit: "people",
      status: f.status ? [f.status] : ["Active"], types: f.type ? [f.type] : null, states: f.state ? [f.state] : null, cities: f.city ? [f.city] : null });
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
    var dev = el("button", { class: "hdr-menu-item" }, ["🛠 Developer"]);
    dev.addEventListener("click", function () { state.menuOpen = false; renderHeaderMenu(); openDeveloper(); });
    menu.appendChild(dev);
    menu.appendChild(el("a", { class: "hdr-menu-item", href: SITE.logoutUrl }, ["⎋ Logout"]));
  }

  // ---------- shell ----------
  function selectTab(id) {
    state.tab = id;
    state.open = {};
    state.dev.newToken = null;
    try { history.replaceState(null, "", "#" + id); } catch (e) { /* file:// previews */ }
    renderViews();
    window.scrollTo(0, 0);
  }
  function renderViews() {
    var app = $("#app");
    if (!app) return;
    app.innerHTML = "";
    state.secKeys = [];
    app.appendChild(buildTabs());
    var view = state.tab === "members" ? buildMembersView() :
      state.tab === "developer" ? buildDeveloperView() : state.tab === "renewals" ? buildRenewalsView() : state.tab === "meeting" ? buildMeetingView() : buildDashboardView();
    if (state.secKeys.length >= 5) view.insertBefore(sectionControls(), view.firstChild);
    app.appendChild(view);
    renderListModal();
    renderDetailModal();
    renderChartPage();
  }
  function buildTabs() {
    var tabs = [["dashboard", "Dashboard"], ["renewals", "Renewals"], ["meeting", "Monthly Meeting"], ["members", "Members"]];
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
    var tabPrint = el("button", { class: "btn", type: "button", title: "Print this tab" }, ["🖨 Print"]);
    tabPrint.addEventListener("click", function () { window.print(); });
    bar.appendChild(tabPrint);
    pick.className += " view-pick";
    bar.appendChild(pick);
    return bar;
  }
  function emptyRosterState() {
    var b = el("button", { class: "btn primary" }, ["Import members (Developer menu)"]);
    b.addEventListener("click", function () { openDeveloper(); });
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
    // New-member lists read oldest join date first (then by name); other lists keep the order they were given.
    if (/^New members/.test(title)) members = members.slice().sort(function (x, y) { return (x.joinDate || "") < (y.joinDate || "") ? -1 : (x.joinDate || "") > (y.joinDate || "") ? 1 : memberLine(x).localeCompare(memberLine(y)); });
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
    // Print just this list: body.print-modal hides the page behind it (see styles.css) while the dialog prints.
    var prn = el("button", { class: "btn" }, ["🖨 Print"]);
    prn.addEventListener("click", printModal);
    var exp = el("button", { class: "btn" }, ["⬇ Export"]);
    exp.addEventListener("click", function () { var t = memberRows(st.members); download("members.csv", I.toCsv(t.header, t.rows)); });
    var body = [el("div", { class: "count", text: num(st.members.length) + " record" + (st.members.length === 1 ? "" : "s") + (st.note ? " · " + st.note : "") })];
    body.push(st.members.length ? el("div", { class: "tablewrap modal-table" }, [tkEnhanceTable(el("table", { class: "grid" }, [thead, tbody]), st.tkKey || (st.tkKey = "list#" + (++tkSeq)))]) : el("div", { class: "empty-state", text: "No members." }));
    var modal = el("div", { class: "modal wide", role: "dialog", "aria-modal": "true", "aria-label": st.title }, [
      el("div", { class: "modal-head" }, [el("h3", { text: st.title }), prn, exp, closeBtn]),
      el("div", { class: "modal-body" }, body)
    ]);
    var backdrop = el("div", { class: "modal-backdrop no-print" }, [modal]);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    host.appendChild(backdrop);
  }

  // Print just the open dialog: body.print-modal hides the page behind it (see styles.css) while it prints.
  function printModal() {
    document.body.classList.add("print-modal");
    var done = function () { document.body.classList.remove("print-modal"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
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
    var prn = el("button", { class: "btn" }, ["🖨 Print"]);
    prn.addEventListener("click", printModal);
    var exp = el("button", { class: "btn" }, ["⬇ Export"]);
    exp.addEventListener("click", function () { var t = memberRows([m]); download("member-" + (m.memberNumber || "record") + ".csv", I.toCsv(t.header, t.rows)); });
    var modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "modal-head" }, [el("h3", { text: L.fullName(m) || "Member" }), prn, exp, closeBtn]),
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
    items.unshift("Cards and charts show members/households (households = single members + couple members ÷ 2); the Show menu switches to just one. The dashboard always covers the whole club; filter by status, type or place on the Members tab. Times are " + R.TZ + "; today is " + L.formatDate(today()) + ".");
    var roles = state.members.filter(R.isRole).length;
    if (roles && !state.includeRoles) items.push(num(roles) + " role accounts (officer positions) are not counted as members.");
    items.push("This is a current roster. Members who left before the latest export are not in it, so totals over time come only from dated imports saved here (see the Total membership over time chart).");
    var box = el("details", { class: "panel notes" }, [el("summary", { text: "About these numbers" })]);
    box.appendChild(el("ul", {}, items.map(function (t) { return el("li", { text: t }); })));
    return box;
  }

  // ---------- Collapsible sections ----------
  // Pages open with their sections collapsed (the dashboard opens expanded). A section's open/closed state lives in state.open[key]
  // (so it survives re-renders on the same page) and is cleared when you move to another page or report.
  function makeCollapsible(panel, key, opts) {
    opts = opts || {};
    var h = panel.querySelector(":scope > h3");
    if (!h) return panel;
    var kids = Array.prototype.slice.call(panel.childNodes).filter(function (n) { return n !== h; });
    panel.appendChild(el("div", { class: "sec-body" }, kids));
    var btn = el("button", { type: "button", class: "sec-toggle no-print" });
    h.insertBefore(btn, h.firstChild);
    panel.classList.add("collapsible");
    state.secKeys.push(key);
    var name = h.textContent.replace(/[▸▾]/g, "").replace(/⤢ full page/, "").trim();
    // Default state: collapsed everywhere except the dashboard, which opens expanded. An explicit
    // true/false in state.open (from a click, Expand all or Collapse all) overrides the default.
    function isOpen() { return state.open[key] !== undefined ? state.open[key] : key.indexOf("dash:") === 0; }
    function sync() {
      var open = isOpen();
      panel.classList.toggle("collapsed", !open);
      btn.textContent = open ? "▾" : "▸";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", (open ? "Collapse " : "Expand ") + name);
    }
    function toggle(e) {
      if (e) e.stopPropagation();
      state.open[key] = !isOpen();
      sync();
    }
    btn.addEventListener("click", toggle);
    if (opts.headClick !== false) h.addEventListener("click", toggle);
    sync();
    return panel;
  }
  function sectionControls() {
    var all = el("button", { class: "btn" }, ["▾ Expand all"]), none = el("button", { class: "btn" }, ["▸ Collapse all"]);
    all.addEventListener("click", function () { state.secKeys.forEach(function (k) { state.open[k] = true; }); renderViews(); });
    none.addEventListener("click", function () { state.secKeys.forEach(function (k) { state.open[k] = false; }); renderViews(); });
    return el("div", { class: "sec-controls no-print" }, [all, none]);
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
    return makeCollapsible(card, "dash:" + title, { headClick: !onOpen });
  }

  // Daily-sync status for the dashboard: nothing until a sync token exists; a red notice when the last run
  // failed or no run has succeeded in 36 hours.
  function syncLine() {
    var sy = state.sync;
    if (!sy || !sy.tokenSet) return null;
    var last = sy.lastSuccessAt ? new Date(sy.lastSuccessAt).getTime() : 0, stale = !last || Date.now() - last > 36 * 3600 * 1000;
    if (sy.ok === false || stale) {
      return { bad: true, text: (sy.ok === false && sy.message ? sy.message : "The automatic data import has not run successfully in over a day") + (last ? " · last success " + fmtDateTime(sy.lastSuccessAt) : " · it has not succeeded yet") };
    }
    return { bad: false, text: "data import " + (sy.changed ? "updated " : "checked ") + fmtDateTime(sy.lastSuccessAt) };
  }

  function buildDashboardView() {
    var view = el("div", { class: "view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }
    // The dashboard is the whole-club overview: it ignores the Members filters (roles excluded).
    var t = today(), pool = R.pool(state.members, { status: ["Active"] }), suspect = R.suspectJoinDates(state.members);
    var active = pool.filter(R.isActive);
    var src = state.importLog.length && state.importLog[0].sourceFile ? " · " + state.importLog[0].sourceFile : "";
    var sy = syncLine();
    if (state.importedAt) view.appendChild(el("div", { class: "loadedinfo", text: "Last import " + fmtDateTime(state.importedAt) + src + (sy && !sy.bad ? " · " + sy.text : "") }));
    if (sy && sy.bad) view.appendChild(el("div", { class: "errors", text: sy.text }));

    // Five cards: where we are, what's new, and the renewal picture.
    function newIn(key) { var p = R.period(key, t, "rolling"); return { p: p, list: R.newMembers(pool, p.start, p.end, suspect).members }; }
    // "Month" here is the club's meeting month (Wednesday after the first Tuesday through the next first
    // Tuesday), the same one the Monthly Meeting tab uses, so both pages show the same numbers.
    var mp = R.meetingPeriods(t, 2), mLast = mp.filter(function (x) { return x.completed; })[0], mNow = mp.filter(function (x) { return x.inProgress; })[0];
    function newBetween(a, b) { return R.newMembers(pool, a, b, suspect).members; }
    var n1 = { p: mLast, list: newBetween(mLast.start, mLast.end) }, n3 = newIn("3m"), n12 = newIn("12m");
    var nNow = mNow.start <= t ? newBetween(mNow.start, t) : [];
    var rs = R.renewalStatus(pool, t, renewalCfg());
    // Renewed / Left to renew are for this year's renewal (same pool and dates as the Renewals tab).
    var rcfg = renewalCfg(), rw = R.renewalWindow(t, rcfg), rc = R.cycleForYear(rw.open ? +rw.start.slice(0, 4) : +t.slice(0, 4), rcfg);
    var rr = R.renewalRate(pool, rc, t), tgt = L.formatDate(rc.target);
    // New members who joined after the auto-renewal date are renewed automatically, so they count as renewed.
    var autoNew = pool.filter(function (m) { return m.joinDate && m.joinDate > rc.cutoff && m.joinDate <= t; });
    var renewedAll = rr.renewed.concat(autoNew.filter(function (m) { return rr.renewed.indexOf(m) === -1; }))
      .sort(function (x, y) { return (x.joinDate || "") < (y.joinDate || "") ? -1 : (x.joinDate || "") > (y.joinDate || "") ? 1 : memberLine(x).localeCompare(memberLine(y)); });
    var grid = el("div", { class: "kpi-grid" });
    grid.appendChild(kpi("Membership", mmhh(active), viewWord() + " today", function () { openList("Membership (active members)", active); }));
    grid.appendChild(kpi("New last month", mmhh(n1.list), n1.p.label + " · 3 months " + mmhh(n3.list) + " · year " + mmhh(n12.list), function () { openList("New members — last month", n1.list, n1.p.label); }));
    grid.appendChild(kpi("New this month so far", mmhh(nNow), mNow.start <= t ? L.formatDate(mNow.start) + " to today · meeting " + L.formatDate(mNow.end) : "month begins " + L.formatDate(mNow.start), function () { openList("New members — this month so far", nNow, mNow.start <= t ? L.formatDate(mNow.start) + " to today" : ""); }));
    grid.appendChild(kpi("Renewed", mmhh(renewedAll), "expire " + tgt + " or later, plus " + mmhh(autoNew) + " new since " + L.formatDate(rc.cutoff), function () { openList("Renewed — expire " + tgt + " or later, or joined after " + L.formatDate(rc.cutoff), renewedAll); }));
    grid.appendChild(kpi("Left to renew", mmhh(rr.left), windowText(rw, t), function () { openList("Left to renew — expire before " + tgt, rr.left); }));
    grid.appendChild(kpi("Expired", mmhh(rs.expired), "past expiration date", function () { openList("Expired — expiration date before today", rs.expired); }));
    view.appendChild(grid);
    view.appendChild(caveats(pool));

    // Four charts at most (each opens a full page).
    var p12 = R.period("12m", t, "rolling");
    var vH = state.view === "households", vM = state.view === "members", noun = viewNoun();
    var months = vH ? R.householdsMonthly(pool, p12.start, p12.end, suspect) : chartRows(R.monthlyNew(pool, p12.start, p12.end, suspect));
    var charts = el("div", { class: "chart-grid" });
    charts.appendChild(chartPanel("New " + noun + " by month (last 12 months)", C.bar(months, {
      ariaLabel: "New " + noun + " by month", onSelect: function (d) { openList("New members — " + d.label, d.members); }
    }), vH ? "Each couple member counts as half a household." : "Click a bar to see who joined. Bulk-load join dates are left out.", function () { openChartPage(vH ? "hnew" : "new"); }));
    if (!vM) charts.appendChild(chartPanel("Households by membership type", C.bar(R.householdsByType(active), { ariaLabel: "Households by membership type", onSelect: function (d) { openList("Households: " + d.label, d.members); } }),
      "Households = single members + couple members ÷ 2.", function () { openChartPage("htype"); }));
    if (state.view === "both") charts.appendChild(chartPanel("New households by month (last 12 months)", C.bar(R.householdsMonthly(pool, p12.start, p12.end, suspect), { ariaLabel: "New households by month", onSelect: function (d) { openList("New members — " + d.label, d.members); } }),
      "Each couple member counts as half a household.", function () { openChartPage("hnew"); }));
    charts.appendChild(chartPanel(vH ? "Total households over time" : "Total membership over time", totalsNode(totalsData("12m", active), state.view, 260),
      "Today's " + viewNoun() + " by recorded join date. Click for all periods.", function () { openChartPage("tot"); }));
    view.appendChild(charts);
    return view;
  }

  // ---------- Renewals tab ----------
  function buildRenewalsView() {
    var view = el("div", { class: "view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }
    var t = today(), cfg = renewalCfg(), w = R.renewalWindow(t, cfg), c = R.cycleForYear(w.open ? +w.start.slice(0, 4) : +t.slice(0, 4), cfg); // this calendar year's renewal, even before it opens
    function byName(list) { return list.slice().sort(function (x, y) { return (x.lastName || "").localeCompare(y.lastName || "", undefined, { sensitivity: "base" }) || (x.firstName || "").localeCompare(y.firstName || "", undefined, { sensitivity: "base" }); }); }
    var rate = R.renewalRate(state.members, c, t); rate.renewed = byName(rate.renewed); rate.left = byName(rate.left); rate.pool = byName(rate.pool);
    var pctText = rate.pct === null ? "n/a" : (Math.round(rate.pct * 10) / 10) + "%";
    var grid = el("div", { class: "kpi-grid" });
    grid.appendChild(kpi("Renewal start", L.formatDate(c.start), t < c.start ? "opens in " + R.daysBetween(t, c.start) + " days" : t <= c.end ? "window open now" : "window closed"));
    grid.appendChild(kpi("Renewal end", L.formatDate(c.end), "memberships expire this day"));
    grid.appendChild(kpi("New member auto renewal", L.formatDate(c.cutoff), "joined after this date: renewed automatically"));
    grid.appendChild(kpi("Renewed", pctText, mmhh(rate.renewed) + " of " + mmhh(rate.pool) + " (expire " + L.formatDate(c.target) + " or later)", function () { openList("Renewed — expire " + L.formatDate(c.target) + " or later", rate.renewed); }));
    grid.appendChild(kpi("Renewal start count", mmhh(rate.pool), "members in the renewal pool", function () { openList("Renewal start count — members in the renewal pool", rate.pool); }));
    grid.appendChild(kpi("Left to renew", mmhh(rate.left), "in the renewal pool", function () { openList("Left to renew — expire before " + L.formatDate(c.target), rate.left); }));
    view.appendChild(grid);
    function listLink(text, title, list, primary) {
      var a = el("button", { type: "button", class: "btn" + (primary ? " primary" : ""), style: "font-size:1.05rem;padding:.7rem 1.3rem;font-weight:600", text: text + " (" + mmhh(list) + ")" });
      a.addEventListener("click", function () { openList(title, list); });
      return a;
    }
    view.appendChild(el("div", { class: "toolbar no-print", style: "gap:.8rem;margin:.6rem 0 1rem" }, [
      listLink("List of members who have renewed", "Renewed — expire " + L.formatDate(c.target) + " or later", rate.renewed, true),
      listLink("List of members who have not renewed", "Not renewed — expire before " + L.formatDate(c.target), rate.left)]));
    view.appendChild(el("div", { class: "hint", text: "Percent of members (people). The pool is everyone paid through " + L.formatDate(c.end) + " who joined on or before " + L.formatDate(c.cutoff) + "; role accounts and lifetime dates are left out. The dates are set in the menu → Developer → Renewal dates." }));

    var r1 = function (x) { return Math.round(x * 10) / 10; };
    var pts = R.renewalSeries(state.snapshots, c, t).map(function (p) { return { date: p.date, count: r1(p.pct), tip: L.formatDate(p.date) + ": " + r1(p.pct) + "% (" + p.renewed + " of " + p.pool + ")" }; });
    if (rate.pct !== null && t >= c.start) pts = pts.filter(function (p) { return p.date !== t; }).concat([{ date: t, count: r1(rate.pct), tip: L.formatDate(t) + " (today): " + pctText + " (" + rate.renewed.length + " of " + rate.pool.length + ")" }]);
    var charts = el("div", { class: "chart-grid" });
    charts.appendChild(chartPanel("% of members renewed, " + L.formatDate(c.start) + " to " + L.formatDate(c.end),
      C.timeLine([{ name: "% renewed", points: pts }], { start: c.start, end: c.end > t ? c.end : t, emptyText: t < c.start ? "Renewals open " + L.formatDate(c.start) + "; the line starts then." : undefined, ariaLabel: "Percent of members renewed over time" }),
      "One point per saved import this cycle, plus today. The trend fills in as daily imports are saved; earlier days were not recorded."));
    var hist = R.renewalHistory(state.members, t, cfg, 2024).filter(function (h) { return h.pct !== null; });
    hist.forEach(function (h) { h.start = byName(h.start); h.kept = byName(h.kept); });
    var sd = L.formatDate("2001-" + cfg.snapshot).replace(/\/2001$/, "");
    function pctOf(h, kind) { var a = kindCount(h.start, kind); return a ? kindCount(h.kept, kind) / a * 100 : 0; }
    var bars = hist.map(function (h) { return { label: String(h.year), count: r1(pctOf(h, state.view === "households" ? "households" : "members")), members: h.kept }; });
    charts.appendChild(chartPanel("Renewed %, Since Club Express Migration", C.bar(bars, {
      ariaLabel: "Members on the snapshot date as a percent of members on December 31, by year", emptyText: "No snapshot dates have passed yet.",
      onSelect: function (d) { var h = hist.filter(function (x) { return String(x.year) === d.label; })[0]; openList("Members on " + L.formatDate(h.ref) + " — " + d.count + "% (" + h.start.length + " on " + L.formatDate(h.base) + " ÷ " + h.kept.length + " on " + L.formatDate(h.ref) + ")", h.kept); }
    }), "Each bar: (members after renewal ÷ members before renewal) × 100; members are counted the day before the renewal period starts and on " + sd + " the following year, leaving out people who joined after that year's new member auto renewal date. Bars are labeled by the year the renewal period starts. Years are skipped when ClubExpress no longer lists anyone who lapsed in them."));
    // Each count opens the member names behind it: the day before renewals start, the snapshot date, and who is in the first but not the second.
    function nameLink(list, title, date) {
      var a = el("a", { href: "#", text: mmhh(list) });
      a.addEventListener("click", function (e) { e.preventDefault(); openList(title, list); });
      return el("td", {}, [a, el("div", { class: "hint", text: date })]);
    }
    var rows = hist.map(function (h) {
      var inKept = {}; h.kept.forEach(function (m) { inKept[m.key] = true; });
      var gone = h.start.filter(function (m) { return !inKept[m.key]; });
      return el("tr", {}, [el("td", { text: String(h.year) }), nameLink(h.start, "Members on " + L.formatDate(h.base), "on " + L.formatDate(h.base)), nameLink(h.kept, "Members on " + L.formatDate(h.ref), "on " + L.formatDate(h.ref)),
        nameLink(gone, "On " + L.formatDate(h.base) + " but not on " + L.formatDate(h.ref), L.formatDate(h.base) + " to " + L.formatDate(h.ref)), el("td", { text: h.pct === null ? "n/a" : viewKinds().map(function (k) { return r1(pctOf(h, k)) + "%"; }).join("/") })]);
    });
    charts.appendChild(el("div", { class: "panel", style: "grid-column:1 / -1" }, [el("h3", { text: "Supporting table" }), el("div", { class: "tablewrap" }, [el("table", { class: "grid static" }, [
      el("thead", {}, [el("tr", {}, ["Renewal year", "Before Renewal", "After Renewal", "Lost", "Renewed %"].map(function (x) { return el("th", { text: x }); }))]), el("tbody", {}, rows)])])]));
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

  // ---------- Sections (tables with a supporting chart/table, used by Monthly Meeting) ----------
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
    return makeCollapsible(panel, "sec:" + key);
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
    var exp = el("button", { class: "btn" }, ["⬇ Export"]);
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
    var pool = R.pool(state.members, { status: ["Active"] }), active = pool.filter(R.isActive);
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
      "Counts are for the current roster; role accounts are excluded and bulk-load join dates are left out of new-member counts. Membership is as of the month's end: for a past month it is an estimate (today's members who had joined by then, since people who left are not in the export) unless a full import was saved during that month."]));

    if (o.summary) {
      var prevNm = prev ? R.newMembers(pool, prev.start, prev.end, suspect).members : null;
      var cmp = prevNm ? R.compare(joined.length, prevNm.length) : null;
      var hAct = R.householdBreakdown(active), hNew = R.householdTotal(joined);
      var expNext = R.expiringInRange(active, nxt.start, nxt.end, t);
      var grid = el("div", { class: "kpi-grid" });
      // Membership as of the END of the chosen meeting month (today for the month in progress). A past total
      // cannot be known exactly, so it is the number of today's active members who had joined by then; an exact
      // figure from a full import saved during that month replaces it.
      var snapHit = R.snapshotSeries(state.snapshots).filter(function (x) { return x.date >= sel.start && x.date <= effEnd; }).pop();
      var atList = sel.inProgress ? active : active.filter(function (m) { return m.joinDate && m.joinDate <= effEnd; });
      if (snapHit) {
        var snapVal = viewKinds().map(function (k) { return num(k === "households" ? snapHit.households : snapHit.count); }).join("/");
        grid.appendChild(kpi("Membership", snapVal, viewWord() + " · saved import " + L.formatDate(snapHit.date) + " (exact)"));
      } else {
        var hAt = R.householdBreakdown(atList);
        grid.appendChild(kpi("Membership", mmhh(atList), viewWord() + " as of " + L.formatDate(effEnd) + (sel.inProgress ? " (today)" : " · estimate from join dates") + " · " + num(hAt.singleHouseholds) + " single + " + num(hAt.couples.length) + " couple members ÷ 2", function () { openList("Membership as of " + L.formatDate(effEnd), atList); }));
      }
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
    var exp = el("button", { class: "btn" }, ["⬇ Export"]);
    exp.addEventListener("click", function () {
      var out = [["Monthly Meeting"], [sel.start + " to " + effEnd + " (meeting " + sel.end + "), " + R.TZ]];
      sections.forEach(function (s) { out.push([]); out.push([s.title]); out.push(s.header); s.rows.forEach(function (r) { out.push(r); }); });
      download("monthly-meeting-" + sel.end + ".csv", out.map(function (r) { return r.map(I.csvCell).join(","); }).join("\r\n") + "\r\n");
    });
    actions.appendChild(exp);
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
    view.appendChild(makeCollapsible(panel, "import:main"));
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
      box.appendChild(el("details", { class: "support" }, [el("summary", { text: num(review.length) + " records flagged for review (still imported)" }), el("ul", {}, items.concat(review.length > 12 ? [el("li", { text: "…and " + (review.length - 12) + " more (each member's details list their data notes after importing)" })] : []))]));
    }
    if (b.rejected.length) {
      var rl = b.rejected.slice(0, 15).map(function (r) { return el("li", { text: "Row " + r.rowNumber + ": " + r.reason }); });
      var dl = el("button", { class: "btn" }, ["⬇ Export rejected rows"]);
      dl.addEventListener("click", function () {
        download("rejected-rows.csv", I.toCsv(["Row", "Reason"].concat(imp.header), b.rejected.map(function (r) { return [r.rowNumber, r.reason].concat(r.row); })));
      });
      box.appendChild(el("details", { class: "support" }, [el("summary", { text: num(b.rejected.length) + " rows rejected" }), el("ul", {}, rl), dl]));
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

  // ---------- Total members / households over time ----------
  // Built from today's roster (current members by recorded join date) plus exact totals from the full
  // imports saved by this site. The first is NOT the club's past membership: see totalsIntro().
  function totalsData(preset, activePool) {
    var t = today(), p = R.period(preset, t, "rolling");
    var snaps = R.snapshotSeries(state.snapshots).filter(function (x) { return x.date >= p.start && x.date <= p.end; });
    return { p: p, gran: R.granularityFor(preset), pts: R.totalsOverTime(activePool, p.start, p.end, R.granularityFor(preset)), snaps: snaps };
  }
  // kind: "members" | "households" | "both" (both lines on one chart, sharing the y-axis).
  function totalsNode(td, kind, height) {
    var kinds = kind === "both" ? ["members", "households"] : [kind], series = [];
    kinds.forEach(function (k) {
      var isH = k === "households", pre = kinds.length > 1 ? (isH ? "Households" : "Members") : "Current " + k;
      series.push({ name: pre + " (by recorded join date)", color: C.COLORS[isH ? 3 : 1], points: td.pts.map(function (x) {
        var v = isH ? x.households : x.members;
        return { date: x.date, count: v, tip: L.formatDate(x.date) + ": " + num(v) + " " + k, list: x.list };
      }) });
    });
    return C.timeLine(series, { start: td.p.start, end: td.p.end, height: height || 280, ariaLabel: "Total " + (kind === "both" ? "members and households" : kind) + " over time",
      onSelect: function (pt) { if (pt.list && pt.list.length) openList(pt.tip, pt.list); } });
  }
  function totalsIntro(td, suspect) {
    var bulk = Object.keys(suspect).map(function (d) { return L.formatDate(d) + " (" + suspect[d] + " members)"; });
    return "Each point is how many of today's active members had a recorded join date on or before that date (" + td.p.label + ", " + L.formatDate(td.p.start) + " to " + L.formatDate(td.p.end) + "). " +
      "Members who have since left are not in today's export, so earlier points understate the club's real past totals" +
      (bulk.length ? ", and the bulk-load join date" + (bulk.length > 1 ? "s " : " ") + bulk.join(", ") + (bulk.length > 1 ? " show" : " shows") + " up as a sudden jump that is not real growth" : "") + ".";
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

    if (cp.kind === "tot") {
      var td = totalsData(cp.preset, pool.filter(R.isActive));
      title = state.view === "households" ? "Total households over time" : "Total membership over time";
      intro = totalsIntro(td, suspect);
      chart = totalsNode(td, state.view, 380);
      header = ["Date", "Members", "Households", "Source"];
      rows = td.pts.map(function (x, i) { return [L.formatDate(x.date), x.members, x.households, i === td.pts.length - 1 ? "today's roster" : i === 0 ? "period start" : "recorded join dates"]; });
      members = td.pts.map(function (x) { return x.list; });
    } else if (cp.kind === "htype") {
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
    var exp = el("button", { class: "btn" }, ["⬇ Export"]);
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
      if (j.sync) { state.sync = j.sync; state.dev.sync = j.sync; }
      if (j.mail) state.dev.mail = j.mail;
      if (j.syncLog) state.dev.syncLog = j.syncLog;
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
    return makeCollapsible(form, "dev:" + title);
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
        el("div", { class: "hint", text: "This area changes passwords and shows server details. It stays unlocked for 30 idle minutes." }), pw.row, el("div", { class: "toolbar" }, [go]), el("div", { class: "hint" }, [el("a", { href: "dev-forgot-password.php" }, ["Forgot the developer password?"])])]);
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

    var d1 = passwordField("New developer password", "new-password"), d2 = passwordField("Confirm new developer password", "new-password");
    view.appendChild(passwordForm("Change developer password",
      "The password for this Developer area; it also opens the website once it has been changed. At least " + MIN_PASSWORD + " characters.",
      [d1, d2], "change_dev_password", function () { return { newPassword: d1.input.value }; }, "Change developer password"));

    // Renewal dates: month and day only. Memberships expire on the END date; the window repeats every year.
    var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    function mdPicker(label, value) {
      var ms = el("select", { "aria-label": label + " month" }), ds = el("select", { "aria-label": label + " day" });
      MONTHS.forEach(function (n, i) { var o = el("option", { value: String(i + 1), text: n }); if (i + 1 === Number(value.slice(0, 2))) o.selected = true; ms.appendChild(o); });
      for (var i = 1; i <= 31; i++) { var o = el("option", { value: String(i), text: String(i) }); if (i === Number(value.slice(3))) o.selected = true; ds.appendChild(o); }
      function two(n) { return (Number(n) < 10 ? "0" : "") + Number(n); }
      return { month: ms, day: ds, row: el("div", { class: "toolbar" }, [el("strong", { text: label }), ms, ds]), get: function () { return two(ms.value) + "-" + two(ds.value); } };
    }
    var rStart = mdPicker("Renewals start", state.settings.renewalStart), rEnd = mdPicker("Renewals end (memberships expire)", state.settings.renewalEnd), rAuto = mdPicker("New member auto renewal", state.settings.autoRenewDate), rSnap = mdPicker("Membership renew snapshot", state.settings.renewalSnapshot);
    var rMsg = el("div", { class: "hint", role: "status" }), rPrev = el("div", { class: "hint" });
    function rValid(v) { var m = Number(v.slice(0, 2)), d = Number(v.slice(3)); return d <= new Date(Date.UTC(2001, m, 0)).getUTCDate(); }
    function rPreview() {
      var a = rStart.get(), b = rEnd.get();
      if (!rValid(a) || !rValid(b)) { rPrev.textContent = "That month does not have that many days."; return; }
      var w = R.renewalWindow(today(), { start: a, end: b });
      rPrev.textContent = "Current renewal window: " + L.formatDate(w.start) + " to " + L.formatDate(w.end) + " (" + (w.open ? "open now" : "closed; next opens " + L.formatDate(w.nextStart)) + "). Members who have renewed expire " + L.formatDate(w.target) + " or later.";
    }
    [rStart.month, rStart.day, rEnd.month, rEnd.day, rAuto.month, rAuto.day, rSnap.month, rSnap.day].forEach(function (x) { x.addEventListener("change", rPreview); });
    // Each year from 2024 can have its own start and end (past years may have differed); a year left on the
    // general dates above is not stored.
    var yearRows = [], yearBox = el("div"), addYearBtn = el("button", { class: "btn", type: "button" });
    function addYearRow(yy) {
      var yo = state.settings.renewalYears[yy] || {}, r = { year: yy, start: mdPicker(yy + " renewals start", yo.start || state.settings.renewalStart), end: mdPicker(yy + " renewals end", yo.end || state.settings.renewalEnd) };
      yearRows.push(r);
      yearBox.appendChild(el("div", {}, [r.start.row, r.end.row]));
      addYearBtn.textContent = "Add " + (yy + 1) + " renewal dates";
    }
    // 2025 through this year; the button adds the next year (dates saved for a later year are dropped on save unless it is added).
    var lastYear = Number(today().slice(0, 4));
    for (var yy = 2025; yy <= lastYear; yy++) addYearRow(yy);
    addYearBtn.addEventListener("click", function () { addYearRow(yearRows[yearRows.length - 1].year + 1); });
    var rSave = el("button", { class: "btn primary", type: "submit" }, ["Save renewal dates"]);
    var rForm = el("form", { class: "panel pw-form" }, [el("h3", { text: "Renewal dates" }),
      el("div", { class: "hint", text: "When the club's renewal window opens and closes each year. Memberships expire on the end date; the Renewed / Left to renew / Expired cards use these dates." }),
      rAuto.row, rSnap.row, el("h4", { text: "Renewal dates by year (2025 on)" }), el("div", { class: "hint", text: "The renewal start and end for each year. This year's dates also drive the Dashboard cards." })].concat([yearBox, addYearBtn], [ el("div", { class: "hint", text: "The snapshot date is when the Renewals bar chart counts members (compared with the day before the renewal start date of the year before). People who join after the new member auto renewal date are renewed automatically for next year, so the Renewals tab leaves them out of that year's renewal rate." }), el("div", { class: "toolbar" }, [rSave]), rMsg]));
    rForm.addEventListener("submit", function (e) {
      e.preventDefault();
      // The general start/end are taken from this year's row; every listed year is stored.
      var thisRow = yearRows.filter(function (r) { return r.year === Number(today().slice(0, 4)); })[0];
      var a = thisRow ? thisRow.start.get() : rStart.get(), b = thisRow ? thisRow.end.get() : rEnd.get(), c = rAuto.get(), sn = rSnap.get(), ys = {}, yokay = true;
      Object.keys(state.settings.renewalYears).forEach(function (y) { if (Number(y) < 2025) ys[y] = state.settings.renewalYears[y]; }); // years no longer shown keep their saved dates
      yearRows.forEach(function (r) {
        var ya = r.start.get(), yb = r.end.get();
        if (!rValid(ya) || !rValid(yb)) yokay = false;
        else ys[r.year] = { start: ya, end: yb };
      });
      if (!yokay) { rMsg.className = "errors"; rMsg.textContent = "A month in the by-year dates does not have that many days."; return; }
      if (!rValid(a) || !rValid(b) || !rValid(c) || !rValid(sn)) { rMsg.className = "errors"; rMsg.textContent = "That month does not have that many days."; return; }
      rSave.disabled = true; rMsg.className = "hint"; rMsg.textContent = "Saving…";
      devApi("save_settings", { renewalStart: a, renewalEnd: b, autoRenewDate: c, renewalSnapshot: sn, renewalYears: ys }).then(function (j) {
        rSave.disabled = false;
        if (j && j.ok) {
          if (j.settings) state.settings = { renewalStart: j.settings.renewalStart, renewalEnd: j.settings.renewalEnd, autoRenewDate: j.settings.autoRenewDate || "10-01", renewalSnapshot: j.settings.renewalSnapshot || "02-01", renewalYears: yearsOf(j.settings) };
          rMsg.className = "success"; rMsg.textContent = j.message || "Saved."; rPreview();
        } else { rMsg.className = "errors"; rMsg.textContent = (j && j.error) || "Could not save."; if (j && j.httpStatus === 403) { state.dev.unlocked = false; renderViews(); } }
      }).catch(function () { rSave.disabled = false; rMsg.className = "errors"; rMsg.textContent = "Could not reach the server. Nothing was changed."; });
    });
    view.appendChild(makeCollapsible(rForm, "dev:renewal"));
    rPreview();

    // Import members (moved here from its own tab): file -> preview -> confirm, plus the import history.
    view.appendChild(buildImportView());

    // Recovery email: how "Forgot password" links are delivered, with a safe way to test it.
    var mail = state.dev.mail || {};
    var mailBox = el("div", { class: "panel pw-form" }, [el("h3", { text: "Recovery email" }),
      el("div", { class: "hint", text: "The Forgot password pages (on the login page and the Developer unlock form) email a link, valid 24 hours, to the club's admin address; the new password is chosen on the page it opens. The mail-server login ($SMTP_* — the same mailbox settings as the Car Show app) lives in secrets.php on the server and is never typed into a web page." }),
      el("div", { text: "Recovery mailbox: " + (mail.to || "—") }),
      el("div", { text: "Mail server (SMTP): " + (mail.smtp ? "configured" : "not set up — reset links cannot be sent yet") })]);
    var mailMsg = el("div", { class: "hint", role: "status" });
    var testBtn = el("button", { class: "btn primary", type: "button" }, ["Send test email"]);
    testBtn.addEventListener("click", function () {
      testBtn.disabled = true; mailMsg.className = "hint"; mailMsg.textContent = "Sending…";
      devApi("test_email").then(function (j) {
        testBtn.disabled = false;
        if (j && j.ok) { mailMsg.className = "success"; mailMsg.textContent = j.message || "Sent."; }
        else { mailMsg.className = "errors"; mailMsg.textContent = (j && j.error) || "Could not send."; }
      }).catch(function () { testBtn.disabled = false; mailMsg.className = "errors"; mailMsg.textContent = "Could not reach the server."; });
    });
    mailBox.appendChild(el("div", { class: "toolbar" }, [testBtn]));
    mailBox.appendChild(mailMsg);
    view.appendChild(makeCollapsible(mailBox, "dev:mail"));

    // Daily sync: a token for the scheduled task on the club's computer, plus the last run's result.
    var sy = state.dev.sync || state.sync || {};
    var syBox = el("div", { class: "panel pw-form wide" }, [el("h3", { text: "Data Import" }),
      el("div", { class: "hint", text: "A task on the club's computer exports the ClubExpress Additional Member Data report on the schedule set below and sends it here. Sync now asks it to run on its next check (about every 5 minutes). It signs in with a sync token, not a password; the server keeps only the token's hash." }),
      el("div", { text: "Token: " + (sy.tokenSet ? "created " + fmtDateTime(sy.tokenCreatedAt) : "none (automatic data import is off)") }),
      el("div", { text: "Last run: " + (sy.lastRunAt ? fmtDateTime(sy.lastRunAt) + " — " + (sy.ok ? "ok" : "FAILED") + (sy.message ? " (" + sy.message + ")" : "") : "never") })]);
    var syMsg = el("div", { class: "hint", role: "status" });
    // Manual sync: only records a request; the club computer's poll task (every ~5 minutes) picks it up.
    var pending = !!sy.requestedAt;
    if (pending) syBox.appendChild(el("div", { class: "hint", role: "status", text: (sy.claimedAt ? "Sync running on the club computer (started " + fmtDateTime(sy.claimedAt) + ")" : "Sync requested " + fmtDateTime(sy.requestedAt) + " — waiting for the club computer to pick it up (it checks about every 5 minutes)") + ". This updates by itself." }));
    // While a request is waiting or running, re-check every 15 seconds so the result shows without reopening the page.
    if (pending) setTimeout(function () {
      if (state.tab !== "developer" || !state.dev.unlocked) return;
      devApi("status").then(function (j) { applyDev(j); }).catch(function () { /* try again at the next render */ });
    }, 15000);
    var now = el("button", { class: "btn primary", type: "button" }, ["Sync now"]);
    if (!sy.tokenSet || pending) now.disabled = true;
    now.addEventListener("click", function () {
      now.disabled = true;
      devApi("sync_request").then(function (j) {
        if (j && j.ok) { applyDev(j, true); syMsg.className = "success"; syMsg.textContent = j.message; }
        else { now.disabled = false; syMsg.className = "errors"; syMsg.textContent = (j && j.error) || "Could not request a sync."; }
      }).catch(function () { now.disabled = false; syMsg.className = "errors"; syMsg.textContent = "Could not reach the server. Nothing was changed."; });
    });
    if (state.dev.newToken) {
      var tokInput = el("input", { type: "text", readonly: "readonly", value: state.dev.newToken, "aria-label": "New sync token", style: "width:100%;font-family:monospace" });
      tokInput.addEventListener("focus", function () { tokInput.select(); });
      var copy = el("button", { class: "btn", type: "button" }, ["Copy"]);
      copy.addEventListener("click", function () { try { navigator.clipboard.writeText(state.dev.newToken); copy.textContent = "Copied"; } catch (e) { tokInput.select(); } });
      syBox.appendChild(el("div", { class: "success" }, ["New token — copy it now; it is shown only once and the old token no longer works."]));
      syBox.appendChild(tokInput);
      syBox.appendChild(el("div", { class: "toolbar" }, [copy]));
      syBox.appendChild(el("div", { class: "hint", text: "On the club's computer, run:  powershell -ExecutionPolicy Bypass -File Z:\\Backup\\websites\\MembershipManager\\App\\sync\\set-token.ps1  and paste the token when asked." }));
    }
    var gen = el("button", { class: "btn primary", type: "button" }, [sy.tokenSet ? "Replace sync token" : "Create sync token"]);
    gen.addEventListener("click", function () {
      if (sy.tokenSet && !window.confirm("Replace the sync token? The automatic data import stops working until the new token is installed on the club's computer.")) return;
      gen.disabled = true;
      devApi("sync_token_generate").then(function (j) {
        gen.disabled = false;
        if (j && j.ok) { state.dev.newToken = j.token; applyDev(j, true); }
        else { syMsg.className = "errors"; syMsg.textContent = (j && j.error) || "Could not create the token."; }
      }).catch(function () { gen.disabled = false; syMsg.className = "errors"; syMsg.textContent = "Could not reach the server. Nothing was changed."; });
    });
    var btns = [now, gen];
    if (sy.tokenSet) {
      var rev = el("button", { class: "btn", type: "button" }, ["Revoke token (turn the sync off)"]);
      rev.addEventListener("click", function () {
        if (!window.confirm("Revoke the sync token? The automatic data import will stop until a new token is created.")) return;
        devApi("sync_token_revoke").then(function (j) {
          if (j && j.ok) { state.dev.newToken = null; applyDev(j, true); }
          else { syMsg.className = "errors"; syMsg.textContent = (j && j.error) || "Could not revoke the token."; }
        });
      });
      btns.push(rev);
    }
    syBox.appendChild(el("div", { class: "toolbar" }, btns));
    syBox.appendChild(syMsg);

    // Import schedule (Eastern time): on/off, daily at a time or hourly, optional start and end dates (blank end = forever).
    // The club computer's poll task starts a run when the schedule says one is due.
    var sc = sy.schedule || { enabled: true, frequency: "daily", time: "06:30", start: "", end: "" };
    var tOn = el("input", { type: "checkbox", "aria-label": "Scheduled import enabled" });
    tOn.checked = !!sc.enabled;
    var tFreq = el("select", { "aria-label": "Import frequency" }, [el("option", { value: "daily", text: "Daily at" }), el("option", { value: "hourly", text: "Hourly" })]);
    tFreq.value = sc.frequency === "hourly" ? "hourly" : "daily";
    var tInput = el("input", { type: "time", value: sc.time || "06:30", "aria-label": "Data import time" });
    var tStart = el("input", { type: "date", value: sc.start || "", "aria-label": "Schedule start date (optional)" });
    var tEnd = el("input", { type: "date", value: sc.end || "", "aria-label": "Schedule end date (optional)" });
    var tSave = el("button", { class: "btn", type: "button" }, ["Save schedule"]);
    var tMsg = el("div", { class: "hint", role: "status" });
    function tSync() { tInput.style.display = tFreq.value === "daily" ? "" : "none"; }
    tFreq.addEventListener("change", tSync); tSync();
    tSave.addEventListener("click", function () {
      if (tFreq.value === "daily" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tInput.value)) { tMsg.className = "errors"; tMsg.textContent = "Choose a time of day."; return; }
      if (tStart.value && tEnd.value && tEnd.value < tStart.value) { tMsg.className = "errors"; tMsg.textContent = "The end date must be on or after the start date."; return; }
      tSave.disabled = true; tMsg.className = "hint"; tMsg.textContent = "Saving…";
      var payload = { syncEnabled: tOn.checked, syncFrequency: tFreq.value, syncStart: tStart.value || "", syncEnd: tEnd.value || "" };
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(tInput.value)) payload.syncTime = tInput.value;
      devApi("save_settings", payload).then(function (j) {
        tSave.disabled = false;
        if (j && j.ok) { applyDev(j, true); tMsg.className = "success"; tMsg.textContent = j.message || "Saved."; }
        else { tMsg.className = "errors"; tMsg.textContent = (j && j.error) || "Could not save."; }
      }).catch(function () { tSave.disabled = false; tMsg.className = "errors"; tMsg.textContent = "Could not reach the server. Nothing was changed."; });
    });
    syBox.appendChild(el("h4", { text: "Import schedule" }));
    syBox.appendChild(el("label", { class: "toolbar" }, [tOn, el("strong", { text: "Scheduled import on" }), el("span", { class: "hint", text: sc.enabled ? "" : "— off: only Sync now runs an import" })]));
    syBox.appendChild(el("div", { class: "toolbar" }, [tFreq, tInput, el("span", { class: "hint", text: "Eastern time" })]));
    syBox.appendChild(el("div", { class: "toolbar" }, [el("span", { text: "Start date" }), tStart, el("span", { text: "End date" }), tEnd, el("span", { class: "hint", text: "both optional; no end date means forever" })]));
    syBox.appendChild(el("div", { class: "toolbar" }, [tSave]));
    syBox.appendChild(tMsg);

    // Every sync run, newest first.
    var slog = state.dev.syncLog || [];
    syBox.appendChild(el("h4", { text: "Sync log" }));
    if (!slog.length) syBox.appendChild(el("div", { class: "hint", text: "No imports logged yet." }));
    else {
      var how = { manual: "Sync now", scheduled: "Scheduled", browser: "Upload", direct: "Run on the computer" };
      syBox.appendChild(el("div", { class: "tablewrap" }, [tkEnhanceTable(el("table", { class: "grid static" }, [
        el("thead", {}, [el("tr", {}, ["When", "How", "Result", "Details"].map(function (h) { return el("th", { text: h }); }))]),
        el("tbody", {}, slog.map(function (e) {
          return el("tr", {}, [fmtDateTime(e.at), how[e.trigger] || e.trigger || "", e.ok ? "OK" : "FAILED", e.message || ""].map(function (c) { return el("td", { text: String(c) }); }));
        }))
      ]), "syncLog")]));
    }
    view.appendChild(makeCollapsible(syBox, "dev:sync"));

    view.appendChild(makeCollapsible(el("div", { class: "panel" }, [el("h3", { text: "System check" }), el("div", { id: "devSystem" })]), "dev:system"));
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
    if (["dashboard", "renewals", "meeting", "members"].indexOf(h) !== -1) state.tab = h;
    buildHeaderMenu();
    renderViews();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
