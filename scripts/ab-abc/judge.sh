#!/usr/bin/env bash
# Cladding · scripts/ab-abc/judge.sh — blinded rubric scoring (SECONDARY, unused)
#
# NOT RUN BY THE CAMPAIGN. This is a model-graded, non-deterministic measure, and
# the pre-registration marks it **secondary: reported only, never a verdict**.
# Everything the release decision rests on is deterministic and lives elsewhere.
#
# What it would do: build an anonymised snapshot of one cell's `src/` and
# `tests/` — no arm letter, no engine version, no spec directory, no harness
# files — and ask a fixed rubric of a separate model.
#
#   Readability      1–5
#   Error handling   1–5
#   Test design      1–5
#
# Cost is roughly $0.10 per cell at the sizes this campaign produces. It refuses
# to spend anything unless the operator confirms explicitly, because a scoring
# script that quietly bills money is exactly the kind of thing this harness's
# safety rules exist to prevent.
#
# Usage: ABC_JUDGE_CONFIRM=yes-spend bash scripts/ab-abc/judge.sh <A|B|C> <cell>
set -euo pipefail

ARM="${1:?usage: judge.sh <A|B|C> <cell-name>}"
CELL="${2:?usage: judge.sh <A|B|C> <cell-name>}"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
WORKSPACE="$ABC_ROOT/cells/$ARM/$CELL"
ARTIFACTS="$ABC_ROOT/artifacts/$ARM/$CELL"
SNAPSHOT="$ARTIFACTS/blind-snapshot"

if [ "${ABC_JUDGE_CONFIRM:-}" != "yes-spend" ]; then
  echo "judge.sh is a secondary, model-graded measure and is NOT part of the campaign." >&2
  echo "It costs roughly \$0.10 per cell. Set ABC_JUDGE_CONFIRM=yes-spend to run it." >&2
  exit 1
fi

# ── the blinded snapshot ──────────────────────────────────────────────────────
rm -rf "$SNAPSHOT"
mkdir -p "$SNAPSHOT"
cp -R "$WORKSPACE/src" "$SNAPSHOT/src"
cp -R "$WORKSPACE/tests" "$SNAPSHOT/tests"
# Strip anything that would name the arm, the engine, or the criterion binding —
# a grader that can tell which arm it is reading is not a blinded grader.
find "$SNAPSHOT" -type f -name '*.ts' -exec sed -i '' -E \
  -e 's/\[covers:[^]]*\]//g' \
  -e 's/cladding//gI' \
  -e 's/0\.(9|10)\.[0-9]+//g' {} +

RUBRIC="You are reviewing one small TypeScript module and its tests. Score three axes from 1 to 5, where 3 is ordinary professional work: readability, error handling, and test design. Answer as JSON: {\"readability\": n, \"error_handling\": n, \"test_design\": n, \"note\": \"one sentence\"}. Do not guess who or what wrote this code."

cd "$SNAPSHOT"
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SAFE_MODE -u CLAUDE_CODE_SIMPLE \
  claude -p "$RUBRIC" \
    --model claude-sonnet-5 \
    --output-format json \
    --strict-mcp-config \
    --no-session-persistence \
    --max-budget-usd 1 \
    --allowedTools "Read,Glob,Grep,LS" \
    > "$ARTIFACTS/blind-rubric.json"

echo "blinded rubric written to $ARTIFACTS/blind-rubric.json (secondary — not a verdict)"
