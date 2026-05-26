// Cladding · drift detector · ENRICHMENT_PENDING
//
// Detector #28 (axis: lazy-enrichment, severity: warn). v0.3.60 / F-90d054.
//
// Problem this solves: `clad init` writes a deterministic floor plus an
// enrichment marker (`spec.yaml._meta.enrichment_status: "pending"`) and
// expects the user's host AI (Claude Code / Codex / Gemini CLI / Cursor / …)
// to finish populating the scope on its first task in the project. If the
// user runs `clad check` *before* that first AI session — or if the AI
// ignored the AGENTS.md instruction — the pending marker silently lingers
// and the spec stays under-populated.
//
// This detector surfaces the pending state as a `warn` finding so:
//   • `clad check --strict` (which promotes warn → error) blocks CI until
//     the marker is cleared, while
//   • everyday `clad check` runs only flag it and never block local work.
//
// Severity is intentionally `warn`, not `error` — a pending marker is the
// *intended* state of a freshly-initialised project; it is only an issue
// when the project is treated as merge-ready while the enrichment was
// never finished. The promotion to error happens through the existing
// `--strict` flag without changing this detector's default.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'ENRICHMENT_PENDING';

function runEnrichmentPending(opts: CommandStageOptions): readonly DriftFinding[] {
  const cwd = opts.cwd ?? '.';
  const specPath = join(cwd, 'spec.yaml');
  if (!existsSync(specPath)) return [];

  let body: string;
  try {
    body = readFileSync(specPath, 'utf8');
  } catch {
    return [];
  }

  const lines = body.split('\n');
  const metaStart = lines.findIndex((l) => /^_meta:\s*$/.test(l));
  if (metaStart === -1) return [];

  // Scan inside the _meta block for `enrichment_status:`. Stop at the next
  // top-level key (column-0 `xxx:` line) so we never read past the block.
  for (let i = metaStart + 1; i < lines.length; i++) {
    if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[i])) break;
    const m = lines[i].match(/^\s{2}enrichment_status:\s*(\S+)/);
    if (!m) continue;
    const status = m[1].replace(/['"]/g, '').trim();
    if (status === 'pending') {
      return [
        {
          detector: NAME,
          severity: 'warn',
          path: 'spec.yaml',
          message:
            'spec.yaml._meta.enrichment_status is "pending" — open this ' +
            'project in a host AI (Claude Code, Codex, Gemini CLI, Cursor, …) ' +
            'and follow the AGENTS.md instruction to finish enrichment ' +
            'before merging. `clad check --strict` will block while pending.',
        },
      ];
    }
    break;
  }

  return [];
}

export const enrichmentPending: DriftDetector = {
  name: NAME,
  run: runEnrichmentPending,
};
