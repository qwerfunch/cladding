#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-scenario-policy.sh — advisory versus required (S-B4)
#
# A scenario that names no feature is a described journey nobody has claimed.
# Whether that is worth mentioning or worth stopping for is a project's own
# choice, and the candidate makes it one setting. The row asks whether the
# setting actually decides: the same workspace, the same unbound scenario, under
# `advisory` and then under `required`. A setting that changes nothing is a
# setting in name only.
#
# The row also records where the boundary sits. The editing surface has its own
# opinion about unbound scenarios, independent of the project policy, so the
# creation attempt is recorded as the fact it is before the gate question is
# asked — and if the tool refuses, the shard is written from the shape the tool
# itself produced for a bound scenario, so the gate still gets its input.
#
# Called by sidetable.ts as: bash row-scenario-policy.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ "$ARM" != "C" ]; then
  echo "not applicable: the scenario policy is a schema 0.2 setting"
  exit 0
fi
if [ ! -x "$PREFIX/bin/clad" ]; then
  echo "no engine at $PREFIX/bin/clad — the row cannot run"
  exit 3
fi
export PATH="$PREFIX/bin:$PATH"
cd "$CWD"
echo "engine: $(command -v clad) $(clad --version)"
echo "declared policy at start: $(grep -m1 -E '^[[:space:]]*scenario_policy:' spec.yaml || echo '(absent)')"

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

# 0 — one feature, so a BOUND scenario is possible at all.
cat > "$OUT/create-feature.calls.json" <<'CREATE'
[
  {
    "type": "tool",
    "name": "clad_create_feature",
    "args": {
      "slug": "journey-subject",
      "title": "A feature a journey can name",
      "purpose": "The row needs one feature so a bound scenario is possible.",
      "modules": ["src/journey-subject.ts"],
      "capability_refs": [],
      "acceptance_criteria": [
        {"kind": "behavior", "statement": "The system shall bind a described journey to the feature it exercises."}
      ]
    }
  }
]
CREATE
drive "$OUT/create-feature.calls.json" "$OUT/create-feature.json"
FEATURE="$(node -e '
  const fs = require("node:fs");
  const id = fs.readFileSync(process.argv[1], "utf8").match(/F-[0-9a-f]{6,8}/);
  if (!id) throw new Error("no feature id");
  process.stdout.write(id[0]);
' "$OUT/create-feature.json")" || { echo "the create call produced no feature id"; exit 2; }
echo "feature: $FEATURE"
# The scaffold ships no source at all, so the type stage fails on an empty
# include list and the gate's exit says nothing about scenarios. One real module
# and one real test give the row a workspace whose gate result is about its own
# question.
mkdir -p src tests
cat > src/journey-subject.ts <<'MODULE'
// Fixture module — the feature a described journey names.
export function journeySubject(): string {
  return 'checkout';
}
MODULE
cat > tests/journey-subject.test.ts <<'TEST'
import {describe, expect, test} from 'vitest';

import {journeySubject} from '../src/journey-subject.js';

describe('journey subject', () => {
  test('names the journey it belongs to', () => {
    expect(journeySubject()).toBe('checkout');
  });
});
TEST

# 1 — the unbound scenario, attempted through the tool.
cat > "$OUT/unbound.calls.json" <<'UNBOUND'
[
  {
    "type": "tool",
    "name": "clad_create_scenario",
    "args": {
      "slug": "unclaimed-journey",
      "title": "A journey nobody has claimed",
      "actor": "a first-time visitor",
      "goal": "finish checkout without an account",
      "success": "the order is placed and a receipt is shown",
      "steps": ["opens the basket", "chooses guest checkout", "pays", "reads the receipt"]
    }
  }
]
UNBOUND
drive "$OUT/unbound.calls.json" "$OUT/unbound.json"
tool_said "$OUT/unbound.json" "unbound scenario through the tool"

# 2 — a bound scenario, which also gives the row a shard shape it did not invent.
node -e '
  const fs = require("node:fs");
  const [callsPath, feature] = process.argv.slice(1);
  fs.writeFileSync(callsPath, `${JSON.stringify([{type: "tool", name: "clad_create_scenario", args: {
    slug: "claimed-journey",
    title: "A journey the feature claims",
    actor: "a first-time visitor",
    goal: "finish checkout without an account",
    success: "the order is placed and a receipt is shown",
    steps: ["opens the basket", "chooses guest checkout", "pays", "reads the receipt"],
    features: [feature],
  }}], null, 2)}\n`);
' "$OUT/bound.calls.json" "$FEATURE"
drive "$OUT/bound.calls.json" "$OUT/bound.json"
tool_said "$OUT/bound.json" "bound scenario through the tool"
ls spec/scenarios 2>/dev/null | sed 's/^/scenario shard: /' || echo "scenario shard: (none)"

# 3 — if the surface refused the unbound one, the gate still needs one to judge.
if ! ls spec/scenarios/unclaimed-journey-*.yaml >/dev/null 2>&1; then
  BOUND_SHARD="$(ls spec/scenarios/*.yaml 2>/dev/null | head -1 || true)"
  if [ -n "$BOUND_SHARD" ]; then
    node -e '
      const fs = require("node:fs");
      const [source, feature] = process.argv.slice(1);
      const raw = fs.readFileSync(source, "utf8");
      // The identifier has to look like one the tool would have minted, and the
      // reference list has to be genuinely empty — an id the reader rejects, or a
      // surviving reference, would make the row measure the wrong refusal.
      const unbound = raw
        .replace(/^id:.*$/m, "id: S-facade01")
        .replace(/^title:.*$/m, "title: \"A journey nobody has claimed\"")
        .replace(/^feature_refs:\n(?:\s+-\s.*\n)*/m, "feature_refs: []\n")
        .replace(/^features:\n(?:\s+-\s.*\n)*/m, "features: []\n");
      const written = source.replace(/[^/]+$/, "unclaimed-journey-facade01.yaml");
      fs.writeFileSync(written, unbound);
      process.stdout.write(`unbound shard written by hand from the tool-produced shape: ${written}\n`);
      process.stdout.write(`unbound shard still names a feature: ${/F-[0-9a-f]{6,8}/.test(unbound) ? "yes" : "no"}\n`);
    ' "$BOUND_SHARD" "$FEATURE"
  else
    echo "no scenario shard on disk — the gate question cannot be asked"
  fi
