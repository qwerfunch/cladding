// Cladding · integration test — drive loop end-to-end against the
// real AnthropicTransport (v0.2.21, F-070).
//
// What this test proves vs the existing tests:
//   - tests/drive/loop.test.ts uses vi.mock to stub `runAgent`. It
//     verifies the loop's control flow, but never exercises the
//     actual adapter-selector → transport → invoke chain.
//   - tests/adapters/anthropic.test.ts unit-tests AnthropicTransport
//     in isolation. The drive loop is not involved.
//   - This file wires the two together: a stubbed @anthropic-ai/sdk
//     client is injected into AnthropicTransport, the SDK adapter is
//     installed as the global default via setDefaultTransportForTesting,
//     the env routes the selector to mode=sdk + name=claude-anthropic,
//     and runDriveLoop is called for real. The data shape that flows
//     through the loop is the SDK reply shape, not the mock placeholder.
//
// v0.2.21 substep validation: the drive loop's halt-class chain
// (ALL_FEATURES_DONE · HUMAN_REQUIRED via reviewer barrier · UAT
// gating) works against real-shape transport data.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {runDriveLoop} from '../../src/drive/loop.js';
import {
  AnthropicTransport,
  setDefaultTransportForTesting,
} from '../../src/adapters/sdk/anthropic.js';

type FakeClient = {messages: {create: ReturnType<typeof vi.fn>}};

function makeFakeClient(replyTextSequence: string[]): {
  client: FakeClient;
  factory: (apiKey: string) => unknown;
} {
  const create = vi.fn();
  for (const text of replyTextSequence) {
    create.mockResolvedValueOnce({
      content: [{type: 'text', text}],
      stop_reason: 'end_turn',
    });
  }
  // Any subsequent calls beyond the queued sequence resolve a default
  create.mockResolvedValue({
    content: [{type: 'text', text: 'continuation'}],
    stop_reason: 'end_turn',
  });
  const client: FakeClient = {messages: {create}};
  return {client, factory: () => client};
}

const ENV_KEYS = ['CLADDING_AGENT_MODE', 'CLADDING_AGENT_NAME', 'ANTHROPIC_API_KEY'] as const;

