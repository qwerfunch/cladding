This project is managed by **cladding** — the Spec-Anchored Agent Harness.
The lines between the `clad:agents-md` markers are generated from `spec.yaml`; edit the spec, not them. Everything OUTSIDE the markers is yours to keep.

## bare-project — what this project is

## Single source of truth

- `spec.yaml` is authoritative (Tier A); code must conform to its `features[]` and
  `acceptance_criteria`. Feature detail lives in `spec/features/<slug>-<hash8>.yaml` —
  never hand-author `F-NNN` filenames; ask cladding via the `clad` CLI (or
  `clad_create_feature` when your host has cladding wired as an MCP server).
- For shell commands, use `node .cladding/host/serve.cjs <arguments>` when that
  project launcher exists; it pins the CLI to the same engine as MCP. Fall back to
  `clad <arguments>` only when the project has no launcher.
- Run the resolved Cladding command with `check --strict` to verify spec ↔ code
  across every drift detector.
- Deeper context: `docs/project-context.md` (why this project exists) and `docs/conventions.md` (its code style).

## Feature cycle — one at a time

Finish ONE feature end-to-end before the next: author its spec entry (`acceptance_criteria`
+ `modules`) → implement → author tests in a separate context → run the declared test
command and confirm it collected relevant tests → run the resolved Cladding command
with `done <featureId>` (sets `status: done` only when the strict pre-push gate is
GREEN). Package test scripts must not depend on shell-expanded glob patterns. Do not
author spec entries ahead of their code, or hand-write `status: done`.

## Writing an acceptance criterion

Each criterion may declare an `ears` pattern. When it does, its `condition` must open
with that pattern's trigger word — the gate rejects the entry otherwise:

| `ears` | `condition` must | example |
|---|---|---|
| `ubiquitous` | be omitted — the rule always holds | *(none)* |
| `event` | start with **when** | `when the upload completes` |
| `state` | start with **while** | `while the queue is draining` |
| `optional` | start with **where** | `where telemetry is enabled` |
| `unwanted` | start with **if** | `if the checksum does not match` |
| `complex` | start with **while** and also contain a **when** clause | `while offline, when a retry fires` |

Write the obligation in `text`, or in the `action` / `response` fields — both are read
as the requirement. Put the reasoning in `notes`; it is free prose and nothing parses it.

## What language to write a spec entry in

Default to English. If the spec already has entries, match the language THEY use — the
entries already written are the answer, so nothing needs configuring and nothing can go
stale. Where they disagree, write English. This keeps one repository speaking with one
voice no matter who is at the keyboard; it is a property of the project, not of whoever
you are talking to right now.

If the user asks for another language, write `title`, `notes` and `text` in it. The next
entry then follows by the rule above, so a one-time request carries forward on its own.
Switching language applies to NEW entries; never rewrite existing ones into another
language — those are the project's own words.

Four words stay English wherever they appear, because the gate matches them literally and
EARS is a published notation: **when**, **while**, **if**, **where**. Only the FIRST word
of a `condition` is constrained — the rest of the sentence is yours:

    condition: "when the app exits"      · condition: "when 앱이 종료될 때"

Identifiers are not prose and are never translated: feature and criterion ids, the `ears`
values themselves, and file paths.

## Design evolves with each feature

Before implementation, classify the feature as: no design impact, an additive
capability/scenario link, or a structural change. Apply deterministic links directly;
preview architecture or project-context changes for the user. Do not finish a feature
while a material design impact remains unresolved, and do not churn design documents
for internal fixes that genuinely have no design impact.

## Personas — cross-host capability map (anti-self-cert)

The agent that writes a unit of work must not sign off on it. Each
persona and the vendor-neutral capabilities it may use — so Codex, Gemini, and other
AGENTS.md readers receive the same guidance Claude does:

- planner — read, write, edit, exec
- developer — read, write, edit, exec
- reviewer — read, exec
- blind-author — write, exec
- observability — read, exec
- orchestrator — read, write, edit, exec, dispatch

These briefs are manuals for cladding's touchpoints, not a roster of permitted agents: any host agent may take up any of them, and an agent that never touches a cladding surface needs none. The gates judge a result the same way whoever produced it — the one thing tied to identity is the independence label, which records whether the verifier was independent of the author, never which brief (if any) an agent wore.

## Speak the user's language

Translate cladding's vocabulary into plain words in the user's own language when you
report progress — relay gate/hook messages by meaning, and never lead with an internal
id (`F-…`, `AC-…`, `stage_X.Y`): name the feature and the plain outcome instead.
