// F-90d054 — enrichment marker builder for spec.yaml._meta.
//
// The marker is a checklist + observed context that a host AI consumes on its
// first task in a project. `clad init` writes it; host AI removes it once
// every scope item has been populated.

import type { DetectedContext } from './detect.js';

export const DEFAULT_ENRICHMENT_SCOPE: readonly string[] = [
  'project.intent',
  'project.ai_hints',
  'docs/project-context.md',
  'docs/conventions.md',
  'spec/architecture.yaml',
  'spec/capabilities.yaml',
  'features',
  'acceptance_criteria',
];

export interface EnrichmentMarker {
  readonly enrichment_status: 'pending' | 'complete';
  readonly enrichment_scope: readonly string[];
  readonly detected: DetectedContext;
  readonly enriched_by?: string;
  readonly enriched_at?: string;
}

export function buildMarker(
  detected: DetectedContext,
  scope: readonly string[] = DEFAULT_ENRICHMENT_SCOPE,
): EnrichmentMarker {
  return {
    enrichment_status: 'pending',
    enrichment_scope: scope,
    detected,
  };
}

/**
 * Renders the marker as a top-level YAML block to be inserted directly under
 * `schema:` and above `project:` in spec.yaml. Two-space indentation, no
 * surrounding empty lines.
 */
export function renderMarkerYaml(marker: EnrichmentMarker): string {
  const lines: string[] = [];
  lines.push('_meta:');
  lines.push(`  enrichment_status: ${marker.enrichment_status}`);
  lines.push('  enrichment_scope:');
  for (const item of marker.enrichment_scope) {
    lines.push(`    - ${item}`);
  }
  lines.push('  detected:');
  const d = marker.detected;
  lines.push(`    project_type: ${d.project_type}`);
  lines.push(`    source_files: ${d.source_files}`);
  lines.push(`    test_files: ${d.test_files}`);
  lines.push(`    primary_language: ${d.primary_language}`);
  lines.push(`    package_manager: ${d.package_manager}`);
  lines.push(`    has_readme: ${d.has_readme}`);
  lines.push(`    has_existing_tests: ${d.has_existing_tests}`);
  lines.push('    observed_layers:');
  if (d.observed_layers.length === 0) {
    // Inline empty array preserves YAML validity without an empty block.
    // Replace the heading line we just pushed.
    lines.pop();
    lines.push('    observed_layers: []');
  } else {
    for (const layer of d.observed_layers) {
      lines.push(`      - ${layer}`);
    }
  }
  lines.push(`    detected_at: "${d.detected_at}"`);
  if (marker.enriched_by) {
    lines.push(`  enriched_by: ${JSON.stringify(marker.enriched_by)}`);
  }
  if (marker.enriched_at) {
    lines.push(`  enriched_at: "${marker.enriched_at}"`);
  }
  return lines.join('\n');
}

/**
 * Compares two DetectedContext snapshots and returns the list of scope items
 * that should be re-activated on the second `clad init` run.
 *
 * Used by the idempotent re-run path (AC-012). Only changes that *invalidate
 * previous enrichment* re-activate scope; cosmetic shifts (detected_at) don't.
 */
/**
 * Parses the `_meta.detected` block out of an existing spec.yaml body using a
 * line-oriented scan. Intentionally avoids a full YAML parser so it stays
 * fast on the cold path and never touches code outside the block.
 *
 * Returns `null` when no `_meta:` block is present.
 */
