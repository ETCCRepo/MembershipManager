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
