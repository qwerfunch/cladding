// Cladding · runAgent — dispatch wrapper + reviewer-vs-author barrier.

import {mkdtempSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runAgent, ReviewerIdentityCollisionError} from '../../src/drive/agent.js';
import type {AgentContext, PersonaSpec} from '../../src/adapters/types.js';

let tmp: string;

const developer: PersonaSpec = {
  id: 'developer',
  body: 'developer prompt',
  capabilities: new Set(['read', 'write', 'edit', 'exec']),
};

const reviewer: PersonaSpec = {
  id: 'reviewer',
  body: 'reviewer prompt',
  capabilities: new Set(['read', 'exec']),
};

function ctxFor(featureId: string): AgentContext {
  return {
    featureId,
    featureShard: `id: ${featureId}\nstatus: in_progress\n`,
    guardrails: [],
    cwd: tmp,
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cladding-agent-'));
});

afterEach(() => {
  rmSync(tmp, {recursive: true, force: true});
});

describe('runAgent', () => {
  test('dispatches via the auto-detected host adapter and records evidence', async () => {
    const out = await runAgent(developer, ctxFor('F-001'));
    expect(['claude-code', 'generic-mcp']).toContain(out.adapter);
    expect(out.result.identity.author).toBe('llm');
    expect(out.evidence.featureId).toBe('F-001');
    // Audit log was written
    const auditPath = join(tmp, '.cladding', 'audit.log.jsonl');
    expect(existsSync(auditPath)).toBe(true);
    const raw = readFileSync(auditPath, 'utf8').trim();
    expect(raw.length).toBeGreaterThan(0);
  });

  test('rejects reviewer evidence when reviewer identity equals implementer (F-049 AC-086)', async () => {
    // The mock adapter assigns identity name `claude-code:reviewer`
    // or `generic-mcp:reviewer`. We force a collision by passing the
    // same string as the implementer.
    const probe = await runAgent(reviewer, ctxFor('F-002'));
    const reviewerIdentity = probe.result.identity.name!;

    await expect(
      runAgent(reviewer, ctxFor('F-003'), {implementerIdentityName: reviewerIdentity}),
    ).rejects.toBeInstanceOf(ReviewerIdentityCollisionError);
  });

  test('reviewer hand-off passes when implementer identity differs', async () => {
    const out = await runAgent(reviewer, ctxFor('F-004'), {
      implementerIdentityName: 'some-other-identity',
    });
    expect(out.result.identity.author).toBe('llm');
    expect(out.evidence.featureId).toBe('F-004');
  });
});
