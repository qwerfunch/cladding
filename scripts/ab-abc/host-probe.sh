#!/usr/bin/env bash
# Cladding · scripts/ab-abc/host-probe.sh — the live host-integration probe
#
#   bash scripts/ab-abc/host-probe.sh <host> <model> [--dry-run]
#     host   claude | codex | cursor | antigravity
#     model  the model the host should run; pass the cheapest one the host lists
#
# What this is, and what it is not. It drives the REAL host CLI from a console
# outside the calling session — no doctor shim, no in-process client, no mock —
# against a copy of the completed 0.10.0 fixture wired to the frozen candidate
# engine, and keeps every byte the console produced. It is a PROBE: three
# read-only tool calls and one minimal write cycle. It is not the full MCP11
# cycle (create → begin → implement → gate → sign → done), and nothing it
# records should be read as one.
#
# Each cell leaves command.txt (the exact command line, so the same run can be
# repeated by hand), stdout.txt, stderr.txt, exit.txt and duration_ms.txt.
#
# Cost. Only `claude -p` reports dollars, so the cap is operational rather than
# arithmetic: one fixed model per host, a ten-minute wall clock per cell, the
# host's own budget flag where one exists (claude `--max-budget-usd 1`), and the
# token counts a host prints — "not reported" where it prints none. No dollar
# total is claimed for the hosts that report none.
#
# Machine state. `clad setup` writes machine-wide files for some hosts (the
# Antigravity wire is machine-wide by design, and the legacy-cleanup pass can
# remove a cladding entry from ~/.codex/config.toml, ~/.cursor/mcp.json and the
# ~/.gemini tree whatever host is named). Every one of those paths is backed up
# before setup runs and restored by an EXIT trap, and the probe prints the
# before/after `agy mcp list` around the Antigravity run.
set -uo pipefail

HOST="${1:-}"
MODEL="${2:-}"
DRY="${3:-}"

if [ -z "$HOST" ] || [ -z "$MODEL" ]; then
  echo "usage: bash host-probe.sh <claude|codex|cursor|antigravity> <model> [--dry-run]" >&2
  exit 64
fi
case "$HOST" in
  claude | codex | cursor | antigravity) ;;
  *) echo "unknown host: $HOST (claude, codex, cursor, antigravity)" >&2; exit 64 ;;
esac
DRY_RUN=0
[ "$DRY" = "--dry-run" ] && DRY_RUN=1

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
PREFIX_C="$ABC_ROOT/prefix-C"
FIXTURE_SOURCE="$ABC_ROOT/sidetable/done/C"
STAMP="$([ "$DRY_RUN" -eq 1 ] && echo dry-run || date +%Y%m%dT%H%M%S)"
ARTIFACTS="${ABC_HOST_PROBE_DIR:-$ABC_ROOT/host-probe/$HOST-$STAMP}"
WORK="$ARTIFACTS/project"
BACKUP="$ARTIFACTS/machine-state-backup"
CELL_TIMEOUT_SECONDS="${ABC_HOST_PROBE_TIMEOUT:-600}"
# A wire cladding does not recognise is left alone by default, which is right:
# `clad setup` reports `skipped-different` rather than overwriting somebody's
# configuration. A stale cladding entry pointing at a deleted install reads the
# same way from the outside, and the product's escape from it is `--force`. That
# rewrites the machine-wide Antigravity plugin wire, so it stays opt-in and
# leans on the backup taken below — ~/.gemini/config is tarred whole and put
# back by the EXIT trap, plugins/cladding included.
SETUP_ARGS=(setup --host "$HOST")
SETUP_FORCE=no
if [ "${ABC_HOST_PROBE_SETUP_FORCE:-0}" = "1" ]; then
  SETUP_ARGS+=(--force)
  SETUP_FORCE=yes
fi

# `timeout` is not on macOS. perl's alarm survives the exec, so the host process
# itself carries the clock and a killed cell shows up as exit 142.
ALARM=(perl -e 'alarm shift; exec @ARGV or die "exec failed: $!\n"' "$CELL_TIMEOUT_SECONDS")
# The host must not inherit this session: an inherited CLAUDECODE makes a host CLI
# believe it is already inside one.
CLEAN_ENV=(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SSE_PORT -u CLAUDE_CODE_MAX_OUTPUT_TOKENS)

FEATURE="$(cat "$ABC_ROOT/sidetable/done/C.feature" 2> /dev/null || echo F-0ac93269)"