export function readDetectedFromSpec(body: string): DetectedContext | null {
  const lines = body.split('\n');
  const metaStart = lines.findIndex((l) => /^_meta:\s*$/.test(l));
  if (metaStart === -1) return null;
  // Find detected: subsection inside _meta
  let i = metaStart + 1;
  while (i < lines.length && !/^[^\s].*:/.test(lines[i])) {
    if (/^\s{2}detected:\s*$/.test(lines[i])) break;
    i++;
  }
  if (i >= lines.length) return null;
  const detectedStart = i + 1;
  const detected: Record<string, unknown> = {};
  const layers: string[] = [];
  let layersOpen = false;
  for (let j = detectedStart; j < lines.length; j++) {
    const line = lines[j];
    // End of _meta block (top-level key or end of file)
    if (/^[^\s].*:/.test(line)) break;
    // End of detected block (next sibling under _meta at 2-space indent)
    if (/^\s{2}[a-z]/.test(line) && !/^\s{2}detected/.test(line)) break;
    if (layersOpen) {
      const layerMatch = line.match(/^\s{6}-\s+(.+)$/);
      if (layerMatch) {
        layers.push(layerMatch[1].trim());
        continue;
      }
      layersOpen = false;
    }
    const kv = line.match(/^\s{4}([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (key === 'observed_layers') {
      const inline = raw.match(/^\[(.*)\]\s*$/);
      if (inline) {
        const items = inline[1].split(',').map((s) => s.trim()).filter(Boolean);
        detected.observed_layers = items;
      } else {
        layersOpen = true;
        detected.observed_layers = layers;
      }
      continue;
    }
    let value: unknown = raw.trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^-?\d+$/.test(value as string)) value = Number(value);
    else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    detected[key] = value;
  }
  if (Object.keys(detected).length === 0) return null;
  return {
    project_type: (detected.project_type as 'greenfield' | 'brownfield') ?? 'greenfield',
    source_files: (detected.source_files as number) ?? 0,
    test_files: (detected.test_files as number) ?? 0,
    primary_language: (detected.primary_language as string) ?? 'unknown',
    package_manager:
      (detected.package_manager as DetectedContext['package_manager']) ?? 'unknown',
    has_readme: (detected.has_readme as boolean) ?? false,
    has_existing_tests: (detected.has_existing_tests as boolean) ?? false,
    observed_layers: (detected.observed_layers as string[]) ?? layers,
    detected_at: (detected.detected_at as string) ?? new Date().toISOString(),
  };
}

/**
 * F-90d054 AC-012 — Idempotent re-run.
 *
 * Replaces the `_meta:` block in an existing spec.yaml body with a fresh
 * marker, but ONLY when `detected` observations have changed since the last
 * init. Spec body content outside `_meta:` is preserved verbatim (no YAML
 * round-trip, no key reordering, no whitespace changes).
 *
 * Returns:
 *   - `updated: false` when the existing `_meta` reflects the current
 *     filesystem and nothing needs to change.
 *   - `updated: true` with the patched body and the list of scope items that
 *     were re-activated (a subset of DEFAULT_ENRICHMENT_SCOPE).
 */
export function patchMarkerInSpec(
  body: string,
  newDetected: DetectedContext,
): {body: string; updated: boolean; reactivated: readonly string[]} {
  const lines = body.split('\n');
  const metaStart = lines.findIndex((l) => /^_meta:\s*$/.test(l));
  if (metaStart === -1) {
    // No marker present — insert one right after the `schema:` line.
    const schemaIdx = lines.findIndex((l) => /^schema:\s/.test(l));
    if (schemaIdx === -1) {
      return {body, updated: false, reactivated: []};
    }
    const marker = buildMarker(newDetected);
    const block = renderMarkerYaml(marker);
    const insertion = ['', ...block.split('\n')];
    lines.splice(schemaIdx + 1, 0, ...insertion);
    return {body: lines.join('\n'), updated: true, reactivated: DEFAULT_ENRICHMENT_SCOPE};
  }
  // Locate end of _meta block — the next top-level key (column-0 `xxx:`).
  let metaEnd = lines.length;
  for (let i = metaStart + 1; i < lines.length; i++) {
    if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(lines[i])) {
      metaEnd = i;
      break;
    }
  }
  const previous = readDetectedFromSpec(body);
  if (previous) {
    const reactivate = diffScope(previous, newDetected);
    if (reactivate.length === 0) {
      return {body, updated: false, reactivated: []};
    }
    const marker: EnrichmentMarker = {
      enrichment_status: 'pending',
      enrichment_scope: reactivate,
      detected: newDetected,
    };
    const block = renderMarkerYaml(marker);
    const newLines = [...lines.slice(0, metaStart), ...block.split('\n'), ...lines.slice(metaEnd)];
    return {body: newLines.join('\n'), updated: true, reactivated: reactivate};
  }
  // _meta present but unparseable — fall back to full replacement.
  const marker = buildMarker(newDetected);
  const block = renderMarkerYaml(marker);
  const newLines = [...lines.slice(0, metaStart), ...block.split('\n'), ...lines.slice(metaEnd)];
  return {body: newLines.join('\n'), updated: true, reactivated: DEFAULT_ENRICHMENT_SCOPE};
}

export function diffScope(
  previous: DetectedContext,
  current: DetectedContext,
): readonly string[] {
  const reactivate: string[] = [];
  if (previous.project_type !== current.project_type) {
    reactivate.push('docs/project-context.md', 'spec/architecture.yaml', 'features');
  }
  if (previous.source_files !== current.source_files) {
    reactivate.push('features', 'docs/conventions.md');
  }
  if (previous.test_files !== current.test_files) {
    reactivate.push('acceptance_criteria');
  }
  if (previous.primary_language !== current.primary_language) {
    reactivate.push('docs/conventions.md', 'project.ai_hints');
  }
  if (previous.package_manager !== current.package_manager) {
    reactivate.push('spec/capabilities.yaml');
  }
  if (
    previous.observed_layers.length !== current.observed_layers.length ||
    previous.observed_layers.some((l, i) => l !== current.observed_layers[i])
  ) {
    reactivate.push('spec/architecture.yaml');
  }
  return [...new Set(reactivate)];
}
