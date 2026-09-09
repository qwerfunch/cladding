#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-relocate.sh — the generated-projection move (S-F1)
#
# 0.10.0 moves the three derived files cladding writes for itself — the feature
# index, the doc-link map, the attestation — under spec/generated/, and retargets
# the `merge=union` line that keeps the index mergeable. A move of files a gate
# reads is only safe if all of this holds, so the row walks the whole lifetime in
# one pass:
#
#   preview     names three moves and writes nothing at all
#   apply       old paths gone, new paths byte-identical, .gitattributes retargeted
#   gate        the moved workspace still passes its own strict push profile
#   again       a second apply reports no change rather than moving twice
#   conflict    a workspace holding BOTH paths is refused, naming both
#   0.1         a schema-0.1 workspace is refused and pointed at `clad migrate`
#
# Arm B records the comparison: 0.9.4 has no such verb.
#
# Called by sidetable.ts as: bash row-relocate.sh <arm> <cwd> <artifact-dir>
set -uo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
SOURCE_01="$ABC_ROOT/sidetable/done/B"

export PATH="$ABC_ROOT/prefix-$ARM/bin:$PATH"
echo "engine: $(command -v clad) $(clad --version 2>&1)"

if [ "$ARM" != "C" ]; then
  ( cd "$CWD" && clad relocate-generated ) > "$OUT/relocate-b.txt" 2>&1
  echo "B relocate-generated exit: $?"
  head -c 300 "$OUT/relocate-b.txt"
  echo
  echo "not applicable: relocating the generated projections is a 0.2 surface"
  exit 0
fi

digest() { [ -f "$1" ] && shasum -a 256 "$1" | cut -d' ' -f1 || echo "(absent)"; }
changed_paths() { ( cd "$1" && git status --porcelain ) | grep -v 'node_modules' || true; }

BEFORE_INDEX="$(digest "$CWD/spec/index.yaml")"
BEFORE_LINKS="$(digest "$CWD/spec/_doc-links.yaml")"
BEFORE_ATTEST="$(digest "$CWD/spec/attestation.yaml")"
echo "before: spec/index.yaml $BEFORE_INDEX"

# 1 — the preview, which must be read-only.
( cd "$CWD" && clad relocate-generated --json ) > "$OUT/relocate-preview.json" 2> "$OUT/relocate.log"
echo "preview exit: $?"
node -e '
  const fs = require("node:fs");
  const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(`preview state ${plan.state}; moves ${(plan.artifacts ?? []).length}; writes ${plan.writes}\n`);
  process.stdout.write(`preview gitattributes: ${plan.gitattributes?.line} → ${plan.gitattributes?.action}\n`);
  process.stdout.write(`preview moves: ${(plan.artifacts ?? []).map((a) => `${a.from}→${a.to}`).join(", ")}\n`);
' "$OUT/relocate-preview.json" || true
echo "preview left $(changed_paths "$CWD" | wc -l | tr -d ' ') changed paths"

# 2 — the apply.
( cd "$CWD" && clad relocate-generated --apply --json ) > "$OUT/relocate-apply.json" 2>> "$OUT/relocate.log"
echo "apply exit: $?"
node -e '
  const fs = require("node:fs");
  const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(`apply state ${plan.state}; changed ${plan.changed}; writes ${plan.writes}\n`);
' "$OUT/relocate-apply.json" || true
echo "old paths still present: $(ls "$CWD/spec/index.yaml" "$CWD/spec/_doc-links.yaml" "$CWD/spec/attestation.yaml" 2> /dev/null | wc -l | tr -d ' ') of 3"
echo "index bytes identical after the move: $([ "$(digest "$CWD/spec/generated/index.yaml")" = "$BEFORE_INDEX" ] && echo yes || echo NO)"
echo "doc-links bytes identical after the move: $([ "$(digest "$CWD/spec/generated/_doc-links.yaml")" = "$BEFORE_LINKS" ] && echo yes || echo NO)"
echo "attestation bytes identical after the move: $([ "$(digest "$CWD/spec/generated/attestation.yaml")" = "$BEFORE_ATTEST" ] && echo yes || echo NO)"
echo "gitattributes now: $(grep 'merge=union' "$CWD/.gitattributes" | head -1)"

# 3 — the moved workspace's own gate.
( cd "$CWD" && clad sync ) >> "$OUT/relocate.log" 2>&1
echo "sync exit: $?"
( cd "$CWD" && git add -A && git commit -qm "relocate the generated projections" ) >> "$OUT/relocate.log" 2>&1
( cd "$CWD" && clad check --profile push --strict --json ) > "$OUT/relocate-gate.json" 2>> "$OUT/relocate.log"
echo "strict push profile after the move: exit $?"

# 4 — the same command again.
( cd "$CWD" && clad relocate-generated --apply --json ) > "$OUT/relocate-again.json" 2>> "$OUT/relocate.log"
echo "second apply exit: $?"
node -e '
  const fs = require("node:fs");
  const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(`second apply state ${plan.state}; changed ${plan.changed}\n`);
' "$OUT/relocate-again.json" || true

# 5 — both paths present at once: which of the two is the truth is not the
# engine's guess to make.
cp "$CWD/spec/generated/index.yaml" "$CWD/spec/index.yaml"
( cd "$CWD" && clad relocate-generated --json ) > "$OUT/relocate-conflict.json" 2> "$OUT/relocate-conflict.err"
CONFLICT=$?
echo "conflict exit: $CONFLICT"
node -e '
  const fs = require("node:fs");
  const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const clash = (plan.artifacts ?? []).filter((a) => a.action === "conflict");
  process.stdout.write(`conflict state ${plan.state}; conflicting artifacts ${clash.length}\n`);
  process.stdout.write(`conflict names: ${clash.map((a) => `${a.from} and ${a.to}`).join("; ") || "(none)"}\n`);
' "$OUT/relocate-conflict.json" || true
# The preview only describes; the refusal that matters is what --apply does when
# both copies exist, because choosing between them is not the engine's to guess.
( cd "$CWD" && clad relocate-generated --apply --json ) > "$OUT/relocate-conflict-apply.json" 2>> "$OUT/relocate-conflict.err"
echo "conflict apply exit: $?"
head -c 400 "$OUT/relocate-conflict-apply.json" | tr -s '\n' ' '
echo
echo "both copies still present after the refusal: $(ls "$CWD/spec/index.yaml" "$CWD/spec/generated/index.yaml" 2> /dev/null | wc -l | tr -d ' ') of 2"
rm -f "$CWD/spec/index.yaml"

# 6 — a schema-0.1 workspace, driven by the same candidate binary.
WORK="$CWD/.relocate-01"
rm -rf "$WORK"
mkdir -p "$WORK"
rsync -a --exclude node_modules "$SOURCE_01/" "$WORK/" >> "$OUT/relocate.log" 2>&1
( cd "$WORK" && clad relocate-generated --json ) > "$OUT/relocate-01.json" 2> "$OUT/relocate-01.err"
echo "0.1 workspace exit: $?"
head -c 400 "$OUT/relocate-01.json" "$OUT/relocate-01.err" | tr -s '\n' ' '
echo
rm -rf "$WORK"
