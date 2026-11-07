#!/usr/bin/env bash
# Runs every verification for ticket #1 and writes proof into ./proof.
# Usage: bash verifications/1-bootstrap-monorepo/run.sh   (from anywhere)
set -u
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  pnpm install --ignore-workspace --frozen-lockfile
  npx playwright install chromium
fi
status=0
for script in 01-check 02-boundaries 03-headless 04-ports 05-browser 06-agents-md; do
  echo
  echo "=== $script ==="
  node "$script.mjs" 2>&1 | tee "proof/$script.txt"
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then status=1; fi
done
echo
if [ $status -eq 0 ]; then echo "ALL VERIFICATIONS PASSED"; else echo "SOME VERIFICATIONS FAILED"; fi
exit $status
