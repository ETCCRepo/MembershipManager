// One-time (and occasional re-run) setup: opens the dedicated ClubExpress Chrome profile in a VISIBLE window so an
// officer can sign into ClubExpress by hand. Nothing else in the sync ever touches a login form.
//
//   node sync/clubexpress-login.js
//
// IMPORTANT: sign in *in the window this opens*. It is a dedicated Chrome profile with its own cookie jar --
// signing into ClubExpress in your everyday Chrome does not help it. TICK "REMEMBER ME": without it ClubExpress
// issues only a temporary cookie and the next scheduled run finds itself signed out.
//
// The profile is shared with the CarShow and Vette Fest syncs, so signing in here fixes all of them.
// This polls until it can actually see a working admin session (the Control Panel link) and says so.
const { openContext, PROFILE_DIR, HOME_URL, persistentCookies, sessionIsLive } = require("./clubexpress-common");

(async () => {
  console.log("Profile folder: " + PROFILE_DIR);
  console.log("Opening: " + HOME_URL);
  console.log("");
  console.log("  >> Sign in IN THE WINDOW THAT JUST OPENED. <<");
  console.log("     It has its own cookie jar -- a login in your normal Chrome will not register here.");
  console.log("");
  console.log('  1. Click "Member Login" and sign in. Tick "Remember Me" so the session lasts.');
  console.log("  2. Wait for this console to print CONFIRMED (checked every 5 seconds).");
  console.log("  3. Then close the window.");
  console.log("");

  const context = await openContext({ headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.error("Could not open ClubExpress: " + e.message));

  let closed = false, live = false, durable = false, last = null;
  context.on("close", () => { closed = true; });
  while (!closed) {
    await new Promise((r) => setTimeout(r, 5000));
    if (closed) break;
    live = await sessionIsLive(context);
    const cookies = live ? await persistentCookies(context).catch(() => []) : [];
    durable = cookies.length > 0;
    const verdict = !live ? "out" : durable ? "durable" : "session-only";
    if (verdict === last) continue;
    last = verdict;
    console.log("");
    if (verdict === "out") console.log("  Not signed in yet -- still watching.");
    else if (verdict === "durable") {
      const soonest = new Date(Math.min(...cookies.map((c) => c.expires)) * 1000);
      console.log("  CONFIRMED -- signed in, and the Control Panel is reachable.");
      console.log("  Session is DURABLE -- lasts until at least " + soonest.toLocaleString() + ".");
      console.log("  You can close the window now.");
    } else {
      console.log("  Signed in, but this session will NOT survive closing the browser (\"Remember Me\" was not ticked).");
      console.log('  Sign out, sign back in WITH "Remember Me" ticked, and wait for DURABLE before closing.');
    }
    console.log("");
  }
  if (durable) { console.log("Browser closed -- durable session saved."); process.exit(0); }
  console.error(live ? "Browser closed with a TEMPORARY session only. Re-run and tick \"Remember Me\"." : "Browser closed WITHOUT a confirmed session. Re-run and sign in inside the window it opens.");
  process.exit(1);
})().catch((err) => { console.error("Login helper failed: " + err.message); process.exit(1); });
