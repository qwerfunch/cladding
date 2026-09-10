#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-migrate.sh — the migration row (L0-11), no agent
#
# Takes the completed 0.1 project arm B built and puts the candidate's migration
# through both answers from the SAME commit: the legacy-baseline decision
# rejected, then accepted. Three things are then checkable — that the preview
# writes nothing, that a rejected baseline still leaves a workspace the gate
# accepts, and that the accepted result passes the candidate's own strict
# pre-push gate (G4/R4).
#
# The first run measured none of that. It invoked `--preview` and
# `--decisions reject|accept`, neither of which exists: every migrate call died
# with "unknown option" and the strict pre-push that followed was run on an
# unmigrated 0.1 tree, so its exit 0 said nothing about the migration. The real
# surface is a read-only `clad migrate --to 0.2 --json` preview followed by
# `--apply --resolutions <file>`, where the file carries the reviewed
# `previewDigest` and one confirmation per required decision. Accept and reject
# are not whole-migration modes: the only two-valued decision is
# PROJECT_LEGACY_L2_BASELINE, which is what this row now varies.
#
# The porcelain check also counted the fixture's own `node_modules` symlink as a
# changed path, which is why "preview left 1 changed paths" was reported for a
# preview that in fact wrote nothing.
#
# Called by sidetable.ts as: bash row-migrate.sh <arm> <cwd> <artifact-dir>
set -euo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
PREFIX_C="$ABC_ROOT/prefix-C"
SOURCE="$ABC_ROOT/sidetable/done/B"

if [ "$ARM" != "C" ]; then
  echo "not applicable: migrating to the newer schema is the candidate's verb"
  exit 0
fi
if [ ! -d "$SOURCE" ]; then
  echo "no completed 0.1 fixture at $SOURCE — the row cannot run"
  exit 3
fi

export PATH="$PREFIX_C/bin:$PATH"
echo "engine: $(command -v clad) $(clad --version)"

run_pass() {
  local label="$1" dir="$2"
  rm -rf "$dir"
  mkdir -p "$dir"
  rsync -a --exclude 'node_modules' "$SOURCE/" "$dir/"
  if [ -d "$SOURCE/node_modules" ]; then ln -s "$SOURCE/node_modules" "$dir/node_modules"; fi
  echo "--- $label ---"
  ( cd "$dir" && git rev-parse HEAD )
}

# The symlinked dependencies are the harness's own doing, so they never count as
# a path the engine changed.
changed_paths() {
  ( cd "$1" && git status --porcelain ) | grep -v ' node_modules$' | grep -v '^?? node_modules' || true
}

# Turns a reviewed preview into the decision file `--apply` requires. Every
# required decision is confirmed; the two-valued one carries the row's answer.
write_resolutions() {
  local preview="$1" out="$2" baseline="$3"
  node -e '
    const fs = require("node:fs");
    const [previewPath, outPath, baseline] = process.argv.slice(1);
    const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
    const confirmed = (preview.requiredResolution ?? []).map((item) => {
      if (item.code === "PROJECT_LEGACY_L2_BASELINE") return {code: item.code, subject: item.subject, value: baseline};
      // The 0.1 fixture declares `layers: []` — an empty list the preview will
      // not project on its own. The reviewed answer is therefore "still none":
      // naming a layer here would invent a `src/<layer>/` directory the project
      // does not have, and the gate would then refuse the migrated workspace for
      // an invention of the harness rather than anything the migration did.
      if (item.code === "ARCHITECTURE_LAYER_RESOLUTION") return {code: item.code, subject: item.subject, value: {layers: []}};
      if (item.code === "CRITERION_TEXT_UNKNOWN" || item.code === "CRITERION_STATEMENT_CONFLICT") {
        return {
          code: item.code,
          subject: item.subject,
          value: {statement: "The system shall retain an explicitly reviewed historic criterion.", kind: "behavior", testBindingDisposition: "drop"},
        };
      }
      return {code: item.code, subject: item.subject};
    });
    fs.writeFileSync(outPath, `${JSON.stringify({previewDigest: preview.previewDigest, confirmed}, null, 2)}\n`);
    process.stdout.write(`decisions written: ${confirmed.length} (${[...new Set(confirmed.map((c) => c.code))].join(", ") || "none"})\n`);
  ' "$preview" "$out" "$baseline"
}

