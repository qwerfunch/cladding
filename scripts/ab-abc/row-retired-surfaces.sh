#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-retired-surfaces.sh — what is gone is gone (S-G1)
#
# The release removes the experimental headless loop, its command, its skill and
# the parts that existed only to serve it. Removal is a claim about files, so the
# row reads the installed package rather than the source tree: an entry point
# that still ships, or a skill folder still copied into the plugin, would keep
# the command reachable however the release notes phrase it. The scaffold is
# checked too, because a project told to run a command that no longer exists is
# worse off than one never told about it.
#
# Called by sidetable.ts as: bash row-retired-surfaces.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ ! -x "$PREFIX/bin/clad" ]; then
  echo "no engine at $PREFIX/bin/clad — the row cannot run"
  exit 3
fi
export PATH="$PREFIX/bin:$PATH"
echo "engine: $(command -v clad) $(clad --version)"

ROOT="$(node -e '
  const path = require("node:path");
  const fs = require("node:fs");
  const prefix = process.argv[1];
  const candidates = [
    path.join(prefix, "lib", "node_modules", "cladding"),
    path.join(prefix, "node_modules", "cladding"),
  ];
  const found = candidates.find((dir) => fs.existsSync(dir));
  process.stdout.write(found ?? "");
' "$PREFIX")"
if [ -z "$ROOT" ]; then
  echo "the installed package root could not be located under $PREFIX"
  exit 3
fi
echo "installed package: $ROOT"

# `grep` exits non-zero when it matches nothing, and matching nothing is the
# answer this row is hoping for — so every count is taken with the pipeline's
# failure explicitly swallowed, or an empty result would look like a broken row.
count_matching() {
  local label="$1"; shift
  local hits
  hits="$(find "$ROOT" "$@" 2>/dev/null | { grep -v '/node_modules/' || true; })"
  local n=0
  if [ -n "$hits" ]; then n="$(printf '%s\n' "$hits" | wc -l | tr -d ' ')"; fi
  echo "$label: $n"
  if [ -n "$hits" ]; then printf '%s\n' "$hits" | head -8 | sed 's/^/  path: /'; fi
}
count_matching "skills/run folders in the installed package" -type d -name run -path '*skills*'
count_matching "drive modules in the installed package" -type f -name 'drive*'
count_matching "run skill documents in the installed package" -type f -path '*skills/run/*'

RUN_IN_HELP="$(clad --help 2>&1 | { grep -cE '^[[:space:]]+run[[:space:]]' || true; })"
echo "run command in --help: $RUN_IN_HELP"
set +e
clad run --help > "$OUT/run-help-$ARM.log" 2>&1
RUN_EXIT=$?
set -e
echo "clad run exit: $RUN_EXIT"
echo "clad run said: $(head -c 300 "$OUT/run-help-$ARM.log" | tr '\n' ' ')"
# Exit code alone is not the answer: an unknown verb can still print the root
# help and exit 0. What settles it is whether the loop's own description comes
# back, and whether the shipped bundle still carries the loop at all — the
# published package inlines its modules, so a file name search over the tree
# finds nothing on either engine and would report a retirement that never
# happened.
echo "run verb reachable: $(grep -qF 'Headless autonomous loop' "$OUT/run-help-$ARM.log" && echo yes || echo no)"
BUNDLE="$ROOT/dist/clad.js"
if [ -f "$BUNDLE" ]; then
  echo "shipped bundle: $BUNDLE ($(wc -c < "$BUNDLE" | tr -d ' ') bytes)"
  echo "bundle carries the loop description: $(grep -qF 'Headless autonomous loop' "$BUNDLE" && echo yes || echo no)"
  echo "bundle carries the loop driver: $(grep -qE 'runDriveLoop|drive-loop' "$BUNDLE" && echo yes || echo no)"
  echo "bundle carries the crash postmortem: $(grep -qiE 'postmortem' "$BUNDLE" && echo yes || echo no)"
else
  echo "shipped bundle: (not found at $BUNDLE)"
fi

if [ -f "$CWD/AGENTS.md" ]; then
  echo "scaffold AGENTS.md mentions clad run: $(grep -qF 'clad run' "$CWD/AGENTS.md" && echo yes || echo no)"
else
  echo "scaffold AGENTS.md mentions clad run: (no AGENTS.md in this fixture)"
fi
