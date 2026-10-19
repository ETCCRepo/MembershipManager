// Daily member sync: exports the ClubExpress "Additional Member Data" report, parses and checks it with the
// same code the website's Import tab uses (src/csvimport.js), and sends the roster to the site.
//
//   node sync/sync-members.js [--file path.csv] [--dry-run] [--headed]
//
//   --file     use this CSV instead of exporting from ClubExpress (testing, or a manual export)
//   --dry-run  parse and report what WOULD be sent; contacts nobody and needs no token
//   --headed   show the Chrome window during the ClubExpress export
//
// Environment:
//   MEMBERSHIP_SYNC_TOKEN   (required to upload) created in the website's Developer menu -> Daily sync and
//                           stored by sync/set-token.ps1 as a Windows user environment variable
//   MEMBERSHIP_SITE_URL     (optional) defaults to https://etccapps.com/apps/membershipmanager
//   MEMBERSHIP_EXPORTS_DIR  (optional) where exported CSVs are kept
//
// ClubExpress credentials are never stored or used here: the export drives a dedicated Chrome profile that an
// officer signed into by hand (sync/clubexpress-login.js). When that session lapses the run fails with a clear
// message AND reports the failure to the site, which shows it on the dashboard.
//
// Exit code 0 = synced (or nothing to change); 1 = failed. Nothing member-related is ever written to the log.
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const I = require("../src/csvimport.js");

const SITE = (process.env.MEMBERSHIP_SITE_URL || "https://etccapps.com/apps/membershipmanager").replace(/\/+$/, "");
const EXPORTS_DIR = process.env.MEMBERSHIP_EXPORTS_DIR || "Z:/Backup/ETCC/Membership/Additional Member Data Report";
const TOKEN = (process.env.MEMBERSHIP_SYNC_TOKEN || "").trim();
const LOCAL_LOG = path.join(__dirname, "sync-members.local.log");
const MIN_MEMBERS = 20; // a real club export is far larger; fewer means a wrong or empty report

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

function stamp() { return new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: false }); }
function log(msg) {
  const line = "[" + stamp() + "] " + msg;
  console.log(line);
  try {
    fs.appendFileSync(LOCAL_LOG, line + "\n");
    if (fs.statSync(LOCAL_LOG).size > 400000) { // keep the log small: drop the oldest half
      const lines = fs.readFileSync(LOCAL_LOG, "utf8").split("\n");
      fs.writeFileSync(LOCAL_LOG, lines.slice(Math.floor(lines.length / 2)).join("\n"));
    }
  } catch (e) { /* logging must never break the sync */ }
}

// Reads and checks one CSV. Returns what would be sent. Throws a plain-English Error when it is unusable.
function prepare(csvPath) {
  const bytes = fs.readFileSync(csvPath);
  const dec = I.decodeBytes(new Uint8Array(bytes));
  const rows = I.parseCsv(dec.text);
  if (rows.length < 2) throw new Error("The exported file is empty.");
  const sug = I.suggestMapping(rows[0]);
  if (sug.missingRequired.length) throw new Error("The export is missing required columns (" + sug.missingRequired.join(", ") + ") -- ClubExpress may have changed the report.");
  if (sug.mapping.memberNumber === null) throw new Error("The export has no member_number column, so members cannot be matched -- ClubExpress may have changed the report.");
  const built = I.buildMembers(rows, sug.mapping);
  if (built.fatal) throw new Error(built.warnings[0] || "The export could not be read.");
  if (built.members.length < MIN_MEMBERS) throw new Error("The export has only " + built.members.length + " members; that is not the full roster, so nothing was sent.");
  const households = new Set(built.members.filter((m) => !m.isRole).map((m) => m.household)).size;
  return { members: built.members, rejected: built.rejected, sourceFile: path.basename(csvPath), dataRows: rows.length - 1, encoding: dec.encoding, households };
}

function request(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request({ method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers, timeout: 180000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error("The website did not answer in time.")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function post(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return request("POST", SITE + "/members-sync.php", { "Content-Type": "application/json", "Content-Length": body.length, "X-Sync-Token": TOKEN }, body);
}

// Best-effort: tell the site this run failed so the dashboard can say so. Never throws.
async function reportFailure(message) {
  if (!TOKEN || flag("--dry-run")) return;
  try { await post({ status: "failed", error: String(message).slice(0, 250) }); } catch (e) { log("(could not report the failure to the site: " + e.message + ")"); }
}

// Exported files made by this script are named answers-YYYYMMDD.csv; keep two months of them.
function pruneOldExports() {
  try {
    const cutoff = Date.now() - 60 * 86400000;
    for (const f of fs.readdirSync(EXPORTS_DIR)) {
      if (!/^answers-\d{8}\.csv$/.test(f)) continue;
      const full = path.join(EXPORTS_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch (e) { /* not important */ }
}

async function main() {
  log("Daily member sync starting" + (flag("--dry-run") ? " (dry run)" : ""));
  if (!flag("--dry-run") && !TOKEN) throw new Error("MEMBERSHIP_SYNC_TOKEN is not set on this computer -- run sync/set-token.ps1 (the token comes from the website's Developer menu -> Daily sync).");

  let csvPath = option("--file");
  if (!csvPath) {
    const { exportMembersCsv } = require("./clubexpress-members");
    if (!fs.existsSync(EXPORTS_DIR)) throw new Error("The exports folder does not exist: " + EXPORTS_DIR);
    csvPath = await exportMembersCsv({ destDir: EXPORTS_DIR, log, headless: !flag("--headed") });
    pruneOldExports();
  } else {
    log("Using " + path.basename(csvPath));
  }

  const prep = prepare(csvPath);
  log("Read " + prep.dataRows + " rows (" + prep.encoding + "): " + prep.members.length + " people, " + prep.households + " households, " + prep.rejected.length + " rejected rows.");

  if (flag("--dry-run")) { log("Dry run: nothing was sent."); return; }

  const res = await post({ mode: "full", sourceFile: prep.sourceFile, members: prep.members, rejected: prep.rejected });
  if (res.status !== 200 || !res.json || !res.json.ok) {
    const why = (res.json && res.json.error) || ("HTTP " + res.status + " " + res.text.slice(0, 120).replace(/\s+/g, " "));
    throw new Error("The website refused the import: " + why);
  }
  const r = res.json;
  log(r.changed ? "Site updated: " + r.added + " added, " + r.updated + " updated, " + r.notInFile + " no longer in the export." : "No changes since the last sync.");
}

main().then(() => process.exit(0)).catch(async (err) => {
  log("FAILED: " + err.message);
  await reportFailure(err.message);
  process.exit(1);
});
