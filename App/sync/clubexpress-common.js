// Shared ClubExpress browser plumbing for the member sync: the dedicated Chrome profile and the signed-in check.
// Adapted from the CarShow / Vette Fest apps' clubexpress.js.
//
// Auth model: this NEVER logs in. It drives a dedicated, persistent Chrome profile that an officer signed into
// ClubExpress once by hand (clubexpress-login.js, with "Remember Me" ticked). That keeps ClubExpress credentials
// off this computer entirely. The profile is the SAME folder the CarShow and Vette Fest syncs use, so one sign-in
// serves all three -- and the tasks can collide on it, hence the retry in openContext().
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE = "https://www.etccwebsite.com"; // the www host: ClubExpress's auth cookie (MEMBER_TOKEN) is host-only on it
const CLUB_ID = "313652"; // East Tennessee Corvette Club on ClubExpress
const CONTROL_PANEL_URL = BASE + "/content.aspx?page_id=15&club_id=" + CLUB_ID;
// The Control Panel's "People" tab is loaded from this URL (found by looking at the signed-in admin UI, 2026-10-19).
const PEOPLE_TAB_URL = BASE + "/basic_modules/club_admin/cp_tab.aspx?t=0&club_id=" + CLUB_ID;
// Known page ids, used only if the links cannot be found: Additional Member Data = 147, its "Export Answers" popup = 394.
const DEFAULT_MEMBER_DATA_URL = BASE + "/content.aspx?page_id=147&club_id=" + CLUB_ID + "&actr=3";
const DEFAULT_EXPORT_POPUP_URL = BASE + "/popup.aspx?page_id=394&club_id=" + CLUB_ID;

const PROFILE_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Local"),
  "ETCC", "clubexpress-profile"
);

class LoginError extends Error {}

// Opens the profile with the system's real Google Chrome (the browser the officer signed in with). Chrome allows
// one process per profile folder, so a busy profile is retried rather than failing an unattended run.
async function openContext({ headless = true, attempts = 4, waitMs = 15000 } = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: "chrome", headless, acceptDownloads: true, viewport: { width: 1440, height: 900 },
      });
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("Could not open the ClubExpress Chrome profile after " + attempts + " tries (it may be in use by the CarShow or Vette Fest sync, or by an open login window): " + String(lastErr && lastErr.message).split(/\r?\n/)[0]);
}

// Cookies that survive closing Chrome (a real expiry). Empty after a login means "Remember Me" was not ticked.
async function persistentCookies(context, domainPattern = /etccwebsite\.com$/i) {
  const cookies = await context.cookies();
  return cookies.filter((c) => c.expires && c.expires > 0 && domainPattern.test((c.domain || "").replace(/^\./, "")));
}

// Loads the People tab and returns { live, memberDataHref }. Signed out (or not an admin) the tab has no
// "Additional Member Data" link. NOTE the public home page cannot be used for this check: it shows "Member Login"
// even to a signed-in admin. The tab content is an internal fragment that can stall when it is the very first page
// loaded, so the normal Control Panel page is loaded first, as a browser would, and the whole step is tried twice.
async function readPeopleTab(page) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(CONTROL_PANEL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.goto(PEOPLE_TAB_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      const href = await page.evaluate(() => {
        const a = [...document.querySelectorAll("a")].find((x) => /^\s*additional member data\s*$/i.test(x.textContent || ""));
        return a ? a.getAttribute("href") : null;
      });
      return { live: !!href, memberDataHref: href ? new URL(href, page.url()).toString() : null };
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw lastErr;
}

async function sessionIsLive(context) {
  const probe = await context.newPage();
  try {
    return (await readPeopleTab(probe)).live;
  } catch (_) {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
}

module.exports = {
  BASE, CLUB_ID, CONTROL_PANEL_URL, PEOPLE_TAB_URL, DEFAULT_MEMBER_DATA_URL, DEFAULT_EXPORT_POPUP_URL,
  PROFILE_DIR, LoginError, openContext, persistentCookies, readPeopleTab, sessionIsLive,
};