fi
clad sync > "$OUT/sync.log" 2>&1 || true

# 4 — the gate under the declared policy, then under the stricter one.
run_gate() {
  local label="$1"
  set +e
  clad check --profile checkpoint --json > "$OUT/check-$label.json" 2>"$OUT/check-$label.err"
  local code=$?
  set -e
  echo "$label gate exit: $code"
  node -e '
    const fs = require("node:fs");
    let gate;
    try { gate = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { gate = null; }
    const label = process.argv[2];
    if (gate === null) { process.stdout.write(`${label} gate emitted no JSON\n`); process.exit(0); }
    const findings = (gate.stages ?? []).flatMap((stage) => (stage.findings ?? []).map((f) => ({stage: stage.stage, ...f})));
    const scenario = findings.filter((f) => /scenario|journey/i.test(`${f.detector ?? ""} ${f.message ?? ""}`));
    process.stdout.write(`${label} scenario findings: ${scenario.length === 0 ? "(none)" : scenario.map((f) => `${f.severity}/${f.detector}: ${(f.message ?? "").slice(0, 140)}`).join(" | ")}\n`);
    const failing = (gate.stages ?? []).filter((s) => s.status === "fail").map((s) => `${s.stage} ${s.label}`);
    process.stdout.write(`${label} failing stages: ${failing.length === 0 ? "(none)" : failing.join(", ")}\n`);
    process.stdout.write(`${label} unbound criteria: ${JSON.stringify(gate.unbound_criteria ?? "(not reported)").slice(0, 200)}\n`);
  ' "$OUT/check-$label.json" "$label"
}
run_gate advisory

# The typed surface validates the whole workspace before it will transact, and an
# unbound journey fails that validation whatever the project policy says — so the
# policy cannot be changed while the shard the row wrote is on disk. The row
# records that as the boundary it is, then takes the shard out of the way, makes
# the change, and puts it back: the gate question is about the policy, and it
# should not be answered by an editing rule that fired first.
UNBOUND_SHARD="$(ls spec/scenarios/unclaimed-journey-*.yaml 2>/dev/null | head -1 || true)"
if [ -n "$UNBOUND_SHARD" ]; then
  cp "$UNBOUND_SHARD" "$OUT/unbound-shard.yaml"
  node -e '
    const fs = require("node:fs");
    fs.writeFileSync(process.argv[1], `${JSON.stringify([{type: "tool", name: "clad_prepare_spec_edit", args: {operations: [{kind: "project.set_policy", scenarioPolicy: "required"}]}}], null, 2)}\n`);
  ' "$OUT/policy-blocked.calls.json"
  drive "$OUT/policy-blocked.calls.json" "$OUT/policy-blocked.json"
  tool_said "$OUT/policy-blocked.json" "policy change attempted with the unbound journey on disk"
  rm -f "$UNBOUND_SHARD"
  clad sync > "$OUT/sync-without-unbound.log" 2>&1 || true
fi

# The policy is changed through the typed surface, the way a project would.
node -e '
  const fs = require("node:fs");
  fs.writeFileSync(process.argv[1], `${JSON.stringify([{type: "tool", name: "clad_prepare_spec_edit", args: {operations: [{kind: "project.set_policy", scenarioPolicy: "required"}]}}], null, 2)}\n`);
' "$OUT/policy-prepare.calls.json"
drive "$OUT/policy-prepare.calls.json" "$OUT/policy-prepare.json"
node -e '
  const fs = require("node:fs");
  const prepared = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const call = prepared.find((entry) => entry.type === "tool");
  const payload = call?.result?.structuredContent ?? JSON.parse(call?.result?.content?.[0]?.text ?? "{}");
  const args = {
    operations: [{kind: "project.set_policy", scenarioPolicy: "required"}],
    input_revisions: payload.input_revisions ?? {},
    ...(payload.context_revision ? {context_revision: payload.context_revision} : {}),
  };
  fs.writeFileSync(process.argv[2], `${JSON.stringify([{type: "tool", name: "clad_edit_spec", args}], null, 2)}\n`);
' "$OUT/policy-prepare.json" "$OUT/policy-apply.calls.json"
drive "$OUT/policy-apply.calls.json" "$OUT/policy-apply.json"
tool_said "$OUT/policy-apply.json" "policy change to required"
echo "declared policy after the change: $(grep -m1 -E '^[[:space:]]*scenario_policy:' spec.yaml || echo '(absent)')"
if [ -f "$OUT/unbound-shard.yaml" ] && [ -n "${UNBOUND_SHARD:-}" ]; then
  cp "$OUT/unbound-shard.yaml" "$UNBOUND_SHARD"
  clad sync > "$OUT/sync-with-unbound.log" 2>&1 || true
  echo "unbound journey restored: $UNBOUND_SHARD"
fi
run_gate required
