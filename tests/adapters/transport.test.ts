// Cladding · unit tests for src/adapters/host/transport.ts (F-068)
//
// The Transport layer is the swap-point for v0.2.20 real bodies.
// v0.2.19 ships only MockTransport, so the tests cover the mock's
// observable behaviour:
//   - invoke returns an AgentResult with identity + summary
//   - identity.name uses the host-tagged form `mock:<hostName>:<persona>`
//   - mutations is empty (mock has no fs side-effects)
//   - ready() honours the readyWhen predicate
//   - ready() returns the configured reason when not ready

import {describe, expect, test} from 'vitest';

import type {AgentContext, PersonaSpec} from '../../src/adapters/types.js';
import {MockTransport} from '../../src/adapters/host/transport.js';

const PERSONA: PersonaSpec = {id: 'reviewer', body: '', capabilities: new Set()};
const CTX: AgentContext = {featureId: 'F-001', featureShard: '{}', guardrails: [], cwd: '.'};

describe('MockTransport', () => {
  test('id reflects hostName with the mock: prefix', () => {
    const t = new MockTransport({
      hostName: 'claude-code',
      readyWhen: () => true,
      notReadyReason: 'never',
    });
    expect(t.id).toBe('mock:claude-code');
  });

  test('invoke returns AgentResult with llm identity + tagged name', async () => {
    const t = new MockTransport({
      hostName: 'claude-code',
      readyWhen: () => true,
      notReadyReason: 'never',
    });
    const r = await t.invoke(PERSONA, CTX);
    expect(r.identity.author).toBe('llm');
    expect(r.identity.name).toBe('mock:claude-code:reviewer');
    expect(r.identity.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(r.summary).toContain('persona=reviewer');
    expect(r.summary).toContain('feature=F-001');
  });

  test('invoke returns empty mutations (mock has no fs side-effects)', async () => {
    const t = new MockTransport({
      hostName: 'generic-mcp',
      readyWhen: () => true,
      notReadyReason: 'never',
    });
    const r = await t.invoke(PERSONA, CTX);
    expect(r.mutations).toEqual([]);
  });

  test('ready resolves true when the predicate is true', async () => {
    const t = new MockTransport({
      hostName: 'h',
      readyWhen: () => true,
      notReadyReason: 'never',
    });
    const r = await t.ready();
    expect(r.ready).toBe(true);
  });

  test('ready resolves false with the configured reason when predicate is false', async () => {
    const t = new MockTransport({
      hostName: 'h',
      readyWhen: () => false,
      notReadyReason: 'no host detected',
    });
    const r = await t.ready();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('no host detected');
  });

  test('predicate is evaluated each call (not cached)', async () => {
    let flag = false;
    const t = new MockTransport({
      hostName: 'h',
      readyWhen: () => flag,
      notReadyReason: 'flag off',
    });
    expect((await t.ready()).ready).toBe(false);
    flag = true;
    expect((await t.ready()).ready).toBe(true);
  });

  test('different hostName yields distinct identity.name across two transports', async () => {
    const t1 = new MockTransport({hostName: 'a', readyWhen: () => true, notReadyReason: ''});
    const t2 = new MockTransport({hostName: 'b', readyWhen: () => true, notReadyReason: ''});
    const r1 = await t1.invoke(PERSONA, CTX);
    const r2 = await t2.invoke(PERSONA, CTX);
    expect(r1.identity.name).not.toBe(r2.identity.name);
    expect(r1.identity.name).toContain('mock:a');
    expect(r2.identity.name).toContain('mock:b');
  });
});
