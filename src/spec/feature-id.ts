// Cladding · spec · canonical F-id lexer — shared by the graph layer's prose scanners
//
// v0.7.0 shipped TWO diverging F-id finders: doc-references.ts matched only
// hash ids, so every legacy sequential id (F-001…F-083,
// 80 live shards) was invisible to the doc graph and DOC_LINK_INTEGRITY, while
// graph-health.ts carried the correct alternation. One source of truth here so
// the scan sites can never diverge again. Legacy = 3+ digits or 6+ lowercase
// hexadecimal characters; writers emit eight lowercase hex through ID_POLICIES.
// This module projects the embedded prose scanner; full-match readers and
// writers derive from the same executable policy in id-policy.ts.

import {embeddedReadableIdSource} from './compiler/id-policy.js';

/** Compatibility-reader prose pattern projected from the executable ID policy. */
export const FEATURE_ID_SOURCE = embeddedReadableIdSource('feature');

/** Fresh RegExp per call — a shared global regex object would leak lastIndex state. */
export function featureIdRe(flags: string = ''): RegExp {
  return new RegExp(FEATURE_ID_SOURCE, flags);
}