# 1 — preview, which must not write anything.
WORK="$CWD/.migrate-preview"
run_pass preview "$WORK"
set +e
( cd "$WORK" && clad migrate --to 0.2 --json ) > "$OUT/migrate-preview.json" 2> "$OUT/migrate-preview.err"
echo "preview exit: $?"
set -e
changed_paths "$WORK" > "$OUT/migrate-preview.status"
echo "preview left $(wc -l < "$OUT/migrate-preview.status" | tr -d ' ') changed paths (0 is the honest answer)"
head -c 300 "$OUT/migrate-preview.err"

# 2 — apply with the legacy-baseline decision rejected.
WORK="$CWD/.migrate-reject"
run_pass reject "$WORK"
set +e
( cd "$WORK" && clad migrate --to 0.2 --json ) > "$OUT/migrate-reject.preview.json" 2>> "$OUT/migrate-reject.err"
set -e
write_resolutions "$OUT/migrate-reject.preview.json" "$OUT/migrate-reject.resolutions.json" reject
set +e
( cd "$WORK" && clad migrate --to 0.2 --apply --resolutions "$OUT/migrate-reject.resolutions.json" --json ) > "$OUT/migrate-reject.json" 2>> "$OUT/migrate-reject.err"
echo "reject exit: $?"
set -e
changed_paths "$WORK" > "$OUT/migrate-reject.status"
echo "reject changed $(wc -l < "$OUT/migrate-reject.status" | tr -d ' ') paths"
head -c 400 "$OUT/migrate-reject.json"
echo
set +e
( cd "$WORK" && clad sync ) >> "$OUT/migrate-reject.err" 2>&1
( cd "$WORK" && clad check --tier=pre-push --strict --json ) > "$OUT/migrate-reject.prepush.json" 2>> "$OUT/migrate-reject.err"
echo "reject strict pre-push exit: $?"
set -e

# 3 — apply with the legacy baseline accepted, then the candidate's own gate.
WORK="$CWD/.migrate-accept"
run_pass accept "$WORK"
set +e
( cd "$WORK" && clad migrate --to 0.2 --json ) > "$OUT/migrate-accept.preview.json" 2>> "$OUT/migrate-accept.err"
set -e
write_resolutions "$OUT/migrate-accept.preview.json" "$OUT/migrate-accept.resolutions.json" accept
set +e
( cd "$WORK" && clad migrate --to 0.2 --apply --resolutions "$OUT/migrate-accept.resolutions.json" --json ) > "$OUT/migrate-accept.json" 2>> "$OUT/migrate-accept.err"
echo "accept exit: $?"
set -e
changed_paths "$WORK" > "$OUT/migrate-accept.status"
echo "accept changed $(wc -l < "$OUT/migrate-accept.status" | tr -d ' ') paths"
head -c 400 "$OUT/migrate-accept.json"
echo
grep -c 'schema: .0.2.' "$WORK/spec.yaml" > /dev/null 2>&1 && echo "spec.yaml now declares schema 0.2" || echo "spec.yaml does NOT declare schema 0.2"
set +e
( cd "$WORK" && clad sync ) >> "$OUT/migrate-accept.err" 2>&1
( cd "$WORK" && clad check --tier=pre-push --strict --json ) > "$OUT/migrate-accept.prepush.json" 2>> "$OUT/migrate-accept.err"
ACCEPT_GATE=$?
set -e
echo "accept strict pre-push exit: $ACCEPT_GATE"
echo "G4 holds only when that exit is 0"
