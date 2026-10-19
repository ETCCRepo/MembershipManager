# ETCC Membership Manager

Membership dashboard + reports site for the East Tennessee Corvette Club, modeled on the
CarShow app (`Z:\Backup\websites\CarShow` on the owner's machine). Live at
https://etccapps.com/apps/membershipmanager/ (Hostinger, plain PHP, FTP deploy).

- UI source: `App/src/` — `csvimport.js` (CSV parse/map/validate/diff), `reports.js` (every metric),
  `charts.js` (SVG charts), `logic.js` (directory helpers), `app.js` (DOM), `styles.css`.
  `node App/build.js` inlines them into `App/ETCCMembership.html` (gitignored).
- Server: `App/deploy/` (PHP). `index.php` injects data into the bundle per request;
  `members-import.php` is the JSON import API. See `App/deploy/README.md` (metric definitions,
  historical limits, deployment, backup).
- Tests: `cd App && npm test` (Node only). Fixtures are synthetic; regenerate with `node test/make-fixture.js`.
- Never commit `secrets.php`, `.ftp-credentials`, `App/deploy/data/`, or any member data JSON / real
  ClubExpress export (real PII). Do not push or deploy without the owner's explicit say-so.
- Metric rule: never present current members grouped by join date as historical membership;
  totals over time come only from saved full-import snapshots. Keep people vs households separate.
