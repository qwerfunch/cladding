// Cladding · changelog · deterministic renderers (F-904495a5)
//
// Three render surfaces over the ChangelogManifest / Spec, split by audience
// per the Soft Shell policy (ironclad-design 03-ux §1.2):
//
//   renderChangelogMarkdown — PROSE surface. Capability-grouped English
//     markdown built only from feature titles + AC sentences; internal
//     F-/AC- ids never appear. This is the deterministic no-LLM fallback —
//     the changelog skill renders richer EN+KO notes from the same manifest.
//
//   renderAuditTable — AUDIT surface. Ids KEPT (forensic replay needs them);
//     every verification ref is marked resolved ✓ / unresolved ✗ on disk,
//     and `derived:` / `self-dogfood:` / `fixture:` / `script:` refs are
//     labeled by kind instead of resolved — a suggestion or an alias must
//     never masquerade as on-disk evidence.
//
//   renderCatalog — the full capability → feature → AC-sentence listing of
//     the living spec (the comprehension artifact a non-coder can read).
//
// All renderers return markdown WITHOUT a trailing newline; callers append.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {AcceptanceCriterion, Feature, Spec} from '../spec/types.js';
import type {ChangelogManifest, FeatureChangeKind} from './collect.js';
import {acSentence} from './collect.js';

/** User-facing phrasing per change kind (no internal enum leakage in prose). */
const CHANGE_PHRASE: Readonly<Record<FeatureChangeKind, string>> = {
  'added-as-done': 'new',
  'flipped-to-done': 'completed',
  'modified-while-done': 'updated',
  archived: 'retired',
};

/**
 * Renders the manifest as capability-grouped English markdown.
 * Prose comes ONLY from feature titles and AC sentences (Soft Shell — ids
 * omitted). Never blank: a zero-change manifest renders an explicit
 * "no shipped changes since <ref>" line.
 */
export function renderChangelogMarkdown(manifest: ChangelogManifest): string {
  const featureCount = manifest.groups.reduce((n, g) => n + g.features.length, 0);
  if (featureCount === 0 && manifest.unsharded_commits.length === 0) {
    return `no shipped changes since ${manifest.since}`;
  }
  const lines: string[] = [`# Changes since ${manifest.since}`, ''];
  for (const group of manifest.groups) {
    lines.push(`## ${group.title}`, '');
    for (const feature of group.features) {
      lines.push(`- **${feature.title}** (${CHANGE_PHRASE[feature.change]})`);
      for (const sentence of feature.acceptance) {
        lines.push(`  - ${sentence}`);
      }
    }
    lines.push('');
  }
  if (manifest.unsharded_commits.length > 0) {
    // The honest under-reporting closure: shipped work the spec never tracked.
    lines.push('## Other changes (not yet spec-tracked)', '');
    for (const commit of manifest.unsharded_commits) {
      lines.push(`- ${commit.subject}`);
    }
    lines.push('');
  }
  const inv = manifest.inventory;
  if (inv.before.features !== inv.after.features || inv.before.scenarios !== inv.after.scenarios) {
    lines.push(
      `_Spec inventory: ${inv.before.features} → ${inv.after.features} features, ` +
        `${inv.before.scenarios} → ${inv.after.scenarios} scenarios._`,
      '',
    );
  }
  while (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** Non-path ref prefixes: labeled by kind instead of resolved on disk. */
const LABELED_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['derived:', 'machine-suggested — not author-confirmed'],
  ['self-dogfood:', 'verified by cladding running on itself'],
  ['fixture:', 'conformance fixture'],
  ['script:', 'npm script'],
];

/**
 * Renders the id-keeping audit table: `feature | AC | EARS | verification refs`.
 * Each bare-path ref is marked ✓ (exists under `cwd`) or ✗ (missing — visible
 * spec-annotation drift); prefixed refs are labeled by kind, never resolved.
 */
export function renderAuditTable(manifest: ChangelogManifest, spec: Spec, cwd: string): string {
  const lines: string[] = [
    `# Audit — shipped changes since ${manifest.since}`,
    '',
    '| feature | AC | EARS | verification refs |',
    '|---|---|---|---|',
  ];
  const byId = new Map(spec.features.map((f) => [f.id, f]));
  for (const group of manifest.groups) {
    for (const entry of group.features) {
      const feature = byId.get(entry.id);
      if (!feature) {
        // Archived-and-removed shard — the manifest knows it, the live spec no
        // longer does. Keep the row honest instead of dropping it.
        lines.push(`| ${entry.id} | — | — | (removed from spec — see git history at ${manifest.since}) |`);
        continue;
      }
      const acs = feature.acceptance_criteria ?? [];
      if (acs.length === 0) {
        lines.push(`| ${feature.id} | — | — | (no acceptance criteria) |`);
        continue;
      }
      for (const ac of acs) {
        lines.push(`| ${feature.id} | ${ac.id} | ${ac.ears ?? '—'} | ${renderRefs(ac, cwd)} |`);
      }
    }
  }
  return lines.join('\n');
}

function renderRefs(ac: AcceptanceCriterion, cwd: string): string {
  const refs = [...(ac.test_refs ?? []), ...(ac.oracle_refs ?? []), ...(ac.evidence_refs ?? [])];
  if (refs.length === 0) return '(none)';
  return refs
    .map((ref) => {
      for (const [prefix, label] of LABELED_PREFIXES) {
        if (ref.startsWith(prefix)) return `${ref} (${label})`;
      }
      // `path#anchor` refs point at a test WITHIN a file — resolve the path part.
      const pathPart = ref.split('#', 1)[0] ?? ref;
      return `${existsSync(join(cwd, pathPart)) ? '✓' : '✗'} ${ref}`;
    })
    .join('<br>');
}

/**
 * Renders the full living spec as a capability → feature → AC-sentence
 * catalog — the comprehension artifact for non-coders/auditors. Prose
 * surface: internal ids omitted; archived features excluded.
 */
export function renderCatalog(spec: Spec): string {
  const lines: string[] = [`# ${spec.project.name} — capability catalog`, ''];
  const capabilities = [...(spec.capabilities ?? [])]
    .filter((c) => typeof c.id === 'string' && c.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(spec.features.map((f) => [f.id, f]));
  const claimed = new Set<string>();
  for (const cap of capabilities) {
    lines.push(`## ${cap.title ?? cap.id}`, '');
    if (cap.summary) lines.push(cap.summary, '');
    for (const fid of cap.features ?? []) {
      const feature = byId.get(fid);
      if (!feature || feature.status === 'archived') continue;
      claimed.add(fid);
      pushCatalogFeature(lines, feature);
    }
  }
  const rest = spec.features
    .filter((f) => !claimed.has(f.id) && f.status !== 'archived')
    .sort((a, b) => a.id.localeCompare(b.id));
  if (rest.length > 0) {
    lines.push('## Uncategorized', '');
    for (const feature of rest) pushCatalogFeature(lines, feature);
  }
  while (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function pushCatalogFeature(lines: string[], feature: Feature): void {
  lines.push(`### ${feature.title}`, '');
  for (const ac of feature.acceptance_criteria ?? []) {
    const sentence = acSentence(ac);
    if (sentence) lines.push(`- ${sentence}`);
  }
  lines.push('');
}
