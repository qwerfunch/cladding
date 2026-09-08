#!/usr/bin/env bash
# Cladding · scripts/ab-abc/lib-fixture.sh — shared fixture-building steps
#
# Sourced by make-done-fixture.sh (side-table fixtures) and make-trap-cell.sh
# (the completion-claim trap). Nothing here spawns a model: every step is a
# deterministic file write or an engine call, so the same command always builds
# the same fixture.
#
# The one thing worth stating up front: the two engines bind a test to an
# acceptance criterion in different ways, and these helpers keep that difference
# explicit rather than hidden. 0.9.4 binds through a shard's `test_refs`; 0.10.0
# binds through a `[covers:F-…/AC-…]` token at the START of a test title. A
# fixture that wants a defective binding therefore breaks a different thing in
# each arm — an emptied `test_refs` for B, a token moved to the end for C.

# shellcheck shell=bash

ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"

# Fails loudly when the arm's engine is not the one the caller thinks it is.
abc_engine_check() {
  local arm="$1" prefix="$2"
  [ -x "$prefix/bin/clad" ] || { echo "arm $arm has no engine at $prefix/bin/clad — run freeze.sh" >&2; return 1; }
  printf 'arm %s engine: %s (%s)\n' "$arm" "$prefix/bin/clad" "$(PATH="$prefix/bin:$PATH" clad --version)"
}

# Template + dependencies + an initial commit.
abc_seed_workspace() {
  local dest="$1"
  mkdir -p "$dest"
  cp -R "$ABC_HARNESS/template/." "$dest/"
  mkdir -p "$dest/src" "$dest/tests"
  (cd "$dest" && npm ci >/dev/null 2>&1)
  (cd "$dest" && git init --quiet \
    && git config user.name "abc-harness" \
    && git config user.email "abc-harness@example.invalid" \
    && git add -A && git commit --quiet -m "chore: project skeleton")
}

# `clad init` in the shape each arm's schema expects, then the host wiring.
abc_init_engine() {
  local arm="$1" prefix="$2" dest="$3"
  if [ "$arm" = "C" ]; then
    (cd "$dest" && PATH="$prefix/bin:$PATH" clad init --schema 0.2 --no-llm >/dev/null)
  else
    (cd "$dest" && PATH="$prefix/bin:$PATH" clad init --no-llm >/dev/null)
  fi
  (cd "$dest" && PATH="$prefix/bin:$PATH" clad setup --host claude >/dev/null)
}

