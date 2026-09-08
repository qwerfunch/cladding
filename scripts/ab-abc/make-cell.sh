#!/usr/bin/env bash
# Cladding · scripts/ab-abc/make-cell.sh — build one campaign cell's fixture.
#
# Every arm gets the byte-identical template, the byte-identical TASK.md, and a
# git history whose baseline commit is taken AFTER the arm's own setup — so the
# agent's `git status` afterwards shows only what the agent did. The arms differ
# in exactly one thing: which engine, if any, is on PATH.
#
#   A  no engine. A `clad` stub earlier on PATH records every call and exits 127,
#      so a reach for the harness is visible instead of silent.
#   B  cladding@0.9.4 from prefix-B, `clad init --no-llm` (schema 0.1) + setup.
#   C  the packed 0.10.0 from prefix-C, `clad init --schema 0.2 --no-llm` + setup.
#
# Usage: ABC_ROOT=~/abc-0100 bash scripts/ab-abc/make-cell.sh <A|B|C> <cell-name>
#   ABC_TASK=task2.md  swaps in the second feature's brief.
#   ABC_SKIP_ENGINE=1  builds the fixture only (used for dry-running arm A).
#   ABC_FROM=<arm>/<cell>  seeds this cell from a FINISHED cell instead of the
#                     template — the continuation case, where a second feature
#                     lands in a workspace that already completed one.
set -euo pipefail

ARM="${1:?usage: make-cell.sh <A|B|C> <cell-name>}"
CELL="${2:?usage: make-cell.sh <A|B|C> <cell-name>}"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
ABC_TASK="${ABC_TASK:-task.md}"

case "$ARM" in
  A|B|C) ;;
  *) echo "arm must be A, B or C (got '$ARM')" >&2; exit 2 ;;
esac

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

log "# cell $ARM/$CELL — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "workspace: $WORKSPACE"
log "task brief: $ABC_TASK"

