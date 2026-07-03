// Cladding · `clad report` — one deterministic PR review packet per git range
//
// Thin, impure CLI wrapper (git + spec + detector I/O and exit codes only); all
// rendering lives in the pure foundation layer src/report/. It composes, for a
// `<since>..HEAD` range:
//
//   • spec-shard movement          — from the changelog collector
//   • changed source → owning feats — each changed file resolved via the
//                                     reverse index's blast-radius slice
//   • the regression set           — deduped union of test_refs across slices
//   • gate + attestation state     — spec/attestation.yaml + last gate_run event
//
// and RENDERS it as markdown (default), SARIF 2.1.0 (--format sarif), or the raw
// model (--format json). It gates NOTHING.
//
// Exit codes: 0 rendered · 2 unresolvable/missing --since ref (never a
// silently-empty packet — the contract shared with the changelog collector) ·
// 1 any other failure.

import {execFileSync} from 'node:child_process';
import process from 'node:process';

import {collectChangelog, defaultSinceRef, type ChangelogManifest} from '../changelog/collect.js';
import {latestEventOfType} from '../events/log.js';
import {buildImpactSlice, ledgerOf} from '../optimizer/reverse-slice.js';
import {
  buildReportModel,
  renderReportMarkdown,
  type CodeChangeInput,
  type GateStateInput,
  type OwningFeature,
  type ReportInputs,
} from '../report/report.js';
import {toSarif} from '../report/sarif.js';
import {readAttestation} from '../spec/attestation.js';
import {loadSpec} from '../spec/load.js';
import {reverseIndexOf} from '../spec/reverse-index.js';
import type {Feature, Spec} from '../spec/types.js';
import {runDrift} from '../stages/drift.js';
import {pulse} from '../ui/pulse.js';

export interface ReportCommandOptions {
  readonly since?: string;
  /** Output format: md (default) | sarif | json. */
  readonly format?: string;
  /** Project root (tests inject; the CLI always runs from the project root). */
  readonly cwd?: string;
}

const FORMATS = ['md', 'sarif', 'json'] as const;

/** Source-code file extensions the code-changes section considers reviewable. */
const SOURCE_EXT = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java',
  'kt', 'kts', 'rb', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'swift',
  'php', 'scala', 'm', 'mm', 'sh', 'bash', 'lua', 'dart', 'ex', 'exs', 'clj',
  'ml', 'vue', 'svelte',
]);

/** Path segments that mark generated / vendored trees — never reviewable source. */
const DENIED_SEGMENTS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.cladding',
  'vendor', '.next', 'target',
]);

/** True when a repo-relative path is a reviewable source file (not vendored/generated). */
function isReviewableSourcePath(p: string): boolean {
  const segs = p.split('/');
  if (segs.some((s) => DENIED_SEGMENTS.has(s))) return false;
  const dot = p.lastIndexOf('.');
  if (dot < 0) return false;
  return SOURCE_EXT.has(p.slice(dot + 1).toLowerCase());
}

