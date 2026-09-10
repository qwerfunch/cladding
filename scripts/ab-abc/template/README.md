# abc-fixture

A small TypeScript library. Conventions this repository expects:

- Source lives in `src/`, tests in `tests/`, one test file per source module.
- Every source and test file opens with a one-line header comment naming the file
  and what it is for.
- Two-space indent, single quotes, semicolons, named exports in camelCase.
- TypeScript ESM: import sibling modules with an explicit `.js` extension.
- Errors are thrown as named `Error` subclasses, never returned as `null`.
- `npm test` (vitest), `npm run typecheck` (tsc), and `npm run lint` (eslint) must
  all pass before work is considered finished.
