# ETCC Membership Manager — setup, metrics and deployment

Membership dashboard and reports for the East Tennessee Corvette Club. Built like the
CarShow app: one self-contained HTML bundle for the UI, and a few PHP files that put it
behind a password and store the member data on the server.

Live location: **https://etccapps.com/apps/membershipmanager/**

## How it works

- **Browser** (`App/src/*.js` → `node App/build.js` → `App/ETCCMembership.html`):
  `csvimport.js` reads and validates the ClubExpress CSV *locally*, `reports.js` holds every
  metric, `charts.js` draws SVG charts, `app.js` is the UI. The bundle contains no member data.
- **Server** (`App/deploy/`, PHP):
  - `index.php` — password gate (`_login.html`), then serves `app-bundle.html` with the
    current roster, import log and saved snapshots injected. Login is throttled (5 wrong
    passwords per IP → 15-minute lockout) and sessions expire after 8 idle hours.
  - `members-import.php` — logged-in JSON API. Receives the cleaned records, **re-validates
    every field**, updates the roster, writes a dated snapshot, logs the batch, and serves
    the "rejected rows" CSV. It needs the session cookie *and* a CSRF token.
  - `lib.php` — atomic JSON writes (temp file + rename, never a half-written file), locking,
    validation, snapshot helpers. `logout.php`. `.htaccess` denies all `.json` files,
    `lib.php`, `secrets.php`, the bundle, and directory listings.
- **Storage** (server only, never in git, never publicly served):
  - `members-data.json` — current roster
  - `member-import-history.json` — one entry per import
  - `data/snapshots/<yyyymmddHHMMSS>.json` — one per **full** import (counts + member keys)
  - `data/batches/<id>-rejected.json` — rows rejected in that import
  - `login-attempts.json` — throttling state

Data is shared and central: every officer who logs in sees the same roster from any device.
Nothing is kept in browser storage.

## Hostinger / subdirectory notes

- Plain PHP + static files; no Node server, database or build step on the server. This
  matches how CarShow and VetteFest run on the same plan.
- Everything is relative (`index.php`, `members-import.php`, `logout.php`, the logo), so it runs
  unchanged under `/apps/membershipmanager/`. There are no client-side nested routes: the
  current tab is kept in the URL hash (`#reports`), so a refresh returns to the same tab.
- On the CarShow site `/apps/` is a server Alias onto the FTP account's own folder. The FTP
  account used here must point at *this app's* folder; confirm the remote directory in the
  FTP client before the first deploy (do not infer it from the URL).
- Only this app's files are uploaded; the script never deletes or overwrites anything else.

## First-time server setup

1. Copy `secrets.example.php` to `secrets.php`, set `$PASSWORD_HASH`
   (`openssl passwd -6 -salt "$(openssl rand -hex 8)" 'the-password'`), and upload it once by hand.
2. Copy `.ftp-credentials.example` to `.ftp-credentials` (gitignored) and fill it in.
3. Deploy (below), log in, open **Import** and import the ClubExpress export.

## Local setup

```
cd App
npm test            # Node only — no PHP needed (all parsing and metrics are in src/*.js)
node build.js       # writes App/ETCCMembership.html and bumps version.json
```

To click through it without a server, build, then serve a folder containing the built HTML with
a small script that calls `window.__membership.ingestMembers(...)`, `ingestImportLog(...)`
and `ingestSnapshots(...)` using the synthetic fixture (`test/fixtures/clubexpress-sample.csv`;
regenerate with `node test/make-fixture.js`). Never use real member data in fixtures.

## Deploying

1. `cd App && npm test && node build.js`
2. `bash deploy/ftp-deploy.sh` (needs `deploy/.ftp-credentials`, or `FTP_HOST`/`FTP_USER`/`FTP_PASS`).
   It uploads code only. It never touches member data, snapshots or `secrets.php`.

**Rollback:** the previous version is in git. Check out the earlier commit, rebuild, redeploy.
Data is separate from code, so a rollback never changes member data.

## Importing from ClubExpress

Use the ClubExpress **Additional Member Data** report CSV. Open **Import**, choose the file.

- The file is parsed in your browser. UTF-8 and Windows-1252 are both handled; quoted fields,
  embedded commas/newlines, ragged rows and blank values are fine.
- **Preview** shows how columns were matched (you can re-map any column; First and Last Name
  are required) and, before anything is saved: **added / updated / unchanged / rejected**
  counts, records flagged for review, and current members missing from the file.
- **Full snapshot vs partial.** Choose *Full snapshot* when the file is the whole club (the
  default if it has ≥80% of the current roster). A full import replaces the roster and is saved
  as a dated point used by history reports. *Partial update* merges only the members in the
  file and is never used for totals over time. **A member missing from a full file is not
  treated as resigned or expired** — it is only reported as "not in this file".
