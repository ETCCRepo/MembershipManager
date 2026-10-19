# ETCC Membership Manager — Project Status

**Last updated:** 2026-10-19 — Rebuilt into a ClubExpress-driven dashboard/reporting site (import preview, snapshots, charts, metric reports). Committed locally on `main`, **not pushed, not deployed**. Node tests pass (46); PHP changes are unexecuted (no `php` on this machine).

## What this is

Membership dashboard + reports for the East Tennessee Corvette Club. Live location (once deployed): https://etccapps.com/apps/membershipmanager/. GitHub: https://github.com/ETCCRepo/MembershipManager (`main`). Modeled on CarShow/VetteFest (PHP + one-file JS bundle, FTP to Hostinger). Full operating docs, metric definitions and historical limits: `App/deploy/README.md`. Rules: `CLAUDE.md`.

- **Browser** (`App/src/`): `csvimport.js` (CSV parse, column mapping, validation, matching, diff, export-safe CSV), `reports.js` (all metrics, periods, snapshots), `charts.js` (SVG bar/line/donut), `logic.js` (directory search/sort helpers), `app.js` (UI), `styles.css`. `node build.js` → `ETCCMembership.html` (gitignored; bumps `version.json` unless `MEMBERSHIP_NO_BUMP=1`).
- **Server** (`App/deploy/`, PHP): `index.php` (login gate + injects roster/import log/snapshots + CSRF token), `members-import.php` (JSON import API + rejected-rows CSV), `lib.php`, `logout.php`, `_login.html`, `.htaccess`, `ftp-deploy.sh`.
- **Tabs:** Dashboard (KPI cards, 4 charts, "About these numbers"), Reports (10 reports × periods/filters, chart + supporting table, click-through, CSV, print), Members (directory), Import (preview → confirm → history).

## Real export findings (ClubExpress "Additional Member Data", sample `answers35.csv`, not in repo)

381 rows × 40 columns, all `Active` (no lapsed members — it is a current snapshot only). Rows are ragged (317 have 37 cols; Corvette columns only on 64). One row = one **person**; `primary_member_number` = household (237 primary incl. 20 `Role` rows; 217 households excluding roles); `member_level` 1 = primary, 2 = spouse. 6 spouse rows share member numbers; 1 row has no member number. **146 members share join date 12/21/2022** (a data-load date) so join history before 2023 is not usable; only ~4 genuine older join dates. Membership types contain a damaged dash (U+FFFD). `Role` accounts expire 1/1/2066 and have no join date. The file includes `login_name`, `date_of_birth`, `gender` etc., which are dropped at import.

## Decisions made (confirmed by the owner 2026-10-19: Role accounts excluded from member counts; 12/21/2022 bulk join date excluded from new-member counts)

- Role accounts (officer positions) are excluded from member counts by default (toggle available).
- Active = Status "Active". Bulk-load join dates (≥15 and ≥5% of dated members share one date) are excluded from new-member counts/tenure and shown separately.
- Totals over time come ONLY from saved full-import snapshots (`data/snapshots/`); partial imports never count. A member missing from a full file is "not in this file", never "resigned".
- Import parsing runs in the browser (preview before anything is saved); the server re-validates and never stores raw CSV.

## Session log

### 2026-10-19 (late night, 13) — Membership card follows the meeting month
- Owner: the Monthly Meeting Membership card did not change with the meeting month. It now shows membership **as of the end of the chosen month** (today for the month in progress): today's active members whose recorded join date is on/before that date (an estimate, labelled; bulk-load-date members only appear from that date on), or the exact total from a saved full import when one was saved during that month. Click opens the list behind the number. Deployed.

### 2026-10-19 (late night, 12) — Reports tab removed
- Owner: remove the Reports tab. Tabs are now Dashboard, Monthly Meeting, Members, Import. Removed `buildReportsView`, `buildReportSpec` and the report picker/period code from `app.js` (bundle 211 KB -> 191 KB); `renderSection` stays (Monthly Meeting uses it) and `reports.js` is unchanged. An old `#reports` link opens the Dashboard. No longer reachable in the UI: status / type / tenure / geography / renewals / history / households / long-serving & anniversaries / data-quality reports (restore from git at `dcceb7c` or earlier if wanted; the households and totals charts remain on the dashboard). Wording that pointed to Reports was updated. Deployed.

