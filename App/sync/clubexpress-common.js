// Shared ClubExpress browser plumbing for the member sync: the dedicated Chrome profile, the signed-in check,
// and frame-aware locators. Adapted from the CarShow / Vette Fest apps' clubexpress.js.
//
// Auth model: this NEVER logs in. It drives a dedicated, persistent Chrome profile that an officer signed into
// ClubExpress once by hand (clubexpress-login.js, with "Remember Me" ticked). That keeps ClubExpress credentials
// off this computer entirely. The profile is the SAME folder the CarShow and Vette Fest syncs use, so one sign-in
// serves all three -- and the tasks can collide on it, hence the retry in openContext().
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const CLUB_ID = "313652"; // East Tennessee Corvette Club on ClubExpress
const HOME_URL = "https://www.etccwebsite.com/content.aspx?page_id=0&club_id=" + CLUB_ID; // www host: the auth cookie is host-only

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

// ClubExpress is ASP.NET WebForms with generated ids, so everything anchors on visible text and role, and every
// lookup sweeps ALL frames (admin panels are often rendered inside an iframe).
async function firstVisibleInAnyFrame(page, buildCandidates, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      let candidates;
      try { candidates = buildCandidates(frame); } catch (_) { continue; }
      for (const locator of candidates) {
        const el = locator.first();
        if (await el.isVisible().catch(() => false)) return el;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

const controlPanelCandidates = (frame) => [
  frame.getByRole("link", { name: /^\s*control panel\s*$/i }),
  frame.locator('a:has-text("Control Panel")'),
];
const memberLoginCandidates = (frame) => [
  frame.getByRole("link", { name: /member login/i }),
  frame.locator('input[type="password"]'),
];

// True when this page is ClubExpress's logged-out view.
async function looksLoggedOut(page) {
  if (/action=login/i.test(page.url())) return true;
  return !!(await firstVisibleInAnyFrame(page, memberLoginCandidates, 1500));
}

// True when the profile has a working admin session: not logged out AND the Control Panel link is reachable.
async function sessionIsLive(context) {
  const probe = await context.newPage();
  try {
    await probe.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (await looksLoggedOut(probe)) return false;
    return !!(await firstVisibleInAnyFrame(probe, controlPanelCandidates, 6000));
  } catch (_) {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
}

module.exports = { CLUB_ID, HOME_URL, PROFILE_DIR, LoginError, openContext, persistentCookies, firstVisibleInAnyFrame, controlPanelCandidates, looksLoggedOut, sessionIsLive };
