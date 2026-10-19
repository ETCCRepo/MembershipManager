// Exports the ClubExpress "Additional Member Data" report as a CSV, using the signed-in dedicated Chrome profile.
//
// Click path (documented in the CarShow app): Control Panel -> People -> Additional Member Data -> Export Answers
// -> Export. Each step is found by its visible text, in any frame, because ClubExpress is ASP.NET WebForms with
// generated ids. When a step cannot be found the error lists the link texts that WERE visible, so a ClubExpress
// layout change is easy to diagnose (link texts only -- never member data).
//
//   node sync/clubexpress-members.js --discover [--headed]
//     walks the same path, printing the visible link/button texts at every step and the control it would press,
//     without downloading anything. Use it to confirm or repair the path after signing in.
//
// The final Export is a WebForms postback. Headless Chrome cannot run ClubExpress's postback scripts (the
// script bundles answer 403), so -- as the CarShow app does -- the form is serialized exactly as a browser would
// (__VIEWSTATE and all) and POSTed through the profile's own cookies; ClubExpress answers with the CSV as an
// attachment. A real click with a download listener is the fallback.
const fs = require("fs");
const path = require("path");
const { HOME_URL, LoginError, openContext, firstVisibleInAnyFrame, controlPanelCandidates, looksLoggedOut } = require("./clubexpress-common");

const STEPS = [
  { name: "People", text: /^\s*people\s*$/i },
  { name: "Additional Member Data", text: /^\s*additional member data\s*$/i },
  { name: "Export Answers", text: /^\s*export answers\s*$/i },
];

function dateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

// Visible link / button texts across all frames (short ones only, deduplicated).
async function visibleTexts(page) {
  const out = new Set();
  for (const frame of page.frames()) {
    const texts = await frame.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return [...document.querySelectorAll("a, button, input[type=submit], input[type=button]")]
        .filter(vis)
        .map((e) => (e.value || e.textContent || "").trim().replace(/\s+/g, " "))
        .filter((t) => t && t.length < 60);
    }).catch(() => []);
    texts.forEach((t) => out.add(t));
  }
  return [...out];
}

async function clickText(page, step, log) {
  const el = await firstVisibleInAnyFrame(page, (frame) => [
    frame.getByRole("link", { name: step.text }),
    frame.getByRole("button", { name: step.text }),
    frame.locator("a, span, div").filter({ hasText: step.text }).locator("xpath=ancestor-or-self::a[1]"),
  ], 10000);
  if (!el) {
    const seen = await visibleTexts(page);
    throw new Error('Could not find "' + step.name + '" in ClubExpress. Visible on the page: ' + JSON.stringify(seen.slice(0, 40)) + " -- the report's location may have changed.");
  }
  await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), el.click()]);
  await page.waitForTimeout(1500);
  log('Opened "' + step.name + '"');
}

// Reads the Export control and the form on the current page.
async function readExportForm(page) {
  for (const frame of page.frames()) {
    const info = await frame.evaluate(() => {
      const els = [...document.querySelectorAll("a, input[type=submit], input[type=button], button")];
      const e = els.find((x) => /^export$/i.test((x.value || x.textContent || "").trim()));
      const f = document.forms[0];
      if (!e || !f) return null;
      const m = /__doPostBack\(\s*'([^']+)'\s*,\s*'([^']*)'\s*\)/.exec((e.getAttribute("href") || "") + " " + (e.getAttribute("onclick") || ""));
      const fields = {};
      for (const el of f.elements) {
        if (!el.name || el.disabled) continue;
        if ((el.type === "radio" || el.type === "checkbox") && !el.checked) continue;
        if (el.type === "button" || el.type === "submit" || el.type === "file") continue;
        fields[el.name] = el.value;
      }
      if (m) { fields.__EVENTTARGET = m[1]; fields.__EVENTARGUMENT = m[2]; }
      else if (e.name) fields[e.name] = e.value || "Export";
      return { action: new URL(f.getAttribute("action") || location.href, location.href).toString(), fields, how: m ? "postback " + m[1] : e.name ? "button " + e.name : "link" };
    }).catch(() => null);
    if (info) return info;
  }
  return null;
}

async function exportMembersCsv({ destDir, log, headless = true, discover = false }) {
  const context = await openContext({ headless });
  try {
    const page = await context.newPage();
    log("Opening ClubExpress");
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (await looksLoggedOut(page)) {
      throw new LoginError("ClubExpress is signed out -- run: node sync/clubexpress-login.js and sign in WITH \"Remember Me\" ticked.");
    }
    const cp = await firstVisibleInAnyFrame(page, controlPanelCandidates, 12000);
    if (!cp) throw new LoginError("No Control Panel link on ClubExpress -- the session is not an admin session. Run: node sync/clubexpress-login.js");
    if (discover) log("Home page shows: " + JSON.stringify((await visibleTexts(page)).slice(0, 40)));
    await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), cp.click()]);
    await page.waitForTimeout(1500);
    log('Opened "Control Panel"');

    for (const step of STEPS) {
      if (discover) log("Before " + step.name + ", visible: " + JSON.stringify((await visibleTexts(page)).slice(0, 60)));
      await clickText(page, step, log);
    }
    if (discover) log("Export page shows: " + JSON.stringify((await visibleTexts(page)).slice(0, 60)));

    const form = await readExportForm(page);
    if (!form) {
      throw new Error('Could not find the Export button on the "Export Answers" page. Visible: ' + JSON.stringify((await visibleTexts(page)).slice(0, 40)));
    }
    log("Export control: " + form.how);
    if (discover) { log("Discovery finished -- nothing was downloaded."); return null; }

    const destPath = path.join(destDir, "answers-" + dateStamp() + ".csv");
    const res = await page.request.post(form.action, { form: form.fields, timeout: 120000 });
    const ctype = res.headers()["content-type"] || "";
    const body = await res.body();
    // Anything but a CSV attachment is an HTML page (login redirect, error, layout change): refuse it rather than
    // save HTML as .csv and let the importer choke on it.
    if (res.status() !== 200 || !/text\/csv|application\/(vnd\.ms-excel|octet-stream)/i.test(ctype)) {
      throw new Error("The export returned " + res.status() + " " + (ctype || "(no content-type)") + " instead of a CSV -- " + body.toString("utf8").replace(/\s+/g, " ").slice(0, 100));
    }
    fs.writeFileSync(destPath, body);
    log("Exported the report -> " + path.basename(destPath));
    return destPath;
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { exportMembersCsv };

if (require.main === module) {
  const args = process.argv.slice(2);
  exportMembersCsv({
    destDir: process.env.MEMBERSHIP_EXPORTS_DIR || "Z:/Backup/ETCC/Membership/Additional Member Data Report",
    log: (m) => console.log(m), headless: !args.includes("--headed"), discover: args.includes("--discover"),
  }).then(() => process.exit(0)).catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
}