/** Asserts `ref` resolves to a commit, throwing an exit-2-style error otherwise. */
function assertRefResolves(cwd: string, ref: string): void {
  const r = (ref ?? '').trim();
  if (r.length === 0) {
    throw new Error('report: empty --since ref — pass --since <tag|branch|sha>');
  }
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${r}^{commit}`], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error(
      `report: '${r}' does not resolve to a commit in this repository — pass --since <tag|branch|sha> that exists. ` +
        'An unresolvable ref is an error, never a silently-empty report.',
    );
  }
}

/** Changed source files in `<since>..HEAD`, deduped + sorted. Empty on git failure. */
function changedSourceFiles(cwd: string, sinceRef: string): readonly string[] {
  let raw: string;
  try {
    raw = execFileSync('git', ['diff', '--name-only', `${sinceRef}..HEAD`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return [];
  }
  return [
    ...new Set(
      raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .filter(isReviewableSourcePath),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/** Resolves an owning-feature id to its title + slug from the spec. */
function ownerOf(id: string, byId: ReadonlyMap<string, Feature>): OwningFeature {
  const f = byId.get(id);
  const slug = f ? (f as {slug?: string}).slug : undefined;
  return {id, title: f?.title ?? id, ...(slug ? {slug} : {})};
}

/** Reads gate + attestation state from spec/attestation.yaml and the events ledger. */
function gatherGateState(cwd: string): GateStateInput {
  const att = readAttestation(cwd);
  const ev = latestEventOfType(cwd, 'gate_run');
  const lastGateRun = ev
    ? {
        tier: typeof ev.payload.tier === 'string' ? ev.payload.tier : undefined,
        strict: typeof ev.payload.strict === 'boolean' ? ev.payload.strict : undefined,
        worst: typeof ev.payload.worst === 'number' ? ev.payload.worst : undefined,
        anyFailed: typeof ev.payload.anyFailed === 'boolean' ? ev.payload.anyFailed : undefined,
      }
    : null;
  return {attestedCount: att === null ? null : att.size, lastGateRun};
}

/** Composes the pure model's inputs from the git range + the loaded spec. */
function gatherInputs(
  cwd: string,
  spec: Spec,
  sinceRef: string,
  manifest: ChangelogManifest,
): ReportInputs {
  const ri = reverseIndexOf(spec);
  const ledgerEmpty = ledgerOf(ri).depends_on_edges === 0;
  const byId = new Map((spec.features ?? []).map((f) => [f.id, f]));

  const codeChanges: CodeChangeInput[] = changedSourceFiles(cwd, sinceRef).map((path) => {
    const slice = buildImpactSlice(spec, path);
    if ('not_found' in slice) return {path, owners: [], testRefs: []};
    const owners = (slice.focus.owners ?? []).map((id) => ownerOf(id, byId));
    return {path, owners, testRefs: slice.test_refs};
  });

  return {specChanges: manifest, codeChanges, ledgerEmpty, gate: gatherGateState(cwd)};
}

/** Handler for `clad report --since <ref> [--format md|sarif|json]`. */
export function runReportCommand(opts: ReportCommandOptions): void {
  const cwd = opts.cwd ?? '.';
  const format = opts.format ?? 'md';
  if (!(FORMATS as readonly string[]).includes(format)) {
    pulse('fail', 'report', `unknown --format '${format}' (expected md | sarif | json)`);
    process.exit(1);
    return;
  }

  // Ref validation up front for EVERY format — an unresolvable ref exits 2,
  // never a silently-empty packet (AC-67fa1d25).
  let sinceRef: string;
  try {
    sinceRef = opts.since ?? defaultSinceRef(cwd);
    assertRefResolves(cwd, sinceRef);
  } catch (err) {
    pulse('fail', 'report', (err as Error).message);
    process.exit(2);
    return;
  }

  try {
    let out: string;
    if (format === 'sarif') {
      // SARIF projects the drift findings, not the range — run the detectors
      // (runDrift primes the spec cache; findings carry every severity) and
      // emit error|warn as results.
      const {findings} = runDrift({cwd});
      out = `${JSON.stringify(toSarif(findings), null, 2)}\n`;
    } else {
      const manifest = collectChangelog(cwd, sinceRef);
      const spec = loadSpec(cwd);
      const model = buildReportModel(gatherInputs(cwd, spec, sinceRef, manifest));
      out =
        format === 'json'
          ? `${JSON.stringify({since: sinceRef, head: manifest.head, ...model}, null, 2)}\n`
          : `${renderReportMarkdown(model, {sinceRef, head: manifest.head})}\n`;
    }
    // Set exitCode and let the event loop DRAIN stdout instead of process.exit():
    // the packet can exceed the 64KB pipe buffer, and a forced exit truncates a
    // buffered pipe mid-write (the latent bug PR #201 fixed for `clad check`).
    process.stdout.write(out);
    process.exitCode = 0;
  } catch (err) {
    pulse('fail', 'report', (err as Error).message);
    process.exit(1);
  }
}