- **Matching.** A person is matched on ClubExpress `member_number` (the stable id). Two people can
  share one number in real exports (seen for spouses); they are kept as separate people and
  flagged. A row with no number is matched on name + ZIP and flagged. An exact repeat of
  another row is rejected as a duplicate. Re-importing the same file changes nothing.
- **Rejected rows** (no name, duplicates) are listed with reasons and can be downloaded as CSV,
  during the preview and afterwards (`Import history`).
- **Not stored:** `login_name`, `date_of_birth`, `spouse_birthday`, `anniversary`, `gender`,
  `pronoun_name` are dropped at import. The original text of the other columns is kept under
  each member's "All columns from the import". ZIP codes and member numbers stay text
  (`007` stays `007`; a 4-digit ZIP gets its leading zero back and is flagged).
- Membership types that lost a dash in the export (`ETCC Only � Couple`) are normalized to
  `ETCC Only - Couple` for grouping; the original is kept.

### Field mapping (ClubExpress column → meaning)

| Column | Used as |
| --- | --- |
| `member_number` | person id |
| `primary_member_number` | household id (a couple shares one) |
| `member_level` | 1 = primary member, 2 = spouse/partner |
| `last_name`, `first_name`, `middle_initial`, `spouse_*` | names |
| `membership_type` | type (Couple, Single, Role, …) |
| `status` | status (the sample export contains only `Active`) |
| `date_joined` | join date |
| `expiration_date`, `last_renewal_date`, `automatic_renewal_opt_in` | renewal data |
| `address1/2`, `city`, `state`, `zip`, `country_name` | geography |
| `primary_email`, `phone`, `cell_phone` | contact |
| `Corvette Year/Model/Color` | vehicle (only present for some members) |

## What the numbers mean

**Units — never mixed in one number.** *People* = one record per person (a couple is 2).
*Households* = **single members + (couple members ÷ 2)**: every non-couple type counts 1, a Couple membership counts 1 for its two people (each person is half). A couple with only one record in the export therefore shows as .5. Every count card shows **members/households** (for example 361/217); charts and report tables say which unit they use. There is no People/Households switch.

**Dates and time.** All dates are `YYYY-MM-DD` in **America/New_York**; ranges include both end dates.
*Rolling* periods end today (last month = the day after one month ago through today).
*Completed calendar* periods are whole months ending on the last day of last month.
"Since 1958" means *all records available*, from 1958-01-01 to today.

| Measure | Definition |
| --- | --- |
| Active members | Roster records whose Status is Active (role accounts excluded) |
| Role accounts | `membership_type = Role` — officer positions, not members; excluded unless ticked |
| New members in a period | Roster records whose join date is in the period (bulk-load dates excluded, below) |
| Change / % change | This period minus the comparison period; % is shown as "n/a" when the comparison was 0 |
| Comparison periods | The immediately preceding period of equal length, and the same dates one year earlier |
| In records since 1958 | Roster records that have a join date. **Not** a complete club history |
| Tenure | Whole years from join date to today, in buckets |
| Renewal due | Expiration date within 30/60/90 days. "Active but past expiration" = Active with an expiration date already passed. Expiry more than 5 years out = no expiry |
| Members over time | Active people (or households) in each saved **full** import — nothing else |
| Retention / new / not in newer file / returned | Computed between consecutive full imports by person key |

### Historical limits — read this before quoting a trend

- **A current export cannot tell you past membership.** Counting today's members by join year only
  shows when *surviving* members joined; it misses everyone who left, so it is **not** "members
  in that year". The Reports tab therefore shows join-date reports as *new members who are
  still in the roster*, and totals over time **only** from saved dated imports.
- **Bulk-load join dates.** In the sample export 146 members share the join date 12/21/2022 —
  almost certainly when records were loaded into ClubExpress, not when people joined. Any date
  shared by many members (≥15 and ≥5% of dated members) is excluded from new-member counts and
  tenure and shown in its own "tenure unknown" bucket. Join dates before that load are mostly
  missing, so "since 1958" history is thin (one 1958 record in the sample).
- **Snapshots start now.** Each full import adds a point. Until a second full import exists there is
  no trend line, only a message saying so. Gaps between imports are shown as gaps.
- **Lapses, rejoins, households.** A member who disappears from a later full export is reported as
  "not in newer file" (could be a lapse, resignation or data issue; the site does not guess). A
  member who reappears is "returned". Households are counted by primary member number; a person
  who leaves a household appears under their own number.
- **Missing dates** are listed under *Missing or inconsistent data* and left out of date-based counts.
- Demographic reports (gender, age) are intentionally not provided: those columns are dropped at import.

## Privacy and security summary

