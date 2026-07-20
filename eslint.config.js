// Cladding · ESLint flat config (ESLint 9+)
//
// Minimum policy: typescript-eslint recommended set. Project-specific
// tightening (Google TS Style) layered on top — restricted to `stages/`
// where cladding's own implementation lives.

import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // .cladding/ is machine-local runtime state (e.g. the generated host
    // launcher serve.cjs) — never authored source, so never linted.
    ignores: ['node_modules/**', 'dist/**', 'plugins/**/dist/**', 'src/graph/viewer/**', '.cladding/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['stages/**/*.ts', 'spec/**/*.ts', 'conformance/**/*.ts', 'tests/**/*.ts', 'hitl/**/*.ts', 'router/**/*.ts', 'ui/**/*.ts', 'cli/**/*.ts', 'optimizer/**/*.ts', 'events/**/*.ts', 'drive/**/*.ts'],
    rules: {
      // Google TS Style — single quotes (override if doubles preferred).
      quotes: ['error', 'single', {avoidEscape: true}],
      semi: ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
    },
  },
);
