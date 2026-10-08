#!/usr/bin/env bash
# Uploads the deploy/ folder's server files (CODE, not DATA) over FTPS —
# adapted from the CarShow app's deploy/ftp-deploy.sh. Run `node build.js`
# first so App/ETCCMembership.html is current; this script uploads it as
# app-bundle.html, the template index.php stitches live member data into on
# every request. It never touches members-data.json or the import log, which
# live only on the server, and never uploads secrets.php (upload that once by
# hand — see README.md).
#
# Credentials: set FTP_HOST/FTP_USER/FTP_PASS as env vars, or create
# deploy/.ftp-credentials (gitignored — copy .ftp-credentials.example). Env
# vars take precedence. The FTP account's home directory is expected to be
# the target folder. Uses -k (no certificate hostname check) for the same
# reason as CarShow: Hostinger custom FTP hostnames fail that check; the
# channel is still encrypted. Only run this against a host you trust.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CRED_FILE="$DIR/.ftp-credentials"
if [ -z "${FTP_HOST:-}" ] && [ -f "$CRED_FILE" ]; then
  # `|| [ -n "$key" ]` keeps the loop's last iteration even if the file has no
  # trailing newline (read exits nonzero on that final line but still
  # populates $key/$value — without this, the last KEY=VALUE line is silently
  # dropped). Stripping a trailing \r handles files saved with Windows line
  # endings (Notepad etc.), which would otherwise leave it stuck on the value.
  while IFS='=' read -r key value || [ -n "$key" ]; do
    key="${key%$'\r'}"
    value="${value%$'\r'}"
    case "$key" in
      FTP_HOST) FTP_HOST="$value" ;;
      FTP_USER) FTP_USER="$value" ;;
      FTP_PASS) FTP_PASS="$value" ;;
    esac
  done < "$CRED_FILE"
fi

: "${FTP_HOST:?Set FTP_HOST (env var, or create deploy/.ftp-credentials from the .example file)}"
: "${FTP_USER:?Set FTP_USER (env var, or create deploy/.ftp-credentials from the .example file)}"
: "${FTP_PASS:?Set FTP_PASS (env var, or create deploy/.ftp-credentials from the .example file)}"
BASE="ftp://${FTP_HOST}"
NETRC="$(mktemp)"
trap 'rm -f "$NETRC"' EXIT

cat > "$NETRC" <<EOF
machine ${FTP_HOST}
login ${FTP_USER}
password ${FTP_PASS}
EOF

if [ ! -f "$DIR/../ETCCMembership.html" ]; then
  echo "App/ETCCMembership.html not found — run 'node build.js' first." >&2
  exit 1
fi

# FTPS over Windows' schannel TLS stack has a history of dropping mid-transfer
# on this host (see the file header comment) — manifesting as curl exit 28
# (timeout), 55 (connection reset), or a server-side 550 (exit 25). The 550
# case has a specific known cause here: the server (ProFTPd) uses
# "HiddenStores" — it writes an upload to ".in.<filename>." first and only
# renames it to the real filename on success. If a transfer gets dropped
# mid-upload, that hidden temp file is left behind and blocks every further
# attempt to upload the same filename with a 550. On a 550 we delete ONLY
# that hidden temp file (never the real target — deleting the live file
# would leave the site broken if a retry then also failed) before retrying.
upload() {
  local remoteName="$1" localPath="${2:-$DIR/$1}"
  local attempt rc
  for attempt in 1 2 3; do
    echo "--- Uploading $remoteName (attempt $attempt) ---"
    rc=0
    curl -sS --netrc-file "$NETRC" --ftp-ssl -k --ftp-pasv -T "$localPath" "$BASE/$remoteName" -m 120 || rc=$?
    if [ $rc -eq 0 ]; then return 0; fi
    echo "    upload failed (curl exit $rc)" >&2
    if [ $rc -eq 25 ] && [ $attempt -lt 3 ]; then
      echo "    deleting stale hidden temp file .in.$remoteName. before retrying" >&2
      curl -sS --netrc-file "$NETRC" --ftp-ssl -k -Q "-DELE .in.$remoteName." "$BASE/" -m 30 -o /dev/null 2>&1 || true
    fi
    if [ $attempt -lt 3 ]; then sleep 5; fi
  done
  echo "    giving up on $remoteName after 3 attempts" >&2
  return $rc
}

upload "app-bundle.html" "$DIR/../ETCCMembership.html"
upload "_login.html"
upload "index.php"
upload "lib.php"
upload "members-import.php"
upload "logout.php"
upload "ETCClogoWhiteBackground.png" "$DIR/../assets/ETCClogoWhiteBackground.png"
upload ".htaccess"

echo "--- Final listing ---"
curl -sS --netrc-file "$NETRC" --ftp-ssl -k --ftp-pasv "$BASE/" -m 20
