/* app.js — ETCC Membership Manager UI. Same structure as the CarShow app:
 * index.php injects the data through window.__membership.ingest*() on every
 * page load; renderViews() rebuilds #app from `state`.
 *
 * Tabs:
 *   Membership — every imported member with their membership data (search,
 *                sortable columns, click a row for every field from the export).
 *   Reports    — launcher for the Monthly Membership Report (members who
 *                joined in each month), shown full-page with Print.
 */
(function () {
  "use strict";

  var L = window.MembershipLogic;
  var SITE = window.__membershipSite || { importUrl: "members-import.php", logoutUrl: "logout.php" };

  var state = {
    tab: "members",
    members: [],
    importedAt: null,
    importLog: [],
    search: "",
    sortKey: "lastName",
    sortDir: "asc",
    detailMember: null,
    menuOpen: false,
    reportOpen: false,
    reportYear: null
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var h = d.getHours(), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    var mm = d.getMinutes();
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear() + " " + h + ":" + (mm < 10 ? "0" : "") + mm + " " + ap;
  }

  // ---------- data ingest (called by index.php's boot script) ----------
  window.__membership = {
    ingestMembers: function (members, importedAt) {
      state.members = Array.isArray(members) ? members : [];
      state.importedAt = importedAt || null;
      var years = L.joinYears(state.members);
      state.reportYear = years.length ? years[0] : "all";
      renderViews();
    },
    ingestImportLog: function (log) {
      state.importLog = Array.isArray(log) ? log : [];
      renderViews();
    }
  };

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
    menu.appendChild(el("a", { class: "hdr-menu-item", href: SITE.importUrl }, ["⬆ Import Members"]));
    menu.appendChild(el("a", { class: "hdr-menu-item", href: SITE.logoutUrl }, ["⎋ Logout"]));
  }

  // ---------- views ----------
  function renderViews() {
    var app = $("#app");
    if (!app) return;
    app.innerHTML = "";
    app.appendChild(buildTabs());
    app.appendChild(state.tab === "reports" ? buildReportsView() : buildMembersView());
    renderDetailModal();
    renderReportPage();
  }

  function buildTabs() {
    function mk(id, label) {
      var t = el("div", { class: "tab" + (state.tab === id ? " active" : ""), text: label });
      t.addEventListener("click", function () { state.tab = id; renderViews(); });
      return t;
    }
    return el("div", { class: "tabs no-print" }, [mk("members", "Membership"), mk("reports", "Reports")]);
  }

  function emptyRosterState() {
    return el("div", { class: "panel empty-state" }, [
      el("p", { text: "No membership data has been imported yet." }),
      el("a", { class: "btn primary", href: SITE.importUrl }, ["⬆ Import Members"])
    ]);
  }

  // ----- Membership tab -----
  function buildMembersView() {
    var view = el("div", { class: "view" });
    if (!state.members.length) { view.appendChild(emptyRosterState()); return view; }

    if (state.importedAt) {
      view.appendChild(el("div", { class: "loadedinfo" },
        ["Last imported " + fmtDateTime(state.importedAt) + " · " + state.members.length + " members"]));
    }

    var search = el("input", { type: "search", placeholder: "Search name, number, email, city…", value: state.search, "aria-label": "Search members" });
    var countEl = el("span", { class: "count" });
    var importBtn = el("a", { class: "btn", href: SITE.importUrl }, ["⬆ Import Members"]);
    view.appendChild(el("div", { class: "toolbar" }, [search, countEl, el("span", { class: "spacer" }), importBtn]));

    var columns = L.visibleColumns(state.members);
    var thead = el("thead");
    var headRow = el("tr");
    columns.forEach(function (c) {
      var th = el("th", { class: c.num ? "num" : "" }, [c.label]);
      if (state.sortKey === c.key) th.appendChild(el("span", { class: "arrow", text: state.sortDir === "asc" ? "▲" : "▼" }));
      th.addEventListener("click", function () {
        if (state.sortKey === c.key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = c.key; state.sortDir = "asc"; }
        renderViews();
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    var tbody = el("tbody");
    var table = el("table", { class: "grid" }, [thead, tbody]);

    function renderBody() {
      var list = L.sortMembers(L.searchMembers(state.members, state.search), state.sortKey, state.sortDir);
      tbody.innerHTML = "";
      list.forEach(function (m) {
        var tr = el("tr");
        columns.forEach(function (c) { tr.appendChild(el("td", { class: c.num ? "num" : "", text: L.displayValue(m, c) })); });
        tr.addEventListener("click", function () { state.detailMember = m; renderDetailModal(); });
        tbody.appendChild(tr);
      });
      if (!list.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: String(columns.length), class: "empty-state", text: "No members match your search." })]));
      }
      countEl.textContent = list.length === state.members.length
        ? state.members.length + " members"
        : list.length + " of " + state.members.length + " members";
    }
    search.addEventListener("input", function () { state.search = search.value; renderBody(); });
    renderBody();

    view.appendChild(el("div", { class: "tablewrap" }, [table]));
    return view;
  }

  // Every field we know about plus every original export column, so the
  // detail view shows the member's complete record.
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
    var fields = m.fields || {};
    var keys = Object.keys(fields).filter(function (k) { return String(fields[k]).trim() !== ""; });
    if (keys.length) {
      var all = el("div", { class: "detail-grid" });
      keys.forEach(function (k) {
        all.appendChild(el("div", { class: "k", text: k }));
        all.appendChild(el("div", { class: "v", text: fields[k] }));
      });
      sections.push(el("div", { class: "modal-section" }, [el("h4", { text: "All columns from the import" }), all]));
    }

    var closeBtn = el("button", { class: "btn" }, ["✕ Close"]);
    closeBtn.addEventListener("click", close);
    var modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "modal-head" }, [el("h3", { text: L.fullName(m) || "Member" }), closeBtn]),
      el("div", { class: "modal-body" }, sections)
    ]);
    var backdrop = el("div", { class: "modal-backdrop no-print" }, [modal]);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    host.appendChild(backdrop);
  }

  // ----- Reports tab -----
  function buildReportsView() {
    var monthlyBtn = el("button", { class: "btn" }, ["📅 Monthly Membership Report"]);
    monthlyBtn.addEventListener("click", function () { state.reportOpen = true; renderReportPage(); });
    if (!state.members.length) monthlyBtn.setAttribute("disabled", "disabled");
    var col = el("div", { class: "settings-actions", style: "flex-direction: column; align-items: flex-start" }, [
      monthlyBtn,
      el("div", { class: "hint", text: "Lists the members who joined in each month." })
    ]);
    var row = el("div", { class: "reports-row" });
    if (window.__membershipReportsBanner) {
      row.appendChild(el("img", { src: window.__membershipReportsBanner, class: "reports-banner", alt: "Reports" }));
    }
    row.appendChild(col);
    var kids = [el("div", { class: "panel" }, [el("h3", { text: "Reports" }), row])];
    if (!state.members.length) kids.push(emptyRosterState());
    return el("div", { class: "view reports-view" }, kids);
  }

  function renderReportPage() {
    var host = $("#reportHost");
    if (!host) return;
    host.innerHTML = "";
    document.body.classList.toggle("report-open", !!state.reportOpen);
    if (!state.reportOpen) return;

    function close() { state.reportOpen = false; renderReportPage(); }
    var backBtn = el("button", { class: "btn" }, ["← Back"]);
    backBtn.addEventListener("click", close);

    var years = L.joinYears(state.members);
    var yearSel = el("select", { "aria-label": "Year" });
    years.concat(["all"]).forEach(function (y) {
      var o = el("option", { value: y, text: y === "all" ? "All years" : y });
      if (String(state.reportYear) === y) o.selected = true;
      yearSel.appendChild(o);
    });
    yearSel.addEventListener("change", function () { state.reportYear = yearSel.value; renderReportPage(); });
    var printBtn = el("button", { class: "btn" }, ["🖨 Print"]);
    printBtn.addEventListener("click", function () { window.print(); });

    var head = el("div", { class: "api-page-head no-print" }, [
      el("div", { class: "left" }, [backBtn]),
      el("h2", { text: "Monthly Membership Report" }),
      el("div", { class: "right" }, [el("label", { class: "toolbar", style: "margin:0" }, ["Year ", yearSel]), printBtn])
    ]);

    var body = el("div", { class: "api-page-inner" });
    var logo = $("header.app img.hdr-logo");
    var year = state.reportYear || "all";
    body.appendChild(el("div", { class: "report-head" }, [
      logo ? el("img", { src: logo.src, class: "print-logo", alt: "ETCC Logo" }) : null,
      el("h2", { text: "Monthly Membership Report — " + (year === "all" ? "All Years" : year) }),
      el("div", { class: "count", text: "Members who joined each month" })
    ]));

    var report = L.monthlyJoinReport(state.members, year);
    var summary = report.total + " member" + (report.total === 1 ? "" : "s") + " joined" + (year === "all" ? "" : " in " + year) + ".";
    if (report.undated) summary += " " + report.undated + " member" + (report.undated === 1 ? " has" : "s have") + " no join date in the imported data and " + (report.undated === 1 ? "is" : "are") + " not listed.";
    body.appendChild(el("div", { class: "report-summary", text: summary }));

    if (!years.length) {
      body.appendChild(el("div", { class: "empty-state", text: "None of the imported members have a join date. Re-import an export that includes a Join Date column." }));
    }
    report.months.forEach(function (month) {
      var block = el("div", { class: "month-block" }, [
        el("h3", {}, [month.label, el("span", { class: "count", text: month.members.length + " new member" + (month.members.length === 1 ? "" : "s") })])
      ]);
      if (!month.members.length) {
        block.appendChild(el("div", { class: "none", text: "No new members" }));
      } else {
        var tbody = el("tbody");
        month.members.forEach(function (m) {
          tbody.appendChild(el("tr", {}, [
            el("td", { text: L.formatDate(m.joinDate) }),
            el("td", { text: m.memberNumber || "" }),
            el("td", { text: [m.lastName, m.firstName].filter(Boolean).join(", ") }),
            el("td", { text: m.spouseFirstName || "" }),
            el("td", { text: [m.city, m.state].filter(Boolean).join(", ") }),
            el("td", { text: m.email || "" }),
            el("td", { text: m.phone || "" })
          ]));
        });
        block.appendChild(el("table", { class: "report-table" }, [
          el("thead", {}, [el("tr", {}, ["Joined", "Member #", "Name", "Spouse", "City", "Email", "Phone"].map(function (h) { return el("th", { text: h }); }))]),
          tbody
        ]));
      }
      body.appendChild(block);
    });

    host.appendChild(el("div", { class: "api-page" }, [head, el("div", { class: "api-page-body" }, [body])]));
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (state.detailMember) { state.detailMember = null; renderDetailModal(); }
    else if (state.reportOpen) { state.reportOpen = false; renderReportPage(); }
  });

  function init() {
    buildHeaderMenu();
    renderViews();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
