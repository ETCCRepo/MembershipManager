// Exports the ClubExpress "Additional Member Data" report as a CSV, using the signed-in dedicated Chrome profile.
//
// Path (verified against the live admin UI on 2026-10-19): Control Panel -> People tab -> "Additional Member Data"
// -> "Export Answers" (a popup form with a Membership Status filter, default Active) -> Export. The links are
// FOLLOWED rather than hard-coded, with the known page ids as a fallback, so a renumbering does not break the sync.
//
//   node sync/clubexpress-members.js --discover [--headed]   print what it finds at each step; downloads nothing
//
// The final Export is a WebForms postback. Headless Chrome cannot run ClubExpress's postback scripts (the script
// bundles answer 403), so -- as the CarShow app does -- the popup form is serialized exactly as a browser would
// (__VIEWSTATE and all, with the Export button as __EVENTTARGET) and POSTed through the profile's own cookies;
// ClubExpress answers with the CSV as an attachment. Anything that is not a CSV is refused.
const fs = require("fs");
const path = require("path");
const { LoginError, openContext, readPeopleTab, DEFAULT_MEMBER_DATA_URL, DEFAULT_EXPORT_POPUP_URL } = require("./clubexpress-common");

const mask = (u) => String(u).replace(/(club_id|item_id|member_id|user_id)=\d+/gi, "$1=#");
function dateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

// Finds the "Export Answers" popup URL on the Additional Member Data page (an openModalPopup('...') onclick).
async function findExportPopupUrl(page) {
  const popupPath = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((x) => /export answers/i.test(x.textContent || ""));
    const m = a && /openModalPopup\(\s*['"]([^'"]+)['"]/.exec(a.getAttribute("onclick") || "");
    return m ? m[1] : null;
  }).catch(() => null);
  return popupPath ? new URL(popupPath, page.url()).toString() : null;
}

// Reads the export form: its action, its fields (as a browser would submit them) and its Export button.
async function readExportForm(page) {
  return page.evaluate(() => {
    const f = document.forms[0];
    const btn = [...document.querySelectorAll("a, input[type=submit], input[type=button], button")].find((x) => /^export$/i.test((x.value || x.textContent || "").trim()));
    if (!f || !btn) return null;
    const m = /__doPostBack\(\s*'([^']+)'\s*,\s*'([^']*)'\s*\)/.exec((btn.getAttribute("href") || "") + " " + (btn.getAttribute("onclick") || ""));
    if (!m) return null;
    const fields = {};
    for (const el of f.elements) {
      if (!el.name || el.disabled) continue;
      if ((el.type === "radio" || el.type === "checkbox") && !el.checked) continue;
      if (el.type === "button" || el.type === "submit" || el.type === "file") continue;
      fields[el.name] = el.value;
    }
    fields.__EVENTTARGET = m[1];
    fields.__EVENTARGUMENT = m[2];
    const status = fields["ctl00$membership_status_dropdown"] || "";
    return { action: new URL(f.getAttribute("action") || location.href, location.href).toString(), fields, target: m[1], status };
  });
}

async function exportMembersCsv({ destDir, log, headless = true, discover = false }) {
  const context = await openContext({ headless });
  try {
    const page = await context.newPage();
    log("Opening the ClubExpress Control Panel (People)");
    const tab = await readPeopleTab(page);
    if (!tab.live) {
      throw new LoginError("ClubExpress is signed out -- run:  node sync\\clubexpress-login.js  and sign in WITH \"Remember Me\" ticked.");
    }
    log("Signed in. Additional Member Data: " + mask(tab.memberDataHref));

    await page.goto(tab.memberDataHref || DEFAULT_MEMBER_DATA_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    let popupUrl = await findExportPopupUrl(page);
    if (!popupUrl) { log('"Export Answers" link not found; using the known popup page'); popupUrl = DEFAULT_EXPORT_POPUP_URL; }
    log("Export Answers form: " + mask(popupUrl));

    // Always load the form fresh: it is a WebForms page whose __VIEWSTATE is consumed by each postback.
    await page.goto(popupUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const form = await readExportForm(page);
    if (!form) {
      const seen = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200));
      throw new Error("The Export Answers form has no Export button -- ClubExpress may have changed it. The page says: " + seen);
    }
    log("Export control: postback " + form.target + "; Membership Status filter: " + (form.status || "(default)"));
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
    log("Exported the report -> " + path.basename(destPath) + " (" + Math.round(body.length / 1024) + " KB)");
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