# The three read prompts are the doctor's own, verbatim
# (src/cli/doctor-hosts.ts SURFACE_PROMPTS) — maximally directive, because an
# open-ended request invites a host to explore the repository instead of calling
# the tool, which grades a healthy host as broken.
PROMPT_LIST='Call the clad_list_features MCP tool and print exactly one feature id (format F-xxxxxxxx) from the result, nothing else.'
PROMPT_GET="Call the clad_get_feature MCP tool for id ${FEATURE} and print that id verbatim."
PROMPT_CHECK="Call the clad_run_check MCP tool and print the number of findings plus the word 'findings'."
# The write cycle is deliberately the smallest one that proves a mutation
# reached the workspace: create a feature, start its cycle, read it back.
PROMPT_WRITE='Do exactly this and nothing else, using only the cladding MCP tools. 1) Call clad_create_feature with slug "host-probe", title "A feature created by the host probe", purpose "Prove the host can drive a write tool.", modules ["src/host-probe.ts"], capability_refs [], and one acceptance criterion of kind "behavior" with the statement "The system shall record a feature created through the host probe.". 2) Call clad_begin for the feature id it returned. 3) Call clad_get_feature for that id. Then print the feature id and its status, nothing else.'

say() { printf '%s\n' "$*"; }

# Renders a command exactly as it would be typed, so a reader can repeat it.
render() {
  local out='' token escaped
  for token in "$@"; do
    if [[ "$token" =~ ^[A-Za-z0-9_@%+=:,./-]+$ ]]; then
      out+="$token "
    else
      escaped=${token//\'/\'\\\'\'}
      out+="'$escaped' "
    fi
  done
  printf '%s\n' "${out% }"
}

# Runs one cell, or prints its command line under --dry-run. Everything the
# console produced is kept: a probe that summarises is a probe you cannot check.
run_cell() {
  local name="$1"; shift
  local dir="$ARTIFACTS/cells/$name"
  local line
  line="$(cd "$WORK" 2> /dev/null || cd /; render "${CLEAN_ENV[@]}" "${ALARM[@]}" "$@")"
  if [ "$DRY_RUN" -eq 1 ]; then
    say "cell $name (cwd $WORK):"
    say "  $line"
    return 0
  fi
  mkdir -p "$dir"
  printf '%s\n' "$line" > "$dir/command.txt"
  printf 'cwd: %s\n' "$WORK" >> "$dir/command.txt"
  local start end exit_code
  start="$(date +%s000)"
  ( cd "$WORK" && "${CLEAN_ENV[@]}" "${ALARM[@]}" "$@" ) > "$dir/stdout.txt" 2> "$dir/stderr.txt"
  exit_code=$?
  end="$(date +%s000)"
  printf '%s\n' "$exit_code" > "$dir/exit.txt"
  printf '%s\n' "$(( end - start ))" > "$dir/duration_ms.txt"
  if [ "$exit_code" -eq 142 ]; then
    printf 'the cell hit the %ss wall clock and was killed\n' "$CELL_TIMEOUT_SECONDS" > "$dir/timed_out.txt"
    say "cell $name: TIMED OUT after ${CELL_TIMEOUT_SECONDS}s"
  fi
  say "cell $name: exit $exit_code in $(( (end - start) / 1000 ))s, stdout $(wc -c < "$dir/stdout.txt" | tr -d ' ') bytes"
  return 0
}

# ── machine state: back up before setup, restore however this ends ──────────
MACHINE_PATHS=(
  "$HOME/.gemini/config"
  "$HOME/.gemini/extensions/cladding"
  "$HOME/.codex/config.toml"
  "$HOME/.cursor/mcp.json"
  "$HOME/.claude/plugins/cladding"
)

backup_machine_state() {
  mkdir -p "$BACKUP"
  local index=0
  for path in "${MACHINE_PATHS[@]}"; do
    index=$(( index + 1 ))
    if [ -e "$path" ] || [ -L "$path" ]; then
      # tar keeps a symlink a symlink, which cp -R would not.
      ( cd "$(dirname "$path")" && tar -cf "$BACKUP/$index.tar" "$(basename "$path")" ) 2> /dev/null \
        && say "backed up $path" || say "WARNING: could not back up $path"
    else
      printf 'absent\n' > "$BACKUP/$index.absent"
      say "no existing $path (it will be removed again on exit if setup creates it)"
    fi
  done
}

restore_machine_state() {
  [ -d "$BACKUP" ] || return 0
  local index=0
  for path in "${MACHINE_PATHS[@]}"; do
    index=$(( index + 1 ))
    if [ -f "$BACKUP/$index.tar" ]; then
      rm -rf "$path"
      ( cd "$(dirname "$path")" && tar -xf "$BACKUP/$index.tar" ) 2> /dev/null \
        && say "restored $path" || say "WARNING: could not restore $path"
    elif [ -f "$BACKUP/$index.absent" ]; then
      if [ -e "$path" ] || [ -L "$path" ]; then
        rm -rf "$path"
        say "removed $path, which the probe created"
      fi
    fi
  done
}

trap 'restore_machine_state' EXIT

# ── the fixture ─────────────────────────────────────────────────────────────
say "host $HOST, model $MODEL, artifacts $ARTIFACTS"
say "engine under probe: $PREFIX_C/bin/clad"
if [ "$DRY_RUN" -eq 1 ]; then
  say ''
  say 'DRY RUN — nothing is copied, no machine file is touched, no host is called.'
  say ''
  say 'fixture:'
  say "  $(render rsync -a --exclude node_modules "$FIXTURE_SOURCE/" "$WORK/")"
  say "  $(render "$PREFIX_C/bin/clad" "${SETUP_ARGS[@]}")   # run inside $WORK"
  say "  setup --force: $SETUP_FORCE (ABC_HOST_PROBE_SETUP_FORCE=1 to replace a stale cladding wire)"
  if [ "$HOST" = cursor ]; then
    say "  the fixture's own .cursor/cli.json gains Mcp(cladding:clad_create_feature|clad_begin|clad_get_feature) — setup allows only the three read tools"
  fi
  say "machine state backed up and restored on exit: ${MACHINE_PATHS[*]}"
  say "refused before any of this if ~/.claude/plugins/cladding is a symlink (setup would uninstall the user-scoped plugin)"
  say ''
else
  trap 'restore_machine_state' EXIT
  # `clad setup` removes a cladding symlink at ~/.claude/plugins/cladding and, if
  # it removed one, runs `claude plugin uninstall` — a machine change no tar can
  # put back. The probe refuses rather than risk it.
  if [ -L "$HOME/.claude/plugins/cladding" ] && [ "${ABC_HOST_PROBE_ALLOW_PLUGIN_CLEANUP:-0}" != "1" ]; then
    say "~/.claude/plugins/cladding is a symlink; setup would uninstall the user-scoped plugin, which this probe cannot restore."
    say "Re-run with ABC_HOST_PROBE_ALLOW_PLUGIN_CLEANUP=1 only if you are willing to reinstall it yourself."
    exit 3
  fi
  if [ ! -d "$FIXTURE_SOURCE" ]; then
    say "no completed 0.2 fixture at $FIXTURE_SOURCE — run the side-table bootstrap first"
    exit 3
  fi
  if ! command -v "$([ "$HOST" = antigravity ] && echo agy || { [ "$HOST" = cursor ] && echo cursor-agent || echo "$HOST"; })" > /dev/null; then
    say "the $HOST CLI is not installed on this machine — recorded as not-run"
    exit 3
  fi
  mkdir -p "$ARTIFACTS/cells"
  rm -rf "$WORK"
  mkdir -p "$WORK"
  rsync -a --exclude node_modules "$FIXTURE_SOURCE/" "$WORK/"
  [ -d "$FIXTURE_SOURCE/node_modules" ] && ln -s "$FIXTURE_SOURCE/node_modules" "$WORK/node_modules"
  backup_machine_state
  ( cd "$WORK" && "$PREFIX_C/bin/clad" "${SETUP_ARGS[@]}" ) > "$ARTIFACTS/setup.txt" 2>&1
  SETUP_EXIT=$?
  printf 'setup --force: %s\n' "$SETUP_FORCE" >> "$ARTIFACTS/setup.txt"
  say "clad setup --host $HOST exit: $SETUP_EXIT (--force: $SETUP_FORCE)"

  # The wire has to point at the frozen candidate, not at whatever `clad` the
  # machine has globally. A probe of the wrong engine measures nothing.
  {
    say "--- launcher check ---"
    grep -rn "prefix-C" "$WORK/.cladding/host/serve.cjs" "$WORK/.mcp.json" "$WORK/.codex/config.toml" \
      "$WORK/.cursor/mcp.json" "$HOME/.gemini/config/plugins/cladding/mcp_config.json" 2> /dev/null \
      || say "no prefix-C reference found in the written wiring"
  } > "$ARTIFACTS/wiring.txt" 2>&1
  if [ "$HOST" = cursor ]; then
    # `clad setup` allows cursor only the three read-only tools by design
    # (CURSOR_READONLY_MCP_PERMISSIONS). Without the write tools in the FIXTURE's
    # own allowlist the write cell would measure this harness's permission file
    # rather than the host. The product default is untouched — only the copy.
    node -e '
      const fs = require("node:fs");
      const path = `${process.argv[1]}/.cursor/cli.json`;
      const doc = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
      doc.permissions = doc.permissions ?? {};
      const allow = new Set(doc.permissions.allow ?? []);
      for (const tool of ["clad_create_feature", "clad_begin", "clad_get_feature"]) allow.add(`Mcp(cladding:${tool})`);
      doc.permissions.allow = [...allow];
      fs.mkdirSync(`${process.argv[1]}/.cursor`, {recursive: true});
      fs.writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
      process.stdout.write(`fixture .cursor/cli.json now allows ${doc.permissions.allow.length} entries\n`);
    ' "$WORK" | tee -a "$ARTIFACTS/setup.txt"
  fi
  if grep -q "prefix-C" "$ARTIFACTS/wiring.txt"; then
    say "wiring points inside $PREFIX_C: yes"
  else
    say "wiring points inside $PREFIX_C: NO — see $ARTIFACTS/wiring.txt"
  fi
fi

# ── versions and the model listing ──────────────────────────────────────────
record_versions() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "versions.txt: $(render "$PREFIX_C/bin/clad" --version) + the host's own --version"
    return 0
  fi
  {
    say "cladding: $("$PREFIX_C/bin/clad" --version 2>&1)"
    case "$HOST" in
      claude) say "claude: $(claude --version 2>&1 | head -1)" ;;
      codex) say "codex: $(codex --version 2>&1 | head -1)" ;;
      cursor) say "cursor-agent: $(cursor-agent --version 2>&1 | head -1)" ;;
      antigravity) say "agy: $(agy --version 2>&1 | head -1)" ;;
    esac
    say "model requested: $MODEL"
  } > "$ARTIFACTS/versions.txt" 2>&1
  cat "$ARTIFACTS/versions.txt"
}

