#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-receipt-stale.sh — a receipt goes stale, and heals (S-D3)
#
# A human receipt says a person reviewed something. If the something then
# changes, the receipt is a statement about code that no longer exists — so it
# must stop counting until somebody signs again. This row is the regression guard
# for that: it replays the full L4 cycle through row-l4.sh, edits the module the
# completed feature declares, commits the edit so nothing but the content differs,
# and asks the push profile whether the audit obligation is still satisfied.
#
# Expected shape: green, then exit 1 with the audit obligation `unobserved:stale`,
# then green again once every criterion carries a fresh receipt. A row that stays
# green across the edit would mean a receipt outlives the thing it reviewed.
#
# Called by sidetable.ts as: bash row-receipt-stale.sh <arm> <cwd> <artifact-dir>
set -uo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORD="$ABC_ROOT/sidetable/inprogress"

if [ "$ARM" != "C" ]; then
  echo "not applicable: signed receipts and their staleness are a 0.2 surface"
  exit 0
fi
if ! command -v expect > /dev/null; then
  echo "not run: expect is not installed, and the signing prompts are interactive"
  exit 3
fi

export PATH="$ABC_ROOT/prefix-C/bin:$PATH"

# 1 — the completed, signed L4 cycle, replayed by the row that owns that recipe.
# Same artifact directory on purpose: the issuer key and the signing script it
# writes are what this row re-signs with.
unset ABC_L4_POLICY ABC_L4_ISSUER
bash "$HARNESS/row-l4.sh" C "$CWD" "$OUT" > "$OUT/stale-l4.log" 2>&1
L4=$?
echo "L4 replay exit: $L4"
grep -E '^(completion exit|strict pre-push AFTER completion)' "$OUT/stale-l4.log" || true
if [ "$L4" -ne 0 ]; then
  echo "the L4 replay did not complete — nothing to make stale"
  tail -c 600 "$OUT/stale-l4.log"
  exit 3
fi

FEATURE="$(cat "$RECORD/C.feature")"
export CLADDING_KEYS_DIR="$OUT/keys"

( cd "$CWD" && git add -A && git commit -qm "cycle: complete $FEATURE" ) >> "$OUT/stale.log" 2>&1
( cd "$CWD" && clad check --profile push --strict --json ) > "$OUT/stale-before.json" 2>> "$OUT/stale.log"
echo "push profile BEFORE the edit: exit $?"

# 2 — change the module the feature declares, and commit it: the only difference
# from the signed state is the content a reviewer would have to look at again.
perl -pi -e 's{joins the remaining words with hyphens\.}{joins the remaining words with hyphens. Leading and trailing separators are trimmed.}' "$CWD/src/slugify.ts"
if ! grep -qF "Leading and trailing separators are trimmed." "$CWD/src/slugify.ts"; then
  echo "FAIL: the module edit did not land — the row would measure nothing"
  exit 2
fi
( cd "$CWD" && git add -A && git commit -qm "edit the signed module" ) >> "$OUT/stale.log" 2>&1
echo "edited and committed src/slugify.ts (the module the completed feature declares)"

( cd "$CWD" && clad check --profile push --strict --json ) > "$OUT/stale-after-edit.json" 2>> "$OUT/stale.log"
AFTER_EDIT=$?
echo "push profile AFTER the edit: exit $AFTER_EDIT"
node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bad = (report.obligations ?? []).filter((o) => o.state !== "pass" && o.state !== "na");
  process.stdout.write(bad.length === 0
    ? "no obligation went unobserved after the edit\n"
    : `unsatisfied obligations after the edit: ${bad.map((o) => `${o.obligation}/${o.state}${o.reason ? `(${o.reason})` : ""}`).join(", ")}\n`);
' "$OUT/stale-after-edit.json" || true

# 3 — sign again, which is the whole remedy: a fresh receipt over the code as it
# now stands.
while read -r CRITERION; do
  [ -n "$CRITERION" ] || continue
  expect "$OUT/sign.exp" audit "$FEATURE" "$CWD" "$(cd "$CWD" && git config user.name)" "$CRITERION" >> "$OUT/stale.log" 2>&1
  echo "re-signed audit: $CRITERION"
done < "$RECORD/C.criteria"

# The UAT claim goes stale with the same edit and is feature-scoped, so it is
# re-signed too — the audit matrix alone does not heal the gate.
expect "$OUT/sign.exp" uat "$FEATURE" "$CWD" "$(cd "$CWD" && git config user.name)" "" >> "$OUT/stale.log" 2>&1
echo "re-signed uat: feature-scoped"

( cd "$CWD" && git add -A && git commit -qm "re-sign the audit receipts" ) >> "$OUT/stale.log" 2>&1
( cd "$CWD" && clad check --profile push --strict --json ) > "$OUT/stale-after-resign.json" 2>> "$OUT/stale.log"
AFTER_RESIGN=$?
echo "push profile AFTER re-signing: exit $AFTER_RESIGN"
node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bad = (report.obligations ?? []).filter((o) => o.state !== "pass" && o.state !== "na");
  process.stdout.write(bad.length === 0
    ? "every obligation passes again\n"
    : `still unobserved: ${bad.map((o) => `${o.obligation}/${o.state}${o.reason ? `(${o.reason})` : ""}`).join(", ")}\n`);
' "$OUT/stale-after-resign.json" || true
