#!/usr/bin/env bash
# Runs every verification for ticket #8 and writes proof into ./proof.
# Usage: bash verifications/8-pixel-perfect-camera/run.sh   (from anywhere)
set -u
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  pnpm install --ignore-workspace --frozen-lockfile
  npx playwright install chromium
fi
status=0
for script in 01-check 02-camera; do
  echo
  echo "=== $script ==="
  node "$script.mjs" 2>&1 | tee "proof/$script.txt"
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then status=1; fi
done

# The ticket says existing checks still pass: ticket #1's browser check walks the
# (now bigger) level with the new camera. Its own proof folder is refreshed too.
echo
echo "=== 03-existing-browser (verifications/1-bootstrap-monorepo/05-browser.mjs) ==="
(
  cd ../1-bootstrap-monorepo
  if [ ! -d node_modules ]; then
    pnpm install --ignore-workspace --frozen-lockfile
    npx playwright install chromium
  fi
  node 05-browser.mjs
) 2>&1 | tee proof/03-existing-browser.txt
if [ "${PIPESTATUS[0]}" -ne 0 ]; then status=1; fi

echo
if [ $status -eq 0 ]; then echo "ALL VERIFICATIONS PASSED"; else echo "SOME VERIFICATIONS FAILED"; fi
exit $status
