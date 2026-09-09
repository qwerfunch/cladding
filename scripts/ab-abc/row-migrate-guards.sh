#!/usr/bin/env bash
# Cladding · scripts/ab-abc/row-migrate-guards.sh — the three guards around a
# schema migration (S-F2)
#
# L0-11 shows the migration doing its job. This row asks what stops it, because a
# migration rewrites the files a project's whole history is addressed by and the
# recoverable-transaction claim is only as good as its refusals:
#
#   dirty      a planned path with uncommitted work is refused (DIRTY_PLANNED_PATH):
#              applying over it would bury a change git cannot show anyone again.
#   answered   once the legacy-baseline question has been answered and applied,
#              answering it the other way must not quietly re-decide it.
#   unreadable a 0.1 criterion whose sentence the 0.2 grammar cannot parse must
#              become a question for a human, not a guess by the tool.
#
# Every pass runs on its own copy of the completed 0.1 project, so a refusal in
# one cannot be mistaken for a state left by another.
#
# Called by sidetable.ts as: bash row-migrate-guards.sh <arm> <cwd> <artifact-dir>
set -uo pipefail

ARM="$1"
CWD="$2"
OUT="$3"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
SOURCE="$ABC_ROOT/sidetable/done/B"

if [ "$ARM" != "C" ]; then
  echo "not applicable: migrating to the newer schema is the candidate's verb"
  exit 0
fi
if [ ! -d "$SOURCE" ]; then
  echo "no completed 0.1 fixture at $SOURCE — the row cannot run"
  exit 3
fi

export PATH="$ABC_ROOT/prefix-C/bin:$PATH"
echo "engine: $(command -v clad) $(clad --version)"

# A fresh copy of the 0.1 project, committed clean — same recipe as row-migrate.sh.
fresh_copy() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  rsync -a --exclude 'node_modules' "$SOURCE/" "$dir/"
  if [ -d "$SOURCE/node_modules" ]; then ln -s "$SOURCE/node_modules" "$dir/node_modules"; fi
}

changed_paths() {
  ( cd "$1" && git status --porcelain ) | grep -v 'node_modules' || true
}

