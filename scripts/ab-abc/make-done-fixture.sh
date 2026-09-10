#!/usr/bin/env bash
# Cladding · scripts/ab-abc/make-done-fixture.sh — a completed feature, no agent
#
# Builds the fixture the harder side-table rows need: one small feature carried
# all the way to `done` by the arm's own engine, with its criteria genuinely
# bound to its tests. Rows about warn severity, completion wording, the
# independence policy, vacuous greens and migration all need a project that has
# actually finished something — this is that project, built deterministically so
# the rows measure the engine rather than an agent's mood.
#
# Each arm binds the way its own schema binds: 0.9.4 through the shard's
# `test_refs`, 0.10.0 through a covers token at the head of a test title.
#
# Usage: ABC_ROOT=~/abc-0100 bash scripts/ab-abc/make-done-fixture.sh <B|C>
#        → $ABC_ROOT/sidetable/done/<arm>, plus done-output.txt beside it.
set -euo pipefail

ARM="${1:?usage: make-done-fixture.sh <B|C> [--stop-before-done]}"
case "$ARM" in
  B|C) ;;
  *) echo "arm must be B or C (got '$ARM')" >&2; exit 2 ;;
esac

# `--stop-before-done` builds the same project one step short of completion, and
# adds the project-owned quality runners an L4 profile asks for. The L4 row needs
# that shape: the documented recipe raises the level while the feature is still
# in its cycle and lets `clad done` publish the L4 attestation row. Completing at
# L2 first and raising the level afterwards asks a different question.
STOP_BEFORE_DONE=0
if [ "${2:-}" = "--stop-before-done" ]; then STOP_BEFORE_DONE=1; fi

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
# shellcheck source=lib-fixture.sh
. "$ABC_HARNESS/lib-fixture.sh"

PREFIX="$ABC_ROOT/prefix-$ARM"
if [ "$STOP_BEFORE_DONE" = "1" ]; then
  DEST="$ABC_ROOT/sidetable/inprogress/$ARM"
  RECORD="$ABC_ROOT/sidetable/inprogress"
else
  DEST="$ABC_ROOT/sidetable/done/$ARM"
  RECORD="$ABC_ROOT/sidetable/done"
fi
LOG="$RECORD/$ARM.log"

abc_engine_check "$ARM" "$PREFIX"

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
: > "$LOG"

abc_seed_workspace "$DEST"
abc_init_engine "$ARM" "$PREFIX" "$DEST"

FEATURE="$(abc_create_feature "$ARM" "$PREFIX" "$DEST" slugify "Turn a title into a URL slug" \
  "Readers and search engines both need a stable, readable identifier for a title.")"
# `mapfile` is bash 4 and this harness must run on the stock macOS bash.
CRITERIA_RAW="$(abc_criteria "$DEST" "$FEATURE")"
AC1="$(printf '%s\n' "$CRITERIA_RAW" | sed -n 1p)"
AC2="$(printf '%s\n' "$CRITERIA_RAW" | sed -n 2p)"
AC3="$(printf '%s\n' "$CRITERIA_RAW" | sed -n 3p)"
SHARD="$(abc_shard_path "$DEST" "$FEATURE")"
printf 'feature %s / criteria %s\nshard %s\n' "$FEATURE" "$AC1 $AC2 $AC3" "$SHARD" | tee -a "$LOG"

abc_write_module "$DEST"
if [ "$STOP_BEFORE_DONE" = "1" ]; then
  # Smoke, Performance and Visual call `npm run --silent smoke|perf|visual`; with
  # no such script each one skips, and a skipped stage is an UNOBSERVED
  # obligation at L4 — which would make the row fail for a missing runner rather
  # than for a missing receipt. Script bodies avoid `process` and signal failure
  # by throwing, as the runbook requires.
  cat > "$DEST/smoke.mjs" <<'SMOKE'
// smoke.mjs — the fixture's project-owned smoke check.
import {slugify} from './src/slugify.ts';

if (slugify('Hello World!') !== 'hello-world') throw new Error('smoke failed: slugify did not produce hello-world');
console.log('smoke ok');
SMOKE
  cat > "$DEST/perf.mjs" <<'PERF'
