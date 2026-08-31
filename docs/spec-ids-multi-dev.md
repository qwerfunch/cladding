# Multi-developer-safe spec IDs

<!-- clad-doc-links: ignore — this guide uses illustrative F-id examples (e.g. F-c4d108) in prose, not real references -->

Two or more contributors can add new features or scenarios to a cladding-applied project simultaneously without git merge conflicts. This document explains how and what to do when something looks off.

## The short version

| Layer | Identifier | Scope | Multi-dev safety |
|---|---|---|---|
| **Filename** | `<slug>-<hash8>.yaml` (8 hex since 0.6.0, legacy 6 hex valid; e.g. `login-flow-a3f9c2e1.yaml`) | one per feature or scenario | ✅ Two contributors with the same slug get different hashes → different file paths → no `git merge` collision |
| **Feature id** | `F-<hash8>` (e.g. `F-a3f9c2e1`) — same hash as filename | globally unique by construction | ✅ < 1/4.3B per-pair collision at 8 hex (6-hex birthday bound neared 50% at ~5k features); `ID_COLLISION` detector catches the rest |
| **Scenario id** | `S-<hash8>` (e.g. `S-c4d108e9`) — full feature-symmetric model since v0.3.12 | globally unique by construction | ✅ Same guarantees as features; `F-*` and `S-*` are separate id namespaces |
| **Slug** (yaml field) | `login-flow` | human-readable anchor, separate namespaces for features vs scenarios | ⚠️ Two contributors picking the same slug within the same namespace is *expected* if they have the same intent; `SLUG_CONFLICT` detector raises this as an error so a human resolves it |
| **AC id** | `AC-<hash8>` for new records; legacy `AC-NNN` and six-or-more-hex forms remain readable | **feature-scoped; canonical address `criterion:<F-id>/<AC-id>`** | ✅ Same AC spelling may coexist under different features; `AC_DUPLICATE_WITHIN_FEATURE` catches only an intra-feature duplicate |
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

- Alice on `feat/login`: `createFeature(slug='login-flow')` → `login-flow-a3f9c2e1.yaml`
- Bob on `feat/checkout`: `createFeature(slug='checkout-cart')` → `checkout-cart-d29f1a7b.yaml`
- main merge → both files land cleanly. **No conflict.**

### Scenario 2: Same slug, simultaneous

- Alice on `feat/auth-1`: `createFeature(slug='auth-bypass')` → `auth-bypass-c4d108e9.yaml`
- Bob on `feat/auth-2`: `createFeature(slug='auth-bypass')` → `auth-bypass-e7f201ab.yaml`
- main merge → both files land cleanly (different hashes → different paths).
- `clad check --strict` → `SLUG_CONFLICT` error: *"slug 'auth-bypass' is used by both F-c4d108e9 and F-e7f201ab"*.
- Human resolves: either (a) the two features are *the same intent* — archive one (`status: archived`); (b) the two features are *different intents* that picked the same name — rename one slug.

The detector reports the conflict; the human decides what was meant. cladding does not silently merge or auto-rename because semantic intent is not something the tool can guess.

### Scenario 3: Same contributor, same cwd, repeated call

- One developer calls `createFeature(slug='login-flow')` twice in a row.
- Both files written: `login-flow-a3f9c2e1.yaml`, `login-flow-b7e102cd.yaml`.
- Same outcome as Scenario 2 — `SLUG_CONFLICT` raises it on the next `clad check --strict`. Almost always indicates a mistake; the developer archives one.

## Merging: derived files heal, never hand-resolve

The scenarios above cover *authored* shard files. Two files under `spec/` are instead *derived* — written by the harness, never by hand:

- `spec/attestation.yaml` — the Tier-C verification record; a GREEN `clad check --tier=pre-push --strict` gate is its only author.
- `spec/index.yaml` — the feature index, refreshed by `clad sync`.

When a merge, rebase, or cherry-pick conflicts in either one, **do not resolve the hashes by hand.** After a merge both sides are stale against the merged tree — neither the incoming nor the local value describes the code you actually end up with — so any hand-picked hash is wrong by construction. Only a GREEN strict pre-push gate can recompute the truth, and it will.

### The ritual

