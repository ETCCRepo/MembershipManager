# ETCC Membership Manager — deployment

Built the same way as the CarShow app (`Z:\Backup\websites\CarShow`): one
self-contained HTML bundle for the UI, and a few PHP files that gate it behind a
password and stitch the live member data into it on every page load.

## CODE vs DATA

- **CODE** (`App/src/*` → `node App/build.js` → `App/ETCCMembership.html`) is
  uploaded as `app-bundle.html` by `deploy/ftp-deploy.sh`. It contains no member data.
- **DATA** (`members-data.json`, `member-import-history.json`) lives only on the
  server, written by `members-import.php`. Deploys never touch it, and a new import is
  visible on the next page load with no rebuild.

## Server files

- `index.php` — serves `_login.html` until the session is logged in, then serves
  `app-bundle.html` with the current roster and import log injected
  (`window.__membership.ingestMembers(...)` / `.ingestImportLog(...)`).
- `members-import.php` — logged-in only. Upload the membership CSV export; it
  **replaces** the stored roster and appends an entry to the import log.
- `lib.php` — JSON read/write helpers and the CSV parser (`membership_parse_csv`).
- `logout.php` — ends the session and returns to the login screen.
- `.htaccess` — denies direct access to every `.json` file, `app-bundle.html`,
  `_login.html`, `lib.php` and `secrets.php`.
- `secrets.php` — **not committed, not uploaded by the deploy script.** Copy
  `secrets.example.php`, set `$PASSWORD_HASH`
  (`openssl passwd -6 -salt "$(openssl rand -hex 8)" 'the-password'`), and upload it
  once by hand.

## Membership CSV format

Header names are matched ignoring case, spaces, underscores, hyphens and periods
(`Last Name`, `last_name`, `LastName` all work). Only **First Name** and **Last Name**
are required.

| Field | Accepted headers (normalized) |
| --- | --- |
| Member Number | Member Number, Member No, Member #, Member ID, ID |
| First / Last Name | First Name, Last Name |
| Spouse | Spouse First Name, Spouse, Spouse Name |
| Contact | Email, Phone, Address, City, State, Zip (also `primary_` prefixed) |
| Membership Type | Membership Type, Member Type, Membership Level, Level |
| Status | Status, Member Status, Membership Status |
| **Join Date** | Join Date, Date Joined, Joined, Member Since, Original Join Date, Start Date |
| Expiration Date | Expiration Date, Expires, Renewal Date |
| Corvette | Year / Corvette Year, Model / Corvette Model, Color / Corvette Color |

Dates may be `2025-01-15`, `1/15/2025`, `1/15/25` or `Jan 15, 2025`. **Join Date**
drives the Monthly Membership Report; members without one are counted but not listed
there. Every other column in the file is kept as-is and shown in the member's details.

## Deploying

1. `cd App && node build.js`
2. `deploy/ftp-deploy.sh` (needs `FTP_HOST`/`FTP_USER`/`FTP_PASS` or
   `deploy/.ftp-credentials`; the FTP account's home should be the app's folder).
3. First deploy only: upload `secrets.php` by hand, then log in and import the
   membership CSV via the menu's **Import Members**.

Live location: **https://etccapps.com/apps/membershipmanager/**. Every link and
form in the app is relative (`index.php`, `members-import.php`, `logout.php`, the
logo), so it runs unchanged from that subdirectory. On the CarShow app the `/apps/`
URL prefix is a server Alias onto the FTP account's own folder (for CarShow,
`public_html/carshow`), so the FTP account used here should point at this app's own folder.

## Local testing

`cd App && npm test` runs the parser and report tests (needs `node` and `php`).
To click through it locally: build to `app-bundle.html` in a scratch folder, copy
the `deploy/` files and a test `secrets.php` next to it, and run `php -S 127.0.0.1:8765`
there.
