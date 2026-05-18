---
name: Bug report
about: Report a reproducible defect in cladding
title: "[bug] "
labels: bug
assignees: ''
---

## What happened

<!-- A clear one-paragraph description of what went wrong. -->

## How to reproduce

1. <!-- Step 1 -->
2. <!-- Step 2 -->
3. <!-- … -->

**Minimal reproducer** (if possible — link to a gist, a branch, or paste the offending `spec/features/*.yaml` snippet):

```
<!-- paste here -->
```

## Expected vs actual

| | Expected | Actual |
|---|---|---|
| stage / detector | <!-- e.g. stage_1.3 Drift --> | <!-- e.g. UNTESTED_AC false-positive --> |
| exit code | <!-- e.g. 0 --> | <!-- e.g. 1 --> |
| output | <!-- e.g. "13/13 stages clean" --> | <!-- paste relevant output --> |

## Environment

- cladding version: <!-- output of `node bin/clad --version` -->
- Node version: <!-- `node --version` -->
- OS: <!-- macOS / Linux / Windows + version -->
- Toolchain languages in use: <!-- typescript · python · rust · go · java · php · ruby · elixir · dotnet — list any active for this repo -->
- Ironclad spec pin: <!-- value of `.claude-plugin/plugin.json` `ironclad.spec-version` -->

## Anything else

<!-- Logs, audit-log entries, screenshots — anything that helps. Strip secrets first. -->
