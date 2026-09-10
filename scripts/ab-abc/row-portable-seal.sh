#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-portable-seal.sh — a record stamped on a messy machine (S-C5)
#
# A working copy is never only what the repository holds. A file browser writes
# its own metadata inside a source folder, and a project ignores fixtures it
# still keeps on disk. The row puts both inside a folder the record seals, runs
# the passing gate that writes the record, commits it, and then clones the
# commit into a fresh directory — the same thing continuous integration does —
# and runs the strict check there.
#
# The question is whether the record describes the commit or the machine that
# wrote it. If it describes the machine, the clone recomputes different seals,
# reports every completed feature as stale, and exits non-zero: green here, red
# everywhere else. If it describes the commit, the clone accepts the file
# unchanged.
#
# The released engine writes no third-generation record to compare, so only the
# candidate arm runs.
#
# Called by sidetable.ts as: bash row-portable-seal.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
PREFIX="$ABC_ROOT/prefix-$ARM"

if [ "$ARM" != "C" ]; then
  echo "not applicable: the released engine writes no third-generation record to compare"
  exit 0
fi
if [ ! -x "$PREFIX/bin/clad" ]; then
  echo "no engine at $PREFIX/bin/clad — the row cannot run"
  exit 3
fi
export PATH="$PREFIX/bin:$PATH"
cd "$CWD"
echo "engine: $(command -v clad) $(clad --version)"

# 0 — the fixture must be a repository, because the question is about what a
# clone of a commit sees. A fixture that is not one makes the row meaningless.
if [ ! -d .git ]; then
  git init -q
  git config user.email "row@example.invalid"
  git config user.name "Side table"
fi
printf 'ignored-fixture/\n*.local.json\n' >> .gitignore
git add -A
git -c commit.gpgsign=false commit -q -m "fixture before the stray files" || true

# 1 — the stray files: one desktop metadata file inside a sealed source folder,
# one ignored fixture beside it, one ignored control at the root.
SEALED="$(node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const dirs = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { dirs.push(full); walk(full); }
    }
  };
  walk("src");
  process.stdout.write(dirs[0] ?? "src");
' 2>/dev/null || echo src)"
mkdir -p "$SEALED"
printf 'desktop metadata\n' > "$SEALED/.DS_Store"
printf '{"scratch": true}\n' > "$SEALED/notes.local.json"
mkdir -p ignored-fixture
printf '{"name": "ignored-fixture"}\n' > ignored-fixture/package.json
echo "stray files written under: $SEALED (plus ignored-fixture/)"

# 2 — the passing gate stamps the record on this messy machine.
set +e
clad check --tier=pre-push --json > "$OUT/prepush-$ARM.json" 2>"$OUT/prepush-$ARM.err"
STAMP=$?
set -e
echo "pre-push exit on the messy working copy: $STAMP"

FILE="$(find spec -name 'attestation*.y*ml' 2>/dev/null | head -1 || true)"
if [ -z "$FILE" ]; then
  echo "no record was written — the row has nothing to compare"
  exit 2
fi
echo "record: $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes)"
cp "$FILE" "$OUT/attestation-stamped-$ARM.yaml"

# 3 — commit the record exactly as an adopter would, then clone the commit.
git add -A
git -c commit.gpgsign=false commit -q -m "stamped on a machine holding stray files"
CLONE="$OUT/clone-$ARM"
rm -rf "$CLONE"
git clone -q "$CWD" "$CLONE"
if [ -d node_modules ]; then cp -R node_modules "$CLONE/node_modules"; fi
echo "cloned the commit to: $CLONE"

# 4 — the check a fresh clone runs. This is the whole row.
cd "$CLONE"
set +e
clad check --tier=pre-commit --strict --json > "$OUT/clone-check-$ARM.json" 2>"$OUT/clone-check-$ARM.err"
CLONE_EXIT=$?
set -e
echo "clone strict pre-commit exit: $CLONE_EXIT"
echo "stale findings in the clone: $(grep -o 'STALE_ATTESTATION' "$OUT/clone-check-$ARM.json" | wc -l | tr -d ' ')"

if cmp -s "$OUT/attestation-stamped-$ARM.yaml" "$FILE"; then
  echo "record after the clone check: byte-identical to the stamped one"
else
  echo "record after the clone check: CHANGED — the clone did not accept what the messy machine wrote"
  diff <(head -40 "$OUT/attestation-stamped-$ARM.yaml") <(head -40 "$FILE") | head -20 || true
fi
