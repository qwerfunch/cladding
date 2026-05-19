// Cladding · SDK adapter · Anthropic Claude
//
// v0.2.20 (F-069) — first real-LLM transport. Talks directly to the
// Anthropic API using an ANTHROPIC_API_KEY supplied via env var. Opt-in
// only — selected when `agent.mode === 'sdk'` and the API key is
// present. Default cladding stays on host-bound MockTransport.
//
// Architectural placement: this is one Transport implementation
// among (eventually) several SDK transports — `claude-anthropic`
// here, `openai` and `google-gemini` slots reserved for later. Host
// adapters (mock for now) stay in `src/adapters/host/`; SDK
// adapters live in `src/adapters/sdk/`.
//
// Why dynamic import: the `@anthropic-ai/sdk` package is sizeable
// (multi-MB), and most cladding installs never hit sdk mode. Loading
// it on-demand keeps the default bundle path light. The first
// successful `invoke` warms the cache.
//
// @see src/adapters/host/transport.ts — the Transport interface.
// @see src/adapters/types.ts — the AgentAdapter contract.
// @see docs/multi-provider-roadmap.md — adapter matrix.
// @see spec/features/F-049.yaml — original two-mode adapter contract.
// @see spec/features/F-069.yaml — this real-LLM transport.

import process from 'node:process';

import type {Transport} from '../host/transport.js';
import type {
  AgentAdapter,
  AgentContext,
  AgentResult,
  Capability,
  HealthStatus,
  PersonaSpec,
} from '../types.js';

const CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'read',
  'write',
  'edit',
  'exec',
  'dispatch',
]);

/** Minimal SDK surface we depend on. Kept narrow so mocking is easy. */
interface AnthropicLike {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ReadonlyArray<{role: 'user' | 'assistant'; content: string}>;
    }): Promise<{
      content: ReadonlyArray<{type: string; text?: string}>;
      stop_reason?: string | null;
    }>;
  };
}

/** Factory for the SDK client. Overridable for tests. */
export interface AnthropicTransportOptions {
  /** Override for the API key (defaults to process.env.ANTHROPIC_API_KEY). */
  readonly apiKey?: string;
  /** Model id (defaults to `claude-opus-4-7`, the current strongest model). */
  readonly model?: string;
  /** Maximum output tokens per dispatch (defaults to 4096). */
  readonly maxTokens?: number;
  /** Test seam — supply a pre-built client to skip the dynamic import. */
  readonly clientFactory?: (apiKey: string) => AnthropicLike;
}

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Real-LLM Transport. Dispatches through the Anthropic API and
 * returns an AgentResult whose summary is the model's reply.
 *
 * Mutations are NOT inferred from the reply in v0.2.20 — the model
 * returns prose; structured mutations land in v0.2.21+ once a
 * tool-use protocol is wired up. v0.2.20's contribution is proving
 * the dispatch path end-to-end on a real LLM call.
 */
export class AnthropicTransport implements Transport {
  readonly id = 'sdk:claude-anthropic';
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly clientFactory: (apiKey: string) => AnthropicLike;
  private cachedClient: AnthropicLike | null = null;

  constructor(opts: AnthropicTransportOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.clientFactory =
      opts.clientFactory ??
      ((key: string) => {
        // Dynamic import keeps the default bundle path light. The
        // require shim in the esbuild banner lets this work in the
        // bundled ESM context too.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {Anthropic} = require('@anthropic-ai/sdk') as {
          Anthropic: new (cfg: {apiKey: string}) => AnthropicLike;
        };
        return new Anthropic({apiKey: key});
      });
  }

  async invoke(persona: PersonaSpec, ctx: AgentContext): Promise<AgentResult> {
    if (!this.apiKey) {
      throw new Error(
        'AnthropicTransport: ANTHROPIC_API_KEY is not set — set it or switch to a host adapter',
      );
    }
    if (!this.cachedClient) this.cachedClient = this.clientFactory(this.apiKey);
    const userMessage = buildUserMessage(ctx);
    const response = await this.cachedClient.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: persona.body,
      messages: [{role: 'user', content: userMessage}],
    });
    const replyText = extractText(response.content);
    return {
      identity: {
        author: 'llm',
        name: `${this.id}:${persona.id}`,
        timestamp: new Date().toISOString(),
      },
      summary: replyText.slice(0, 200),
      mutations: [],
      notes: `model=${this.model} stop=${response.stop_reason ?? 'unknown'}`,
    };
  }

  ready(): Promise<HealthStatus> {
    if (!this.apiKey) {
      return Promise.resolve({
        ready: false,
        reason: 'ANTHROPIC_API_KEY env var is not set',
      });
    }
    return Promise.resolve({ready: true});
  }
}

function buildUserMessage(ctx: AgentContext): string {
  const guardrails =
    ctx.guardrails.length > 0
      ? `\n\nGuardrails:\n${ctx.guardrails.map((g) => `- ${g}`).join('\n')}`
      : '';
  return [
    `Feature: ${ctx.featureId}`,
    '',
    'Feature shard (JSON):',
    ctx.featureShard,
    guardrails,
  ].join('\n');
}

function extractText(content: ReadonlyArray<{type: string; text?: string}>): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
}

const defaultTransport: Transport = new AnthropicTransport();

export const claudeAnthropicAdapter: AgentAdapter = {
  mode: 'sdk',
  name: 'claude-anthropic',
  capabilities: CAPABILITIES,
  invokeAgent: (persona, ctx) => defaultTransport.invoke(persona, ctx),
  healthCheck: () => defaultTransport.ready(),
};
