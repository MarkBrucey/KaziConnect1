#!/usr/bin/env sh
# Kazi Connect on macOS and Linux: install, build, check, start. The same three steps as start_lab.bat.
# Run it from the folder it is in:  sh run.sh        (stop the server with Ctrl+C)
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install the LTS version from https://nodejs.org, then run this again."
  exit 1
fi
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 9) ? 0 : 1)'; then
  echo "Node.js $(node -v) is too old: Kazi Connect needs 20.9 or newer (the LTS version from https://nodejs.org)."
  exit 1
fi
if [ ! -f package.json ]; then
  echo "package.json is missing. Run this from the folder that contains it."
  exit 1
fi

echo "Step 1 of 3: installing packages and building the app..."
npm ci || { echo "npm ci failed. If the message mentions ETIMEDOUT or CERT, connect to your phone hotspot and run this again."; exit 1; }
npm run build

echo
echo "Step 2 of 3: checking every endpoint against openapi.yaml, with good and bad input..."
npm run verify

echo
echo "Step 3 of 3: starting the server. Swagger UI is at http://localhost:${PORT:-3000}/docs"
echo "Keep this window open while you work. Press Ctrl+C to stop the server."
exec npm start
