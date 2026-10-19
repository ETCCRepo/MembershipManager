// Exports the ClubExpress "Additional Member Data" report as a CSV, using the signed-in dedicated Chrome profile.
//
// Path (verified against the live admin UI on 2026-10-19): Control Panel -> People tab -> "Additional Member Data"
// -> "Export Answers". The popup that opens only sets two hidden fields on the Additional Member Data page
// (hidden_membership_types = the ticked statuses, hidden_subgroup_id) and then posts that page back with
// __EVENTTARGET = hidden_export_button; THAT request answers with the CSV (answers.csv). We send the same post
// directly, so no popup, no clicking and no ClubExpress JavaScript is needed -- which matters because headless
// Chrome cannot run ClubExpress's scripts (the script bundles answer 403). The page is found by following the
// People tab's link (known page id 147 as a fallback), so a renumbering does not break the sync.
//
// Membership status: the browser's own post with only "Active" ticked (the form's default) sends types "1", and
// that is what the club's manual exports use. Override with MEMBERSHIP_STATUS_IDS (comma-separated ids) if the
// club ever wants other statuses included.
//
//   node sync/clubexpress-members.js --discover [--headed]   print what it finds; downloads nothing
const fs = require("fs");
const path = require("path");
const { LoginError, openContext, readPeopleTab, DEFAULT_MEMBER_DATA_URL } = require("./clubexpress-common");

const STATUS_IDS = (process.env.MEMBERSHIP_STATUS_IDS || "1").trim();
const mask = (u) => String(u).replace(/(club_id|item_id|member_id|user_id)=\d+/gi, "$1=#");
function dateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

// Reads the Additional Member Data page's form the way a browser would submit it, ready to be posted back
// as the export. Returns null if the page does not have the export hooks (layout changed / not an admin page).
async function readExportForm(page) {
  return page.evaluate((statusIds) => {
    const f = document.forms[0];
    if (!f) return null;
    const named = (re) => [...f.elements].find((e) => e.name && re.test(e.name));
    const btn = named(/hidden_export_button$/), types = named(/hidden_membership_types$/), sub = named(/hidden_subgroup_id$/);
    if (!btn || !types || !sub) return null;
    const fields = {};
    for (const el of f.elements) {
      if (!el.name || el.disabled) continue;
      if ((el.type === "radio" || el.type === "checkbox") && !el.checked) continue;
      if (el.type === "button" || el.type === "submit" || el.type === "file") continue;
      fields[el.name] = el.value;
    }
    fields[types.name] = statusIds; // what the popup's own script sets
    fields[sub.name] = "-1";        // all subgroups
    fields.__EVENTTARGET = btn.name;
    fields.__EVENTARGUMENT = "";
    return { action: new URL(f.getAttribute("action") || location.href, location.href).toString(), fields, target: btn.name };
  }, STATUS_IDS);
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
    const dataUrl = tab.memberDataHref || DEFAULT_MEMBER_DATA_URL;
    log("Signed in. Additional Member Data: " + mask(dataUrl));

    // Load the page fresh: it is a WebForms page whose __VIEWSTATE is consumed by each postback.
    await page.goto(dataUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    const form = await readExportForm(page);
    if (!form) {
      throw new Error("The Additional Member Data page has no export hooks -- ClubExpress may have changed it (run: npm run sync:discover).");
    }
    log("Export control: postback " + form.target + "; membership status ids: " + STATUS_IDS);
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
