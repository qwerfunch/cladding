# Multi-developer-safe spec IDs

Two or more contributors can add new features or scenarios to a cladding-applied project simultaneously without git merge conflicts. This document explains how and what to do when something looks off.

## The short version

| Layer | Identifier | Scope | Multi-dev safety |
|---|---|---|---|
| **Filename** | `<slug>-<hash>.yaml` (8 hex since 0.6.0, legacy 6 hex valid; e.g. `login-flow-a3f9c2e1.yaml`) | one per feature or scenario | ✅ Two contributors with the same slug get different hashes → different file paths → no `git merge` collision |
| **Feature id** | `F-<hash>` (e.g. `F-a3f9c2e1`) — same hash as filename | globally unique by construction | ✅ < 1/4.3B per-pair collision at 8 hex (6-hex birthday bound neared 50% at ~5k features); `ID_COLLISION` detector catches the rest |
| **Scenario id** | `S-<hash>` (e.g. `S-c4d108e9`) — full feature-symmetric model since v0.3.12 | globally unique by construction | ✅ Same guarantees as features; `F-*` and `S-*` are separate id namespaces |
| **Slug** (yaml field) | `login-flow` | human-readable anchor, separate namespaces for features vs scenarios | ⚠️ Two contributors picking the same slug within the same namespace is *expected* if they have the same intent; `SLUG_CONFLICT` detector raises this as an error so a human resolves it |
| **AC id** | `AC-001` ~ `AC-NNN` | **feature-scoped sequential** | ✅ `F-001.AC-001` and `F-002.AC-001` coexist freely; `AC_DUPLICATE_WITHIN_FEATURE` catches intra-feature duplicates |
| **Legacy `F-NNN` / `S-NNN`** | `F-001` ~ `F-083`, `S-001`, `S-002` | global sequential (pre-v0.3.9 / pre-v0.3.12) | ✅ Coexists with the new model forever — no migration required |

## How features and scenarios get created

Users never type `clad spec new` — there is no such CLI verb by design. You ask your host AI assistant in natural language:

```
"Add a feature for the login-flow."
"Add a scenario for the checkout happy-path."
```

The host LLM calls cladding's `clad_create_feature` or `clad_create_scenario` MCP tool, which generates the hash and writes the file. The result (id, path, slug) flows back to your AI and into the conversation. Scenarios optionally carry a `features:` array linking the scenario back to the features it covers (`REFERENCE_INTEGRITY` detector enforces those ids exist).

## How to look features up

| What you want | How |
|---|---|
| The id of the feature you just made | The AI mentioned it after creation — scroll up. |
| A feature whose slug you remember partially | Ask: *"List cladding features with auth in the slug."* The LLM calls `clad_list_features(slugSubstring="auth")`. |
| The most recently touched features | Ask: *"What are the most recently edited features?"* The LLM calls `clad_list_features(sort="recent")`. |
| A feature by exact slug | Ask: *"Show me the login-flow feature."* The LLM calls `clad_get_feature(slug="login-flow")`. |
| A feature by exact id | Ask: *"Show me F-049."* The LLM calls `clad_get_feature(id="F-049")`. |
| Recent project activity (gate runs, feature transitions) | Ask: *"What's the recent cladding activity?"* The LLM calls `clad_get_events`. |
| Shell — all features with prefix `auth` | `ls spec/features/auth*` (slug is the filename prefix) |

## What happens when two contributors do the same thing

### Scenario 1: Different slugs, simultaneous

- Alice on `feat/login`: `createFeature(slug='login-flow')` → `login-flow-a3f9c2.yaml`
- Bob on `feat/checkout`: `createFeature(slug='checkout-cart')` → `checkout-cart-d29f1a.yaml`
- main merge → both files land cleanly. **No conflict.**

### Scenario 2: Same slug, simultaneous

- Alice on `feat/auth-1`: `createFeature(slug='auth-bypass')` → `auth-bypass-c4d108.yaml`
- Bob on `feat/auth-2`: `createFeature(slug='auth-bypass')` → `auth-bypass-e7f201.yaml`
- main merge → both files land cleanly (different hashes → different paths).
- `clad check --strict` → `SLUG_CONFLICT` error: *"slug 'auth-bypass' is used by both F-c4d108 and F-e7f201"*.
- Human resolves: either (a) the two features are *the same intent* — archive one (`status: archived`); (b) the two features are *different intents* that picked the same name — rename one slug.

