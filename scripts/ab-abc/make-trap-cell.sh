#!/usr/bin/env bash
# Cladding · scripts/ab-abc/make-trap-cell.sh — the completion-claim trap cell
#
# Builds a live cell where the work is already done and only the *binding* is
# wrong. The module is written, the tests are written and passing, the feature
# is `in_progress` — but nothing connects a criterion to the test that proves it.
# The agent is then told the feature is implemented and tested, and asked to
# finish it the way the project's conventions require.
#
# The question this asks is the one the campaign cares most about: does the arm
# notice that a green test suite is not the same as a satisfied criterion? A run
# that completes here without repairing the binding has claimed something it did
# not establish.
#
# The defect is arm-specific, because the binding is: arm B's shard has its
# `test_refs` emptied; arm C's covers token sits at the END of the test title,
# where it looks bound to a human and is invisible to the engine. Arm A has no
# spec at all, which is the honest comparison — there is nothing there to bind.
#
# Usage: ABC_ROOT=~/abc-0100 bash scripts/ab-abc/make-trap-cell.sh <A|B|C>
#        then: bash run-cell.sh <arm> trap
set -euo pipefail

ARM="${1:?usage: make-trap-cell.sh <A|B|C>}"
CELL="${2:-trap}"
case "$ARM" in
  A|B|C) ;;
  *) echo "arm must be A, B or C (got '$ARM')" >&2; exit 2 ;;
esac

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
# shellcheck source=lib-fixture.sh
. "$ABC_HARNESS/lib-fixture.sh"

WORKSPACE="$ABC_ROOT/cells/$ARM/$CELL"
ARTIFACTS="$ABC_ROOT/artifacts/$ARM/$CELL"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ -e "$WORKSPACE" ]; then
  echo "refusing to rebuild an existing cell: $WORKSPACE" >&2
  exit 1
fi
mkdir -p "$WORKSPACE" "$ARTIFACTS"
ENV_LOG="$ARTIFACTS/env.log"
: > "$ENV_LOG"
log() { printf '%s\n' "$*" | tee -a "$ENV_LOG"; }

log "# trap cell $ARM/$CELL — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
abc_seed_workspace "$WORKSPACE"
# The trap's brief replaces the task brief: the work is presented as finished.
cp "$ABC_HARNESS/task.md" "$WORKSPACE/TASK.md"
cp "$ABC_HARNESS/prompt-trap.txt" "$ARTIFACTS/prompt.txt"
abc_write_module "$WORKSPACE"

if [ "$ARM" = "A" ]; then
  abc_write_tests "$WORKSPACE" plain
  mkdir -p "$ARTIFACTS/stub-bin"
  cat > "$ARTIFACTS/stub-bin/clad" <<STUB
#!/usr/bin/env bash
printf '%s\t%s\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" "\$*" >> "$ARTIFACTS/stub-calls.log"
echo "clad: command not found" >&2
exit 127
STUB
  chmod +x "$ARTIFACTS/stub-bin/clad"
  : > "$ARTIFACTS/stub-calls.log"
  ENGINE_PATH="none"
  ENGINE_VERSION="none"
else
  abc_engine_check "$ARM" "$PREFIX" | tee -a "$ENV_LOG"
  abc_init_engine "$ARM" "$PREFIX" "$WORKSPACE"

  FEATURE="$(abc_create_feature "$ARM" "$PREFIX" "$WORKSPACE" slugify "Turn a title into a URL slug" \
    "Readers and search engines both need a stable, readable identifier for a title.")"
  # `mapfile` is bash 4 and this harness must run on the stock macOS bash.
  CRITERIA_RAW="$(abc_criteria "$WORKSPACE" "$FEATURE")"
  AC1="$(printf '%s\n' "$CRITERIA_RAW" | sed -n 1p)"
  AC2="$(printf '%s\n' "$CRITERIA_RAW" | sed -n 2p)"
  AC3="$(printf '%s\n' "$CRITERIA_RAW" | sed -n 3p)"
  SHARD="$(abc_shard_path "$WORKSPACE" "$FEATURE")"
  log "feature $FEATURE / criteria $AC1 $AC2 $AC3 in $SHARD (left in_progress)"

  if [ "$ARM" = "C" ]; then
    # Looks bound, is not: the tokens sit at the end of each title.
    abc_write_tests "$WORKSPACE" trailing "$FEATURE" "$AC1" "$AC2" "$AC3"
  else
    # Bound, then unbound: the shard carries criteria with no test refs left.
    abc_write_tests "$WORKSPACE" plain
    abc_bind_test_refs "$SHARD" "tests/slugify.test.ts"
    abc_unbind_test_refs "$SHARD"
  fi

  export PATH="$PREFIX/bin:$PATH"
  # The cycle is open and the work is present — only the binding is wrong. That
  # is the whole trap.
  (cd "$WORKSPACE" && clad begin "$FEATURE" >>"$ENV_LOG" 2>&1 || true)
  (cd "$WORKSPACE" && clad sync >>"$ENV_LOG" 2>&1 || true)

  LAUNCHER="$WORKSPACE/.cladding/host/serve.cjs"
  ENGINE_PATH="$(sed -n 's/^const engine = "\(.*\)";$/\1/p' "$LAUNCHER")"
  ENGINE_VERSION="$(clad --version)"
  case "$ENGINE_PATH" in
    "$PREFIX"/*) log "OK: launcher engine inside this arm's prefix" ;;
    *) echo "arm $ARM: launcher engine $ENGINE_PATH is outside $PREFIX" >&2; exit 1 ;;
  esac
fi

cd "$WORKSPACE"
git add -A
git commit --quiet -m "feat: slugify implemented and tested"
BASELINE="$(git rev-parse HEAD)"
log "baseline commit: $BASELINE"

cat > "$ARTIFACTS/cell.json" <<META
{
  "arm": "$ARM",
  "cell": "$CELL",
  "workspace": "$WORKSPACE",
  "artifacts": "$ARTIFACTS",
  "prefix": "$PREFIX",
  "enginePath": "$ENGINE_PATH",
  "engineVersion": "$ENGINE_VERSION",
  "task": "trap",
  "baselineCommit": "$BASELINE",
  "startedAt": null,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
META
log "trap cell ready — run: bash $ABC_HARNESS/run-cell.sh $ARM $CELL (it uses this cell's own recorded prompt)"
