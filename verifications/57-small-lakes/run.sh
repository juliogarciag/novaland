#!/usr/bin/env bash
# Runs every verification in this folder and writes proof into ./proof.
# Usage: bash verifications/<this folder>/run.sh   (from anywhere)
set -u
cd "$(dirname "$0")"
repo="$(cd ../.. && pwd -P)"
if [ ! -d node_modules ]; then
  pnpm install --ignore-workspace --frozen-lockfile
  npx playwright install chromium
fi
mkdir -p proof
status=0
echo
echo "=== sim tests ==="
# The headless proof: water blocks a player, the lakes are lakes, every walkable tile is still reached from the spawn.
(cd "$repo" && NO_COLOR=1 pnpm --filter @novaland/sim exec vitest run src/content/world src/features/terrain src/features/player --reporter=verbose 2>&1) | sed "s#$repo#<repo>#g" | grep -v "Duration\|Start at" | tee proof/sim-tests.txt
if [ "${PIPESTATUS[0]}" -ne 0 ]; then status=1; fi
for script in lakes; do
  echo
  echo "=== $script ==="
  # Console output is proof too: keep machine paths out of it, like writeProof does.
  node "$script.mjs" 2>&1 | sed "s#$repo#<repo>#g" | tee "proof/$script.txt"
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then status=1; fi
done
echo
if [ $status -eq 0 ]; then echo "ALL VERIFICATIONS PASSED"; else echo "SOME VERIFICATIONS FAILED"; fi
exit $status