record_model_list() {
  local listing=()
  case "$HOST" in
    cursor) listing=(cursor-agent --list-models) ;;
    antigravity) listing=(agy models) ;;
    claude) listing=() ;;
    codex) listing=() ;;
  esac
  if [ "${#listing[@]}" -eq 0 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      say "model-list.txt: this host has no model-listing command — the chosen model is recorded from the vendor's published list"
    else
      printf 'this host CLI has no model-listing command; the model was chosen from the vendor documentation and is recorded in versions.txt\n' \
        > "$ARTIFACTS/model-list.txt"
    fi
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "model-list.txt: $(render "${listing[@]}")"
    return 0
  fi
  "${CLEAN_ENV[@]}" "${listing[@]}" > "$ARTIFACTS/model-list.txt" 2>&1
  say "model listing recorded: $(wc -l < "$ARTIFACTS/model-list.txt" | tr -d ' ') lines"
}

record_versions
record_model_list

# ── the host command shapes ─────────────────────────────────────────────────
#
# Derived from src/cli/doctor-hosts.ts buildPromptCommand, with three deliberate
# differences, all of them here rather than in any runner's brief:
#   · codex uses `exec --approve-for-me`, never the bypass flag the doctor uses;
#   · every host is pinned to one model, and codex's reasoning effort is pinned
#     with it, because `-m` alone leaves ~/.codex/config.toml's high setting in
#     place and that is the expensive half;
#   · codex exec ignores untrusted project config, so the server is injected on
#     the command line instead of relying on the file `clad setup` wrote.
host_command() {
  local mode="$1" prompt="$2"
  case "$HOST" in
    claude)
      HOST_CMD=(claude -p "$prompt" --model "$MODEL" --max-budget-usd 1
        --output-format stream-json --verbose
        --strict-mcp-config --mcp-config .mcp.json --allowedTools mcp__cladding)
      ;;
    codex)
      HOST_CMD=(codex exec --approve-for-me -m "$MODEL"
        -c 'model_reasoning_effort="low"'
        -c 'mcp_servers.cladding={command="node",args=[".cladding/host/serve.cjs"]}'
        "$prompt")
      ;;
    cursor)
      if [ "$mode" = read ]; then
        HOST_CMD=(cursor-agent -p --mode ask --trust --approve-mcps --model "$MODEL" "$prompt")
      else
        HOST_CMD=(cursor-agent -p --trust --approve-mcps --model "$MODEL" "$prompt")
      fi
      ;;
    antigravity)
      HOST_CMD=(agy --dangerously-skip-permissions --model "$MODEL"
        --print-timeout 10m --log-file "$ARTIFACTS/agy-handshake.log" -p "$prompt")
      ;;
  esac
}

