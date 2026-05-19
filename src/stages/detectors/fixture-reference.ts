// Cladding · drift detector · FIXTURE_REFERENCE_INVALID
//
// Detector #20 (cladding extension — not part of the upstream Ironclad
// 19, axis: spec ↔ fixture, default severity: warn). Promotes the
// `fixture:NAME` evidence label from a free-form string to a validated
// anchor.
//
// What it does
//   For every `acceptance_criteria[].evidence_refs[]` (and, for
//   backward compatibility, `test_refs[]`) entry that starts with the
//   `fixture:` prefix, the detector strips the prefix and looks the
//   name up in `<cwd>/conformance/fixtures.yaml`. An unregistered
//   citation emits a `warn` finding — typo-grade noise rather than a
//   hard error, because the citation may be aspirational (the fixture
//   is planned but not yet added to the registry).
//
// What it does *not* do
//   - It does not require the fixture body to exist in
//     `conformance/runner.ts` — `kind: documentary` is a legitimate
//     registry entry whose verification lives elsewhere. The point of
//     the registry is to make every label point at *something*, not to
//     force every label into the executable runner.
//   - It does not catch orphan fixtures (registry entries no AC cites)
//     — that's an informational signal best surfaced by a separate
//     `clad panel` view, not a drift finding.
//   - It does not load the YAML when the registry file is missing.
//     User projects without a `conformance/fixtures.yaml` simply opt
//     out; the detector returns no findings rather than warning that
//     the file is absent (false positives would punish projects that
//     never adopt the fixture: convention).
//
// Why severity = warn
//   A typo (`fixture:stage-tyep-skip` instead of `stage-type-skip`)
//   should be noticed by reviewers, not block a release. Authors who
//   want CI to reject typos can use `clad check --strict` (F-051),
//   which promotes every warn to error.
//
// @see spec/features/F-053.yaml — fixture registry feature.
// @see conformance/fixtures.yaml — the SSoT this detector reads.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'yaml';

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'FIXTURE_REFERENCE_INVALID';
const PREFIX = 'fixture:';
const REGISTRY_PATH = 'conformance/fixtures.yaml';

interface RegistryEntry {
  readonly name: string;
  readonly stage?: string;
  readonly kind?: 'runnable' | 'documentary';
  readonly description?: string;
}

interface RegistryFile {
  readonly fixtures?: readonly RegistryEntry[];
}

function loadRegistry(cwd: string): ReadonlySet<string> | null {
  const path = join(cwd, REGISTRY_PATH);
  if (!existsSync(path)) return null;
  try {
    const data = parse(readFileSync(path, 'utf8')) as RegistryFile | null;
    const names = (data?.fixtures ?? []).map((f) => f.name).filter(Boolean);
    return new Set(names);
  } catch {
    return null;
  }
}

function* iterFixtureCitations(
  refs: readonly string[] | undefined,
  fieldName: 'evidence_refs' | 'test_refs',
): Generator<{ref: string; name: string; field: string}> {
  for (const ref of refs ?? []) {
    if (!ref.startsWith(PREFIX)) continue;
    yield {ref, name: ref.slice(PREFIX.length), field: fieldName};
  }
}

function runFixtureReference(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;

  const registry = loadRegistry(cwd);
  if (registry === null) {
    return [];
  }

  let spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message: `spec.yaml not loaded: ${(err as Error).message}`,
      },
    ];
  }

  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    for (const ac of feature.acceptance_criteria ?? []) {
      const citations = [
        ...iterFixtureCitations(ac.evidence_refs, 'evidence_refs'),
        ...iterFixtureCitations(ac.test_refs, 'test_refs'),
      ];
      for (const {ref, name, field} of citations) {
        if (registry.has(name)) continue;
        findings.push({
          detector: NAME,
          severity: 'warn',
          path: REGISTRY_PATH,
          message:
            `${feature.id}.${ac.id} cites '${ref}' in ${field} but no fixture ` +
            `named '${name}' is registered in conformance/fixtures.yaml`,
        });
      }
    }
  }
  return findings;
}

export const fixtureReference: DriftDetector = {
  name: NAME,
  run: runFixtureReference,
};
