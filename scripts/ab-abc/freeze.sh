#!/usr/bin/env bash
# Cladding · scripts/ab-abc/freeze.sh — pin both engines before a campaign runs.
#
# Arm B is the released cladding@0.9.4 from the registry; arm C is a tarball
# packed from this checkout. Both land in private prefixes so nothing on the
# machine's global PATH can decide which engine a cell used. Everything the
# campaign later claims about "which engine" traces back to env.log written here:
# the repo commit, whether the tree was dirty at pack time, both versions, and
# the sha256 of the packed dist against the repo build.
#
# Usage: ABC_ROOT=~/abc-0100 bash scripts/ab-abc/freeze.sh
set -euo pipefail

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_REPO="${ABC_REPO:-/Users/qwerfunch/Developer/work/cladding}"
ABC_B_VERSION="${ABC_B_VERSION:-0.9.4}"

PREFIX_B="$ABC_ROOT/prefix-B"
PREFIX_C="$ABC_ROOT/prefix-C"
ENV_LOG="$ABC_ROOT/env.log"

mkdir -p "$ABC_ROOT" "$PREFIX_B" "$PREFIX_C"
: > "$ENV_LOG"

log() { printf '%s\n' "$*" | tee -a "$ENV_LOG"; }

log "# ab-abc freeze — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "root: $ABC_ROOT"
log "repo: $ABC_REPO"
log "node: $(node --version)"
log "npm:  $(npm --version)"

# ── repo identity (honest even when the tree is dirty) ────────────────────────
cd "$ABC_REPO"
log "repo HEAD: $(git rev-parse HEAD)"
log "repo branch: $(git rev-parse --abbrev-ref HEAD)"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
log "repo dirty files at pack time: $DIRTY"
if [ "$DIRTY" != "0" ]; then
  log "--- dirty tree (the packed engine is NOT a clean commit) ---"
  git status --porcelain | tee -a "$ENV_LOG"
fi

# ── arm C: build, pack, install ───────────────────────────────────────────────
log "## arm C — packing this checkout"
npm run build >>"$ENV_LOG" 2>&1
TARBALL_NAME="$(npm pack --pack-destination "$ABC_ROOT" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s)[0].filename))')"
TARBALL="$ABC_ROOT/$TARBALL_NAME"
log "tarball: $TARBALL ($(wc -c <"$TARBALL" | tr -d ' ') bytes)"
npm install -g --prefix "$PREFIX_C" "$TARBALL" >>"$ENV_LOG" 2>&1

# ── arm B: the released engine ────────────────────────────────────────────────
log "## arm B — installing cladding@$ABC_B_VERSION from the registry"
npm install -g --prefix "$PREFIX_B" "cladding@$ABC_B_VERSION" >>"$ENV_LOG" 2>&1

# ── identity checks ───────────────────────────────────────────────────────────
for arm in B C; do
  case "$arm" in
    B) prefix="$PREFIX_B" ;;
    C) prefix="$PREFIX_C" ;;
  esac
  bin="$prefix/bin/clad"
  [ -x "$bin" ] || { echo "arm $arm: $bin is not executable" >&2; exit 1; }
  log "arm $arm version: $(PATH="$prefix/bin:$PATH" clad --version)"
  log "arm $arm resolved bin: $(PATH="$prefix/bin:$PATH" command -v clad)"
  dist="$prefix/lib/node_modules/cladding/dist/clad.js"
  log "arm $arm dist sha256: $(shasum -a 256 "$dist" | cut -d' ' -f1)  ($dist)"
done

log "repo dist sha256: $(shasum -a 256 "$ABC_REPO/dist/clad.js" | cut -d' ' -f1)"

C_SHA="$(shasum -a 256 "$PREFIX_C/lib/node_modules/cladding/dist/clad.js" | cut -d' ' -f1)"
REPO_SHA="$(shasum -a 256 "$ABC_REPO/dist/clad.js" | cut -d' ' -f1)"
if [ "$C_SHA" != "$REPO_SHA" ]; then
  log "FAIL: arm C's packed engine differs from the repo build — do not run the campaign"
  exit 1
fi
log "OK: arm C's packed engine is byte-identical to the repo build"

# The budget ledger starts here, so a re-freeze never silently resets spending.
if [ ! -f "$ABC_ROOT/budget.json" ]; then
  printf '{"spentUsd": 0, "capUsd": 40, "runs": []}\n' > "$ABC_ROOT/budget.json"
  log "budget ledger created at $ABC_ROOT/budget.json (cap \$40)"
else
  log "budget ledger kept: $(cat "$ABC_ROOT/budget.json" | tr -d '\n')"
fi

log "freeze complete"
