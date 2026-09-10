#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-stale-edit.sh — the stale typed edit row (L0-8)
#
# Prepares a typed spec edit, changes the target underneath it, then applies the
# prepared edit. A prepared edit that still lands has overwritten somebody else's
# change; the candidate is expected to refuse it instead.
#
# Two things the first run got wrong are fixed here. The row ran against a
# freshly scaffolded workspace that holds no feature at all, so reading
# `spec/features` threw ENOENT before any tool was called; the row now creates
# the feature it edits. And the apply call was assembled from a guessed
# `input_sha256` field: the real surface takes `operations` plus an
# `input_revisions` map (and an optional `context_revision`), all of which the
# prepare call hands back, so those are now copied through verbatim.
#
# Called by sidetable.ts as: bash row-stale-edit.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ "$ARM" != "C" ]; then
  echo "not applicable: typed edits are a schema 0.2 surface"
  exit 0
fi

echo "engine: $PREFIX/bin/clad $(PATH="$PREFIX/bin:$PATH" clad --version)"

drive() {
  node "$ABC_HARNESS/mcp-client.mjs" --cwd "$CWD" --server "$PREFIX/bin/clad serve" \
    --calls "$1" --out "$2" > /dev/null
}

# 0 — the feature this row edits. A bare 0.2 scaffold carries none.
cat > "$OUT/create.calls.json" <<'CREATE'
[
  {
    "type": "tool",
    "name": "clad_create_feature",
    "args": {
      "slug": "stale-edit-subject",
      "title": "A feature whose title a stale edit will try to change",
      "purpose": "The row needs one real feature to prepare an edit against.",
      "modules": ["src/stale.ts"],
      "capability_refs": [],
      "acceptance_criteria": [
        {"kind": "behavior", "statement": "The system shall refuse a typed edit whose declared input revision is stale."}
      ]
    }
  }
]
CREATE
drive "$OUT/create.calls.json" "$OUT/create.json"
FEATURE="$(node -e '
  const fs = require("node:fs");
  const text = fs.readFileSync(process.argv[1], "utf8");
  if (/"isError":\s*true/.test(text)) throw new Error(`the tool refused the feature: ${text.slice(0, 600)}`);
  const id = text.match(/F-[0-9a-f]{6,8}/);
  if (!id) throw new Error(`no feature id in the create result: ${text.slice(0, 600)}`);
  process.stdout.write(id[0]);
' "$OUT/create.json")"
echo "feature under edit: $FEATURE"

# 1 — prepare the edit and keep the revisions it hands back.
node -e '
  const fs = require("node:fs");
  const [callsPath, feature] = process.argv.slice(1);
  const operations = [{kind: "feature.set_title", featureId: feature, title: "A title written from a stale prepare"}];
  fs.writeFileSync(callsPath, `${JSON.stringify([{type: "tool", name: "clad_prepare_spec_edit", args: {operations}}], null, 2)}\n`);
' "$OUT/prepare.calls.json" "$FEATURE"
drive "$OUT/prepare.calls.json" "$OUT/prepare.json"
echo "prepare recorded to prepare.json"
node -e '
  const fs = require("node:fs");
  const prepared = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const call = prepared.find((entry) => entry.type === "tool");
  const payload = call?.result?.structuredContent
    ?? JSON.parse(call?.result?.content?.[0]?.text ?? "{}");
  process.stdout.write(`prepared input revisions: ${Object.keys(payload.input_revisions ?? {}).join(", ") || "(none)"}\n`);
' "$OUT/prepare.json"

# 2 — move the ground under it.
node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(process.argv[1], "spec", "features");
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const raw = fs.readFileSync(full, "utf8");
    if (!raw.includes(process.argv[2])) continue;
    fs.writeFileSync(full, `${raw}\n# an edit that happened after the prepare\n`);
    process.stdout.write(`changed on disk after the prepare: spec/features/${name}\n`);
    break;
  }
' "$CWD" "$FEATURE"

# 3 — apply the now-stale edit, with the prepare's own revisions.
node -e '
  const fs = require("node:fs");
  const [preparePath, callsPath, feature] = process.argv.slice(1);
  const prepared = JSON.parse(fs.readFileSync(preparePath, "utf8"));
  const call = prepared.find((entry) => entry.type === "tool");
  const payload = call?.result?.structuredContent
    ?? JSON.parse(call?.result?.content?.[0]?.text ?? "{}");
  if (!payload.input_revisions) throw new Error(`the prepare returned no input_revisions: ${JSON.stringify(payload).slice(0, 600)}`);
  const args = {
    operations: [{kind: "feature.set_title", featureId: feature, title: "A title written from a stale prepare"}],
    input_revisions: payload.input_revisions,
    ...(payload.context_revision ? {context_revision: payload.context_revision} : {}),
  };
  fs.writeFileSync(callsPath, `${JSON.stringify([{type: "tool", name: "clad_edit_spec", args}], null, 2)}\n`);
' "$OUT/prepare.json" "$OUT/apply.calls.json" "$FEATURE"
drive "$OUT/apply.calls.json" "$OUT/apply.json"
echo "apply result recorded to apply.json — the row asks whether it was refused"
grep -o 'STALE_INPUT' "$OUT/apply.json" | head -1 || echo "no STALE_INPUT in the apply result"
node -e '
  const fs = require("node:fs");
  const applied = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const call = applied.find((entry) => entry.type === "tool");
  const text = call?.result?.content?.[0]?.text ?? JSON.stringify(call ?? {});
  process.stdout.write(`apply said: ${text.slice(0, 400)}\n`);
' "$OUT/apply.json"
