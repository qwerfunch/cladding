<!-- Cladding · Tier C · Derived — observed from code · Refreshed by: clad init --scan -->

# task-manager — Conventions

| Key | Value |
|---|---|
| Indent | two-space |
| Quote | single |
| Semicolon | present |
| Naming (exports) | camelCase / PascalCase for components |
| File extensions (imports) | none (Vite handles `.tsx` resolution) |
| Test framework | vitest + React Testing Library |
| State | React hooks; no external state library |

Tailwind utility classes are used in JSX. Each component lives in a single file; hooks live in `src/hooks/`; pure utilities in `src/lib/`.