### 2026-10-19 (late night, 11) — New this month so far card
- Owner: add a card for new members/households so far this month after 'New last month'. Both cards now use the **meeting month** (the same Wednesday-after-first-Tuesday definition as the Monthly Meeting tab) via `R.meetingPeriods`; previously the dashboard's 'last month' was a rolling 30 days and disagreed with the meeting tab (1/1 vs 14/8 on the real data). 'New last month' = last completed meeting month; 'New this month so far' = the in-progress meeting month through today (on a meeting day it shows 'month begins ...'). Deployed.

### 2026-10-19 (late night, 10) — dashboard opens expanded
- Owner: open the dashboard expanded. `makeCollapsible` now has a default (collapsed, except keys starting `dash:` which open expanded); an explicit true/false in `state.open` (click, Expand all, Collapse all) overrides it, and leaving/revisiting a page resets to the defaults. All other pages still open collapsed. Deployed.

### 2026-10-19 (late night, 9) — simpler dashboard
- Owner: the dashboard looked very busy. `buildDashboardView` rewritten: no filter bar (dashboard ignores the Reports/Members filters), 12 KPI cards -> 5 (Membership, New last month with 3-month/1-year in its subtext, Renewed, Left to renew, Expired), the long explanatory line -> one 'Last import' line (definitions moved into 'About these numbers'), status and type donuts removed (type/status still under Reports), Expand/Collapse all only on pages with 5+ sections. The old cards (6-month / 5-year new, in records since 1958, renewals due in 30 days, latest import card) were dropped; the data is still in Reports. Deployed.

### 2026-10-19 (late night, 8) — pages open with sections collapsed
- Owner: open all pages with sections collapsed. `makeCollapsible(panel, key, opts)` + `sectionControls()` in `app.js`; open state in `state.open`, cleared by `selectTab()` and on report change (`state.secKeys` = sections on the current page). Applies to dashboard chart cards (chevron-only toggle; clicking the card still opens the full page), report and Monthly Meeting sections, Import history and Developer panels; Expand all / Collapse all on each such page; print expands everything. Not collapsible: KPI cards, Members table, full-page chart view, list popups. Deployed.

### 2026-10-19 (late night, 7) — whole-number y axes
- Owner: y axis must be whole numbers (the totals chart showed 332.8 / 280.5). `charts.js` `intScale(lo, hi, zeroBase)` now sets every bar, line and time-line axis (steps of 1, 2, 5, 10, 20, 50…, about five intervals, range rounded out to the step). Unit test added (72 tests); checked 234 axis labels across dashboard, full pages and all reports in the browser. Deployed.

### 2026-10-19 (late night, 6) — membership + households on one totals chart
- Owner: rename the totals card to 'membership' and add households to the graph. The dashboard card / full page is now **Total membership over time** (Show: Both draws members and households lines plus exact saved-import dots on one chart; Members or Households draws one line, titled 'Total households over time' for households). Chart-page kind is now `tot`; `totalsNode(td, kind)` accepts members|households|both; the `timeLine` legend wraps onto extra rows. Deployed.

### 2026-10-19 (late night, 5) — renewal dates in Developer, new version format
- **Developer → Renewal dates**: renewal start and end (month-day) are stored server-side (`data/settings.json`; `membership_settings_*` in `lib.php`; `save_settings` in `developer.php`; injected into the page via `ingestSettings`). `reports.js` `renewalWindow/renewalTarget/renewalStatus(members, today, cfg)` use them (wrap-around windows supported, invalid values fall back to Oct 1 / Dec 31). This replaces the earlier 'season starts Oct 1' assumption. 71 tests.
- **Footer version is now `vYYYY.MM.DD.NN`** (date + counter restarting daily; `build.js`, `version.json` = {date, n}). `/ETCCMMCheckpoint` skill updated. Deployed.

### 2026-10-19 (late night, 4) — total members / households line charts
- Owner asked for line charts of total members and total households for the 8 periods. A current export cannot give past totals, so each chart draws (1) a line of *today's active members by recorded join date* (labelled as understating the past; the 12/21/2022 bulk-load date shows as a jump) and (2) dots for exact totals from saved full imports. `charts.js` `timeLine`; `reports.js` `sampleDates`, `totalsOverTime`; `app.js` `totalsData/totalsNode/totalsIntro`, chart-page kinds `totm`/`toth`, two dashboard cards replacing the old 'Active members over time' card. 68 tests pass. Deployed.

