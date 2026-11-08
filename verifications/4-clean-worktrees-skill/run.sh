#!/usr/bin/env bash
# Runs every verification for ticket #4 and writes proof into ./proof.
# Usage: bash verifications/4-clean-worktrees-skill/run.sh   (from anywhere)
set -u
cd "$(dirname "$0")"
status=0
for script in 01-fixture 02-live; do
  echo
  echo "=== $script ==="
  node "$script.mjs" 2>&1
  if [ "$?" -ne 0 ]; then status=1; fi
done
echo
if [ $status -eq 0 ]; then echo "ALL VERIFICATIONS PASSED"; else echo "SOME VERIFICATIONS FAILED"; fi
exit $status