// perf.mjs — a budget check over the fixture's one hot path.
import {slugify} from './src/slugify.ts';

// `process` is deliberately absent: the gate seals the runner-control closure by
// parsing these scripts, and an ambient runtime input leaves that seal open.
const started = Date.now();
for (let i = 0; i < 10_000; i += 1) slugify(`Title number ${i}`);
const elapsedMs = Date.now() - started;
if (elapsedMs > 2000) throw new Error(`perf failed: 10k slugs took ${elapsedMs}ms`);
console.log('perf ok');
PERF
  cat > "$DEST/visual.mjs" <<'VISUAL'
// visual.mjs — the rendered form of a slug, checked as text.
import {slugify} from './src/slugify.ts';

const rendered = ['Caf\u00e9 Society', 'Hello  World'].map((title) => `${title} -> ${slugify(title)}`).join('\n');
if (!rendered.includes('cafe-society')) throw new Error(`visual failed:\n${rendered}`);
console.log('visual ok');
VISUAL
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    pkg.scripts = {...pkg.scripts, smoke: "node smoke.mjs", perf: "node perf.mjs", visual: "node visual.mjs"};
    fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  ' "$DEST/package.json"
fi
if [ "$ARM" = "C" ]; then
  abc_write_tests "$DEST" leading "$FEATURE" "$AC1" "$AC2" "$AC3"
else
  abc_write_tests "$DEST" plain
  abc_bind_test_refs "$SHARD" "tests/slugify.test.ts"
fi

export PATH="$PREFIX/bin:$PATH"
cd "$DEST"

clad sync >>"$LOG" 2>&1 || true
git add -A
git commit --quiet -m "feat: slugify"

# A feature can only be completed from an implementation cycle, so the cycle is
# opened explicitly rather than left to chance.
clad begin "$FEATURE" >>"$LOG" 2>&1 || true
if [ "$STOP_BEFORE_DONE" = "1" ]; then
  # The level is raised while the feature is still in its cycle, so completion —
  # which the row itself runs — publishes an L4 attestation row.
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const raw = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, /assurance_level:/.test(raw)
      ? raw.replace(/assurance_level:.*/, "assurance_level: L4")
      : raw.replace(/^(project:\s*\n)/m, "$1  assurance_level: L4\n"));
  ' "$DEST/spec.yaml"
  clad sync >>"$LOG" 2>&1 || true
fi
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit --quiet -m "chore: open the implementation cycle"
fi

set +e
clad check --tier=pre-push --strict --json > "$RECORD/$ARM.prepush.json" 2>>"$LOG"
PREPUSH_EXIT=$?
set -e
printf 'strict pre-push before completion: exit %s\n' "$PREPUSH_EXIT" | tee -a "$LOG"

if [ "$STOP_BEFORE_DONE" = "1" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit --quiet -m "chore: quality runners and the raised assurance level"
  fi
  printf '%s\n' "$FEATURE" > "$RECORD/$ARM.feature"
  printf '%s\n' "$CRITERIA_RAW" > "$RECORD/$ARM.criteria"
  printf '%s\n' "$AC1" > "$RECORD/$ARM.criterion"
  printf 'in-progress L4 fixture ready: %s (feature %s)\n' "$DEST" "$FEATURE"
  exit 0
fi

# The completion output is itself a side-table row (L0-5), so it is captured
# verbatim rather than summarised.
set +e
clad done "$FEATURE" > "$RECORD/$ARM.done-output.txt" 2>&1
DONE_EXIT=$?
set -e
printf 'completion exit: %s\n' "$DONE_EXIT" | tee -a "$LOG"
cat "$RECORD/$ARM.done-output.txt" >> "$LOG"

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit --quiet -m "chore: completion state"
fi

printf 'done fixture ready: %s (feature %s)\n' "$DEST" "$FEATURE"
printf '%s\n' "$FEATURE" > "$RECORD/$ARM.feature"
printf '%s\n' "$CRITERIA_RAW" > "$RECORD/$ARM.criteria"
printf "%s\n" "$AC1" > "$RECORD/$ARM.criterion"

if [ "$DONE_EXIT" != "0" ]; then
  echo "NOTE: completion did not exit 0 — the rows that need a done feature will say so" >&2
fi