### 2026-10-19 (late night, 3) — Show dropdown + renewal cards
- Site-wide **Show: Members / Households / Both** dropdown in the tab bar (`state.view`, persisted in localStorage `mm.view`; helpers `viewKinds`, `viewCounts`, `viewNames`, `chartRows`, `distV`, `mmhh`, `mmhhDelta` in `app.js`). Cards, dashboard charts and report charts/tables follow it; household-only chart panels hide in Members view.
- New dashboard cards **Renewed / Left to renew / Expired** (`R.renewalTarget`, `R.renewalStatus` in `reports.js`, 65 tests). Replaces the old 'Active but past expiration' card; the Renewals report table has the same groups. **Assumption to confirm with the owner: renewal season starts October 1** (`RENEWAL_SEASON_START_MONTH`); target = 12/31 of next year from Oct 1, else 12/31 of this year. `last_renewal_date` is mostly empty in the export so it is not used. Deployed.

### 2026-10-19 (late night, 2) — one Membership card
- The duplicate Active members and Households cards (both showed 361/217) are merged into one **Membership** card on the dashboard and Monthly Meeting tab (value = active members/households; sub-text keeps the single + couple ÷ 2 breakdown). Deployed.

### 2026-10-19 (late night) — full-page chart view
- The three dashboard chart cards (new members by month, households by type, new households by month) open a full-page view (`openChartPage` / `renderChartPage` in `app.js`, host `#chartPageHost`) with a period picker (1m, 3m, 6m, 1y, 2y, 5y, 10y, since 1958), CSV, print and a supporting table. `reports.js`: `bucketsNew`, `granularityFor`, `R.period` gained `24m`/`120m`. 62 Node tests pass. Deployed.

