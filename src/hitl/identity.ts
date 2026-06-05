// Cladding · HITL · identity types
//
// The Ironclad standard's central distinction: every piece of evidence
// carries an author identity. Stage 4 (HITL) refuses to clear an AC
// when only tool/LLM-authored evidence backs it — that's the
// anti-self-cert guard cladding-design 01-philosophy.md insists on.
//
// `human` = a real person; their identity should be a stable handle
//   (git author, OS user, OAuth subject).
// `llm` = a model output (any LLM); name SHOULD include the model id
//   (e.g. `claude-opus-4.7`).
// `tool` = automated CI / CLI tool (vitest, eslint, secretlint, etc.).
//
// Only `human` evidence breaks the self-cert cycle — `llm` and `tool`
// are equivalent for the guard.

/** Who produced this piece of evidence. */
export type EvidenceAuthor = 'human' | 'llm' | 'tool';

/** Author metadata attached to every evidence entry. */
export interface Identity {
  readonly author: EvidenceAuthor;
  /** Stable handle, e.g. git author / model id / tool name. */
  readonly name?: string;
  /** ISO 8601 timestamp. Defaults to `new Date().toISOString()`. */
  readonly timestamp: string;
}

/**
 * Kinds of evidence cladding records. `oracle` (v0.5.x) is the
 * spec-conformance oracle authoring-provenance record: who authored the
 * impl-blind oracle, and what they were shown (the read-manifest).
 */
export type EvidenceKind = 'pass' | 'fail' | 'note' | 'attachment' | 'oracle';

/** One audit-log entry. */
export interface Evidence {
  /** Stable id, ulid- or uuid-shaped. */
  readonly id: string;
  /** F-NNN feature this evidence supports. */
  readonly featureId: string;
  /** AC-NNN the evidence is attached to (optional — feature-level note allowed). */
  readonly acId?: string;
  /** Which Iron Law stage produced this evidence. */
  readonly stage: string;
  readonly identity: Identity;
  readonly kind: EvidenceKind;
  /** One-line human-readable summary. */
  readonly content: string;
  /** Optional artifact path / hash (e.g. test report). */
  readonly artifact?: string;
  /**
   * Oracle-provenance only (`kind: 'oracle'`): the exact inputs the oracle
   * author was shown. On the structurally-blind `clad oracle` path cladding
   * builds the prompt, so this is trustworthy (spec/AC fields + module PATHS,
   * never module bodies); on the host-protocol MCP path it is the host's
   * self-reported list. SPEC_CONFORMANCE asserts `readManifest ∩ feature.modules = ∅`.
   */
  readonly readManifest?: readonly string[];
  /**
   * Oracle-provenance only: `true` when blindness is structurally guaranteed
   * (cladding-controlled prompt); `false` when it is a self-reported
   * host-protocol claim the gate can audit but not prove.
   */
  readonly blind?: boolean;
}

/** Constructor that fills timestamp + a short random id. */
export function newEvidence(input: Omit<Evidence, 'id' | 'identity'> & {identity: Omit<Identity, 'timestamp'> & {timestamp?: string}}): Evidence {
  const timestamp = input.identity.timestamp ?? new Date().toISOString();
  const id = `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...input,
    id,
    identity: {...input.identity, timestamp},
  };
}
