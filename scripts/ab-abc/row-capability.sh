#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-capability.sh — a reference that has to resolve (S-B5)
#
# A feature can say which user-facing capability it serves. The row asks whether
# that reference is checked: naming a capability nobody has declared should be
# refused or reported, and naming one that exists should pass. A reference that
# is accepted either way is decoration — it looks like a link and points at
# nothing, which is exactly the shape of drift the compiled model exists to stop.
#
# Ordering matters: a capability is linked to a feature, so the first feature has
# to exist before any capability can. The row therefore creates a plain feature,
# links it to a capability (which creates the capability), and only then asks the
# two questions.
#
# Called by sidetable.ts as: bash row-capability.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ "$ARM" != "C" ]; then
  echo "not applicable: the capability contract is a schema 0.2 surface"
  exit 0
fi
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
tool_said() {
  node -e '
    const fs = require("node:fs");
    const results = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const call = results.find((entry) => entry.type === "tool");
    const text = call?.result?.content?.[0]?.text ?? JSON.stringify(call ?? {});
    process.stdout.write(`${process.argv[2]}: ${call?.result?.isError ? "refused" : "accepted"} — ${text.replace(/\s+/g, " ").slice(0, 400)}\n`);
  ' "$1" "$2"
}
make_feature() {
  local slug="$1" refs="$2"
  node -e '
    const fs = require("node:fs");
    const [callsPath, slug, refs] = process.argv.slice(1);
    fs.writeFileSync(callsPath, `${JSON.stringify([{type: "tool", name: "clad_create_feature", args: {
      slug,
      title: `A feature declaring ${refs === "[]" ? "no capability" : "the capability " + refs}`,
      purpose: "The row needs a feature whose capability reference is under test.",
      modules: [`src/${slug}.ts`],
      capability_refs: JSON.parse(refs),
      acceptance_criteria: [{kind: "behavior", statement: "The system shall resolve every capability a feature names."}],
    }}], null, 2)}\n`);
  ' "$OUT/create-$slug.calls.json" "$slug" "$refs"
  drive "$OUT/create-$slug.calls.json" "$OUT/create-$slug.json"
}

# 0 — the anchor feature, with no capability reference at all.
make_feature capability-anchor '[]'
tool_said "$OUT/create-capability-anchor.json" "anchor feature with no capability reference"
FEATURE="$(node -e '
  const fs = require("node:fs");
  const id = fs.readFileSync(process.argv[1], "utf8").match(/F-[0-9a-f]{6,8}/);
  if (!id) throw new Error("no feature id");
  process.stdout.write(id[0]);
' "$OUT/create-capability-anchor.json")" || { echo "the anchor create produced no feature id"; exit 2; }
echo "anchor feature: $FEATURE"
# The scaffold ships no source, so without one real module the gate fails on an
# empty type-checker include list and its exit says nothing about capabilities.
mkdir -p src
cat > src/capability-anchor.ts <<'MODULE'
// Fixture module — the feature whose capability reference is under test.
export function capabilityAnchor(): string {
  return 'anchor';
}
MODULE

# 1 — a reference to a capability nobody declared.
make_feature capability-ghost '["ghost-capability"]'
tool_said "$OUT/create-capability-ghost.json" "feature naming an undeclared capability"
set +e
clad check --profile checkpoint --json > "$OUT/check-ghost.json" 2>"$OUT/check-ghost.err"
GHOST_GATE=$?
set -e
echo "gate exit with the undeclared reference: $GHOST_GATE"
# If the create was refused outright the shard never landed, so the gate has
# nothing to say — which is a different answer from "the gate passed it".
echo "undeclared reference reached the spec on disk: $(grep -rqF 'ghost-capability' spec 2>/dev/null && echo yes || echo no)"
echo "gate mentions the undeclared capability: $(grep -qF 'ghost-capability' "$OUT/check-ghost.json" && echo yes || echo no)"

# 2 — the capability declared, then referenced.
node -e '
  const fs = require("node:fs");
  const [callsPath, feature] = process.argv.slice(1);
  fs.writeFileSync(callsPath, `${JSON.stringify([{type: "tool", name: "clad_link_capability", args: {
    capability: "checkout",
    feature,
    title: "Checkout",
    summary: "Everything a visitor does between a full basket and a receipt.",
    surface: "feature",
  }}], null, 2)}\n`);
' "$OUT/link.calls.json" "$FEATURE"
drive "$OUT/link.calls.json" "$OUT/link.json"
tool_said "$OUT/link.json" "capability declared through the link tool"
echo "capabilities on disk: $(grep -c -E '^\s*-?\s*id:' spec/capabilities.yaml 2>/dev/null || echo 0) entries"

make_feature capability-declared '["checkout"]'
tool_said "$OUT/create-capability-declared.json" "feature naming the declared capability"
set +e
clad check --profile checkpoint --json > "$OUT/check-declared.json" 2>"$OUT/check-declared.err"
DECLARED_GATE=$?
set -e
echo "gate exit with the declared reference: $DECLARED_GATE"
