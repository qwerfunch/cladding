// Cladding · scenarios · token-meter (v0.3.46, F-4747ef)
//
// Pure measurement helpers for the SSoT lifecycle tests. Reports line
// count, character count, and **estimated token count** for any text
// blob — file body, persona prompt, LLM dispatcher prompt, etc.
//
// Token estimation uses the `chars / 4` heuristic. This is portable
// (no extra dependency) and accurate enough for **relative comparison
// + regression detection**, which is what the lifecycle tests need.
//
// If absolute accuracy ever matters (e.g., for billing-class
// measurement), swap in `@anthropic-ai/tokenizer` — see
// `docs/ssot-testing.md` §Tokenizer migration path.

import {readFileSync} from 'node:fs';

/** Result of a single size measurement. */
export interface SizeMeasurement {
  /** Number of newline-separated lines. Trailing empty line counted. */
  readonly lines: number;
  /** Number of UTF-16 code units in the text. */
  readonly chars: number;
  /**
   * Estimated token count (`chars / 4`). Suitable for trend tracking
   * and budget assertions; do not treat as exact.
   */
  readonly estTokens: number;
}

const CHARS_PER_TOKEN = 4;

/** Measures a text blob without touching the filesystem. */
export function measureText(text: string): SizeMeasurement {
  const chars = text.length;
  // `split('\n').length` gives one extra entry per trailing newline; that
  // matches `wc -l + 1` for files ending in newline, which is the human
  // intuition the budgets target.
  const lines = text.length === 0 ? 0 : text.split('\n').length;
  const estTokens = Math.round(chars / CHARS_PER_TOKEN);
  return {lines, chars, estTokens};
}

/** Reads a file and measures it. Returns zeroes when the file is missing. */
export function measureFile(absPath: string): SizeMeasurement {
  try {
    return measureText(readFileSync(absPath, 'utf8'));
  } catch {
    return {lines: 0, chars: 0, estTokens: 0};
  }
}

/**
 * Convenience wrapper for persona prompts; identical to `measureText`
 * but named so call sites read clearly in the digest output.
 */
export function measurePersonaPrompt(prompt: string): SizeMeasurement {
  return measureText(prompt);
}

/**
 * Convenience wrapper for LLM dispatcher prompts (onboarding,
 * refinement). Useful when the prompt is built in-memory and passed
 * straight to the mock dispatcher.
 */
export function measureLLMPrompt(prompt: string): SizeMeasurement {
  return measureText(prompt);
}

/** Sums two measurements field-by-field for "load all" digests. */
export function sumMeasurements(a: SizeMeasurement, b: SizeMeasurement): SizeMeasurement {
  return {
    lines: a.lines + b.lines,
    chars: a.chars + b.chars,
    estTokens: a.estTokens + b.estTokens,
  };
}

/** Returns the larger measurement field-by-field (peak tracking). */
export function maxMeasurements(a: SizeMeasurement, b: SizeMeasurement): SizeMeasurement {
  return {
    lines: Math.max(a.lines, b.lines),
    chars: Math.max(a.chars, b.chars),
    estTokens: Math.max(a.estTokens, b.estTokens),
  };
}

/** Format a measurement for the digest output. */
export function formatMeasurement(m: SizeMeasurement): string {
  return `${m.lines} lines · ${m.chars} chars · ~${m.estTokens} tokens`;
}
