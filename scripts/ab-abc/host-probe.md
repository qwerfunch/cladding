# The host-integration probe

`bash scripts/ab-abc/host-probe.sh <host> <model> [--dry-run]`

`host` is one of `claude`, `codex`, `cursor`, `antigravity`; `model` is the model
the host should run — pass the cheapest one it lists. Gemini is out of scope for
this round.

The probe drives the real host CLI from a console outside the calling session,
against a copy of the completed 0.10.0 side-table fixture wired to the frozen
candidate engine in `~/abc-0100/prefix-C`. Nothing is simulated: no doctor shim,
no in-process MCP client, no mock host. Every byte the console produced is kept.

**This is a probe, not a cycle.** It runs three read-only tool calls and one
minimal write cycle. It is not the MCP11 lifecycle — create, begin, implement,
gate, sign, complete — and no result it records should be reported as one. What
it can answer is narrow and worth having: does this host, on this model, actually
reach cladding's tools from a plain terminal, and what does that cost in time.

## The cells

| Cell | What it asks |
|---|---|
| `read-list-features` | Call `clad_list_features` and print one feature id. |
| `read-get-feature` | Call `clad_get_feature` for the fixture's own feature and print the id back. |
| `read-run-check` | Call `clad_run_check` and print the number of findings. |
| `write` | Call `clad_create_feature`, then `clad_begin` on the id it returned, then `clad_get_feature`. |

The three read prompts are the doctor's own text, copied verbatim from
`src/cli/doctor-hosts.ts` (`SURFACE_PROMPTS`). They are blunt on purpose: an
open-ended request invites a host to go read the repository instead of calling
the tool, which grades a working host as broken.

Antigravity has no per-tool approval flag — its only non-interactive mode is the
skip-permissions family, which is a bypass rather than an approval — so its write
cell is not run and records `write: not-run (read-only approval mode)`.

Every cell writes, under `~/abc-0100/host-probe/<host>-<timestamp>/cells/<cell>/`:

- `command.txt` — the exact command line, plus the directory it ran in
- `stdout.txt`, `stderr.txt` — the console, untrimmed
- `exit.txt`, `duration_ms.txt` — and `timed_out.txt` when the cap fired

Alongside them the run leaves `versions.txt` (engine + host CLI + requested
model), `model-list.txt` (the host's own listing where it has one — cursor
`--list-models`, Antigravity `agy models` — otherwise a line saying the CLI
offers none), `setup.txt`, `wiring.txt` (proof the wire points inside
`prefix-C`), `cost.txt` and `workspace-changes.txt`.

## Replaying one cell by hand

`command.txt` is the whole answer: copy the line, `cd` to the directory named
underneath it, and run it. It carries the `env -u …` prefix that keeps the host
from inheriting the calling session, and the `perl -e 'alarm …'` wrapper that
enforces the wall clock (`timeout` does not exist on macOS; a cell killed by the
alarm exits 142). Drop the `perl` wrapper if you want to sit and watch one.

## The cost cap

Only `claude -p` reports dollars, so the $5 ceiling in the plan is an operational
definition, not an arithmetic one:

1. one fixed model per host, named on the command line;
2. a ten-minute wall clock per cell (`ABC_HOST_PROBE_TIMEOUT` to change it);
3. the host's own budget flag where one exists — claude `--max-budget-usd 1`;
4. the token counts a host prints, recorded as printed;
5. dollars reported only for claude, where `total_cost_usd` is measured from the
   final `result` event. Every other host is reported as time and tokens, and no
   dollar total is claimed across hosts.

Codex is pinned twice on purpose. `-m <model>` alone leaves
`~/.codex/config.toml`'s `model_reasoning_effort = "high"` in force — the
expensive half — so `-c model_reasoning_effort="low"` rides with it. `codex exec`
also ignores untrusted project config, so the server is injected on the command
line rather than trusted to the file `clad setup` wrote.

## Machine state

`clad setup` writes outside the project: Antigravity's wire is machine-wide by
design, and the legacy-cleanup pass can remove a cladding entry from
`~/.codex/config.toml`, `~/.cursor/mcp.json` or the `~/.gemini` tree whichever
host is named. The probe tars each of those paths before setup and restores them
from an `EXIT` trap — including removing one it created where none existed. Set `ABC_HOST_PROBE_SETUP_FORCE=1` when setup reports `skipped-different` for a
wire that is cladding's own but stale — an entry left pointing at an install that
has since been deleted reads as foreign, and `--force` is the product's way past
it; the run records `setup --force: yes` in `setup.txt`, and the restore puts the
machine back on the wire it had before the probe either way. For
Antigravity it also records `agy mcp list` before and after, because a missing
cladding entry there is the leading suspect for the 2026-09-07 doctor timeouts.

## Dry run

`--dry-run` prints every command line the live run would use — fixture copy,
setup, each cell, the model listing, the backup/restore paths — and executes
none of them. It copies nothing and touches no machine file, so it is the safe
way to read what a run would do before paying for it.
