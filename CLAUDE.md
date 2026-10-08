# ETCC Membership Manager

Membership roster + reports site for the East Tennessee Corvette Club, modeled on the
CarShow app (`Z:\Backup\websites\CarShow` on the owner's machine).

- UI source: `App/src/` (`logic.js` = pure helpers, `app.js` = DOM, `styles.css`).
  `node App/build.js` inlines them into `App/ETCCMembership.html` (gitignored).
- Server: `App/deploy/` (PHP). `index.php` injects `members-data.json` into the bundle
  per request; `members-import.php` writes it. See `App/deploy/README.md`.
- Tests: `cd App && npm test` (Node + PHP CLI). Fixtures use obviously fake names only.
- Never commit `secrets.php`, `.ftp-credentials`, or any member data JSON (real PII).
