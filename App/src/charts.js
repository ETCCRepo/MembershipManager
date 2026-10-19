/* charts.js — dependency-free SVG bar / line / donut charts (window.MembershipCharts).
 * Built with createElementNS + textContent only, so member-derived labels
 * (cities, types…) can never inject markup. Every mark has a tooltip (<title>),
 * is keyboard-focusable, and calls onSelect(datum) so a chart segment opens the
 * members behind it.
 */
(function (root) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  // Colour-blind-safe categorical palette, led by the ETCC red.
  var COLORS = ["#b0141e", "#0b5cad", "#e69f00", "#009e73", "#7b3294", "#56b4e9", "#6b6b6b", "#d55e00", "#9a8c00", "#cc79a7"];

  function s(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmt(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 }); }
  function niceMax(v) {
    if (v <= 5) return 5;
    var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function activate(el, datum, onSelect) {
    if (!onSelect) return;
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.style.cursor = "pointer";
    el.addEventListener("click", function () { onSelect(datum); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(datum); } });
  }
  function empty(msg) { return h("div", "chart-empty", msg); }

  // data: [{ label, count }]
  function bar(data, opts) {
    opts = opts || {};
    if (!data.length || data.every(function (d) { return !d.count; })) return empty(opts.emptyText || "Nothing to chart for this selection.");
    var W = 720, H = opts.height || 280, m = { l: 44, r: 12, t: 16, b: data.length > 8 ? 70 : 40 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var max = niceMax(Math.max.apply(null, data.map(function (d) { return d.count; })));
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, class: "chart-svg", role: "img", "aria-label": opts.ariaLabel || "Bar chart" });
    for (var t = 0; t <= 4; t++) {
      var v = max / 4 * t, y = m.t + ih - ih * (v / max);
      svg.appendChild(s("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: "chart-grid" }));
      svg.appendChild(s("text", { x: m.l - 6, y: y + 4, "text-anchor": "end", class: "chart-axis" }, fmt(v)));
    }
    var step = iw / data.length, bw = Math.min(48, step * 0.7);
    data.forEach(function (d, i) {
      var x = m.l + step * i + (step - bw) / 2, bh = ih * (d.count / max), y = m.t + ih - bh;
      var g = s("g", { class: "chart-bar" });
      var rect = s("rect", { x: x, y: y, width: bw, height: Math.max(bh, d.count ? 1 : 0), fill: d.color || opts.color || COLORS[0], rx: 2 });
      rect.appendChild(s("title", {}, d.label + ": " + fmt(d.count)));
      g.appendChild(rect);
      if (data.length <= 16 && d.count) g.appendChild(s("text", { x: x + bw / 2, y: y - 4, "text-anchor": "middle", class: "chart-value" }, fmt(d.count)));
      var lx = x + bw / 2, ly = H - m.b + 14;
      var lab = s("text", { x: lx, y: ly, "text-anchor": data.length > 8 ? "end" : "middle", class: "chart-axis" }, d.label.length > 16 ? d.label.slice(0, 15) + "…" : d.label);
      if (data.length > 8) lab.setAttribute("transform", "rotate(-40 " + lx + " " + ly + ")");
      g.appendChild(lab);
      activate(g, d, opts.onSelect);
      g.setAttribute("aria-label", d.label + ": " + fmt(d.count));
      svg.appendChild(g);
    });
    return svg;
  }

  // points: [{ label, count }] in order
  function line(points, opts) {
    opts = opts || {};
    if (!points.length) return empty(opts.emptyText || "Nothing to chart for this selection.");
    var W = 720, H = opts.height || 260, m = { l: 48, r: 18, t: 16, b: 46 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var vals = points.map(function (p) { return p.count; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max(1, Math.round((hi - lo) * 0.2)), min = Math.max(0, lo - pad), max = hi + pad;
    if (max === min) max = min + 1;
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, class: "chart-svg", role: "img", "aria-label": opts.ariaLabel || "Line chart" });
    for (var t = 0; t <= 4; t++) {
      var v = min + (max - min) / 4 * t, y = m.t + ih - ih * ((v - min) / (max - min));
      svg.appendChild(s("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: "chart-grid" }));
      svg.appendChild(s("text", { x: m.l - 6, y: y + 4, "text-anchor": "end", class: "chart-axis" }, fmt(Math.round(v))));
    }
    var xs = points.map(function (p, i) { return m.l + (points.length === 1 ? iw / 2 : iw * i / (points.length - 1)); });
    var ys = points.map(function (p) { return m.t + ih - ih * ((p.count - min) / (max - min)); });
    if (points.length > 1) svg.appendChild(s("polyline", { points: xs.map(function (x, i) { return x + "," + ys[i]; }).join(" "), fill: "none", stroke: COLORS[1], "stroke-width": 2.5, "stroke-linejoin": "round" }));
    points.forEach(function (p, i) {
      var g = s("g", { class: "chart-point" });
      var c = s("circle", { cx: xs[i], cy: ys[i], r: 5, fill: COLORS[1], stroke: "#fff", "stroke-width": 2 });
      c.appendChild(s("title", {}, p.label + ": " + fmt(p.count)));
      g.appendChild(c);
      g.appendChild(s("text", { x: xs[i], y: ys[i] - 10, "text-anchor": "middle", class: "chart-value" }, fmt(p.count)));
      var every = Math.ceil(points.length / 8);
      if (i % every === 0 || i === points.length - 1) g.appendChild(s("text", { x: xs[i], y: H - m.b + 18, "text-anchor": "middle", class: "chart-axis" }, p.label));
      activate(g, p, opts.onSelect);
      g.setAttribute("aria-label", p.label + ": " + fmt(p.count));
      svg.appendChild(g);
    });
    return svg;
  }

  // Time-scaled line chart. series: [{ name, color, dots, points: [{ date, count, tip }] }]; `dots` draws
  // markers only (exact data points, e.g. saved imports) instead of a connected line.
  function timeLine(series, opts) {
    opts = opts || {};
    var all = [];
    series.forEach(function (s) { s.points.forEach(function (p) { all.push(p); }); });
    if (!all.length) return empty(opts.emptyText || "Nothing to chart for this selection.");
    function day(d) { var p = String(d).split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
    var d0 = day(opts.start), d1 = day(opts.end);
    if (d1 <= d0) d1 = d0 + 1;
    var W = 720, H = opts.height || 300, m = { l: 52, r: 22, t: 34, b: 42 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var vals = all.map(function (p) { return p.count; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max(1, Math.round((hi - lo) * 0.15)), minV = Math.max(0, lo - pad), maxV = hi + pad;
    if (maxV === minV) maxV = minV + 1;
    function X(d) { return m.l + iw * (day(d) - d0) / (d1 - d0); }
    function Y(v) { return m.t + ih - ih * ((v - minV) / (maxV - minV)); }
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, class: "chart-svg", role: "img", "aria-label": opts.ariaLabel || "Line chart" });
    for (var t = 0; t <= 4; t++) {
      var v = minV + (maxV - minV) / 4 * t;
      svg.appendChild(s("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "chart-grid" }));
      svg.appendChild(s("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "chart-axis" }, fmt(Math.round(v * 10) / 10)));
    }
    var span = d1 - d0, MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (var k = 0; k <= 5; k++) {
      var dt = new Date((d0 + span * k / 5) * 86400000);
      var lab = span <= 100 ? MON[dt.getUTCMonth()] + " " + dt.getUTCDate() : span <= 1900 ? MON[dt.getUTCMonth()] + " " + dt.getUTCFullYear() : String(dt.getUTCFullYear());
      svg.appendChild(s("text", { x: m.l + iw * k / 5, y: H - m.b + 18, "text-anchor": k === 0 ? "start" : k === 5 ? "end" : "middle", class: "chart-axis" }, lab));
    }
    series.forEach(function (sr, si) {
      var color = sr.color || COLORS[si % COLORS.length], pts = sr.points.slice().sort(function (a, b) { return day(a.date) - day(b.date); });
      if (!sr.dots && pts.length > 1) svg.appendChild(s("polyline", { points: pts.map(function (p) { return X(p.date) + "," + Y(p.count); }).join(" "), fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round" }));
      pts.forEach(function (p) {
        var g = s("g", { class: "chart-point" });
        var c = s("circle", { cx: X(p.date), cy: Y(p.count), r: sr.dots ? 6 : pts.length > 60 ? 2 : 3.5, fill: sr.dots ? "#fff" : color, stroke: color, "stroke-width": sr.dots ? 3 : 1.5 });
        c.appendChild(s("title", {}, p.tip || (p.date + ": " + fmt(p.count))));
        g.appendChild(c);
        if (opts.onSelect) activate(g, p, opts.onSelect);
        g.setAttribute("aria-label", p.tip || (p.date + ": " + fmt(p.count)));
        svg.appendChild(g);
      });
    });
    var lx = m.l;
    series.forEach(function (sr, si) {
      var color = sr.color || COLORS[si % COLORS.length];
      if (sr.dots) svg.appendChild(s("circle", { cx: lx + 6, cy: 14, r: 5, fill: "#fff", stroke: color, "stroke-width": 3 }));
      else svg.appendChild(s("line", { x1: lx, x2: lx + 14, y1: 14, y2: 14, stroke: color, "stroke-width": 3 }));
      var label = s("text", { x: lx + 20, y: 18, class: "chart-axis" }, sr.name);
      svg.appendChild(label);
      lx += 28 + sr.name.length * 6.2;
    });
    return svg;
  }

  // data: [{ label, count }] — drawn as a donut with an HTML legend.
  function donut(data, opts) {
    opts = opts || {};
    var total = data.reduce(function (a, d) { return a + d.count; }, 0);
    if (!total) return empty(opts.emptyText || "Nothing to chart for this selection.");
    var wrap = h("div", "donut-wrap");
    var S = 200, c = S / 2, R = 88, r = 54;
    var svg = s("svg", { viewBox: "0 0 " + S + " " + S, class: "donut-svg", role: "img", "aria-label": opts.ariaLabel || "Donut chart" });
    var ang = -Math.PI / 2;
    var nonzero = data.filter(function (d) { return d.count > 0; });
    nonzero.forEach(function (d, i) {
      var color = COLORS[data.indexOf(d) % COLORS.length], frac = d.count / total, a2 = ang + frac * Math.PI * 2, path;
      if (frac >= 0.9999) {
        path = s("circle", { cx: c, cy: c, r: (R + r) / 2, fill: "none", stroke: color, "stroke-width": R - r });
      } else {
        var large = frac > 0.5 ? 1 : 0;
        var x1 = c + R * Math.cos(ang), y1 = c + R * Math.sin(ang), x2 = c + R * Math.cos(a2), y2 = c + R * Math.sin(a2);
        var x3 = c + r * Math.cos(a2), y3 = c + r * Math.sin(a2), x4 = c + r * Math.cos(ang), y4 = c + r * Math.sin(ang);
        path = s("path", { d: "M" + x1 + " " + y1 + "A" + R + " " + R + " 0 " + large + " 1 " + x2 + " " + y2 + "L" + x3 + " " + y3 + "A" + r + " " + r + " 0 " + large + " 0 " + x4 + " " + y4 + "Z", fill: color, stroke: "#fff", "stroke-width": 1.5 });
      }
      path.appendChild(s("title", {}, d.label + ": " + fmt(d.count) + " (" + Math.round(frac * 1000) / 10 + "%)"));
      activate(path, d, opts.onSelect);
      svg.appendChild(path);
      ang = a2;
    });
    svg.appendChild(s("text", { x: c, y: c - 2, "text-anchor": "middle", class: "donut-total" }, fmt(total)));
    svg.appendChild(s("text", { x: c, y: c + 16, "text-anchor": "middle", class: "chart-axis" }, opts.centerLabel || "total"));
    wrap.appendChild(svg);
    var legend = h("ul", "donut-legend");
    data.forEach(function (d, i) {
      var li = h("li");
      var sw = h("span", "swatch"); sw.style.background = COLORS[i % COLORS.length];
      li.appendChild(sw);
      li.appendChild(h("span", "lbl", d.label));
      li.appendChild(h("span", "val", fmt(d.count) + " · " + Math.round(d.count / total * 1000) / 10 + "%"));
      activate(li, d, opts.onSelect);
      legend.appendChild(li);
    });
    wrap.appendChild(legend);
    return wrap;
  }

  root.MembershipCharts = { bar: bar, line: line, timeLine: timeLine, donut: donut, COLORS: COLORS };
})(window);
