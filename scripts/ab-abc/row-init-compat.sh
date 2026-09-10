#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-init-compat.sh — the back-compatible scaffold (S-A2)
#
# The candidate keeps the old spec format as a first-class choice, so asking for
# it explicitly should give a project the released engine's own scaffold, not a
# new-format one wearing an old label. The row builds both from the identical
# template inside a single run — self-contained on purpose, so it never depends
# on which arm the runner happened to execute first — and reports how far apart
# they are: the managed AGENTS.md block, the CLAUDE.md section each engine's
# `update` writes, and spec.yaml with the engine's own version string excluded,
# since that line is expected to differ and says nothing about the scaffold.
#
# Called by sidetable.ts as: bash row-init-compat.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"

if [ "$ARM" != "C" ]; then
  echo "not applicable: the comparison runs both engines from one script, on the C pass"
  exit 0
fi
for arm in B C; do
  if [ ! -x "$ABC_ROOT/prefix-$arm/bin/clad" ]; then
    echo "no engine at $ABC_ROOT/prefix-$arm/bin/clad — the row cannot run"
    exit 3
  fi
done

echo "released engine: $("$ABC_ROOT/prefix-B/bin/clad" --version)"
echo "candidate engine: $("$ABC_ROOT/prefix-C/bin/clad" --version)"

# Both scaffolds are built from the row's own checkout of the untouched
# template, so the input is identical by construction.
build() {
  local arm="$1" dir="$2"; shift 2
  rm -rf "$dir"; mkdir -p "$dir"
  ( cd "$CWD" && tar cf - --exclude node_modules . ) | ( cd "$dir" && tar xf - )
  if [ -d "$CWD/node_modules" ]; then ln -s "$CWD/node_modules" "$dir/node_modules"; fi
  ( cd "$dir" && "$ABC_ROOT/prefix-$arm/bin/clad" "$@" ) > "$OUT/init-$arm.stdout" 2>&1 || true
  # CLAUDE.md is never created by onboarding; `update` is the verb that writes
  # the managed section, so the comparison asks for it explicitly.
  ( cd "$dir" && "$ABC_ROOT/prefix-$arm/bin/clad" update ) > "$OUT/update-$arm.stdout" 2>&1 || true
}

# The engine names a fresh project after its own directory, so both scaffolds
# are built in identically named directories under different parents: otherwise
# every comparison carries the harness's own folder names as a difference.
B_DIR="$OUT/pass-B/scaffold"
C_DIR="$OUT/pass-C/scaffold"
build B "$B_DIR" init --no-llm
build C "$C_DIR" init --schema 0.1 --no-llm

echo "released scaffold spec.yaml schema: $(grep -m1 -E '^[[:space:]]*schema:' "$B_DIR/spec.yaml" || echo '(absent)')"
echo "candidate scaffold spec.yaml schema: $(grep -m1 -E '^[[:space:]]*schema:' "$C_DIR/spec.yaml" || echo '(absent)')"

# The engine stamps its own version into spec.yaml; that line is expected to
# differ and is not part of the question.
strip_version() { sed -E 's/^([[:space:]]*version:[[:space:]]*).*$/\1<engine version>/' "$1"; }

compare_file() {
  local label="$1" rel="$2" filter="$3"
  local b="$B_DIR/$rel" c="$C_DIR/$rel"
  if [ ! -f "$b" ] || [ ! -f "$c" ]; then
    echo "$label: released $( [ -f "$b" ] && echo present || echo absent ), candidate $( [ -f "$c" ] && echo present || echo absent )"
    return
  fi
  if [ "$filter" = "strip-version" ]; then
    strip_version "$b" > "$OUT/$rel.B.cmp"; strip_version "$c" > "$OUT/$rel.C.cmp"
  else
    cp "$b" "$OUT/$rel.B.cmp"; cp "$c" "$OUT/$rel.C.cmp"
  fi
  local lines
  lines="$(diff -u "$OUT/$rel.B.cmp" "$OUT/$rel.C.cmp" | grep -c '^[+-][^+-]' || true)"
  echo "$label diff lines: $lines"
  echo "$label bytes: released $(wc -c < "$b" | tr -d ' '), candidate $(wc -c < "$c" | tr -d ' ')"
  if [ "$lines" != "0" ]; then
    diff -u "$OUT/$rel.B.cmp" "$OUT/$rel.C.cmp" > "$OUT/$rel.diff" || true
    echo "$label first differing lines:"
    head -20 "$OUT/$rel.diff" || true
  fi
}

compare_file "AGENTS.md" "AGENTS.md" plain
compare_file "CLAUDE.md" "CLAUDE.md" plain
compare_file "spec.yaml" "spec.yaml" strip-version
echo "artifacts under $B_DIR and $C_DIR"
