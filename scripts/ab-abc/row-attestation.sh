#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-attestation.sh — the sealed record of a passing gate (S-C2)
#
# Every passing gate writes down what it verified. The row reads that file on
# both engines and asks two things: what shape it has — how much of it is a
# digest of the observations rather than the observations themselves, and whether
# it names the engine that wrote it — and whether it changes when the gate is run
# again on an unchanged tree. The second is the part a user feels: a file that
# rewrites itself on every green run is a file they have to commit alongside
# their change, and the release notes say so.
#
# The path is discovered rather than assumed: the newer layout may keep the file
# under the generated folder, and a hard-coded path would quietly measure nothing.
#
# Called by sidetable.ts as: bash row-attestation.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ ! -x "$PREFIX/bin/clad" ]; then
  echo "no engine at $PREFIX/bin/clad — the row cannot run"
  exit 3
fi
export PATH="$PREFIX/bin:$PATH"
cd "$CWD"
echo "engine: $(command -v clad) $(clad --version)"

find_attestation() {
  find spec -name 'attestation*.yaml' -o -name 'attestation*.yml' 2>/dev/null | head -1
}

set +e
clad check --tier=pre-push --json > "$OUT/prepush-1-$ARM.json" 2>"$OUT/prepush-1-$ARM.err"
FIRST=$?
set -e
echo "first pre-push exit: $FIRST"

FILE="$(find_attestation || true)"
if [ -z "$FILE" ]; then
  echo "attestation file: (none found under spec/)"
  echo "spec tree: $(find spec -maxdepth 2 -type f | tr '\n' ' ' | head -c 400)"
  exit 0
fi
echo "attestation file: $FILE"
echo "attestation bytes: $(wc -c < "$FILE" | tr -d ' ')"
cp "$FILE" "$OUT/attestation-first-$ARM.yaml"

# A completed feature's row is one JSON object on a single line, so the shape is
# read by parsing it rather than by matching indented keys — a line-oriented
# grep finds nothing here and would report every key as absent.
echo "attestation top-level keys: $(grep -E '^[a-z_]+:' "$FILE" | tr '\n' ' ' | head -c 300)"
node -e '
  const fs = require("node:fs");
  const raw = fs.readFileSync(process.argv[1], "utf8");
  const rows = [...raw.matchAll(/^\s{2}(F-[0-9a-f]{3,8}):\s*(\{.*\})\s*$/gm)];
  process.stdout.write(`attestation feature rows: ${rows.length}\n`);
  if (rows.length === 0) {
    process.stdout.write("attestation row schema: (no per-feature row — the legacy marker shape)\n");
    process.stdout.write(`attestation legacy markers: ${(raw.match(/^\s{2}F-[0-9a-f]{3,8}:/gm) ?? []).length}\n`);
  }
  for (const [, id, json] of rows) {
    let row;
    try { row = JSON.parse(json); } catch { process.stdout.write(`attestation row ${id}: unparseable\n`); continue; }
    const keys = Object.keys(row);
    process.stdout.write(`attestation row ${id} schema: ${row.attestation_schema ?? "(absent)"}\n`);
    process.stdout.write(`attestation row ${id} tool_identity: ${row.tool_identity ?? "(absent)"}\n`);
    process.stdout.write(`attestation row ${id} observation_set_sha256: ${row.observation_set_sha256 ? "present" : "absent"}\n`);
    process.stdout.write(`attestation row ${id} observation_count: ${row.observation_count ?? "(absent)"}\n`);
    process.stdout.write(`attestation row ${id} inline observation entries: ${keys.filter((k) => Array.isArray(row[k])).length}\n`);
    process.stdout.write(`attestation row ${id} keys: ${keys.join(", ")}\n`);
  }
' "$FILE"

BEFORE="$(shasum -a 256 "$FILE" | cut -d' ' -f1)"
echo "attestation digest after the first pass: $BEFORE"

set +e
clad check --tier=pre-push --json > "$OUT/prepush-2-$ARM.json" 2>"$OUT/prepush-2-$ARM.err"
SECOND=$?
set -e
echo "second pre-push exit: $SECOND"
AFTER="$(shasum -a 256 "$FILE" | cut -d' ' -f1)"
echo "attestation digest after the second pass: $AFTER"
echo "attestation rewritten by a repeat pass: $([ "$BEFORE" = "$AFTER" ] && echo no || echo yes)"
cp "$FILE" "$OUT/attestation-second-$ARM.yaml"
