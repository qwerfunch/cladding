#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-init.sh — what each engine's own scaffold says (S-A1)
#
# Runs each engine's default onboarding over the identical untouched template and
# writes down what the project is told. The question is not whether a scaffold
# appears — both produce one — but whether the instructions it leaves behind name
# the binding the engine actually reads. On schema 0.2 a test claims a criterion
# only by opening its own title with that criterion's tag, so a scaffold that
# never mentions the tag is telling an adopter to do something the gate ignores.
#
# Called by sidetable.ts as: bash row-init.sh <arm> <cwd> <artifact-dir>
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
cd "$CWD"
echo "engine: $(command -v clad) $(clad --version)"

if [ "$ARM" = "C" ]; then
  set +e; clad init --schema 0.2 --no-llm > "$OUT/init-$ARM.stdout" 2>&1; INIT_EXIT=$?; set -e
  echo "init command: clad init --schema 0.2 --no-llm"
else
  set +e; clad init --no-llm > "$OUT/init-$ARM.stdout" 2>&1; INIT_EXIT=$?; set -e
  echo "init command: clad init --no-llm"
fi
echo "init exit: $INIT_EXIT"

# --- what spec.yaml declares -------------------------------------------------
field() {
  local key="$1"
  local value
  value="$(grep -m1 -E "^[[:space:]]*${key}:" spec.yaml 2>/dev/null | sed -E "s/^[[:space:]]*${key}:[[:space:]]*//" || true)"
  if [ -z "$value" ]; then echo "(absent)"; else echo "$value"; fi
}
echo "spec.yaml present: $([ -f spec.yaml ] && echo yes || echo no)"
echo "spec.yaml schema: $(field schema)"
echo "spec.yaml assurance_level: $(field assurance_level)"
echo "spec.yaml scenario_policy: $(field scenario_policy)"
echo "spec.yaml project purpose: $(field purpose)"

# --- what the managed instructions say ---------------------------------------
present() { if [ -f "$1" ] && grep -qF "$2" "$1"; then echo present; else echo absent; fi; }
echo "AGENTS.md present: $([ -f AGENTS.md ] && echo yes || echo no)"
echo "AGENTS.md covers token: $(present AGENTS.md '[covers:')"
echo "AGENTS.md clad_begin: $(present AGENTS.md 'clad_begin')"
echo "AGENTS.md feature-cycle heading: $(present AGENTS.md 'Feature cycle')"
echo "AGENTS.md clad run mention: $(present AGENTS.md 'clad run')"
# `clad init` never creates CLAUDE.md — the file belongs to the adopter, and only
# `clad update` writes the managed section into one that already exists. Recorded
# here as the fact it is, because the row's pre-registered guess named it.
echo "CLAUDE.md present after init: $([ -f CLAUDE.md ] && echo yes || echo no)"
echo "CLAUDE.md covers sentence: $(present CLAUDE.md '[covers:')"

cp -f AGENTS.md "$OUT/AGENTS-$ARM.md" 2>/dev/null || true
cp -f spec.yaml "$OUT/spec-$ARM.yaml" 2>/dev/null || true
echo "scaffold recorded to $OUT/AGENTS-$ARM.md and $OUT/spec-$ARM.yaml"