# ── seeded from a finished cell (the continuation case) ───────────────────────
# The whole tree comes across, git history and harness state included, so the new
# cell starts exactly where the old one stopped. `node_modules` is symlinked
# rather than copied — it is byte-identical in every fixture and copying it turns
# a cheap setup into a slow one. Anything the source cell left uncommitted is
# committed here, so this cell's baseline is again a clean HEAD and the agent's
# `git status` stays a record of the agent alone.
if [ -n "${ABC_FROM:-}" ]; then
  SOURCE="$ABC_ROOT/cells/$ABC_FROM"
  [ -d "$SOURCE" ] || { echo "ABC_FROM names no cell: $SOURCE" >&2; exit 1; }
  log "seeded from finished cell: $SOURCE"
  rsync -a --exclude 'node_modules' "$SOURCE/" "$WORKSPACE/"
  if [ -d "$SOURCE/node_modules" ]; then ln -s "$SOURCE/node_modules" "$WORKSPACE/node_modules"; fi
  cp "$ABC_HARNESS/$ABC_TASK" "$WORKSPACE/TASK.md"
  cp "$ABC_HARNESS/prompt.txt" "$ARTIFACTS/prompt.txt"
  cd "$WORKSPACE"
  git config user.name "abc-harness"
  git config user.email "abc-harness@example.invalid"
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit --quiet -m "chore: carry the finished cell forward"
  fi
  if [ "$ARM" = "A" ]; then
    ENGINE_PATH="none"
    ENGINE_VERSION="none"
  else
    LAUNCHER="$WORKSPACE/.cladding/host/serve.cjs"
    ENGINE_PATH="$(sed -n 's/^const engine = "\(.*\)";$/\1/p' "$LAUNCHER")"
    ENGINE_VERSION="$(PATH="$PREFIX/bin:$PATH" clad --version)"
    log "carried-over engine: $ENGINE_PATH ($ENGINE_VERSION)"
    case "$ENGINE_PATH" in
      "$PREFIX"/*) log "OK: the carried launcher still points inside this arm's prefix" ;;
      *) echo "arm $ARM: carried launcher $ENGINE_PATH is outside $PREFIX" >&2; exit 1 ;;
    esac
  fi
  if [ "$ARM" = "A" ]; then
    mkdir -p "$ARTIFACTS/stub-bin"
    cp "$ABC_ROOT/artifacts/$ABC_FROM/stub-bin/clad" "$ARTIFACTS/stub-bin/clad"
    : > "$ARTIFACTS/stub-calls.log"
  fi
  BASELINE="$(git rev-parse HEAD)"
  cat > "$ARTIFACTS/cell.json" <<META
{
  "arm": "$ARM",
  "cell": "$CELL",
  "workspace": "$WORKSPACE",
  "artifacts": "$ARTIFACTS",
  "prefix": "$PREFIX",
  "enginePath": "$ENGINE_PATH",
  "engineVersion": "$ENGINE_VERSION",
  "task": "$ABC_TASK",
  "seededFrom": "$ABC_FROM",
  "baselineCommit": "$BASELINE",
  "startedAt": null,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
META
  log "cell ready (continuation) — run: bash $ABC_HARNESS/run-cell.sh $ARM $CELL"
  exit 0
fi

# ── the common fixture ────────────────────────────────────────────────────────
cp -R "$ABC_HARNESS/template/." "$WORKSPACE/"
cp "$ABC_HARNESS/$ABC_TASK" "$WORKSPACE/TASK.md"
cp "$ABC_HARNESS/prompt.txt" "$ARTIFACTS/prompt.txt"
mkdir -p "$WORKSPACE/src" "$WORKSPACE/tests"
log "template sha256: $(find "$WORKSPACE" -type f -not -path '*/.git/*' -exec shasum -a 256 {} \; | sort -k2 | shasum -a 256 | cut -d' ' -f1)"

cd "$WORKSPACE"
npm ci >>"$ENV_LOG" 2>&1
log "npm ci complete ($(ls node_modules | wc -l | tr -d ' ') top-level packages)"

git init --quiet
git config user.name "abc-harness"
git config user.email "abc-harness@example.invalid"
git add -A
git commit --quiet -m "chore: project skeleton"
log "baseline commit (skeleton): $(git rev-parse HEAD)"

# ── the one thing that differs ────────────────────────────────────────────────
if [ "$ARM" = "A" ]; then
  mkdir -p "$ARTIFACTS/stub-bin"
  cat > "$ARTIFACTS/stub-bin/clad" <<STUB
#!/usr/bin/env bash
# Arm A carries no engine. This stub records the attempt and fails loudly, so a
# contaminated cell is detectable rather than quietly identical to arm B or C.
printf '%s\t%s\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" "\$*" >> "$ARTIFACTS/stub-calls.log"
echo "clad: command not found" >&2
exit 127
STUB
  chmod +x "$ARTIFACTS/stub-bin/clad"
  : > "$ARTIFACTS/stub-calls.log"
  # The stub lives outside the workspace on purpose: arm A's git tree must stay
  # byte-identical to the other arms before setup, or `git status` stops being a
  # clean record of what the agent did.
  log "arm A: clad stub installed at $ARTIFACTS/stub-bin/clad (exit 127, logged)"
  ENGINE_PATH="none"
  ENGINE_VERSION="none"
elif [ "${ABC_SKIP_ENGINE:-0}" = "1" ]; then
  log "ABC_SKIP_ENGINE=1 — fixture built, engine setup skipped"
  ENGINE_PATH="skipped"
  ENGINE_VERSION="skipped"
else
  [ -x "$PREFIX/bin/clad" ] || { echo "arm $ARM: no engine at $PREFIX/bin/clad — run freeze.sh first" >&2; exit 1; }
  export PATH="$PREFIX/bin:$PATH"
  ENGINE_VERSION="$(clad --version)"
  log "arm $ARM engine: $(command -v clad) → $ENGINE_VERSION"

  if [ "$ARM" = "C" ]; then
    clad init --schema 0.2 --no-llm >>"$ENV_LOG" 2>&1
  else
    clad init --no-llm >>"$ENV_LOG" 2>&1
  fi
  clad setup --host claude >>"$ENV_LOG" 2>&1

  LAUNCHER="$WORKSPACE/.cladding/host/serve.cjs"
  [ -f "$LAUNCHER" ] || { echo "arm $ARM: setup wrote no launcher at $LAUNCHER" >&2; exit 1; }
  ENGINE_PATH="$(sed -n 's/^const engine = "\(.*\)";$/\1/p' "$LAUNCHER")"
  log "launcher engine path: $ENGINE_PATH"
  case "$ENGINE_PATH" in
    "$PREFIX"/*) log "OK: the launcher points inside this arm's prefix" ;;
    *) echo "arm $ARM: launcher engine $ENGINE_PATH is outside $PREFIX — cell is not isolated" >&2; exit 1 ;;
  esac
  log "mcp config: $(cat "$WORKSPACE/.mcp.json" | tr -d '\n ')"

  git add -A
  git commit --quiet -m "chore: cladding harness"
  log "baseline commit (harness): $(git rev-parse HEAD)"
fi

BASELINE="$(git rev-parse HEAD)"
cat > "$ARTIFACTS/cell.json" <<META
{
  "arm": "$ARM",
  "cell": "$CELL",
  "workspace": "$WORKSPACE",
  "artifacts": "$ARTIFACTS",
  "prefix": "$PREFIX",
  "enginePath": "$ENGINE_PATH",
  "engineVersion": "$ENGINE_VERSION",
  "task": "$ABC_TASK",
  "baselineCommit": "$BASELINE",
  "startedAt": null,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
META
log "cell.json written"
log "cell ready — run: bash $ABC_HARNESS/run-cell.sh $ARM $CELL"
