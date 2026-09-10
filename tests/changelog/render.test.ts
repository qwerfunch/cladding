// Cladding · unit tests for src/changelog/render.ts (F-904495a5)
//
// Pure renderer contract over a hand-built manifest/spec:
//   - prose markdown: capability headings + AC sentences, NO internal ids
//     (Soft Shell), honest "no shipped changes" line for an empty manifest
//   - audit table: ids KEPT, unresolved ref marked ✗, derived: ref labeled
//   - catalog: capability → feature → plain AC sentences

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import type {ChangelogManifest} from '../../src/changelog/collect.js';
import {renderAuditTable, renderCatalog, renderChangelogMarkdown} from '../../src/changelog/render.js';
import type {Spec} from '../../src/spec/types.js';

const EMPTY_INVENTORY = {capabilities: 0, features: 0, scenarios: 0, test_files: 0};

function manifestWith(partial: Partial<ChangelogManifest>): ChangelogManifest {
  return {
    groups: [],
    head: 'abc123def456',
    inventory: {after: EMPTY_INVENTORY, before: EMPTY_INVENTORY},
    since: 'v1.2.3',
    unsharded_commits: [],
    ...partial,
  };
}

const SHIPPED: ChangelogManifest = manifestWith({
  groups: [
    {
      capability: 'auth',
      title: 'Authentication',
      features: [
        {
          acceptance: ['The system shall log a user in with email and password.'],
          change: 'added-as-done',
          id: 'F-abc123',
          slug: 'login-flow',
          title: 'Login flow',
        },
      ],
    },
    {
      capability: 'uncategorized',
      title: 'Uncategorized',
      features: [
        {
          acceptance: ['If the session expires, then the system shall re-prompt for credentials.'],
          change: 'flipped-to-done',
          id: 'F-def456',
          title: 'Session expiry',
        },
      ],
    },
  ],
});

describe('changelog/render — renderChangelogMarkdown', () => {
  test('[covers:F-904495a5/AC-72a97f] markdown groups by capability headings and carries AC sentences with no internal ids', () => {
    const md = renderChangelogMarkdown(SHIPPED);
    expect(md).toContain('# Changes since v1.2.3');
    expect(md).toContain('## Authentication');
    expect(md).toContain('## Uncategorized');
    expect(md).toContain('**Login flow**');
    expect(md).toContain('The system shall log a user in with email and password.');
    expect(md).toContain('If the session expires, then the system shall re-prompt for credentials.');
    // Soft Shell: internal ids never reach the prose surface.
    expect(md).not.toMatch(/\bF-[0-9a-f]{6}\b/);
    expect(md).not.toMatch(/\bAC-[0-9a-f]{3,}\b/);
  });

  test('[covers:F-904495a5/AC-72a97f] renders the honest no-shipped-changes line for a zero-change manifest', () => {
    const md = renderChangelogMarkdown(manifestWith({since: 'v9.9.9'}));
    expect(md).toBe('no shipped changes since v9.9.9');
  });

  test('[covers:F-904495a5/AC-72a97f] unsharded commits render under an honest not-yet-spec-tracked section', () => {
    const md = renderChangelogMarkdown(
      manifestWith({unsharded_commits: [{hash: 'abc1234', subject: 'feat: add a thing users can see'}]}),
    );
    expect(md).toContain('## Other changes (not yet spec-tracked)');
    expect(md).toContain('- feat: add a thing users can see');
    expect(md).not.toContain('no shipped changes');
  });
});

describe('changelog/render — renderAuditTable', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-render-audit-'));
    mkdirSync(join(dir, 'tests'), {recursive: true});
    writeFileSync(join(dir, 'tests', 'present.test.ts'), '// evidence on disk\n');
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  const spec: Spec = {
    schema: '0.1',
    project: {name: 'probe', language: 'typescript'},
    features: [
      {
        id: 'F-abc123',
        slug: 'login-flow',
        title: 'Login flow',
        status: 'done',
        acceptance_criteria: [
          {
            id: 'AC-111111',
            ears: 'ubiquitous',
            text: 'The system shall log a user in.',
            test_refs: ['tests/present.test.ts', 'tests/gone.test.ts'],
          },
          {
            id: 'AC-222222',
            ears: 'unwanted',
            text: 'If the password is wrong, then the system shall reject the login.',
            test_refs: ['derived:tests/suggested.test.ts'],
          },
        ],
      },
    ],
  };

  test('[covers:F-904495a5/AC-60067c] audit table keeps ids, marks an unresolved ref ✗ and labels a derived: ref', () => {
    const table = renderAuditTable(SHIPPED, spec, dir);
    expect(table).toContain('| feature | AC | EARS | verification refs |');
    // ids KEPT — this is the audit surface.
    expect(table).toContain('F-abc123');
    expect(table).toContain('AC-111111');
    expect(table).toContain('ubiquitous');
    // resolution marks: present file ✓, missing file ✗.
    expect(table).toContain('✓ tests/present.test.ts');
    expect(table).toContain('✗ tests/gone.test.ts');
    // derived: refs are labeled, never resolved as evidence.
    expect(table).toContain('derived:tests/suggested.test.ts (machine-suggested — not author-confirmed)');
    expect(table).not.toContain('✓ derived:');
    expect(table).not.toContain('✗ derived:');
    // a manifest feature the live spec no longer carries stays an honest row.
    expect(table).toContain('| F-def456 | — | — | (removed from spec — see git history at v1.2.3) |');
  });
});

describe('changelog/render — renderCatalog', () => {
  test('[covers:F-904495a5/AC-72a97f] catalog lists capability then feature then plain AC sentences', () => {
    const spec: Spec = {
      schema: '0.1',
      project: {name: 'probe', language: 'typescript'},
      capabilities: [
        {id: 'auth', title: 'Authentication', summary: 'Sign-in and session safety', features: ['F-abc123']},
      ],
      features: [
        {
          id: 'F-abc123',
          title: 'Login flow',
          status: 'done',
          acceptance_criteria: [{id: 'AC-111111', ears: 'ubiquitous', text: 'The system shall log a user in.'}],
        },
        {
          id: 'F-def456',
          title: 'Session expiry',
          status: 'planned',
          acceptance_criteria: [
            {
              id: 'AC-222222',
              ears: 'unwanted',
              condition: 'if the session expires',
              action: 're-prompt for credentials',
            },
          ],
        },
        {id: 'F-0ld001', title: 'Retired thing', status: 'archived'},
      ],
    };
    const catalog = renderCatalog(spec);
    expect(catalog).toContain('# probe — capability catalog');
    expect(catalog).toContain('## Authentication');
    expect(catalog).toContain('Sign-in and session safety');
    expect(catalog).toContain('### Login flow');
    expect(catalog).toContain('- The system shall log a user in.');
    // a feature no capability claims still surfaces, under Uncategorized.
    expect(catalog).toContain('## Uncategorized');
    expect(catalog).toContain('### Session expiry');
    // EARS parts compose into a sentence when no pre-rendered text exists.
    expect(catalog).toContain('If the session expires, the system shall re-prompt for credentials.');
    // archived features are not part of the living catalog.
    expect(catalog).not.toContain('Retired thing');
  });
});