# Creates one feature through the MCP surface and prints its id. Going through
# the tool rather than writing YAML by hand is the point: the fixture is then
# built the way a host builds one, and a refusal here is a finding, not a typo.
#
# The two schemas ask for different things, so the arguments differ by arm:
# schema 0.2 requires a `purpose` (the WHY) and binds tests through title
# tokens, while schema 0.1 has neither and binds through per-criterion
# `test_refs`. Both arms get the same three criteria, all in the plain
# ubiquitous form, so nothing downstream turns on an EARS shape.
abc_create_feature() {
  local arm="$1" prefix="$2" dest="$3" slug="$4" title="$5" purpose="$6"
  local calls out
  calls="$(mktemp -t abc-calls).json"
  out="$(mktemp -t abc-out).json"
  node -e '
    const fs = require("node:fs");
    const [callsPath, arm, slug, title, purpose] = process.argv.slice(1);
    const criteria = [
      "The system shall convert a title into a lower-case hyphenated slug.",
      "The system shall fold diacritics to their base letters when slugging a title.",
      "The system shall reject a title that carries no slug-able characters.",
    ];
    const args = arm === "C"
      ? {
          slug,
          title,
          purpose,
          modules: ["src/slugify.ts"],
          capability_refs: [],
          // Schema 0.2 takes `kind` + a strict statement and refuses the legacy
          // EARS fields outright — passing both is an error, not a courtesy.
          acceptance_criteria: criteria.map((statement) => ({kind: "behavior", statement})),
        }
      : {
          slug,
          title,
          // `modules` is not a 0.2 addition — the released tool takes it too, and
          // without it the 0.9.4 shard bound no module at all. Several detectors
          // (CONVENTION_DRIFT among them) walk `feature.modules`, so an empty
          // list quietly made those rows unanswerable in arm B.
          modules: ["src/slugify.ts"],
          acceptance_criteria: criteria.map((text) => ({ears: "ubiquitous", text})),
        };
    fs.writeFileSync(callsPath, JSON.stringify([{type: "tool", name: "clad_create_feature", args}]));
  ' "$calls" "$arm" "$slug" "$title" "$purpose"
  node "$ABC_HARNESS/mcp-client.mjs" --cwd "$dest" --server "$prefix/bin/clad serve" --calls "$calls" --out "$out" >/dev/null
  # The id is captured BEFORE the temporary files are removed: a cleanup command
  # as the function's last statement would overwrite a refusal's exit status with
  # its own success, and the caller would build a fixture on a feature that was
  # never created.
  local id
  if ! id="$(node -e '
    const fs = require("node:fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    if (/"isError":\s*true/.test(text)) throw new Error(`the tool refused the feature: ${text.slice(0, 800)}`);
    const id = text.match(/F-[0-9a-f]{6,8}/);
    if (!id) throw new Error(`no feature id in the create result: ${text.slice(0, 800)}`);
    process.stdout.write(id[0]);
  ' "$out")"; then
    cp "$out" "${ABC_KEEP_FAILED:-/dev/null}" 2>/dev/null || true
    rm -f "$calls" "$out"
    return 1
  fi
  rm -f "$calls" "$out"
  printf '%s' "$id"
}

# Prints every acceptance-criterion id in a feature's shard, one per line, in
# the order the shard declares them — so each test can be bound to its own
# criterion instead of three tests all claiming the first.
abc_criteria() {
  local dest="$1" feature="$2"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [dir, feature] = process.argv.slice(1);
    const root = path.join(dir, "spec", "features");
    let ids = null;
    for (const name of fs.readdirSync(root)) {
      const raw = fs.readFileSync(path.join(root, name), "utf8");
      if (!raw.includes(feature)) continue;
      ids = [...new Set(raw.match(/AC-[0-9a-f]{6,8}/g) ?? [])];
      break;
    }
    if (ids === null || ids.length === 0) throw new Error(`no criteria found for ${feature}`);
    process.stdout.write(ids.join("\n"));
  ' "$dest" "$feature"
}

# The first criterion only — kept for rows that need one representative id.
# `sed -n 1p` rather than `head -1`: head closes the pipe as soon as it has its
# line, and the writer then dies of EPIPE instead of finishing quietly.
abc_first_criterion() {
  abc_criteria "$1" "$2" | sed -n 1p
}

# Prints the path of the shard holding a feature.
abc_shard_path() {
  local dest="$1" feature="$2"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [dir, feature] = process.argv.slice(1);
    const root = path.join(dir, "spec", "features");
    let found = null;
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      if (fs.readFileSync(full, "utf8").includes(feature)) { found = full; break; }
    }
    if (found === null) throw new Error(`no shard for ${feature}`);
    process.stdout.write(found);
  ' "$dest" "$feature"
}

# The module every fixture implements — the same code in every arm, so nothing
# downstream can differ because of the implementation.
abc_write_module() {
  local dest="$1"
  cat > "$dest/src/slugify.ts" <<'MODULE'
// Fixture module — turns a title into a URL slug.

/** Raised when an input carries nothing that can become a slug. */
export class EmptySlugError extends Error {
  constructor(input: string) {
    super(`no slug-able characters in ${JSON.stringify(input)}`);
    this.name = 'EmptySlugError';
  }
}

/** Lower-cases, folds diacritics, and joins the remaining words with hyphens. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') throw new EmptySlugError(input);
  return slug;
}
MODULE
}

# The fixture's tests. The generator lives in write-tests.mjs — the test bodies
# are full of quotes, and an inline heredoc of them is unreadable. Modes:
# `leading` (0.10.0's real binding), `trailing` (the trap), `plain` (0.9.4).
abc_write_tests() {
  node "$ABC_HARNESS/write-tests.mjs" "$@"
}

# Points a 0.1 shard's criteria at the test file (B's way of binding).
abc_bind_test_refs() {
  local shard="$1" testPath="$2"
  node -e '
    const fs = require("node:fs");
    const [shard, testPath] = process.argv.slice(1);
    const lines = fs.readFileSync(shard, "utf8").split("\n");
    const out = [];
    for (const line of lines) {
      out.push(line);
      const m = line.match(/^(\s*)-\s+id:\s*AC-/);
      if (m) out.push(`${m[1]}  test_refs:`, `${m[1]}    - ${testPath}`);
    }
    fs.writeFileSync(shard, out.join("\n"));
  ' "$shard" "$testPath"
}

# Empties every `test_refs` list in a shard (the trap for arm B).
abc_unbind_test_refs() {
  local shard="$1"
  node -e '
    const fs = require("node:fs");
    const shard = process.argv[1];
    const lines = fs.readFileSync(shard, "utf8").split("\n");
    const out = [];
    let dropping = false;
    for (const line of lines) {
      if (/^\s*test_refs:\s*$/.test(line)) { dropping = true; continue; }
      if (dropping && /^\s*-\s+\S/.test(line)) continue;
      dropping = false;
      out.push(line);
    }
    fs.writeFileSync(shard, out.join("\n"));
  ' "$shard"
}
