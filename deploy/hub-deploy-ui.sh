#!/usr/bin/env bash
#
# Deploy the OpenSprinkler UI bundle to the home-hub Caddy site, from git.
# Run ON the hub (e.g. `ssh pi`):
#
#     ~/OpenSprinkler-App/deploy/hub-deploy-ui.sh
#
# One-time setup on the hub:
#     git clone https://github.com/LuisMMMTS/OpenSprinkler-App.git ~/OpenSprinkler-App
#
# Every controller points its "jsp" option at this one hosted bundle, so this is
# the only place the UI is deployed. Idempotent: re-run to ship a new commit.
#
set -euo pipefail

REPO="${REPO:-$HOME/OpenSprinkler-App}"
SITE="${SITE:-$HOME/home_network/caddy/site}"   # bind-mounted into the caddy container
BRANCH="${1:-fertigation-2.2.1-5}"

echo ">> Updating $REPO to origin/$BRANCH"
git -C "$REPO" fetch origin
git -C "$REPO" checkout "$BRANCH"
git -C "$REPO" pull --ff-only

# Refresh the served bundle in place. Keep the directory's own inode because
# Caddy bind-mounts this path; replacing the directory would detach the mount.
echo ">> Publishing www/ -> $SITE"
find "$SITE" -mindepth 1 -delete
cp -a "$REPO/www/." "$SITE/"

# js/home.js bootstraps by fetching modules.json (a JSON list of the module
# filenames) and loading each one. It is generated, not committed -- without it
# the app dies at home.js with "Unexpected end of JSON input" and a blank page.
echo ">> Generating modules.json"
( cd "$SITE/js/modules" && ls *.js | sort ) \
  | python3 -c 'import sys, json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()], indent=2))' \
  > "$SITE/modules.json"

# Stamp the service-worker cache version so https/PWA clients drop their old
# cache and pick up this build. (The plain-http LAN URL registers no service
# worker at all -- not a secure context -- and stays fresh via Caddy's
# Cache-Control: no-cache on *.js/*.css. This keeps every context consistent.)
SHA="$(git -C "$REPO" rev-parse --short HEAD)"
sed -i "s|OpenSprinkler-v[0-9A-Za-z.]*|OpenSprinkler-v${SHA}|" "$SITE/sw.js"

echo ">> Deployed UI ${SHA} to ${SITE}"
