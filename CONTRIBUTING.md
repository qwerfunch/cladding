# Contributing to Cladding

Thanks for your interest in helping make code iron-clad.

[`GOVERNANCE.md`](GOVERNANCE.md) is the canonical guide for *how* contributions are reviewed, what's in-scope, and what gets rejected. This file is the **fast path** — read it first, then go to `GOVERNANCE.md` for the details that govern merge decisions.

## Before your first PR

1. **Read [`GOVERNANCE.md`](GOVERNANCE.md) §4 (Contributor Policy).** Sections 4.1 (welcome contributions), 4.2 (out-of-scope), and 4.3 (PR contract) are non-negotiable.
2. **Pick an open issue** — preferably one tagged `good-first-issue`. If you have a fresh idea, open an issue first to confirm scope before writing code.
3. **Branch off `develop`**, not `main`. Naming convention: `feature/<short-slug>` or `fix/<short-slug>`.
4. **Run the four-check loop locally** before pushing:
   ```
   npm test
   npm run typecheck
   npm run lint
   node bin/clad check       # 13/13 stages clean on a clean tree
   ```
   When you change a stage, a detector, or the conformance contract, also run `npm run conformance` to re-verify the 26 fixtures. The runner is a contributor self-audit tool — it depends on dev-only toolchain binaries (`tsc` / `eslint` / `madge` / `secretlint` / `vitest`), so it works after a contributor install (`npm install`), **not** after the end-user install (`npm install -g cladding`).
5. **Add a CHANGELOG entry** under the next-release heading, in the right [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) section (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`).
6. **Open the PR against `develop`.** The maintainer fast-forwards `main` only at release time.

## What kind of contributions land easily

- Bug fixes with a reproducer test.
- New conformance fixtures (especially fail-cases that catch drift the current suite misses).
- New language entries in `src/stages/toolchain/detect.ts`.
- Documentation clarity passes — typos, broken links, confusing examples.
- README translations.

For larger ideas (new detector, new stage, new agent persona, breaking change), open an issue first — `GOVERNANCE.md` §2 explains the versioning bump that's involved.

## Security issues

**Do not** open a public issue for a security report. See [`SECURITY.md`](SECURITY.md) for the private reporting channel.

## Code of Conduct

This project follows the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md). Be kind, be specific, assume good faith.
