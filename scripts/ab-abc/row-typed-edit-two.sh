#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-typed-edit-two.sh — two edits, one snapshot (S-B3)
#
# The stale-input rule has to refuse the edit that would overwrite somebody
# else's change WITHOUT refusing the edit that merely happened to be prepared at
# the same moment. Two features are prepared from the identical snapshot and
# touch different files: applying the first must not invalidate the second, and
# replaying the first from its now-spent snapshot must be refused. A rule that
# fails the second edit is too strict to work in a team; a rule that accepts the
# replay is not a rule at all.
#
# Called by sidetable.ts as: bash row-typed-edit-two.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ "$ARM" != "C" ]; then
  echo "not applicable: typed spec edits are a schema 0.2 surface"
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

feature_id() {
  node -e '
    const fs = require("node:fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const id = text.match(/F-[0-9a-f]{6,8}/);
    if (!id) throw new Error(`no feature id: ${text.slice(0, 400)}`);
    process.stdout.write(id[0]);
  ' "$1"
}

# 0 — two features, so the two edits have separate write-sets.
make_feature() {
  local slug="$1" title="$2" file="$3"
  node -e '
    const fs = require("node:fs");
    const [callsPath, slug, title, module] = process.argv.slice(1);
    fs.writeFileSync(callsPath, `${JSON.stringify([{type: "tool", name: "clad_create_feature", args: {
      slug, title,
      purpose: "The row needs two independently editable features.",
      modules: [module],
      capability_refs: [],
      acceptance_criteria: [{kind: "behavior", statement: "The system shall keep two concurrent typed edits apart."}],
    }}], null, 2)}\n`);
  ' "$OUT/create-$slug.calls.json" "$slug" "$title" "$file"
  drive "$OUT/create-$slug.calls.json" "$OUT/create-$slug.json"
  feature_id "$OUT/create-$slug.json"
}
X="$(make_feature concurrent-x "The first of two concurrently edited features" src/concurrent-x.ts)"
Y="$(make_feature concurrent-y "The second of two concurrently edited features" src/concurrent-y.ts)"
echo "feature X: $X"
echo "feature Y: $Y"

prepare() {
  local label="$1" feature="$2" title="$3"
  node -e '
    const fs = require("node:fs");
    const [callsPath, feature, title] = process.argv.slice(1);
    const operations = [{kind: "feature.set_title", featureId: feature, title}];
    fs.writeFileSync(callsPath, `${JSON.stringify([{type: "tool", name: "clad_prepare_spec_edit", args: {operations}}], null, 2)}\n`);
  ' "$OUT/prepare-$label.calls.json" "$feature" "$title"
  drive "$OUT/prepare-$label.calls.json" "$OUT/prepare-$label.json"
  node -e '
    const fs = require("node:fs");
    const prepared = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const call = prepared.find((entry) => entry.type === "tool");
    const payload = call?.result?.structuredContent ?? JSON.parse(call?.result?.content?.[0]?.text ?? "{}");
    process.stdout.write(`${process.argv[2]} prepared: inputs ${Object.keys(payload.input_revisions ?? {}).join(", ") || "(none)"}; context ${payload.context_revision ?? "(none)"}\n`);
  ' "$OUT/prepare-$label.json" "$label"
}

apply() {
  local label="$1" from="$2" feature="$3" title="$4"
  node -e '
    const fs = require("node:fs");
    const [preparePath, callsPath, feature, title] = process.argv.slice(1);
    const prepared = JSON.parse(fs.readFileSync(preparePath, "utf8"));
    const call = prepared.find((entry) => entry.type === "tool");
    const payload = call?.result?.structuredContent ?? JSON.parse(call?.result?.content?.[0]?.text ?? "{}");
    if (!payload.input_revisions) throw new Error(`the prepare returned no input_revisions: ${JSON.stringify(payload).slice(0, 400)}`);
    const args = {
      operations: [{kind: "feature.set_title", featureId: feature, title}],
      input_revisions: payload.input_revisions,
      ...(payload.context_revision ? {context_revision: payload.context_revision} : {}),
    };
    fs.writeFileSync(callsPath, `${JSON.stringify([{type: "tool", name: "clad_edit_spec", args}], null, 2)}\n`);
  ' "$OUT/prepare-$from.json" "$OUT/apply-$label.calls.json" "$feature" "$title"
  drive "$OUT/apply-$label.calls.json" "$OUT/apply-$label.json"
  node -e '
    const fs = require("node:fs");
    const applied = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const call = applied.find((entry) => entry.type === "tool");
    const text = call?.result?.content?.[0]?.text ?? JSON.stringify(call ?? {});
    const refused = /STALE_INPUT/.test(text) ? "STALE_INPUT" : (call?.result?.isError ? "refused" : "accepted");
    process.stdout.write(`${process.argv[2]}: ${refused} — ${text.replace(/\s+/g, " ").slice(0, 300)}\n`);
  ' "$OUT/apply-$label.json" "$label"
}

# 1 — both prepared from the same snapshot, before either lands.
prepare x "$X" "X, retitled from the shared snapshot"
prepare y "$Y" "Y, retitled from the shared snapshot"

# 2 — the first edit lands.
apply x-first x "$X" "X, retitled from the shared snapshot"

# 3 — the second edit, prepared before that, touches a different file.
apply y-after-x y "$Y" "Y, retitled from the shared snapshot"

# 4 — the first edit replayed from its now-spent snapshot.
apply x-replayed x "$X" "X, retitled a second time from the same spent snapshot"

echo "X title on disk: $(grep -m1 -E '^title:' spec/features/*concurrent-x*.yaml || echo '(unreadable)')"
echo "Y title on disk: $(grep -m1 -E '^title:' spec/features/*concurrent-y*.yaml || echo '(unreadable)')"
