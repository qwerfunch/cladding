// Cladding · unit tests for cli/scan/greenfield-seeds (v0.3.42, F-bd07d7)
//
// Each test fabricates a single (language, projectName) call and
// asserts the body shape — header marker, 14-signal completeness for
// conventions, `version: "0.1"` + `layers: []` shape for architecture,
// `schema: "0.1"` + `capabilities: []` shape for capabilities. Pure
// function tests; no IO.

import {describe, expect, test} from 'vitest';

import {
  renderGreenfieldArchitectureYaml,
  renderGreenfieldCapabilitiesYaml,
  renderGreenfieldConventionsMd,
} from '../../src/cli/scan/greenfield-seeds.js';

describe('renderGreenfieldConventionsMd', () => {
  test('[covers:F-bd07d7/AC-001] TypeScript default — 2-space + single quote + camelCase + SEED header + style guide URL', () => {
    const out = renderGreenfieldConventionsMd('typescript', 'demo');
    expect(out).toMatch(/^<!-- Cladding · Tier C · derived from observed code \(greenfield seed for TypeScript\)/);
    expect(out).toContain('# demo — project conventions');
    expect(out).toContain('greenfield seed (language: TypeScript)');
    expect(out).toContain('https://google.github.io/styleguide/tsguide.html');
    expect(out).toContain('| indent | two-space |');
    expect(out).toContain('| quote | single |');
    expect(out).toContain('| semicolon | present |');
    expect(out).toContain('| naming (exports) | camelCase |');
    expect(out).toContain('| naming (constants) | UPPER_SNAKE |');
    // v0.4.x — greenfield seeds a HIGH-QUALITY documentation default (not 0):
    // a documented public surface + a module purpose header (Why > What).
    expect(out).toContain('| docblock ratio | 0.50 |');
    expect(out).toContain('| import order | node-first |');
    expect(out).toContain('| test location | tests-dir |');
    expect(out).toContain('| file header | purpose header — what the module does + why it exists |');
    expect(out).toContain('## Comments & documentation — Why > What');
    expect(out).toContain('Every exported');
    expect(out).toContain('## Adding a new module');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('Python default — 4-space + double quote + snake_case + PEP 8 URL', () => {
    const out = renderGreenfieldConventionsMd('python', 'demo');
    expect(out).toContain('| indent | four-space |');
    expect(out).toContain('| quote | double |');
    expect(out).toContain('| semicolon | absent |');
    expect(out).toContain('| naming (exports) | snake_case |');
    expect(out).toContain('https://peps.python.org/pep-0008/');
  });

  test('Go default — tab indent + PascalCase exports + result-pattern + Effective Go URL', () => {
    const out = renderGreenfieldConventionsMd('go', 'demo');
    expect(out).toContain('| indent | tab |');
    expect(out).toContain('| naming (exports) | PascalCase |');
    expect(out).toContain('| error handling | result-pattern |');
    expect(out).toContain('| test location | sibling-test |');
    expect(out).toContain('https://go.dev/doc/effective_go');
  });

  test('Rust default — 4-space + snake_case + result-pattern', () => {
    const out = renderGreenfieldConventionsMd('rust', 'demo');
    expect(out).toContain('| indent | four-space |');
    expect(out).toContain('| naming (exports) | snake_case |');
    expect(out).toContain('| error handling | result-pattern |');
    expect(out).toContain('| test location | sibling-test |');
  });

  test('Java default — Google Java style URL + camelCase', () => {
    const out = renderGreenfieldConventionsMd('java', 'demo');
    expect(out).toContain('| naming (exports) | camelCase |');
    expect(out).toContain('https://google.github.io/styleguide/javaguide.html');
  });

  test('[covers:F-dd51b42c/AC-562a6cc3] Kotlin default — 4-space + double quote + absent semicolon + kotlinlang style URL (F-dd51b42c)', () => {
    const out = renderGreenfieldConventionsMd('kotlin', 'demo');
    expect(out).toContain('greenfield seed for Kotlin');
    expect(out).toContain('greenfield seed (language: Kotlin)');
    expect(out).toContain('| indent | four-space |');
    expect(out).toContain('| quote | double |');
    expect(out).toContain('| semicolon | absent |');
    expect(out).toContain('| naming (exports) | camelCase |');
    expect(out).toContain('https://kotlinlang.org/docs/coding-conventions.html');
  });

  test('Unknown language falls back to TypeScript defaults', () => {
    const out = renderGreenfieldConventionsMd('unknown', 'demo');
    expect(out).toContain('greenfield seed for TypeScript');
    expect(out).toContain('| indent | two-space |');
    expect(out).toContain('https://google.github.io/styleguide/tsguide.html');
  });

  test('[covers:F-bd07d7/AC-002] every supported language renders the 12 table rows plus doc tag and module boilerplate representations with an inline style guide', () => {
    for (const [lang, styleGuide] of [
      ['typescript', '## Recommended baseline (per TypeScript style guide — https://google.github.io/styleguide/tsguide.html)'],
      ['javascript', '## Recommended baseline (per JavaScript style guide — https://google.github.io/styleguide/jsguide.html)'],
      ['python', '## Recommended baseline (per Python style guide — https://peps.python.org/pep-0008/)'],
      ['go', '## Recommended baseline (per Go style guide — https://go.dev/doc/effective_go)'],
      ['rust', '## Recommended baseline (per Rust style guide — https://doc.rust-lang.org/1.0.0/style/)'],
      ['ruby', '## Recommended baseline (per Ruby style guide — https://rubystyle.guide/)'],
      ['java', '## Recommended baseline (per Java style guide — https://google.github.io/styleguide/javaguide.html)'],
      ['kotlin', '## Recommended baseline (per Kotlin style guide — https://kotlinlang.org/docs/coding-conventions.html)'],
    ] as const) {
      const out = renderGreenfieldConventionsMd(lang, 'demo');
      expect(out).toContain(styleGuide);
      // The observed renderer's 12 table rows remain table-shaped; its two
      // non-tabular signals use their explicit headings below the table.
      for (const key of [
        'indent',
        'quote',
        'semicolon',
        'naming (exports)',
        'naming (constants)',
        'docblock ratio',
        'import order',
        'export pattern',
        'error handling',
        'type def location',
        'test location',
        'file header',
      ]) {
        expect(out).toContain(`| ${key} |`);
      }
      for (const line of [
        '## Doc tag frequency',
        '- `@param`: 0',
        '- `@returns`: 0',
        '- `@throws`: 0',
        '- `@example`: 0',
        '- `@see`: 0',
        '- `@deprecated`: 0',
        '## Module boilerplate (smallest exported module observed)',
        '(none observed yet)',
      ]) {
        expect(out).toContain(line);
      }
    }
  });

  test('projectName is interpolated into the heading', () => {
    const out = renderGreenfieldConventionsMd('typescript', 'my-cool-project');
    expect(out).toContain('# my-cool-project — project conventions');
  });
});

describe('renderGreenfieldArchitectureYaml', () => {
  test('[covers:F-bd07d7/AC-001][covers:F-bd07d7/AC-003] TypeScript default — empty layers + TS layer baseline in comment (no schema-rejected version key, v0.4.0)', () => {
    const out = renderGreenfieldArchitectureYaml('typescript');
    expect(out).toMatch(/^# Cladding · Tier B · SSoT/);
    expect(out).not.toContain('version:');
    expect(out).toContain('Greenfield seed');
    expect(out).toContain('Typical TypeScript baseline:');
    expect(out).toContain('#  src/cli/');
    expect(out).toContain('#  src/core/');
    expect(out).toContain('#  src/lib/');
    expect(out).toContain('#  src/ui/');
    expect(out).toContain('layers: []');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('Python default — src/<package>/ + tests/ baseline', () => {
    const out = renderGreenfieldArchitectureYaml('python');
    expect(out).toContain('Typical Python baseline:');
    expect(out).toContain('#  src/<package>/');
    expect(out).toContain('#  tests/');
    expect(out).toContain('layers: []');
  });

  test('Go default — cmd/ + pkg/ + internal/ baseline', () => {
    const out = renderGreenfieldArchitectureYaml('go');
    expect(out).toContain('Typical Go baseline:');
    expect(out).toContain('#  cmd/<binary>/');
    expect(out).toContain('#  pkg/');
    expect(out).toContain('#  internal/');
  });

  test('[covers:F-dd51b42c/AC-562a6cc3] Kotlin default — src/main/kotlin/ + src/test/kotlin/ baseline (F-dd51b42c)', () => {
    const out = renderGreenfieldArchitectureYaml('kotlin');
    expect(out).toContain('Typical Kotlin baseline:');
    expect(out).toContain('#  src/main/kotlin/<package>/');
    expect(out).toContain('#  src/test/kotlin/<package>/');
    expect(out).toContain('layers: []');
  });

  test('Unknown language falls back to TypeScript baseline', () => {
    const out = renderGreenfieldArchitectureYaml('cobol');
    expect(out).toContain('Typical TypeScript baseline:');
    expect(out).toContain('#  src/cli/');
  });

  test('Re-scan instruction is present so the user knows the proposal flow', () => {
    const out = renderGreenfieldArchitectureYaml('typescript');
    expect(out).toContain('`clad init --scan`');
    expect(out).toContain('.cladding/scan/architecture.yaml.proposal');
  });
});

describe('renderGreenfieldCapabilitiesYaml', () => {
  test('[covers:F-bd07d7/AC-001] projectName is interpolated and the schema header is intact', () => {
    const out = renderGreenfieldCapabilitiesYaml('demo');
    expect(out).toContain("list demo's user-facing capabilities");
    expect(out).toContain('schema: "0.1"');
    expect(out).toContain('source: README.md');
    expect(out).toContain('capabilities: []');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('[covers:F-bd07d7/AC-004] keeps the language-neutral capabilities guidance while interpolating each project name', () => {
    const alpha = renderGreenfieldCapabilitiesYaml('alpha');
    const beta = renderGreenfieldCapabilitiesYaml('beta');
    expect(alpha).toContain("list alpha's user-facing capabilities");
    expect(beta).toContain("list beta's user-facing capabilities");
    expect(alpha.replaceAll('alpha', '<project>')).toBe(beta.replaceAll('beta', '<project>'));
  });

  test('Capability entry shape is documented in the comment', () => {
    const out = renderGreenfieldCapabilitiesYaml('demo');
    expect(out).toContain('id: <kebab-slug>');
    expect(out).toContain('title:');
    expect(out).toContain('summary:');
    expect(out).toContain('surface: feature | platform | tool | infrastructure');
  });

  test('Re-scan instruction points at the proposal divert path', () => {
    const out = renderGreenfieldCapabilitiesYaml('demo');
    expect(out).toContain('`clad init --scan`');
    expect(out).toContain('.cladding/scan/capabilities.yaml.proposal');
  });

  test('Language is irrelevant — the body is the same across project types', () => {
    const a = renderGreenfieldCapabilitiesYaml('demo');
    const b = renderGreenfieldCapabilitiesYaml('demo');
    expect(a).toBe(b);
  });
});
