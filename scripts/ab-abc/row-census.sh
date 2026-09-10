#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-census.sh — an unsafe evidence census (S-D6)
#
# Every claim the gate makes about human evidence rests on being able to read
# ALL of spec/evidence. If one entry there cannot be read safely — a symbolic
# link is the obvious case, pointing anywhere on the machine — then the honest
# answer is not "no receipts" and not "receipts fine", but "this could not be
# checked". Silently treating an unreadable census as an empty one would turn a
# planted link into a way of hiding evidence.
#
# The row runs the push profile twice on the same completed workspace: once as
# built, once with a link planted under spec/evidence. The second run must stop
# being green, must say the verification could not be checked, and must name the
# remedy.
#
# Called by sidetable.ts as: bash row-census.sh <arm> <cwd> <artifact-dir>
set -uo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"

if [ "$ARM" != "C" ]; then
  echo "not applicable: the receipt census is a 0.2 surface"
  exit 0
fi

export PATH="$ABC_ROOT/prefix-C/bin:$PATH"
export CLADDING_KEYS_DIR="$OUT/keys"
echo "engine: $(command -v clad) $(clad --version)"

FEATURE="$(basename "$(find "$CWD/spec/features" -name '*.yaml' | head -1)" .yaml)"
echo "workspace feature shard: $FEATURE"

( cd "$CWD" && clad check --profile push --strict --json ) > "$OUT/census-before.json" 2> "$OUT/census.log"
echo "push profile before the planted link: exit $?"
node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(`before: profile_complete ${report.profile_complete}; incomplete addresses ${JSON.stringify(report.incomplete_addresses ?? [])}\n`);
' "$OUT/census-before.json" || true

# The plant: a link where a receipt file belongs. Nothing else changes.
TARGET="$CWD/spec/evidence/F-planted"
mkdir -p "$TARGET"
ln -s /etc/hosts "$TARGET/0000000000000000000000000000000000000000000000000000000000000000.yaml"
echo "planted: spec/evidence/F-planted/<digest>.yaml is a symbolic link to /etc/hosts"

( cd "$CWD" && clad check --profile push --strict --json ) > "$OUT/census-after.json" 2>> "$OUT/census.log"
AFTER=$?
echo "push profile with the planted link: exit $AFTER"
node -e '
  const fs = require("node:fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bad = (report.obligations ?? []).filter((o) => o.state !== "pass" && o.state !== "na");
  process.stdout.write(`after: profile_complete ${report.profile_complete}; incomplete addresses ${JSON.stringify(report.incomplete_addresses ?? [])}\n`);
  process.stdout.write(`after: unresolved obligations ${bad.map((o) => `${o.obligation}/${o.state}`).join(", ") || "(none)"}\n`);
' "$OUT/census-after.json" || true

# The text a human reads is half the point: a census that fails silently is the
# thing this row exists to rule out.
( cd "$CWD" && clad check --tier=pre-push --strict ) > "$OUT/census-after.txt" 2>&1
echo "strict pre-push text form exit: $?"
if grep -qF "could not be checked" "$OUT/census-after.txt"; then
  echo "warning text present: verification could not be checked"
  # The terminal form truncates the sentence, so the remedy is read from the
  # machine-readable report rather than from the elided console line.
  node -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const messages = (report.stages ?? [])
      .flatMap((stage) => stage.findings ?? [])
      .map((finding) => `${finding.message ?? ""} ${finding.suggestion ?? ""}`)
      .filter((text) => text.includes("could not be checked"));
    process.stdout.write(messages.length === 0
      ? "no census finding in the JSON report\n"
      : `census finding: ${messages[0].replace(/\s+/g, " ").trim()}\n`);
  ' "$OUT/census-after.json" || true
else
  echo "NO 'could not be checked' warning in the strict pre-push output"
  tail -c 400 "$OUT/census-after.txt"
fi
