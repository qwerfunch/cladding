// Cladding · `clad clarify` refines a schema 0.2 workspace natively (F-c4df5fb4).
//
// The onboarding loop used to publish every refined artifact through the
// schema 0.1 compatibility journal, which refuses a schema 0.2 workspace. These
// tests drive a real host-drafted init → clarify round trip and then hand the
// result to the compiler and to the typed edit boundary: a refinement that only
// looks like schema 0.2 would satisfy a string assertion and brick the first
// feature the adopter tries to author.

import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {parse as parseYaml} from 'yaml';

import {refineOnboarding} from '../../src/cli/clarify.js';
import {extractScenarios} from '../../src/cli/scan/intent-onboarding.js';
import {renderHostDraft} from '../../src/cli/host-onboarding.js';
import {runInit} from '../../src/cli/init.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {createFeature} from '../../src/spec/new.js';

const DRAFT = {
  mode: 'greenfield',
  project_context: {
    why: 'Studios invoice each other by hand.',
    problem: 'Nobody can tell which invoice was settled.',
    purpose: 'Settle every studio-to-studio invoice with one visible ledger.',
  },
  capabilities: [
    {id: 'invoicing', title: 'Invoicing', summary: 'Issues an invoice a studio can send.', surface: 'feature'},
    {id: 'ledger', title: 'Ledger', summary: 'Records every settlement.', surface: 'infrastructure'},
  ],
  architecture: {layers: [{name: 'api', forbidden_imports: ['ledger']}, {name: 'ledger', forbidden_imports: []}]},
  scenarios: [{slug: 'settle-invoice', title: 'Settle an invoice', flow: 'issue\nsettle'}],
  questions: ['Which market launches first?'],
} as const;

const REFINED = {
  ...DRAFT,
  project_context: {
    ...DRAFT.project_context,
    purpose: 'Settle every Korean studio-to-studio invoice with one visible ledger.',
  },
  capabilities: [
    {id: 'invoicing', title: 'Invoicing', summary: 'Issues a Korean-market invoice.', surface: 'feature'},
    {id: 'ledger', title: 'Ledger', summary: 'Records every settlement.', surface: 'infrastructure'},
  ],
  questions: [],
} as const;

interface CapabilityRecord {
  readonly id?: string;
  readonly title?: string;
  readonly outcome?: string;
}

describe('schema 0.2 native clarify', () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'clad-clarify-02-'));
    const draft = renderHostDraft(DRAFT as never, dir);
    await runInit({cwd: dir, intent: 'Invoice settlement for studios.', hostDispatcher: async () => draft});
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-c4df5fb4/AC-9e0a4c31] a refinement publishes the catalog and the layers through the typed edit boundary', async () => {
    const refined = renderHostDraft(REFINED as never, dir);
    const outcome = await refineOnboarding('Korea first', {cwd: dir, hostDispatcher: async () => refined});

    expect(outcome).toMatchObject({ok: true, code: 0});
    const capabilitiesBody = readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8');
    const capabilities = (parseYaml(capabilitiesBody) as {capabilities?: readonly CapabilityRecord[]}).capabilities ?? [];
    expect(capabilities).toEqual([
      {id: 'invoicing', title: 'Invoicing', outcome: 'Issues a Korean-market invoice. — surface: feature'},
      {id: 'ledger', title: 'Ledger', outcome: 'Records every settlement. — surface: infrastructure'},
    ]);
    // The legacy wrapper keys have no home in a schema 0.2 catalog.
    expect(capabilitiesBody).not.toMatch(/^schema:/m);
    expect(capabilitiesBody).not.toMatch(/^source:/m);
    // The typed boundary owns the catalog bytes: it re-renders the contract and
    // keeps no authoring guidance, which a byte replacement would have carried
    // through unchanged.
    expect(capabilitiesBody).not.toContain('# Cladding · Tier B');

    const architecture = parseYaml(readFileSync(join(dir, 'spec', 'architecture.yaml'), 'utf8')) as {
      layers?: readonly (readonly string[])[];
      rules?: readonly unknown[];
    };
    expect(architecture.layers).toEqual([['api', 'ledger']]);
    // Onboarding observes no rationale, so it proposes no architecture rule.
    expect(architecture.rules).toEqual([]);

    expect(compileSpecWorkspace(dir).diagnostics.filter((d) => d.severity === 'blocking')).toEqual([]);
  });

  test('[covers:F-c4df5fb4/AC-9e0a4c31] a refinement folds the stated purpose into the project region', async () => {
    const refined = renderHostDraft(REFINED as never, dir);
    await refineOnboarding('Korea first', {cwd: dir, hostDispatcher: async () => refined});

    const root = parseYaml(readFileSync(join(dir, 'spec.yaml'), 'utf8')) as {project?: {purpose?: string}};
    expect(root.project?.purpose).toBe('Settle every Korean studio-to-studio invoice with one visible ledger.');
    expect(readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8')).toContain('Korean studio-to-studio');
  });

  test('[covers:F-c4df5fb4/AC-9e0a4c31] a refinement refuses a project-context body a concurrent author moved', async () => {
    const refined = renderHostDraft(REFINED as never, dir);
    const context = join(dir, 'docs', 'project-context.md');
    const successor = '# author-owned context\n';
    const catalogBefore = readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8');

    const outcome = await refineOnboarding('Korea first', {
      cwd: dir,
      hostDispatcher: async () => refined,
      testBeforeCanonicalCommit: () => writeFileSync(context, successor),
    });

    expect(outcome).toMatchObject({ok: false, code: 1});
    expect(outcome.error).toContain('changed while the refinement was being prepared');
    // Nothing published: the concurrent author keeps the document, and the
    // typed regions never saw a transaction.
    expect(readFileSync(context, 'utf8')).toBe(successor);
    expect(readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8')).toBe(catalogBefore);
  });

  test('[covers:F-c4df5fb4/AC-9e0a4c31] a drafted journey waits for review instead of blocking the first feature', async () => {
    const refined = renderHostDraft(REFINED as never, dir);
    const outcome = await refineOnboarding('Korea first', {cwd: dir, hostDispatcher: async () => refined});

    // A schema 0.2 journey binds a feature; onboarding has none to bind, so the
    // draft is staged rather than written into spec/scenarios/.
    const scenario = extractScenarios('- slug: settle-invoice\n  title: Settle an invoice\n  flow: issue\n')[0]!;
    const draftName = `settle-invoice-${scenario.id.replace(/^S-/, '')}.yaml`;
    const staged = `spec/scenarios/${draftName}`;
    expect(outcome.proposals).toContain(`${staged} → .cladding/scan/${draftName}.proposal`);
    const draftBody = readFileSync(join(dir, '.cladding', 'scan', `${draftName}.proposal`), 'utf8');
    expect(draftBody).toContain('feature_refs: []');
    expect(draftBody).toContain('actor: ""');
    expect(existsSync(join(dir, staged))).toBe(false);
    expect(readdirSync(join(dir, 'spec', 'scenarios')).filter((name) => name.endsWith('.yaml'))).toEqual([]);

    // The regression this staging exists for: an unbound journey makes the
    // typed edit boundary refuse every transaction, so the adopter could never
    // author their first feature.
    const created = createFeature({
      cwd: dir,
      slug: 'issue-invoice',
      title: 'Issue an invoice',
      purpose: 'Let a studio issue an invoice another studio can settle.',
      capability_refs: ['invoicing'],
      acceptance_criteria: [{
        kind: 'behavior',
        statement: 'When a studio submits invoice details, the system shall issue a numbered invoice.',
      }],
    });
    expect(existsSync(created.path)).toBe(true);
  });
});
