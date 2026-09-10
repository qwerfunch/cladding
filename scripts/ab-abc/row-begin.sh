#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-begin.sh — the order of the cycle (S-B2)
#
# A feature that has just been written down has not been worked on, and nothing
# has proven it. The row asks what each engine says when completion is claimed
# anyway: does the refusal name the step that was skipped, or only the evidence
# that is missing? On the candidate the cycle has an explicit opening move, so
# the row also asks whether taking it changes the answer — the second refusal
# should be about proof, not about order.
#
# Called by sidetable.ts as: bash row-begin.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ ! -x "$PREFIX/bin/clad" ]; then
  echo "no engine at $PREFIX/bin/clad — the row cannot run"
  exit 3
fi
export PATH="$PREFIX/bin:$PATH"
cd "$CWD"
echo "engine: $(command -v clad) $(clad --version)"

drive() {
  node "$ABC_HARNESS/mcp-client.mjs" --cwd "$CWD" --server "$PREFIX/bin/clad serve" \
    --calls "$1" --out "$2" > /dev/null 2>&1 || true
}

# 0 — one freshly written feature, in the shape this engine's own surface takes.
if [ "$ARM" = "C" ]; then
  cat > "$OUT/create-$ARM.calls.json" <<'CREATE'
[
  {
    "type": "tool",
    "name": "clad_create_feature",
    "args": {
      "slug": "cycle-order",
      "title": "A feature nobody has started yet",
      "purpose": "The row needs one feature that has been written down and not worked on.",
      "modules": ["src/cycle-order.ts"],
      "capability_refs": [],
      "acceptance_criteria": [
        {"kind": "behavior", "statement": "The system shall refuse a completion claim for work that has not started."}
      ]
    }
  }
]
CREATE
else
  cat > "$OUT/create-$ARM.calls.json" <<'CREATE'
[
  {
    "type": "tool",
    "name": "clad_create_feature",
    "args": {
      "slug": "cycle-order",
      "title": "A feature nobody has started yet",
      "modules": ["src/cycle-order.ts"],
      "acceptance_criteria": [
        {"ears": "ubiquitous", "text": "The system shall refuse a completion claim for work that has not started."}
      ]
    }
  }
]
CREATE
fi
drive "$OUT/create-$ARM.calls.json" "$OUT/create-$ARM.json"
FEATURE="$(node -e '
  const fs = require("node:fs");
  const text = fs.readFileSync(process.argv[1], "utf8");
  const id = text.match(/F-[0-9a-f]{6,8}/);
  if (!id) throw new Error(`no feature id in the create result: ${text.slice(0, 600)}`);
  process.stdout.write(id[0]);
' "$OUT/create-$ARM.json")" || { echo "the create call produced no feature id"; exit 2; }
echo "feature: $FEATURE"

status_of() {
  grep -m1 -E '^status:' spec/features/*"${FEATURE#F-}"*.yaml 2>/dev/null || echo "status: (unreadable)"
}
echo "status after create: $(status_of)"

# 1 — completion claimed before anything was started.
set +e
clad done "$FEATURE" > "$OUT/done-before-begin-$ARM.log" 2>&1
DONE1=$?
set -e
echo "done before begin exit: $DONE1"
echo "done before begin said: $(head -c 600 "$OUT/done-before-begin-$ARM.log" | tr '\n' ' ')"
echo "done before begin names the opening step: $(grep -qE 'clad begin|clad_begin' "$OUT/done-before-begin-$ARM.log" && echo yes || echo no)"

# 2 — the opening move, where the engine has one.
set +e
clad begin "$FEATURE" > "$OUT/begin-$ARM.log" 2>&1
BEGIN=$?
set -e
echo "begin exit: $BEGIN"
echo "begin said: $(head -c 400 "$OUT/begin-$ARM.log" | tr '\n' ' ')"
echo "status after begin: $(status_of)"

# 3 — completion claimed again, now with the cycle open and nothing proven.
set +e
clad done "$FEATURE" > "$OUT/done-after-begin-$ARM.log" 2>&1
DONE2=$?
set -e
echo "done after begin exit: $DONE2"
echo "done after begin said: $(head -c 600 "$OUT/done-after-begin-$ARM.log" | tr '\n' ' ')"
echo "done after begin names unproven criteria: $(grep -qiE 'unbound|unobserved|unproven|no test|UNVERIFIED' "$OUT/done-after-begin-$ARM.log" && echo yes || echo no)"
echo "final status: $(status_of)"