# ── Antigravity: the wire is the suspect, so it is recorded around the run ───
if [ "$HOST" = antigravity ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    say "before/after wiring record: $(render agy mcp list)"
  else
    "${CLEAN_ENV[@]}" agy mcp list > "$ARTIFACTS/agy-mcp-list-before.txt" 2>&1
    say "agy mcp list before setup recorded ($(wc -l < "$ARTIFACTS/agy-mcp-list-before.txt" | tr -d ' ') lines)"
    grep -q cladding "$ARTIFACTS/agy-mcp-list-before.txt" && say "cladding already wired into agy before the probe" \
      || say "cladding NOT in agy's server list before the probe"
  fi
fi

# ── the cells ───────────────────────────────────────────────────────────────
host_command read "$PROMPT_LIST"; run_cell read-list-features "${HOST_CMD[@]}"
host_command read "$PROMPT_GET"; run_cell read-get-feature "${HOST_CMD[@]}"
host_command read "$PROMPT_CHECK"; run_cell read-run-check "${HOST_CMD[@]}"

if [ "$HOST" = antigravity ]; then
  # agy's only non-interactive approval flag is the skip-permissions family, the
  # same one the doctor uses for read-only surfaces. A write cycle behind it
  # would be a bypass, so this host's write cell is not run and says so.
  if [ "$DRY_RUN" -eq 1 ]; then
    say "cell write: not-run (read-only approval mode)"
  else
    mkdir -p "$ARTIFACTS/cells/write"
    printf 'write: not-run (read-only approval mode)\n' > "$ARTIFACTS/cells/write/stdout.txt"
    printf 'not-run\n' > "$ARTIFACTS/cells/write/exit.txt"
    printf '0\n' > "$ARTIFACTS/cells/write/duration_ms.txt"
    printf 'agy offers no per-tool approval flag; the only non-interactive mode is the skip-permissions family, which is a bypass rather than an approval\n' \
      > "$ARTIFACTS/cells/write/command.txt"
    say "write: not-run (read-only approval mode)"
  fi
else
  host_command write "$PROMPT_WRITE"; run_cell write "${HOST_CMD[@]}"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  say ''
  say 'after the cells:'
  [ "$HOST" = antigravity ] && say "  $(render agy mcp list)   # recorded again, then the machine state is restored"
  say "  $(render git -C "$WORK" status --porcelain)   # what the write cell changed"
  say "  restore: ${MACHINE_PATHS[*]}"
  exit 0
fi

# ── what the run cost, and what it changed ──────────────────────────────────
{
  case "$HOST" in
    claude)
      # The dollar figure lives in the final stream-json result event.
      node -e '
        const fs = require("node:fs");
        let total = 0;
        let seen = false;
        for (const dir of fs.readdirSync(process.argv[1])) {
          const path = `${process.argv[1]}/${dir}/stdout.txt`;
          if (!fs.existsSync(path)) continue;
          for (const line of fs.readFileSync(path, "utf8").split("\n")) {
            if (!line.startsWith("{")) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === "result" && typeof event.total_cost_usd === "number") {
                total += event.total_cost_usd;
                seen = true;
                process.stdout.write(`${dir}: total_cost_usd ${event.total_cost_usd}, duration_ms ${event.duration_ms ?? "?"}\n`);
              }
            } catch {}
          }
        }
        process.stdout.write(seen ? `measured total: $${total.toFixed(4)}\n` : "no result event carried total_cost_usd\n");
      ' "$ARTIFACTS/cells" 2>&1
      ;;
    *)
      say "dollars: not reported by this host CLI"
      grep -ohiE '[0-9,]+ *(input |output |total )?tokens' "$ARTIFACTS"/cells/*/stdout.txt 2> /dev/null | sort -u | head -10 \
        || say "tokens: not reported"
      ;;
  esac
} > "$ARTIFACTS/cost.txt" 2>&1
cat "$ARTIFACTS/cost.txt"

( cd "$WORK" && git status --porcelain ) | grep -v node_modules > "$ARTIFACTS/workspace-changes.txt" 2>&1
say "workspace paths the probe changed: $(wc -l < "$ARTIFACTS/workspace-changes.txt" | tr -d ' ')"
if [ "$HOST" = antigravity ]; then
  "${CLEAN_ENV[@]}" agy mcp list > "$ARTIFACTS/agy-mcp-list-after.txt" 2>&1
  grep -q cladding "$ARTIFACTS/agy-mcp-list-after.txt" && say "cladding in agy's server list after setup: yes" \
    || say "cladding in agy's server list after setup: NO — the wire is the fault to chase"
fi
say "artifacts: $ARTIFACTS"
