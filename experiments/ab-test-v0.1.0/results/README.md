# Results — one folder per cell

`results/<scope>/<mode>/measurement.json` carries the six-axis summary for that cell. The raw artifacts (every file the agent produced) live under `~/Developer/work/cladding-abc/<scope>/<mode>/` and are *not* committed.

Cell index:

| scope | mode | status |
|---|---|---|
| 01-simple | vanilla | ✓ |
| 01-simple | harness | ✓ |
| 01-simple | cladding | ✓ |
| 02-medium | vanilla | ✓ |
| 02-medium | harness | ✓ |
| 02-medium | cladding | ✓ |
| 03-large | vanilla | ✓ |
| 03-large | harness | ✓ |
| 03-large | cladding | ✓ |

After all nine cells complete, the cross-cell synthesis goes in `../REPORT.md`.
