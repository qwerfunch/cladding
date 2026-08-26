// Cladding · drift detector · TECH_STACK_MISMATCH
//
// Detector #4 from the catalog (axis: spec_vs_code). Answers ONE question:
// does `spec.project.language` contradict the source files on disk?
//
// EVIDENCE MODEL — the files, not the manifest.
// The declared language is compared against the observed distribution of
// source files (`core/language-evidence.ts`), under two guards:
//
//   1. declared language outside the vocabulary  → silence. Cladding does
//      not know zig or haskell; ignorance is not drift.
//   2. fewer than EVIDENCE_FLOOR classified files → silence. A tree with
//      three files cannot support an assertion about what it is.
//
// Then: declared absent from the observed set → one `warn` (an active
// contradiction — ported to TypeScript, spec still says python — which
// still blocks under `--strict`, with the counts shown so the developer
// can see why). Declared present but under MINORITY_SHARE → one `info`,
// never a blocking severity. Anything else → silence.
//
// WHY THERE IS DELIBERATELY NO COVERAGE-RATIO RULE.
// An earlier design guarded on "what fraction of source files did we
// classify at all". Red-team testing refuted it out-of-sample: the rule's
// behaviour hinged entirely on whether an unrecognised extension sat in
// the denominator list. In-list, an unclassifiable tree looked
// well-covered and REAL drift went unreported; out-of-list, an ordinary
// project using one unlisted extension tripped a FALSE warn. The failure
// direction flipped on a list edit, which makes the rule unownable. The
// evidence-count floor replaces it and deletes the list entirely.
//
// WHY THE MANIFEST CHAIN IS NOT CONSULTED HERE.
// `detectToolchain` resolves the BUILD HOST (a gradle wrapper resolves
// java, whatever the product is written in). That is exactly the right
// question for "which commands do we run" — where it keeps serving, and
// which this change does not touch — and exactly the wrong question for
// "what IS this project". Using it for identity let a build-host label
// contradict a truthful product language: the manifest comparison
// blocked 12 of 19 realistic normal repo shapes (63%) under `--strict`.
//
// WHY THE MINORITY BAND DISCLOSES INSTEAD OF BLOCKING.
// A boundary attack found a legitimate thin native SDK at 4.8% sitting
// BELOW a genuine ported-residue case at 8.3%: residue and thin-core are
// not mechanically separable, so the band says so out loud and moves on.
//
// @see F-9e1279d4 — language evidence core.

import {classifySources, LANGUAGE_VOCABULARY} from '../../core/language-evidence.js';
import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'TECH_STACK_MISMATCH';

/**
 * Minimum classified source files before the detector will assert
 * anything. Corpus-supported range [3, 10]; 5 is the chosen point —
 * low enough to catch a small ported repo, high enough that a scaffold
 * or a docs-only checkout stays silent.
 */
const EVIDENCE_FLOOR = 5;

/**
 * Share below which a declared-but-present language is merely disclosed.
 * Corpus-supported range [9%, 50%]; 10% is the chosen point — a higher
 * threshold only adds `info` noise on ordinary polyglot repositories.
 */
const MINORITY_SHARE = 0.10;

function runTechStackMismatch(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

/**
 * Renders the observed distribution most-seen first, e.g.
 * `{typescript ×20, python ×3}`. Alphabetical tie-break keeps the
 * message deterministic across filesystems.
 */
function renderDistribution(counts: Readonly<Record<string, number>>): string {
  const parts = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
    .map((language) => `${language} ×${counts[language]}`);
  return `{${parts.join(', ')}}`;
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const declared = spec.project?.language ?? '';
  // Rule 1 — a language cladding has no vocabulary for cannot be judged.
  if (!LANGUAGE_VOCABULARY.has(declared)) return [];

  const evidence = classifySources(cwd);
  // Rule 2 — too few classified files to assert anything about the tree.
  if (evidence.classified < EVIDENCE_FLOOR) return [];

  // Rule 3 — declared language is nowhere in the tree: an active contradiction.
  if (!evidence.set.includes(declared)) {
    return [
      {
        detector: NAME,
        severity: 'warn',
        message:
          `spec.project.language='${declared}' but the observed sources are ` +
          `${renderDistribution(evidence.counts)} — the spec no longer matches the tree`,
      },
    ];
  }

  // Rule 4 — present but a sliver: disclose the share, never block on it.
  if (evidence.share(declared) < MINORITY_SHARE) {
    return [
      {
        detector: NAME,
        severity: 'info',
        message:
          `spec.project.language='${declared}' is a minority of observed sources ` +
          `(${evidence.counts[declared]}/${evidence.classified}) — disclosed, not blocking`,
      },
    ];
  }

  // Rule 5 — declared language is a majority or plural presence: nothing to say.
  return [];
}

export const techStackMismatch: DriftDetector = {
  name: NAME,
  run: runTechStackMismatch,
};
