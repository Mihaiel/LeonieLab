#!/usr/bin/env bash
#
# Pulls the latest commits, regenerates public/resources/build.json with
# the current commit hash and commit date, then restarts the nginx
# container so the new site is served.
#
# Usage (on the server):
#   ./deploy.sh              # pull + build + restart
#   ./deploy.sh --no-pull    # skip git pull (regenerate build info only)
#
set -euo pipefail

cd "$(dirname "$0")"

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

# Pull unless the caller explicitly opted out
PULL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    *)         echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

if [ "$PULL" = "1" ]; then
  echo "pulling latest commits..."
  git pull --ff-only
  echo
fi

HASH=$(git rev-parse --short HEAD)
DATE=$(git log -1 --format=%cI HEAD)   # ISO 8601 with timezone

mkdir -p public/resources
cat > public/resources/build.json <<EOF
{"hash":"${HASH}","date":"${DATE}"}
EOF

echo "wrote public/resources/build.json:"
cat public/resources/build.json
echo

if command -v docker > /dev/null 2>&1; then
  echo "restarting nginx container..."
  docker compose up -d --remove-orphans
else
  echo "docker not found — skipping container restart"
fi