### 2026-10-19 (late) — members/households on every card
- Owner request: every count card shows `members/households` (e.g. 361/217; households = single members + couple members ÷ 2) and the People/Households Count dropdown is removed. Helpers `mmhh`, `mmhhDelta` in `app.js`; dashboard, Monthly Meeting and import-preview cards use them (Monthly Meeting's separate New households card was merged into New members). The Households card now equals the Active members card; remove it if the owner finds it redundant. The owner's real import is live (361 members, 217 households, 146 bulk-date members excluded). Deployed.

### 2026-10-19 (night) — standard TableKit sort/filter header on all tables
- Ported the club's TableKit header (CarShow `tkFillHeader`/`tkEnhance`) into `app.js` + `styles.css`: every table with a `<thead>` (Members directory, report and Monthly Meeting supporting tables, click-through lists, import history) has the ▼ Sort A→Z / Z→A / Clear Filter / value checklist panel; "Total" rows stay put and are re-summed. The directory uses `tkFillHeader` directly (`state.colChecked`); other tables use `tkEnhance(table, key)` with state in `state.tkTables`. Tables without a header row (column-mapping table, system check) are intentionally skipped. Verified in the browser; deployed.

### 2026-10-19 (evening) — Monthly Meeting tab, first deploy of the Developer/recovery work
- New **Monthly Meeting** tab (`reports.js`: `firstTuesday`, `meetingPeriods`, `meetingPeriodAfter`, `anniversariesInRange`, `expiringInRange`; `app.js` `buildMeetingView`). Meeting month = Wednesday after the first Tuesday through the next first Tuesday, inclusive. Options: members joined (last month by default), summary, expirations, anniversaries next month; CSV + print. 58 Node tests pass.
- **Standing instruction from the owner: always deploy after making a change** (`bash App/deploy/ftp-deploy.sh` after `npm test` + `node build.js`; smoke-test the live site afterwards). Pushing to GitHub is still only done when the owner says so.
- Deployed v1.2: Developer menu, `recover.php`, `mailer.php`, household charts, Monthly Meeting. Live smoke test OK: login page 200, bad login 401 JSON, import/developer APIs 401 when logged out, `recover.php` renders, `lib.php`/`mailer.php`/`data/*` are 403. `.htaccess` now also denies `mailer.php`. NOT yet exercised while logged in: Developer unlock and password changes, the recovery POST paths, a real import (the owner has the login).
- The emailed-recovery link needs the `$SMTP` block added to the server's `secrets.php` (none configured); the FTP trigger method works without it. Do not press "Email me a recovery link" for testing: it emails the club mailbox.
### 2026-10-19 (later) — Developer menu, recovery, household charts
- Added **Developer** hamburger item (`developer.php` JSON API, `app.js` view): developer password (initial hash in `lib.php`), change website/developer passwords, system check. Hashes live in `data/auth.json` (overrides `secrets.php`); changing the site password bumps `siteVersion` and signs out other sessions. **Not deployed yet.**
- Owner asked for a permanent always-accepted hardcoded-password backdoor; declined (permanent access to member PII). Built instead: `recover.php` + `mailer.php` — one-shot, time-limited recovery by (1) emailed link to `$RECOVERY_EMAIL` via SMTP/mail() and (2) FTP-uploaded trigger file `data/RESET-PASSWORDS`. Both reset BOTH passwords to random values shown once. SMTP settings go in `secrets.php` (see `secrets.example.php`; the owner must add them; none are configured). `deploy/ftp-deploy.sh` now uploads `developer.php`, `recover.php`, `mailer.php`.
- Household definition (owner): **single members + couple members ÷ 2**. `reports.js` `householdTotal/householdsByType/householdBreakdown/householdsMonthly`; dashboard KPI + 2 charts; rebuilt Reports → Household membership (type bar, composition donut, new households by month, history line, primary-number cross-check). PHP snapshot summary now stores singles/couples and households by the same formula.
- 51 Node tests pass. The PHP files were syntax-checked with the `php-parser` npm package (scratch folder, not in the repo) because PHP is not installed; they have **not been executed**. The SMTP client is untested against a real mail server.
- Restored the template files `secrets.example.php` and `.ftp-credentials.example` that had been removed from the working folder (likely renamed when the real files were made).

### 2026-10-19 — reporting rewrite
- Added `csvimport.js`, `reports.js`, `charts.js`; rewrote `app.js`, `build.js` script list, `styles.css` (appended), `members-import.php` (now a JSON API), `lib.php` (atomic writes, validation, snapshots, session hardening incl. 8h idle timeout, HttpOnly/SameSite cookie), `index.php`, `.htaccess` (`Options -Indexes`), `README.md`, `CLAUDE.md`.
- Removed the PHP CSV parser and its tests; tests are now Node-only (`App/test/run-tests.js`, 46 passing) using the synthetic fixture `test/fixtures/clubexpress-sample.csv` (`test/make-fixture.js` regenerates it).
- Verified in the in-app browser with synthetic data: dashboard, all 10 reports render with charts and supporting tables, import preview (mapping, counts, rejected, flagged), phone-width layout without horizontal scroll, no console errors. Ran the real CSV through the logic read-only (aggregates only): 381 rows → 381 people, 0 rejected, 361 non-role people, 217 households, 146 bulk-date members flagged.
- Skills `/ETCCMMBackup` (now also downloads `data/snapshots` + `data/batches`) and `/ETCCMMCheckpoint` (Node-only tests) updated.
- Earlier today: hardening commit `ef9e4ef` (atomic JSON writes, login throttling) and `d056e5d` (this file) were pushed to origin.

## Known issues / open items

- **Deployed (v1.2) but commits are not pushed** — push only when the owner says so. Needs `App/deploy/.ftp-credentials` and a hand-uploaded `secrets.php`; confirm the FTP account's remote folder is the app folder.
- **Developer menu / recovery / mailer are undeployed and untested end to end**: configure `$SMTP` in the server's `secrets.php`, deploy, then try Developer unlock, both password changes, and `recover.php` (email and FTP paths).
- **PHP is unexecuted.** `php` is not installed here, so `lib.php`, `members-import.php`, `index.php` have only been reviewed, not run. Install PHP (or test on the server) and do an end-to-end import before relying on them: login → import → reload → snapshot appears → rejected-rows download.
- Browser-pane checks used synthetic data and a static preview; the real import POST path (CSRF header, JSON size, `members-data.json` write) is unexercised.
- Only one full import exists so far, so "Members over time" shows an explanatory message until a second full export is imported.
- Demographic reports (age/gender) intentionally absent (columns dropped at import) — add only if the owner wants them.
- Remaining minor items from the earlier review: no per-user accounts (single shared password); lockout is per `REMOTE_ADDR` (shared NAT shares a bucket); `logout.php` works on GET.
- Unused asset `App/assets/reports-banner.jpg` (no longer embedded).
- Chart accessibility: marks are keyboard-focusable with tooltips, but charts have not been tested with a screen reader.

## Checkpoint procedure

`/ETCCMMCheckpoint` (or by hand): `cd App && npm test` → `node build.js` → `bash deploy/ftp-deploy.sh` → commit named files → `git push origin main`. Do not run the deploy/push steps without the owner's go-ahead.
