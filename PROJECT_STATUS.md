# ETCC Membership Manager — Project Status

**Last updated:** 2026-10-16 — Cloned and reviewed the repo, hardened CSV import / JSON writes / login throttling (committed, not deployed, PHP tests not yet run), and created the `/ETCCMM*` skills.

## What this is

Membership roster + reports site for the East Tennessee Corvette Club, modeled on the CarShow app. Live at https://etccapps.com/apps/membershipmanager/. GitHub: https://github.com/ETCCRepo/MembershipManager (branch `main`).

- **UI:** `App/src/` — `logic.js` (pure helpers, Node-testable), `app.js` (DOM), `styles.css`. `node App/build.js` inlines them into `App/ETCCMembership.html` (gitignored) and bumps the minor number in `App/version.json` (override: `MEMBERSHIP_VERSION=1.7`; skip bump: `MEMBERSHIP_NO_BUMP=1`).
- **Server (PHP):** `App/deploy/`. `index.php` = password gate (`_login.html`) then serves `app-bundle.html` with `members-data.json` and the import log injected. `members-import.php` = CSV upload (replaces the roster). `lib.php` = JSON helpers, CSV parser, login throttling. `logout.php`. `.htaccess` denies direct access to `.json`, `lib.php`, `secrets.php`, etc.
- **Deploy:** `App/deploy/ftp-deploy.sh` (FTPS via curl; needs `App/deploy/.ftp-credentials`, gitignored). Never uploads data files or `secrets.php` (upload `secrets.php` once by hand).
- **Docs:** `CLAUDE.md`, `App/deploy/README.md` (CSV format, deploy steps).
- **Rules:** never commit `secrets.php`, `.ftp-credentials`, or member data JSON (real PII). Test fixtures use obviously fake names.

## Skills (in `C:\Users\Admin\.claude\skills\`, modeled on ETCCSAM*)

`/ETCCMMBegin`, `/ETCCMMEnd`, `/ETCCMMCheckpoint` (npm test → build → ftp-deploy → commit → push), `/ETCCMMAll`, `/ETCCMMBackup` (live data via FTPS + repo zip to `Z:\Backup\websites\MM\Backup`). Created this session; not yet exercised.

## Checkpoint procedure

From `App/`: `npm test` (needs `node` and `php` on PATH) → `node build.js` → `bash deploy/ftp-deploy.sh` → commit changed files by name → `git push origin main`.

## Known issues / open items

- **`php` is not installed on the dev machine**, so `npm test` fails at the first PHP-backed test. None of the PHP changes below have been executed yet, including the new Windows-1252 CSV test.
- **Nothing deployed from this machine.** `App/deploy/.ftp-credentials` and `secrets.php` don't exist locally; the hardening commit is not live.
- Minor, unfixed (from the review): two-digit-year pivot makes "49" → 2049; `strtotime` fallback in `membership_parse_date` accepts words like "today"; no session timeout / explicit cookie flags (`Secure`, `SameSite`); `logout.php` works on GET; unparseable dates show raw text but sort with blanks; `members-import.php` requires `secrets.php` without using it.
- Login lockout is per `REMOTE_ADDR`; behind a proxy/shared NAT all users share one bucket.

## Session log

### 2026-10-16
- Cloned the repo into `Z:\Backup\websites\MembershipManager` (HEAD was `9243615`), reviewed all code.
- **Fixed (commit `ef9e4ef`, "Harden CSV import, JSON writes, and login"):**
  1. *Non-UTF-8 CSVs* (Excel/Windows-1252): `membership_parse_csv` now reads the whole file, converts to UTF-8 if invalid, and parses from `php://temp`. `json_encode` calls use `JSON_INVALID_UTF8_SUBSTITUTE`; `membership_safe_inline_json` falls back to `null` instead of emitting `false` (previously a blank page). Test added in `App/test/run-tests.js`.
  2. *Roster-wipe / non-atomic writes:* `membership_write_json` now encodes first, writes a `*.tmp.json` file, and `rename()`s over the target; returns false without touching the old file on failure. `membership_append_json_list` uses new `membership_with_lock()` (sidecar `*.lock.json`).
  3. *Login throttling:* 5 failures per IP in 15 min → 15-min lockout (HTTP 429 + `Retry-After`). State in `App/deploy/login-attempts.json` (`membership_login_*` in `lib.php`, used by `index.php`); `_login.html` shows the lockout message. `.gitignore` and `.htaccess` comments updated.
- Commit `ef9e4ef` is local; it was **one commit ahead of `origin/main`** when last checked (this doc's commit is pushed together with it).
- Created the five `/ETCCMM*` skills (see above). Backup destination `Z:\Backup\websites\MM\Backup` was chosen by naming convention, not confirmed by the user.
- Version in `App/version.json` unchanged (no build run).