- Login gate on every page; the roster is only ever sent to a logged-in session. Import and download
  endpoints check the session and (for writes) a CSRF token. CSV exports neutralize spreadsheet
  formulas (`=`, `+`, `-`, `@`). All member text is rendered with `textContent`.
- No raw CSV is stored on the server; no member data is in the repo, fixtures, logs, or the built bundle.
- Nothing is sent to third parties; the page loads no external scripts, fonts or images.




## The dashboard (kept deliberately simple)

Five cards — **Membership**, **New last month** (its subtext gives 3 months and 1 year), **Renewed**, **Left to renew**, **Expired** — a one-line
last-import note, an "About these numbers" box, and up to four collapsed chart cards (new by month, households by type, new households by month,
total membership over time; fewer under Show: Members or Households). The dashboard always covers the whole club (roles excluded) and has no
filters; filter by status, type or place on **Reports** and **Members**. More breakdowns (status, type, tenure, geography, renewals, data quality)
are under Reports. Expand all / Collapse all appear only on pages with five or more sections.

## Collapsed sections

Pages open with their sections **collapsed** — except the **dashboard, which opens expanded** — covering each report and Monthly Meeting section, the Import history,
and the Developer panels. Click a section's heading or its ▸ / ▾ button to open it, or use **Expand all / Collapse all** at the top of the
page. What you open stays open while you work on that page (changing filters or the Show setting does not re-collapse it); switching pages or
reports collapses everything again. On the dashboard, clicking a chart card itself still opens its full page — only the ▸ button toggles it.
Count cards, the Members table and the full-page chart view are not collapsible. Printing always shows every section expanded.

## Table headers (sort / filter)

Every table with a header row uses the club's standard **TableKit** header (ported from CarShow / Silent Auction Manager):
a ▼ button on each column title opens *Sort A → Z*, *Sort Z → A*, *Clear Filter* and a checklist of that column's values
with *(Select All)*. Dates, numbers/money and text each sort correctly. A "Clear all column filters" button appears above
filtered tables. "Total" rows stay at the bottom and are re-summed for the rows left showing. This covers the Members
directory, every report's supporting table, the Monthly Meeting tables, the click-through member lists and the import
history. Code: `tkFillHeader` / `tkEnhance` in `App/src/app.js`. Exports (CSV) always contain the full table.

## Show: Members / Households / Both (site-wide)

The dropdown at the right of the tab bar applies to **every page**. *Both* (default) shows `members/households`, e.g. 361/217;
*Members* or *Households* shows just that number. It drives all cards, the dashboard charts (the household-only charts appear in
*Households* and *Both*), and every report chart and table (a column per kind shown). The choice is remembered in the browser.
Households = single members + couple members ÷ 2.

## Renewal cards (Renewed / Left to renew / Expired) and renewal dates