# Turns a reviewed preview into the decision file --apply requires; the
# two-valued legacy-baseline decision carries this pass's answer. Same shape as
# row-migrate.sh, kept here so the two rows can be read independently.
write_resolutions() {
  local preview="$1" out="$2" baseline="$3"
  node -e '
    const fs = require("node:fs");
    const [previewPath, outPath, baseline] = process.argv.slice(1);
    const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
    const confirmed = (preview.requiredResolution ?? []).map((item) => {
      if (item.code === "PROJECT_LEGACY_L2_BASELINE") return {code: item.code, subject: item.subject, value: baseline};
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

# ── 1. a planned path with uncommitted work ─────────────────────────────────
# The dirt is made BEFORE the preview on purpose. Two guards stand in front of
# the same apply and the row shows which one answers when: dirty the tree after
# a preview and the preview itself is stale, so the answer is STALE_INPUT; dirty
# it first and the preview is honest about the tree it read, so the refusal is
# the one this pass is about — the uncommitted work that an apply would bury.
WORK="$CWD/.guard-dirty"
fresh_copy "$WORK"
printf '\n# an uncommitted edit to a path the migration plans to rewrite\n' >> "$WORK/spec.yaml"
echo "dirtied paths before the preview: $(changed_paths "$WORK" | wc -l | tr -d ' ')"
( cd "$WORK" && clad migrate --to 0.2 --json ) > "$OUT/dirty.preview.json" 2> "$OUT/dirty.err"
echo "dirty pass preview exit: $?"
write_resolutions "$OUT/dirty.preview.json" "$OUT/dirty.resolutions.json" accept
( cd "$WORK" && clad migrate --to 0.2 --apply --resolutions "$OUT/dirty.resolutions.json" --json ) > "$OUT/dirty.apply.json" 2>> "$OUT/dirty.err"
DIRTY=$?
echo "dirty apply exit: $DIRTY"
head -c 300 "$OUT/dirty.apply.json" | tr -s '\n' ' '
echo
grep -o 'DIRTY_PLANNED_PATH' "$OUT/dirty.apply.json" "$OUT/dirty.err" | head -1 || echo "no DIRTY_PLANNED_PATH in the refusal"
echo "0.2 markers in spec.yaml after the refusal: $(grep -c 'schema: .0.2.' "$WORK/spec.yaml" | tr -d ' ')"
echo "paths changed by the refused apply: $(changed_paths "$WORK" | wc -l | tr -d ' ') (the one dirty file, and nothing the engine added)"

# 1b — the same damage in the other order, recorded so the two refusals are not
# confused for each other.
WORK="$CWD/.guard-dirty-after"
fresh_copy "$WORK"
( cd "$WORK" && clad migrate --to 0.2 --json ) > "$OUT/dirty-after.preview.json" 2> "$OUT/dirty-after.err"
write_resolutions "$OUT/dirty-after.preview.json" "$OUT/dirty-after.resolutions.json" accept > /dev/null
printf '\n# an uncommitted edit made after the preview was taken\n' >> "$WORK/spec.yaml"
( cd "$WORK" && clad migrate --to 0.2 --apply --resolutions "$OUT/dirty-after.resolutions.json" --json ) > "$OUT/dirty-after.apply.json" 2>> "$OUT/dirty-after.err"
echo "dirtied-after-preview apply exit: $?"
head -c 220 "$OUT/dirty-after.apply.json" | tr -s '\n' ' '
echo

# ── 2. the baseline question, answered twice ────────────────────────────────
WORK="$CWD/.guard-answered"
fresh_copy "$WORK"
( cd "$WORK" && clad migrate --to 0.2 --json ) > "$OUT/answered.preview.json" 2> "$OUT/answered.err"
write_resolutions "$OUT/answered.preview.json" "$OUT/answered.accept.json" accept
( cd "$WORK" && clad migrate --to 0.2 --apply --resolutions "$OUT/answered.accept.json" --json ) > "$OUT/answered.apply.json" 2>> "$OUT/answered.err"
echo "first apply (baseline accepted) exit: $?"
( cd "$WORK" && git add -A && git commit -qm "migrate to 0.2" ) >> "$OUT/answered.err" 2>&1
AFTER_FIRST="$(shasum -a 256 "$WORK/spec.yaml" | cut -d' ' -f1)"
# The same decision file, the other answer, against a workspace that has already
# been migrated: the baseline must stay the one that was recorded.
write_resolutions "$OUT/answered.preview.json" "$OUT/answered.reject.json" reject
( cd "$WORK" && clad migrate --to 0.2 --apply --resolutions "$OUT/answered.reject.json" --json ) > "$OUT/answered.second.json" 2>> "$OUT/answered.err"
SECOND=$?
echo "second apply with the other answer exit: $SECOND"
head -c 300 "$OUT/answered.second.json" | tr -s '\n' ' '
echo
echo "spec.yaml unchanged by the second answer: $([ "$AFTER_FIRST" = "$(shasum -a 256 "$WORK/spec.yaml" | cut -d' ' -f1)" ] && echo yes || echo NO)"
echo "paths changed by the second answer: $(changed_paths "$WORK" | wc -l | tr -d ' ')"

# ── 3. a criterion sentence the 0.2 grammar cannot read ─────────────────────
WORK="$CWD/.guard-unparseable"
fresh_copy "$WORK"
SHARD="$(find "$WORK/spec/features" -name '*.yaml' | head -1)"
perl -pi -e 's/^(\s+)text: "The system shall convert a title into a lower-case hyphenated slug\."/$1text: "slug things, mostly"/' "$SHARD"
if ! grep -qF 'slug things, mostly' "$SHARD"; then
  echo "FAIL: the unparseable-criterion mutation did not land"
  exit 2
fi
( cd "$WORK" && git add -A && git commit -qm "a criterion the 0.2 grammar cannot parse" ) >> "$OUT/unparseable.err" 2>&1
echo "criterion rewritten to a sentence with no EARS shape, and committed"
( cd "$WORK" && clad migrate --to 0.2 --json ) > "$OUT/unparseable.preview.json" 2>> "$OUT/unparseable.err"
echo "preview exit: $?"
node -e '
  const fs = require("node:fs");
  const preview = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const required = preview.requiredResolution ?? [];
  process.stdout.write(`required decisions: ${required.length}\n`);
  process.stdout.write(`decision codes: ${[...new Set(required.map((r) => r.code))].join(", ") || "(none)"}\n`);
  const text = required.filter((r) => String(r.code).startsWith("CRITERION_"));
  process.stdout.write(text.length === 0
    ? "no criterion-text decision was demanded\n"
    : `criterion-text decision demanded for: ${text.map((r) => r.subject).join(", ")}\n`);
' "$OUT/unparseable.preview.json" || true
# Applying without answering that question must be refused, or the demand is
# decorative.
node -e '
  const fs = require("node:fs");
  const preview = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const confirmed = (preview.requiredResolution ?? [])
    .filter((item) => !String(item.code).startsWith("CRITERION_"))
    .map((item) => (item.code === "PROJECT_LEGACY_L2_BASELINE"
      ? {code: item.code, subject: item.subject, value: "accept"}
      : item.code === "ARCHITECTURE_LAYER_RESOLUTION"
        ? {code: item.code, subject: item.subject, value: {layers: []}}
        : {code: item.code, subject: item.subject}));
  fs.writeFileSync(process.argv[2], `${JSON.stringify({previewDigest: preview.previewDigest, confirmed}, null, 2)}\n`);
' "$OUT/unparseable.preview.json" "$OUT/unparseable.resolutions.json"
( cd "$WORK" && clad migrate --to 0.2 --apply --resolutions "$OUT/unparseable.resolutions.json" --json ) > "$OUT/unparseable.apply.json" 2>> "$OUT/unparseable.err"
echo "apply without the criterion answer exit: $?"
head -c 300 "$OUT/unparseable.apply.json" | tr -s '\n' ' '
echo
echo "paths changed by the refused apply: $(changed_paths "$WORK" | wc -l | tr -d ' ')"
