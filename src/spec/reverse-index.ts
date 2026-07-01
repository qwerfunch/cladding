// Cladding · spec · reverse-edge index (backlinks) — F-ee47fc2b
//
// The SSoT carries only FORWARD edges: a feature lists what it depends_on,
// which modules it touches, which tests cover each AC. `pruneToFeature` walks
// depends_on UP (ancestors) — there is no way to ask the reverse:
//   • "what depends on me?"            (inverse of depends_on)
//   • "which features touch this file?" (inverse of modules)
//   • "which feature owns this test?"   (inverse of test_refs)
// Today every such question forces a full shard scan. This module materialises
// those three inversions once, so the graph layer (blast-radius queries, doc
// linking, exports) has O(1) backlinks to read.
//
// Design notes:
//   • PURE + DERIVED — the index is computed from the Spec, stored NOWHERE on
//     disk and never mutates the (readonly) Spec. The whole layer adds 0 bytes
//     to the repo.
//   • Memoised per Spec instance via a module-level WeakMap. primeSpecCache
//     (load.ts) holds exactly one Spec object per gate run, so the memo is
//     computed once per run and is GC-collected with the spec it keys — it can
//     never serve a stale index. No changes to types.ts / load.ts / drift.ts.
//   • moduleOwners is MANY-TO-MANY by design: `modules` records every feature
//     that *touched* a file (131/338 paths in cladding-self are multi-claimed),
//     so a path maps to the full set of claiming features — a co-change signal,
//     not exclusive ownership.

import type {Spec} from './types.js';

/** Reverse (backlink) maps derived from a Spec's forward edges. */
export interface ReverseIndex {
  /** featureId → ids of features that DIRECTLY depend_on it (one hop). */
  readonly dependents: ReadonlyMap<string, ReadonlySet<string>>;
  /** module path → set of feature ids that declare it in `modules` (many-to-many). */
  readonly moduleOwners: ReadonlyMap<string, ReadonlySet<string>>;
  /** test-file path (anchor-stripped) → set of feature ids whose ACs cite it. */
  readonly testRefCitations: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * test_ref prefixes that are NOT real file paths — they are pseudo-evidence
 * markers handled elsewhere (test-ref-repair.ts suggestions, fixtures, scripts,
 * the self-dogfood vouch). They must never enter the citation index.
 */
const PSEUDO_REF_PREFIXES = ['derived:', 'fixture:', 'script:', 'self-dogfood:'] as const;

/**
 * Normalises a test_ref to its file path, or null when it is a pseudo-ref.
 * Real refs look like `tests/foo.test.ts#a test name` — the `#anchor` (the
 * vitest test title) is dropped so all refs to the same file collapse to one key.
 */
function testRefPath(ref: string): string | null {
  for (const prefix of PSEUDO_REF_PREFIXES) {
    if (ref.startsWith(prefix)) return null;
  }
  const hash = ref.indexOf('#');
  const path = hash >= 0 ? ref.slice(0, hash) : ref;
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Appends `value` to the set stored at `key`, creating the set on first use. */
function addEdge(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  set.add(value);
}

/**
 * Builds the reverse index from a spec's forward edges. Pure: reads the spec,
 * mutates nothing, allocates fresh maps. O(features × (deps + modules + ACs)).
 *
 * @see reverseIndexOf for the memoised accessor (prefer it in hot paths).
 */
export function buildReverseIndex(spec: Spec): ReverseIndex {
  const dependents = new Map<string, Set<string>>();
  const moduleOwners = new Map<string, Set<string>>();
  const testRefCitations = new Map<string, Set<string>>();

  for (const feature of spec.features ?? []) {
    const fid = feature.id;

    for (const dep of feature.depends_on ?? []) {
      // dep is depended-ON-by fid → fid is a dependent of dep.
      addEdge(dependents, dep, fid);
    }

    for (const modulePath of feature.modules ?? []) {
      addEdge(moduleOwners, modulePath, fid);
    }

    for (const ac of feature.acceptance_criteria ?? []) {
      for (const ref of ac.test_refs ?? []) {
        const path = testRefPath(ref);
        if (path) addEdge(testRefCitations, path, fid);
      }
    }
  }

  return {dependents, moduleOwners, testRefCitations};
}

// ─── Per-Spec memoisation ───
// Keyed by the Spec object identity. The run-scoped cache (load.ts) reuses one
// Spec per run, so reverseIndexOf computes once per run; a new run gets a new
// Spec and a fresh entry, and the old entry is GC'd with the old spec.
const memo = new WeakMap<Spec, ReverseIndex>();

/**
 * Returns the reverse index for `spec`, computing it on first access and
 * caching it for the spec's lifetime. Prefer this over buildReverseIndex when
 * the same spec is queried repeatedly within a run.
 */
export function reverseIndexOf(spec: Spec): ReverseIndex {
  let index = memo.get(spec);
  if (!index) {
    index = buildReverseIndex(spec);
    memo.set(spec, index);
  }
  return index;
}
