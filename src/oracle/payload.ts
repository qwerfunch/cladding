// Cladding · oracle · blind authoring payload (Phase 2, host-protocol, LLM-free)
//
// `clad oracle <feature>` prints THIS brief — the ONLY thing a blind oracle
// author may see. It is built deterministically from the SPEC (acceptance
// criteria + module PATHS + best-effort decl-only export signatures), and
// NEVER contains an implementation body. cladding does not call an LLM; the
// host spawns a fresh sub-agent given only this brief and has it write the
// oracle, then records provenance via `clad_author_oracle`. The `readManifest`
// here is exactly what cladding offered the author — module paths + the spec,
// never bodies — so SPEC_CONFORMANCE's manifest∩modules check has a trustworthy
// record of what was on offer. (cladding cannot prove the host's sub-agent saw
// ONLY this; that is host discipline — see anti-self-cert.)

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../spec/types.js';

export interface OraclePayload {
  readonly featureId: string;
  readonly featureTitle: string;
  readonly acs: readonly {
    readonly id: string;
    readonly ears?: string;
    readonly condition?: string;
    readonly action?: string;
    readonly response?: string;
    readonly text?: string;
  }[];
  readonly modules: readonly string[];
  /** Decl-only export lines (best-effort, body-stripped) — never a body. */
  readonly signatures: readonly string[];
  /** Exactly what the author was offered: module PATHS + the spec, never bodies. */
  readonly readManifest: readonly string[];
}

/** Decl-only export lines for a module file — truncated at the body opener so no
 *  implementation logic can leak. Best-effort (line-based); the AC is the
 *  load-bearing blind input, signatures are an extra. */
function exportDecls(cwd: string, modulePath: string): string[] {
  const abs = join(cwd, modulePath);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const raw of readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const t = raw.trim();
    if (!/^export\s+(?:async\s+)?(?:abstract\s+)?(?:function|const|let|class|interface|type|enum)\b/.test(t)) continue;
    // Cut at the first body brace `{` or value assignment `=` — keep only the
    // declaration. (`=>`/arrow bodies are also cut by the `=`.)
    const decl = t.replace(/\s*[{=].*$/s, '').trim();
    if (decl) out.push(decl);
  }
  return out;
}

/** Builds the deterministic, impl-blind payload for a feature (or one AC). */
export function buildBlindPayload(spec: Spec, featureId: string, acId: string | undefined, cwd: string): OraclePayload | null {
  const feature = spec.features.find((f) => f.id === featureId);
  if (!feature) return null;
  const acs = (feature.acceptance_criteria ?? []).filter((ac) => !acId || ac.id === acId);
  const modules = feature.modules ?? [];
  const signatures = modules.flatMap((m) => exportDecls(cwd, m).map((s) => `${m}: ${s}`));
  return {
    featureId,
    featureTitle: feature.title,
    acs: acs.map((ac) => ({id: ac.id, ears: ac.ears, condition: ac.condition, action: ac.action, response: ac.response, text: ac.text})),
    modules,
    signatures,
    readManifest: [...modules.map((m) => `signatures-of:${m}`), 'spec:acceptance_criteria'],
  };
}

/** Renders the brief a blind sub-agent may see. Contains the conservative
 *  under-assertion guidance that mitigates the v7 over-strict (spurious) mode. */
export function renderBlindBrief(p: OraclePayload): string {
  const lines: string[] = [];
  lines.push(`# Spec-conformance oracle brief — ${p.featureId}: ${p.featureTitle}`);
  lines.push('#');
  lines.push('# Author a conformance TEST SUITE from THIS SPECIFICATION ONLY. You have NOT been');
  lines.push('# shown the implementation and MUST NOT read it. Assert ONLY what the acceptance');
  lines.push('# criteria literally require; when the spec is silent on an edge, write a WEAKER');
  lines.push('# assertion, not a stronger guess (an over-strict oracle falsely fails correct code).');
  lines.push('');
  lines.push('## Acceptance criteria (the spec)');
  for (const ac of p.acs) {
    lines.push(`- ${ac.id}${ac.ears ? ` [${ac.ears}]` : ''}: ${ac.text ?? ''}`.trimEnd());
    if (ac.condition) lines.push(`    when:           ${ac.condition}`);
    if (ac.action) lines.push(`    system shall:   ${ac.action}`);
    if (ac.response) lines.push(`    so that:        ${ac.response}`);
  }
  lines.push('');
  lines.push('## Public surface to call (signatures only — NO implementation shown)');
  if (p.signatures.length === 0) lines.push('  (no export signatures extracted — call the API exactly as the criteria describe)');
  for (const s of p.signatures) lines.push(`  ${s}`);
  lines.push('');
  lines.push(`## Write the suite under tests/oracle/ (the dir stage_2.3 runs), then record it with`);
  lines.push(`## the clad_author_oracle MCP tool so its impl-blind provenance is gate-verified.`);
  return lines.join('\n');
}
