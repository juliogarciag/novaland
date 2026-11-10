#!/usr/bin/env bash
# Runs every verification for ticket #22 and writes proof into ./proof.
# Usage: bash verifications/22-idle-seats/run.sh   (from anywhere)
set -u
cd "$(dirname "$0")"
repo="$(cd ../.. && pwd)"
if [ ! -d node_modules ]; then
  pnpm install --ignore-workspace --frozen-lockfile
  npx playwright install chromium
fi
mkdir -p proof
status=0
for script in 01-check 02-idle-kick 03-browser; do
  echo
  echo "=== $script ==="
  # Console output is proof too: keep machine paths out of it, like writeProof does.
  node "$script.mjs" 2>&1 | sed "s#$repo#<repo>#g" | tee "proof/$script.txt"
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then status=1; fi
done
echo
if [ $status -eq 0 ]; then echo "ALL VERIFICATIONS PASSED"; else echo "SOME VERIFICATIONS FAILED"; fi
exit $status
