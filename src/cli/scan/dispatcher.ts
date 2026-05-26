// Cladding · scan · LLM dispatcher selection chain
//
// The deterministic scan output (conventions table, layer list,
// observed-text project context) is correct but reads like raw
// data. v0.3.33 layers an LLM refinement step on top: when a
// dispatcher is available, the project-context.md Why/Purpose
// sections become polished prose instead of "raw README quote +
// reviewer note".
//
// Two dispatcher sources, tried in order:
//   1. MCP sampling — when cladding is running as `clad serve`,
//      `getHostMcpServer()` returns the connected server. v0.3.34
//      will wire this; v0.3.33 leaves a stub.
//   2. Anthropic SDK direct — when ANTHROPIC_API_KEY is set, call
//      the SDK directly. Already a cladding dependency
//      (src/adapters/sdk/anthropic.ts), so no new external code.
//
// When neither is available the chain returns `null` and the
// caller falls back to the deterministic interpreter — no LLM
// dependency for offline / CI / no-key environments.

import {getHostMcpServer} from '../../adapters/host/sampling-context.js';
import type {SamplingCapableServer} from '../../adapters/host/transport.js';
import type {ScanLlmDispatcher} from './llm.js';

/** Selection input. Mostly mirrors the InitOptions LLM flag. */
export interface DispatcherOptions {
  /** Force the deterministic path even when an LLM is available. */
  readonly noLlm?: boolean;
  /** Override the default model id. */
  readonly model?: string;
  /** Override the API key (defaults to process.env.ANTHROPIC_API_KEY). */
  readonly apiKey?: string;
}

const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Returns the highest-priority dispatcher available in the current
 * environment, or `null` when LLM refinement should not run.
 *
 * @example
 *   const dispatcher = selectDispatcher({noLlm: opts.noLlm});
 *   if (dispatcher) {
 *     const text = await dispatcher(prompt);
 *     // …LLM-refined output
 *   } else {
 *     // …deterministic-only output
 *   }
 */
export function selectDispatcher(opts: DispatcherOptions = {}): ScanLlmDispatcher | null {
  if (opts.noLlm) return null;

  // Priority 1 — MCP sampling. When `clad serve` is running and a
  // sampling-capable client is connected, the registry holds the
  // underlying SDK Server; we wrap it in a flat dispatcher that
  // round-trips through `server.createMessage` to the client. This
  // lets a host like Claude Code / Cursor / Continue refine the
  // scan output without cladding holding any API credentials of its
  // own. The Anthropic-SDK path remains the v0.3.33 fallback for
  // headless / CI environments.
  const mcp = getHostMcpServer();
  if (mcp) {
    return createMcpDispatcher(mcp, opts.model);
  }

  // Priority 2 — Anthropic SDK direct. Lazy-imported so cold-start
  // stays fast for the deterministic-only majority of `clad init`
  // invocations.
  const anthropicKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return createAnthropicDispatcher({apiKey: anthropicKey, model: opts.model ?? DEFAULT_MODEL});
  }

  // Priority 3 — OpenAI direct (fetch, no SDK dependency). F-90d054 v0.3.60.
  // Activates whenever OPENAI_API_KEY is set. Uses the chat-completions
  // endpoint so prompts compose just like Anthropic / MCP-sampling above.
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return createOpenaiDispatcher({apiKey: openaiKey, model: opts.model ?? 'gpt-4o-mini'});
  }

  // Priority 4 — Google Gemini direct (fetch). F-90d054 v0.3.60.
  // Activates when GEMINI_API_KEY or GOOGLE_API_KEY is set.
  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    return createGeminiDispatcher({apiKey: geminiKey, model: opts.model ?? 'gemini-1.5-flash'});
  }

  return null;
}

/**
 * Builds a flat prompt → flat text dispatcher backed by the
 * connected MCP client's sampling API. The host (Claude Code,
 * Cursor, Continue, …) is what actually owns the model selection
 * and credentials — cladding only relays the prompt.
 *
 * Errors (transport refusal, client unavailable, malformed reply)
 * propagate to the caller so the deterministic-fallback policy
 * lives in the call site (renderProjectContextMdWithLlm), not here.
 *
 * The `model` option is *advisory* under MCP sampling — the host's
 * `createMessage` does not always honour the parameter (it routes
 * to whatever model the user has configured), but we still surface
 * it for telemetry symmetry with the Anthropic SDK path.
 */
function createMcpDispatcher(
  server: SamplingCapableServer,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _model: string | undefined,
): ScanLlmDispatcher {
  return async (prompt) => {
    const reply = await server.createMessage({
      messages: [{role: 'user', content: {type: 'text', text: prompt}}],
      maxTokens: DEFAULT_MAX_TOKENS,
    });
    const block = reply.content;
    if (block && typeof block === 'object' && block.type === 'text' && typeof (block as {text?: unknown}).text === 'string') {
      return (block as {text: string}).text;
    }
    return '';
  };
}

/**
 * Builds a flat prompt → flat text dispatcher backed by the
 * Anthropic Messages API. Errors propagate to the caller so the
 * deterministic-fallback policy lives in the call site, not here.
 */
/**
 * Builds a flat dispatcher backed by OpenAI's chat-completions API. Uses
 * `fetch` directly so no SDK dependency is required — keeps the
 * deterministic-only cold-start fast and the cladding bundle thin.
 */
function createOpenaiDispatcher(cfg: {apiKey: string; model: string}): ScanLlmDispatcher {
  return async (prompt) => {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{role: 'user', content: prompt}],
      }),
    });
    if (!r.ok) {
      throw new Error(`OpenAI dispatcher: HTTP ${r.status} ${r.statusText}`);
    }
    const data = (await r.json()) as {
      choices?: {message?: {content?: string}}[];
    };
    return data.choices?.[0]?.message?.content ?? '';
  };
}

/**
 * Builds a flat dispatcher backed by Google's Gemini Generative Language
 * API. Uses `fetch` directly (no SDK dependency).
 */
function createGeminiDispatcher(cfg: {apiKey: string; model: string}): ScanLlmDispatcher {
  return async (prompt) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        contents: [{parts: [{text: prompt}]}],
        generationConfig: {maxOutputTokens: DEFAULT_MAX_TOKENS},
      }),
    });
    if (!r.ok) {
      throw new Error(`Gemini dispatcher: HTTP ${r.status} ${r.statusText}`);
    }
    const data = (await r.json()) as {
      candidates?: {content?: {parts?: {text?: string}[]}}[];
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? '').join('');
  };
}

function createAnthropicDispatcher(cfg: {apiKey: string; model: string}): ScanLlmDispatcher {
  return async (prompt) => {
    // Dynamic import so projects that never enable the LLM path
    // never load the SDK into the bundle's hot section.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('@anthropic-ai/sdk') as {
      Anthropic: new (cfg: {apiKey: string}) => {
        messages: {
          create: (req: {
            model: string;
            max_tokens: number;
            messages: {role: 'user'; content: string}[];
          }) => Promise<{content: {type: string; text?: string}[]}>;
        };
      };
    };
    const client = new sdk.Anthropic({apiKey: cfg.apiKey});
    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [{role: 'user', content: prompt}],
    });
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    }
    return text;
  };
}