describe('drive loop · real AnthropicTransport integration', () => {
  let dir: string;
  let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-loop-real-'));
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
    }
    process.env.CLADDING_AGENT_MODE = 'sdk';
    process.env.CLADDING_AGENT_NAME = 'claude-anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-integration-test';
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    setDefaultTransportForTesting(null);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function setupTransport(replyTextSequence: string[]): FakeClient {
    const {client, factory} = makeFakeClient(replyTextSequence);
    const transport = new AnthropicTransport({
      apiKey: 'sk-integration-test',
      clientFactory: factory as never,
    });
    setDefaultTransportForTesting(transport);
    return client;
  }

  function writeMinimalProject(featureModule: string): void {
    // Schema.json so loadSpec validates
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\n' +
        'project: {name: x, language: typescript}\n' +
        'features:\n' +
        '  - id: F-001\n' +
        '    title: real-transport integration\n' +
        '    status: planned\n' +
        `    modules: [${featureModule}]\n` +
        '    acceptance_criteria:\n' +
        '      - id: AC-001\n' +
        '        ears: ubiquitous\n' +
        '        text: integration target\n',
    );
    // Persona files for developer + reviewer — minimal frontmatter
    const agentsDir = join(dir, 'agents');
    writeFileSync(
      `${agentsDir}-developer.md`,
      '', // not used since loader looks in <here>/<id>.md by default
    );
    // We rely on cladding's bundled agents at the repo's own agents/ — drive's
    // loadPersona reads from the package's own dir, not cwd. No setup needed.
  }

  test('[covers:F-069/AC-187][covers:F-070/AC-193] loop dispatches through AnthropicTransport and lands ALL_FEATURES_DONE when UAT is skipped', async () => {
    // Specialist returns one reply text; reviewer returns a different
    // text so the identity-collision barrier does not fire.
    const client = setupTransport([
      'specialist authored stage-1 stub for F-001',
      'reviewer signs off on the stub',
    ]);
    writeMinimalProject('stages/stub-001.ts');
    const r = await runDriveLoop({
      cwd: dir,
      budget: {maxIterations: 5, maxWallClockMs: 30_000, maxRetriesPerFeature: 2},
    });
    // The loop should reach ALL_FEATURES_DONE because:
    //   - specialist invocation succeeds (real transport)
    //   - stub fallback created the module
    //   - L1 gates pass on the stub (empty TS file, no lint errors)
    //   - reviewer dispatched without identity collision
    //   - UAT: no audit log set up → exitCode=2 (skip), loop tolerates
    expect(r.halt.class).toBe('ALL_FEATURES_DONE');
    expect(r.featuresTouched).toContain('F-001');
    expect(client.messages.create).toHaveBeenCalled();
    // At least two SDK calls: specialist + reviewer
    expect(client.messages.create.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('[covers:F-070/AC-194] reviewer identity collision triggers HUMAN_REQUIRED halt against real-shape data', async () => {
    // Both calls return text from the same fake client → the
    // resulting identity.name is the same persona-tagged form.
    // BUT AnthropicTransport tags identity.name as
    // `sdk:claude-anthropic:<personaId>`. developer and reviewer
    // have different persona ids, so the names differ — no collision.
    //
    // To FORCE a collision, we monkey-patch the transport so it
    // returns identity.name=`sdk:claude-anthropic:developer` for
    // BOTH calls. Easiest way: clientFactory returns the same client,
    // but we override invoke at the Transport layer for this test.
    //
    // Cleaner: just verify the barrier works on real-shape data by
    // crafting a Transport whose invoke returns a fixed identity name.
    const fixedIdentityTransport = {
      id: 'sdk:claude-anthropic',
      async invoke(persona: {id: string}) {
        return {
          identity: {
            author: 'llm' as const,
            name: 'sdk:claude-anthropic:developer', // SAME for both personas
            timestamp: new Date().toISOString(),
          },
          summary: `[forced] ${persona.id}`,
          mutations: [],
        };
      },
      async ready() {
        return {ready: true};
      },
    };
    setDefaultTransportForTesting(fixedIdentityTransport);
    writeMinimalProject('stages/stub-001.ts');
    const r = await runDriveLoop({
      cwd: dir,
      budget: {maxIterations: 5, maxWallClockMs: 30_000, maxRetriesPerFeature: 2},
    });
    expect(r.halt.class).toBe('HUMAN_REQUIRED');
    expect(r.halt.detail).toContain('reviewer identity matched implementer');
  });

  test('[covers:F-070/AC-192] transport throw (401 auth) maps to TRANSPORT_AUTH_FAILED halt (v0.2.22)', async () => {
    const throwingTransport = {
      id: 'sdk:claude-anthropic',
      async invoke() {
        throw new Error('401: invalid x-api-key');
      },
      async ready() {
        return {ready: true};
      },
    };
    setDefaultTransportForTesting(throwingTransport);
    writeMinimalProject('stages/stub-001.ts');
    const r = await runDriveLoop({
      cwd: dir,
      budget: {maxIterations: 5, maxWallClockMs: 30_000, maxRetriesPerFeature: 2},
    });
    expect(r.halt.class).toBe('TRANSPORT_AUTH_FAILED');
    expect(r.halt.detail).toMatch(/specialist dispatch failed/);
    expect(r.halt.detail).toContain('401');
  });

  test('transport throw (429 rate limit) maps to TRANSPORT_RATE_LIMITED halt (v0.2.22)', async () => {
    const throwingTransport = {
      id: 'sdk:claude-anthropic',
      async invoke() {
        throw new Error('429: rate limit exceeded');
      },
      async ready() {
        return {ready: true};
      },
    };
    setDefaultTransportForTesting(throwingTransport);
    writeMinimalProject('stages/stub-001.ts');
    const r = await runDriveLoop({
      cwd: dir,
      budget: {maxIterations: 5, maxWallClockMs: 30_000, maxRetriesPerFeature: 2},
    });
    expect(r.halt.class).toBe('TRANSPORT_RATE_LIMITED');
    expect(r.halt.detail).toContain('429');
  });

  test('transport throw (ECONNREFUSED network) maps to TRANSPORT_NETWORK halt (v0.2.22)', async () => {
    const throwingTransport = {
      id: 'sdk:claude-anthropic',
      async invoke() {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:443') as NodeJS.ErrnoException;
        err.code = 'ECONNREFUSED';
        throw err;
      },
      async ready() {
        return {ready: true};
      },
    };
    setDefaultTransportForTesting(throwingTransport);
    writeMinimalProject('stages/stub-001.ts');
    const r = await runDriveLoop({
      cwd: dir,
      budget: {maxIterations: 5, maxWallClockMs: 30_000, maxRetriesPerFeature: 2},
    });
    expect(r.halt.class).toBe('TRANSPORT_NETWORK');
    expect(r.halt.detail).toContain('ECONNREFUSED');
  });

  test('transport throw with no known pattern maps to LLM_UNAVAILABLE catch-all (v0.2.22)', async () => {
    const throwingTransport = {
      id: 'sdk:claude-anthropic',
      async invoke() {
        throw new Error('something unusual happened');
      },
      async ready() {
        return {ready: true};
      },
    };
    setDefaultTransportForTesting(throwingTransport);
    writeMinimalProject('stages/stub-001.ts');
    const r = await runDriveLoop({
      cwd: dir,
      budget: {maxIterations: 5, maxWallClockMs: 30_000, maxRetriesPerFeature: 2},
    });
    expect(r.halt.class).toBe('LLM_UNAVAILABLE');
  });
});
