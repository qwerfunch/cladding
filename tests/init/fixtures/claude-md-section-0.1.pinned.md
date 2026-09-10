## cladding

**Spec is SSoT** — `spec.yaml` is authoritative; code must satisfy its
`features[]` and `acceptance_criteria`. Run `clad check --strict` before commit.

**Persona separation** — planner writes spec, reviewer audits, developer
implements; whoever authors a unit must not sign off on it (anti-self-cert).

**Feature cycle — one at a time** — One feature end-to-end before the next:
author its spec entry (`acceptance_criteria` + `modules`) → implement → author tests
in a separate context → `clad done <featureId>` (sets `status: done` only when
`clad check --tier=pre-push --strict` is GREEN). Never author spec entries ahead of
their code, or hand-write `status: done`. See `docs/feature-cycle.md`.

**Hash-based IDs** — Never hand-author `F-NNN` filenames; use the `clad` CLI
(or `/cladding:init`). Model in `docs/spec-ids-multi-dev.md`.

**Drift detectors** — `clad check --strict` runs them all; don't suppress
findings — fix them or update spec.

**Speak the user's language** — when reporting to the user, translate
cladding terms into plain words in the user's own language — including
cladding's own gate and hook messages: relay them by
meaning. Never lead with internal ids.
