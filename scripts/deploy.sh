#!/usr/bin/env bash
# Update the live checkout to origin/main and restart if needed.
# Run as the screenview user:
#   ./scripts/deploy.sh [expected-sha]
# DEPLOY_DIR is the live checkout the app runs from, not this script's checkout.
set -euo pipefail

EXPECTED_SHA="${1:-}"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/screenview/backdrop}"
cd "$DEPLOY_DIR"

git fetch --quiet origin main
before="$(git rev-parse HEAD)"
# First run switches the checkout off feature/implementation onto main.
git checkout --quiet main
git merge --quiet --ff-only origin/main
after="$(git rev-parse HEAD)"

if [ -n "$EXPECTED_SHA" ] && [ "$after" != "$EXPECTED_SHA" ]; then
  echo "Checkout is at $after but this run expected $EXPECTED_SHA (a newer push will deploy it)."
fi

if [ "$before" = "$after" ]; then
  echo "Already at $after, nothing to do."
  exit 0
fi

changed="$(git diff --name-only "$before" "$after")"
echo "Deploying $before -> $after"
echo "$changed" | sed 's/^/  /'

if echo "$changed" | grep -qxE 'package(-lock)?\.json'; then
  npm ci --omit=dev --no-audit --no-fund
fi

# Files under public/ are served from disk; anything else needs a restart.
# Only the server restarts: mpv keeps the screen up and the server reconnects.
if echo "$changed" | grep -qvE '^(public/|docs/|setup/|\.github/|README)'; then
  sudo -n systemctl restart screenview.service
  echo "Restarted screenview.service."
else
  echo "Only static files or docs changed, no restart needed."
fi
