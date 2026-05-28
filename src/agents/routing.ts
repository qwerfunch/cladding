// Cladding · agents · routing resolver (0.4.10, PR-A)
//
// Pure-data persona resolver. Reads agents/routing.yaml and matches
// feature scope + intent against the rule list. Used by
// src/work/transaction.ts:enterWork when no explicit personaId is
// supplied — host AI doesn't have to know which persona to call.
//
// Override priority:
//   1. Explicit enterWork({personaId}) — bypasses this resolver.
//   2. First-match rule from routing.yaml.
//   3. spec.yaml::project.ai_hints.preferred_persona (default-rule only).
//   4. Hard-coded fallback 'specialists'.
//
// Fallback is deliberate — when routing.yaml is missing or malformed
// the harness still works with the default specialists dispatch
// (preserves the 0.4.x option-1 behaviour).

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parse as parseYaml} from 'yaml';

const ROUTING_YAML_PATH = ['agents', 'routing.yaml'];
const FALLBACK_PERSONA = 'specialists';
const FALLBACK_RULE = '__fallback__';

export interface RoutingRule {
  readonly name: string;
  readonly when: {
    readonly module_prefix?: readonly string[];
    readonly intent_tokens?: readonly string[];
  };
  readonly persona: string;
  readonly parallel_group?: string;
}

interface RoutingConfig {
  readonly version: number;
  readonly rules: readonly RoutingRule[];
}

export interface ResolvePersonaInput {
  readonly featureId: string;
  readonly intent?: string;
  readonly scope: {readonly slug: string; readonly modules: readonly string[]};
  readonly cwd: string;
  /** Optional override from spec.yaml::project.ai_hints.preferred_persona. */
  readonly preferredPersona?: string;
}

export interface ResolvePersonaResult {
  readonly personaId: string;
  readonly matchedRule: string;
  readonly parallelGroup?: string;
}

/**
 * Resolves the persona for a work transaction. Pure function — same
 * input always produces same output. Failures (missing/malformed
 * yaml) collapse to fallback so the work transaction never fails on
 * routing alone.
 */
export function resolvePersona(opts: ResolvePersonaInput): ResolvePersonaResult {
  const config = loadRoutingConfig(opts.cwd);
  if (!config) {
    return defaultResult(opts);
  }

  const intentLower = (opts.intent ?? '').toLowerCase();
  for (const rule of config.rules) {
    if (ruleMatches(rule, opts.scope.modules, intentLower)) {
      // Default rule honours preferredPersona tie-breaker.
      if (isDefaultRule(rule) && opts.preferredPersona) {
        return {
          personaId: opts.preferredPersona,
          matchedRule: `${rule.name}+ai_hints`,
          parallelGroup: rule.parallel_group,
        };
      }
      return {
        personaId: rule.persona,
        matchedRule: rule.name,
        parallelGroup: rule.parallel_group,
      };
    }
  }

  return defaultResult(opts);
}

function defaultResult(opts: ResolvePersonaInput): ResolvePersonaResult {
  return {
    personaId: opts.preferredPersona ?? FALLBACK_PERSONA,
    matchedRule: FALLBACK_RULE,
  };
}

function loadRoutingConfig(cwd: string): RoutingConfig | undefined {
  const path = join(cwd, ...ROUTING_YAML_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = parseYaml(readFileSync(path, 'utf8')) as RoutingConfig | null;
    if (!parsed || !Array.isArray(parsed.rules)) return undefined;
    return parsed;
  } catch {
    return undefined; // malformed → fallback
  }
}

function ruleMatches(
  rule: RoutingRule,
  modules: readonly string[],
  intentLower: string,
): boolean {
  const when = rule.when ?? {};
  const prefixes = when.module_prefix ?? [];
  const tokens = when.intent_tokens ?? [];

  // Empty when: {} = default rule, always matches.
  if (prefixes.length === 0 && tokens.length === 0) return true;

  // AND between fields: every non-empty field must match (OR within field).
  if (prefixes.length > 0 && !matchesAnyPrefix(modules, prefixes)) return false;
  if (tokens.length > 0 && !matchesAnyToken(intentLower, tokens)) return false;
  return true;
}

function matchesAnyPrefix(modules: readonly string[], prefixes: readonly string[]): boolean {
  for (const m of modules) {
    for (const p of prefixes) {
      if (!p) continue;
      if (m === p) return true;
      const prefix = p.endsWith('/') ? p : `${p}/`;
      if (m.startsWith(prefix)) return true;
    }
  }
  return false;
}

function matchesAnyToken(intentLower: string, tokens: readonly string[]): boolean {
  if (!intentLower) return false;
  for (const t of tokens) {
    if (t && intentLower.includes(t.toLowerCase())) return true;
  }
  return false;
}

function isDefaultRule(rule: RoutingRule): boolean {
  const when = rule.when ?? {};
  return (when.module_prefix?.length ?? 0) === 0 && (when.intent_tokens?.length ?? 0) === 0;
}
