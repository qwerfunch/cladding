#!/usr/bin/env bash
# Cladding · scripts/ab-abc/rescore.sh — score one already-run cell, twice, and
# record whether the two agreed.
#
# Scoring is pure: it reads a finished cell's artifacts and writes score.json.
# Nothing here spawns a host, so this is safe to re-run on a cell that has
# already been run — and that is the point, because the reproducibility claim
# has to end up INSIDE score.json:
#
#   1. score  → score.json, copied aside as score.first.json
#   2. score  → score.json again
#   3. diff the two, write scorer-reproducible.txt
#   4. score  → score.json a third time, so the file carries the answer from
#      step 3 in `extras.scorerReproducible` instead of the null it would hold
#      if the flag had been written after the last scoring run.
#
# Nothing else may write into the artifact directory between steps 1 and 2 — a
# log line landing there mid-sequence would show up as a difference and make the
# scorer look nondeterministic when only the harness moved.
#
# Usage: ABC_ROOT=~/abc-0100 bash scripts/ab-abc/rescore.sh <A|B|C> <cell-name>
set -euo pipefail

ARM="${1:?usage: rescore.sh <A|B|C> <cell-name>}"
CELL="${2:?usage: rescore.sh <A|B|C> <cell-name>}"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
ABC_REPO="${ABC_REPO:-/Users/qwerfunch/Developer/work/cladding}"

ARTIFACTS="$ABC_ROOT/artifacts/$ARM/$CELL"
[ -d "$ARTIFACTS" ] || { echo "no such cell artifacts: $ARTIFACTS" >&2; exit 1; }

score() { (cd "$ABC_REPO" && npx tsx "$ABC_HARNESS/score.ts" "$ARTIFACTS" > /dev/null); }

score
cp "$ARTIFACTS/score.json" "$ARTIFACTS/score.first.json"
score
if diff -q "$ARTIFACTS/score.first.json" "$ARTIFACTS/score.json" > /dev/null; then
  echo true > "$ARTIFACTS/scorer-reproducible.txt"
else
  echo false > "$ARTIFACTS/scorer-reproducible.txt"
fi
rm -f "$ARTIFACTS/score.first.json"
score

printf 'score.json written for %s/%s (scorer reproducible: %s)\n' \
  "$ARM" "$CELL" "$(cat "$ARTIFACTS/scorer-reproducible.txt")"
