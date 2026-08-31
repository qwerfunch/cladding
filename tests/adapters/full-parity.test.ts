// Cladding · live adapter parity (F-049)
//
// The registry, rather than a roadmap list, defines the adapters this test
// exercises. Future placeholders therefore cannot accidentally become parity
// obligations until they are actually registered for selection.

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';

import {registeredAdapters, selectAdapter} from '../../src/adapters/index.js';
import {
  clearHostMcpServerForTesting,
  setHostMcpServer,
} from '../../src/adapters/host/sampling-context.js';
import type {SamplingCapableServer, Transport} from '../../src/adapters/host/transport.js';
import {
  setDefaultTransportForTesting,
} from '../../src/adapters/sdk/anthropic.js';
import type {AgentContext, AgentResult, PersonaSpec} from '../../src/adapters/types.js';
import {runAgent, type RunAgentResult} from '../../src/drive/agent.js';
import {classifyTransportError, type HaltClass} from '../../src/drive/halt.js';
import {readEvidence} from '../../src/hitl/audit.js';

const PROVIDER_API_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
] as const;
const SELECTION_KEYS = ['CLADDING_AGENT_MODE', 'CLADDING_AGENT_NAME'] as const;
const MANAGED_ENV_KEYS = [...PROVIDER_API_KEYS, ...SELECTION_KEYS] as const;

const PERSONA: PersonaSpec = {
  id: 'developer',
  body: 'Implement the selected feature.',
  capabilities: new Set(['read', 'write', 'edit', 'exec']),
};

function shapeOf(value: object): readonly string[] {
  return Object.keys(value).sort();
}

function sdkFixtureTransport(): Transport {
  return {
    id: 'sdk:fixture',
    async invoke(persona): Promise<AgentResult> {
      return {
        identity: {
          author: 'llm',
          name: `sdk:fixture:${persona.id}`,
          timestamp: new Date().toISOString(),
        },
        summary: 'sdk fixture reply',
        mutations: [],
        notes: 'model=fixture stop=end_turn',
      };
    },
    async ready() {
      return {ready: true};
    },
  };
}

function samplingServer(): SamplingCapableServer {
  return {
    createMessage: vi.fn().mockResolvedValue({
      model: 'fixture',
      stopReason: 'endTurn',
      role: 'assistant',
      content: {type: 'text', text: 'host fixture reply'},
    }),
  };
}

async function recordProviderKeyReads<T>(operation: () => Promise<T>): Promise<{
  readonly result: T;
  readonly reads: readonly string[];
}> {
  const originalEnv = process.env;
  const reads: string[] = [];
  process.env = new Proxy(originalEnv, {
    get(target, property, receiver) {
      if (
        typeof property === 'string' &&
        PROVIDER_API_KEYS.includes(property as (typeof PROVIDER_API_KEYS)[number])
      ) {
        reads.push(property);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  try {
    return {result: await operation(), reads};
  } finally {
    process.env = originalEnv;
  }
}

let dir: string;
let savedEnv: Partial<Record<(typeof MANAGED_ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-full-parity-'));
  savedEnv = {};
  for (const key of MANAGED_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  setHostMcpServer(samplingServer());
  setDefaultTransportForTesting(sdkFixtureTransport());
});

afterEach(() => {
  clearHostMcpServerForTesting();
  setDefaultTransportForTesting(null);
  rmSync(dir, {recursive: true, force: true});
  for (const key of MANAGED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test(
  '[covers:F-049/AC-090] every live registered adapter preserves halt, AgentResult, and audit evidence contracts',
  async () => {
    const liveAdapters = registeredAdapters();
    const ctx: AgentContext = {
      featureId: 'F-049',
      featureShard: 'id: F-049\ntitle: adapter parity\n',
      guardrails: [],
      cwd: dir,
    };
    const outputs: RunAgentResult[] = [];
    let firstAdapterTransportClasses: readonly HaltClass[] | undefined;

    for (const adapter of liveAdapters) {
      process.env.CLADDING_AGENT_MODE = adapter.mode;
      process.env.CLADDING_AGENT_NAME = adapter.name;
      expect(selectAdapter(dir)).toBe(adapter);
      outputs.push(await runAgent(PERSONA, ctx));
      const currentTransportClasses = [
        new Error('401: invalid x-api-key'),
        new Error('429: rate limit exceeded'),
        Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'}),
        new Error('unclassified transport failure'),
      ].map((error) => classifyTransportError(error));
      if (firstAdapterTransportClasses === undefined) {
        firstAdapterTransportClasses = currentTransportClasses;
      } else {
        expect(currentTransportClasses).toEqual(firstAdapterTransportClasses);
      }
    }

    expect(outputs).toHaveLength(liveAdapters.length);
    const resultShape = shapeOf(outputs[0]!.result);
    const evidenceShape = shapeOf(outputs[0]!.evidence);
    for (const output of outputs) {
      expect(shapeOf(output.result)).toEqual(resultShape);
      expect(output.result.identity.author).toBe('llm');
      expect(Array.isArray(output.result.mutations)).toBe(true);
      expect(shapeOf(output.evidence)).toEqual(evidenceShape);
      expect(output.evidence.featureId).toBe('F-049');
      expect(output.evidence.content).toBe(output.result.summary);
    }
    expect(readEvidence(dir)).toEqual(outputs.map((output) => output.evidence));
  },
);

test(
  '[covers:F-049/AC-091] live hosts avoid provider keys and every live SDK reads only its declared key',
  async () => {
    const liveAdapters = registeredAdapters();
    const ctx: AgentContext = {
      featureId: 'F-049',
      featureShard: 'id: F-049\ntitle: provider-key isolation\n',
      guardrails: [],
      cwd: dir,
    };
    for (const key of PROVIDER_API_KEYS) process.env[key] = `${key}-sentinel`;

    for (const adapter of liveAdapters.filter((candidate) => candidate.mode === 'host')) {
      process.env.CLADDING_AGENT_MODE = 'host';
      process.env.CLADDING_AGENT_NAME = adapter.name;
      const {reads} = await recordProviderKeyReads(async () => {
        const selected = selectAdapter(dir);
        expect(selected).toBe(adapter);
        await selected.healthCheck();
        await selected.invokeAgent(PERSONA, ctx);
      });
      expect(adapter.apiKeyEnv).toBeUndefined();
      expect(reads).toEqual([]);
    }

    for (const adapter of liveAdapters.filter((candidate) => candidate.mode === 'sdk')) {
      expect(adapter.apiKeyEnv).toBeDefined();
      process.env.CLADDING_AGENT_MODE = 'sdk';
      process.env.CLADDING_AGENT_NAME = adapter.name;
      // Restore the real credential lookup so this assertion observes the SDK
      // adapter's declared key rather than the fixture used by parity above.
      setDefaultTransportForTesting(null);
      const {result, reads} = await recordProviderKeyReads(async () => {
        const selected = selectAdapter(dir);
        expect(selected).toBe(adapter);
        return selected.healthCheck();
      });
      expect(result).toMatchObject({ready: true});
      expect(reads).toEqual([adapter.apiKeyEnv]);
    }
  },
);