```bash
# 1. Keep either side of the derived files — the values don't matter yet.
git checkout --ours -- spec/attestation.yaml spec/index.yaml
git add spec/attestation.yaml spec/index.yaml

# 2. Finish the merge FIRST. A gate run mid-operation writes nothing to
#    derived files — the write guard defers while a merge/rebase/cherry-pick
#    is in flight, and `clad done` refuses outright — so a half-merged tree
#    can never be stamped as verified.
git commit --no-edit

# 3. Run the gate. A GREEN result rewrites both files canonically.
clad check --tier=pre-push --strict

# 4. Commit the canonical rewrite.
git add spec/attestation.yaml spec/index.yaml
git commit -m "chore: canonicalize derived files after merge"
```

The order is load-bearing: because the write guard makes the gate a no-op mid-merge, the merge must be a completed commit before step 3 can rewrite anything. If the gate comes back RED it writes nothing — fix the real drift it reports and rerun; the rewrite only lands on GREEN.

### Why conflicts still happen at all

The machinery that shrinks the conflict surface cannot erase it:

- **The PR surface ignores merge attributes.** A pull-request merge on GitHub is a server-side merge that never consults `.gitattributes` — no local merge driver and no `merge=union` attribute reaches it. A conflict a local merge would have auto-resolved can still surface in a PR. The ritual is unchanged: land the merge, run the gate.
- **Adjacent sorted lines.** The attestation writes one sorted line per module file, so edits to *different* files merge cleanly — even on the PR surface. The boundary: two edits landing on the *same* sorted line, or on two *immediately adjacent* lines, still conflict, because git needs one unchanged buffer line between hunks. When they do, the conflict is exactly one line and sits right beside the real source conflict that caused it. Heal it with the ritual, not by reading the hashes.

### The one-time v1→v2 transition

Repos upgrading cross the attestation format over automatically. v1 keyed one hash per done feature over *all* its module bytes, so a single shared-file edit rewrote every co-owner's line — the top conflict surface in parallel work. v2 keys one hash per module *file* plus a constant `ok` marker per feature, so an edit moves exactly its own line. The first GREEN `clad check --tier=pre-push --strict` after upgrade performs the conversion; the reader accepts either layout in the meantime.

One caveat for a branch cut *before* your repo crossed over: rebase past the conversion commit, and on any attestation conflict take the already-converted (v2) copy wholesale rather than splicing the two layouts by hand — then run the gate to recompute. (Accepting either side and running the gate also works — the gate rewrites canonically regardless — but keeping the v2 copy avoids leaving a stale v1 layout in the branch's intermediate commits.) A union-merge of the two formats produces a harmless dual-section file: the reader tolerates it, and the next GREEN gate canonicalizes it.

### Attribute state

The two derived files are configured differently in `.gitattributes` on purpose:

| File | `.gitattributes` | Why |
|---|---|---|
| `spec/index.yaml` | `merge=union` | Append-mostly and high-churn; union concatenates both sides, and any duplicate rows heal within minutes on the next `clad sync`. |
| `spec/attestation.yaml` | *(no attribute — deliberate)* | `merge=union` here silently reverts uncontested edits that get swept into an adjacent conflict zone (experimentally confirmed). A plain, loud conflict is safe — it heals via the ritual above. |

This table is pinned to the real repository state: if `.gitattributes` ever changes for either file, update it here.
`clad init` creates or appends the exact `spec/index.yaml merge=union` line while preserving every existing attribute; it never assigns a merge driver to `spec/attestation.yaml`.

## Legacy F-NNN ↔ new F-`hash`

Existing features (`F-001` through `F-083` at the time v0.3.9 shipped) keep their sequential ids and their `F-NNN.yaml` filenames forever. New features use the slug + hash model. The two models coexist:

- Spec loader: handles both filename layouts indiscriminately.
- `clad_get_feature`: accepts `F-049` (legacy) and `F-a3f9c2e1` (new) equivalently.
- `clad_list_features`: returns both in a single list.
- `ID_COLLISION` detector: catches a legacy hand-typed duplicate (`F-049` accidentally reused) just as it catches a hash collision.

There is no migration tool because there is no migration need. The legacy ids are stable identifiers in audit logs and external references; rewriting them would break that trail.

## When to override the auto-generated id

You shouldn't. The internal `createFeature` accepts a slug only; the host LLM gives you no way to pin a specific `F-<hash8>`. The hash is built from inputs (slug + user + hostname + ms + hrtime) specifically so two developers cannot collude on the same hash by accident or design — that property is what makes git merges safe by construction.

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