Based on the expiration date (the export's `last_renewal_date` is filled for only a few members, so it is not used).
The club's **renewal start and end dates** (month and day, repeating every year) are set in the **Developer menu → Renewal dates**
(defaults Oct 1 and Dec 31) and stored on the server (`data/settings.json`), so every browser sees the same dates. Memberships expire on
the **end** date; the window may wrap a year-end (e.g. Nov 15 to Jan 31). The **renewal target** is the end date one year after the most
recent window's end — e.g. with Oct 1 – Dec 31 it is 12/31/2027 from Oct 1 2026 until Sep 30 2027.
- **Renewed** — expires on or after the target (already renewed for the next cycle).
- **Left to renew** — still current (expires today or later) but before the target; its card also shows when the window closes or next opens.
- **Expired** — expiration date is before today (this replaces the older "Active but past expiration" card).
Role/lifetime accounts (expiring 5+ years out) are left out. The Reports → Renewals & expirations table has the same three groups.

## Total members / households over time (line charts)

The dashboard card **Total membership over time** (members and households as two lines under Show: Both, one line otherwise) opens a full
page with the eight periods (last month, 3/6 months, 1/2/5/10 years, since 1958), a supporting table and CSV/print. Two kinds of
points are drawn, and they are **not the same thing**:
- **Line — current members by recorded join date:** at each date, how many of *today's* active members had a join date on or
  before it. People who left are not in the export, so earlier points **understate** the club's real past totals, and a join date
  shared by many members (a data-load date such as 12/21/2022) appears as a **jump that is not real growth**. The last point is
  today's full roster and equals the Membership card. Households use single members + couple members ÷ 2.
- **Dots — saved imports (exact totals):** the true active members/households recorded at each full import. These are the only
  trustworthy past totals; one is added with each full import (a single dot until a second full import exists).

## Full-page charts (dashboard)

The dashboard cards **New members by month**, **Households by membership type** and **New households by month** are
clickable (⤢ full page). The full page has a **Period** picker — Last month, 3 months, 6 months, 1 year, 2 years,
5 years, 10 years, Since 1958 (rolling periods ending today, America/New_York) — plus CSV export, Print and a supporting
table that shows both members and households. Bars are weekly for a month, monthly up to 2 years, yearly for 5+ years and
since 1958 (leading empty years are skipped). Clicking a bar or table row lists the members behind it. *Households by
membership type* covers current active members who joined in the period; **Since 1958** is every current active member
(including those with bulk-load or missing join dates). Bulk-load join dates are left out of the new-member charts.

## Monthly Meeting tab

For the club's monthly meeting. A **meeting month** starts the **Wednesday after a month's first Tuesday** and ends
on the **next month's first Tuesday** (both days included; America/New_York) — e.g. Sep 2 – Oct 6, 2026, meeting Oct 6.
"Last month" is the latest period whose meeting day has arrived (on the meeting day itself that period is already
"last month"); the picker also offers "This month so far" (counts run through today) and the previous two years.
Tick which items to collect: **members who joined** (default: last month), summary counts (active members, households,
new members and households, change vs the previous month, expiring next month), **expirations** (next month, and those
that fell in the chosen month) and **anniversaries next month**. Export CSV and Print cover exactly what is ticked. Join
dates that are bulk-load dates are left out, as everywhere else.

## Developer menu and passwords

The hamburger menu has a **Developer** item protected by its own password (initial value supplied by the
owner; only its hash is in the code, and the menu warns until it is changed). Once unlocked (30 idle minutes)
you can **change the website login password**, **change the developer password** (current one required), and see a
**system check** (PHP version, data folder writable, roster/snapshot counts, password source, SMTP status).
Changing the website password signs out every other browser. Passwords are stored only as salted SHA-512 hashes
in `data/auth.json`, which overrides the hash in `secrets.php` once set. Five wrong developer passwords from one
address lock that menu for 15 minutes.

## Password recovery (both passwords lost)

There is deliberately **no hardcoded master password**: a fixed password in the code would give permanent access to
member data to anyone who ever saw it, however often the real passwords changed. `recover.php` instead accepts one
of two out-of-band proofs. Either way it replaces **both** passwords with new random ones, shows them once, and signs
everyone out; then log in and set your own in the Developer menu.

1. **Emailed link.** Open `https://etccapps.com/apps/membershipmanager/recover.php` and press *Email me a recovery
   link*. A one-time link (valid 30 minutes; only its SHA-256 hash is stored; a newer request replaces an older link)
   is sent to `$RECOVERY_EMAIL` from `secrets.php` (default `etccwebsite.webmanager@gmail.com`) — the recipient can
   never be typed into the page. At most one email per 15 minutes, from anyone. Needs the `$SMTP` block in
   `secrets.php` (see `secrets.example.php`: host, port 587/`tls` or 465/`ssl`, mailbox login, from address). With
   `host` empty it falls back to PHP `mail()`, which often works on shared hosting but may land in spam.
2. **FTP trigger.** Upload an **empty** file named `data/RESET-PASSWORDS` into the app folder by FTP, then open
   `recover.php` within 15 minutes and press the button. Works even with no email set up or a broken `secrets.php`.

Each trigger is single-use and is deleted when used. Trade-offs: whoever controls the recovery mailbox or FTP can
reset access (the same trust the site already places in them), and anyone can make the page send the club one
recovery email per 15 minutes (it does nothing unless the link is opened). `recover.php` performs no change on a
plain page view; only the confirm button (a POST) does.

## Backup and restore

- `/ETCCMMBackup` downloads `members-data.json`, `member-import-history.json` and the `data/`
  folder (snapshots, rejected-row files) over FTPS, plus a zip of the repo, to
  `Z:\Backup\websites\MM\Backup`.
- **Restore:** upload the files back to the app folder over FTPS (same names and folders). Snapshots are
  independent files, so restoring only the roster keeps history intact.

## Tests

`cd App && npm test` — CSV parsing, dates, mapping, validation, duplicates, repeated imports,
full/partial semantics, export safety, period boundaries, every metric, chart-vs-table totals,
snapshot movement. Fixtures are synthetic.
The PHP files (`lib.php`, `members-import.php`, `index.php`) are **not** covered by `npm test`; they were
checked by review only until PHP is installed and exercised on the server.

## Version number

The footer shows `vYYYY.MM.DD.NN`: the build date (America/New_York) and a two-digit counter that goes up on every build and restarts at
01 each day (remembered in `App/version.json`). `MEMBERSHIP_VERSION=2026.10.19.05 node build.js` forces a version for one build;
`MEMBERSHIP_NO_BUMP=1` builds without recording one (previews).
