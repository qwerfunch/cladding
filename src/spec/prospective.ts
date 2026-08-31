// Cladding · schema-0.2 completion-only prospective workspace overlays.
//
// A schema-0.2 completion gate must evaluate `done` without first making that
// claim durable.  These scoped overlays are deliberately separate from the
// ordinary per-run loader cache: runDrift primes and clears its own cache while
// it runs, so sharing that mutable slot would let a nested drift pass erase the
// prospective completion view.

import {resolve} from 'node:path';

import type {SpecCompilation} from './compiler/types.js';
import type {Spec} from './types.js';

interface Overlay<T> {
  readonly cwd: string;
  readonly value: T;
}

const specOverlays: Overlay<Spec>[] = [];
const compilationOverlays: Overlay<SpecCompilation>[] = [];

/** Returns the innermost completion-only Spec overlay for a workspace. */
export function prospectiveSpecOverlay(cwd: string): Spec | undefined {
  return lookup(specOverlays, cwd);
}

/** Returns the innermost completion-only compiler overlay for a workspace. */
export function prospectiveCompilationOverlay(cwd: string): SpecCompilation | undefined {
  return lookup(compilationOverlays, cwd);
}

/** Runs synchronous gate work against an immutable prospective Spec. */
export function withProspectiveSpecOverlay<T>(cwd: string, spec: Spec, work: () => T): T {
  return withOverlay(specOverlays, cwd, spec, work);
}

/** Runs synchronous gate work against an immutable prospective compilation. */
export function withProspectiveCompilationOverlay<T>(cwd: string, compilation: SpecCompilation, work: () => T): T {
  return withOverlay(compilationOverlays, cwd, compilation, work);
}

/** Produces the immutable `done` Spec view evaluated by one completion gate. */
export function prospectiveDoneSpec(spec: Spec, featureId: string): Spec {
  return Object.freeze({
    ...spec,
    features: Object.freeze((spec.features ?? []).map((feature) => feature.id === featureId
      ? Object.freeze({...feature, status: 'done'})
      : feature)),
  });
}

/** Produces the matching compiler contract view without reparsing mutable YAML. */
export function prospectiveDoneCompilation(compilation: SpecCompilation, featureId: string): SpecCompilation {
  if (compilation.schemaVersion !== '0.2' || !compilation.contract) return compilation;
  return Object.freeze({
    ...compilation,
    contract: Object.freeze({
      ...compilation.contract,
      features: Object.freeze(compilation.contract.features.map((feature) => feature.id === featureId
        ? Object.freeze({...feature, status: 'done'})
        : feature)),
    }),
  });
}

function lookup<T>(overlays: readonly Overlay<T>[], cwd: string): T | undefined {
  const root = resolve(cwd);
  for (let index = overlays.length - 1; index >= 0; index--) {
    const overlay = overlays[index]!;
    if (overlay.cwd === root) return overlay.value;
  }
  return undefined;
}

function withOverlay<T, R>(overlays: Overlay<T>[], cwd: string, value: T, work: () => R): R {
  const overlay: Overlay<T> = Object.freeze({cwd: resolve(cwd), value});
  overlays.push(overlay);
  try {
    return work();
  } finally {
    // Completion gates are synchronous.  Remove by identity anyway so a
    // nested completion scope cannot accidentally pop its parent view.
    const index = overlays.lastIndexOf(overlay);
    if (index !== -1) overlays.splice(index, 1);
  }
}
