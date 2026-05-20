---
description: Render the feature × stage Integrity Panel — a matrix of every feature vs every Iron Law stage with pass/skip/fail markers. Use when the user wants a project-wide status board, a release-readiness view, or to spot which features are still behind which stage.
---

# Cladding panel

Run `clad panel` from the project root. Renders an ASCII matrix:

- Rows: features (business titles by default; raw ids with `--internal` — legacy `F-NNN` for pre-v0.3.9 features, `F-<hash6>` for v0.3.9+).
- Columns: 13 Iron Law stages.
- Cells: pass · skip · fail · not-yet-attempted.

Use this after `clad check` to see *which features* failed *which stages* at a glance, not just the aggregate exit code.

```
clad panel
clad panel --internal
```
