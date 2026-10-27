#!/usr/bin/env bash
# Update the live checkout to origin/main and restart if needed.
# Run as the screenview user:
#   ./scripts/deploy.sh [expected-sha]
# DEPLOY_DIR is the live checkout PM2 runs from, not this script's checkout.
set -euo pipefail

export PM2_HOME="${PM2_HOME:-/opt/screenview/.pm2}"
APP_NAME="${APP_NAME:-screenview}"
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
  # Dev dependencies stay installed: the start scripts run concurrently.
  npm ci --no-audit --no-fund
fi

# Files under public/ are served from disk; anything else needs a restart.
if echo "$changed" | grep -qvE '^(public/|docs/|setup/|\.github/|README)'; then
  pm2 restart "$APP_NAME"
  echo "Restarted $APP_NAME."
else
  echo "Only static files or docs changed, no restart needed."
fi
