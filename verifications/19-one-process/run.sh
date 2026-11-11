#!/usr/bin/env bash
# Runs every verification for ticket #19 and writes proof into ./proof.
# Usage: bash verifications/19-one-process/run.sh   (from anywhere; needs Docker for 03)
set -u
cd "$(dirname "$0")"
repo="$(cd ../.. && pwd)"
if [ ! -d node_modules ]; then
  pnpm install --ignore-workspace --frozen-lockfile
  npx playwright install chromium
fi
mkdir -p proof
status=0
for script in 01-check 02-built-server 03-docker; do
  echo
  echo "=== $script ==="
  node "$script.mjs" 2>&1 | sed "s#$repo#<repo>#g" | tee "proof/$script.txt"
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then status=1; fi
done
echo
if [ $status -eq 0 ]; then echo "ALL VERIFICATIONS PASSED"; else echo "SOME VERIFICATIONS FAILED"; fi
exit $status