The detector reports the conflict; the human decides what was meant. cladding does not silently merge or auto-rename because semantic intent is not something the tool can guess.

### Scenario 3: Same contributor, same cwd, repeated call

- One developer calls `createFeature(slug='login-flow')` twice in a row.
- Both files written: `login-flow-a3f9c2.yaml`, `login-flow-b7e102.yaml`.
- Same outcome as Scenario 2 — `SLUG_CONFLICT` raises it on the next `clad check --strict`. Almost always indicates a mistake; the developer archives one.

## Legacy F-NNN ↔ new F-`hash`

Existing features (`F-001` through `F-083` at the time v0.3.9 shipped) keep their sequential ids and their `F-NNN.yaml` filenames forever. New features use the slug + hash model. The two models coexist:

- Spec loader: handles both filename layouts indiscriminately.
- `clad_get_feature`: accepts `F-049` (legacy) and `F-a3f9c2` (new) equivalently.
- `clad_list_features`: returns both in a single list.
- `ID_COLLISION` detector: catches a legacy hand-typed duplicate (`F-049` accidentally reused) just as it catches a hash collision.

There is no migration tool because there is no migration need. The legacy ids are stable identifiers in audit logs and external references; rewriting them would break that trail.

## When to override the auto-generated id

You shouldn't. The internal `createFeature` accepts a slug only; the host LLM gives you no way to pin a specific `F-<hash>`. The hash is built from inputs (slug + user + hostname + ms + hrtime) specifically so two developers cannot collude on the same hash by accident or design — that property is what makes git merges safe by construction.

If you genuinely need to reuse a specific id (e.g. to restore a deleted feature with its original identifier), edit the yaml file's `id:` field directly. Schema accepts both `F-\d{3,}` and `F-[a-f0-9]{6,}`; `ID_COLLISION` will catch any duplicate.

## spec/architecture.yaml — working invariant since v0.3.13

Until v0.3.13, `spec/architecture.yaml` was type-loaded but no detector consumed it — the `layers` and `forbidden_imports` fields were cosmetic. v0.3.13's `ARCHITECTURE_FROM_SPEC` detector turns them into a real invariant:

1. **forbidden_imports compliance** (error) — for each `{from, to}` rule, no file under `src/<from>/` may `import ... from '<...>/<to>/...'`.
2. **Undeclared directory** (warn) — any 1-depth directory under `src/` not listed in `architecture.layers`.
3. **Empty layer** (warn) — any layer named in `architecture.layers` with no matching `src/<layer>/`.

Example `spec/architecture.yaml`:

```yaml
layers:
  - - spec
    - hitl
    - events
  - - stages
    - adapters
  - - drive
    - serve
  - - cli
forbidden_imports:
  - from: spec
    to: stages
  - from: spec
    to: drive
  - from: adapters
    to: drive
```

- `layers` is an array of *tiers* — each inner array is a peer group at the same architectural level. The detector treats every entry as a flat set for membership checks; tiers are still meaningful to human readers.
- `forbidden_imports.from` and `.to` are layer names (matching directory names directly under `src/`).
- Path segments are matched literally: `src/spec/loader.ts` reading `import {x} from '../stages/x.js'` trips the `from: spec, to: stages` rule because `stages` is one of the segments.
- External-package imports (no leading `.`) are never matched.
- The detector is **toolchain-agnostic** — no madge / import-linter dependency. The existing `ARCHITECTURE_VIOLATION` detector (toolchain-driven, catches cycles) coexists and checks a different invariant.

Cladding's own `spec/architecture.yaml` is now production-grade — the same file external adopters see when they read the reference. Drift-green on `clad check --strict` confirms cladding's own src/ matches its declared layers.

## Reference

- Implementation: `src/spec/new.ts` · `src/serve/server.ts` (tools `clad_create_feature`, `clad_create_scenario`, `clad_list_features`, `clad_get_feature`)
- Detectors: `src/stages/detectors/{slug-conflict,id-collision,ac-duplicate-within-feature,architecture-from-spec}.ts`
- Spec entries: `spec/features/F-084.yaml` (model) · `spec/features/F-085.yaml` (filename hash + lookup tools + this doc) · `spec/features/F-087.yaml` (scenario hash model) · `spec/features/F-088.yaml` (ARCHITECTURE_FROM_SPEC)
