// Cladding · changelog · deterministic collector (F-904495a5)
//
// The spec is the SSoT — so "what shipped?" must be answerable FROM the spec,
// deterministically, without an LLM recalling git history. This module turns
// the git range `<sinceRef>..HEAD` into a `ChangelogManifest`: feature shards
// classified by how their lifecycle moved (added-as-done / flipped-to-done /
// modified-while-done / archived), grouped by capability (Tier B), plus an
// inventory count diff and the conventional `feat:`/`fix:` commits that name
// no feature id (the honest under-reporting signal — work that shipped
// outside the spec).
//
// COST DISCIPLINE (enterprise review E8): exactly ONE repo-wide
// `git diff --name-status` classifies the candidate set; `git show` runs only
// for the shards whose status must be compared against the ref (modified /
// deleted), never as a per-shard loop over the whole spec tree.
//
// DETERMINISM: object keys are constructed in sorted order and feature ids
// are sorted, so two runs over the same repo state serialize byte-identically
// — the property that makes a rendered release note auditable.
//
// Layer: `changelog` is foundation-tier (spec/architecture.yaml) — it must
// never import stages/cli/serve. The CLI verb (src/cli/changelog.ts)
// and the MCP tool (src/serve/server.ts) are thin wrappers over this module.

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parse as parseYaml} from 'yaml';

import {refExists} from '../core/git-ops.js';
import type {AcceptanceCriterion, Capability} from '../spec/types.js';

/** How a feature shard's lifecycle moved across the `since..HEAD` range. */
export type FeatureChangeKind =
  | 'added-as-done'
  | 'flipped-to-done'
  | 'modified-while-done'
  | 'archived';

/** One shipped feature in the manifest (keys sorted for determinism). */
export interface ChangelogFeature {
  /** Plain AC sentences (the `text` field, or composed from EARS parts). */
  readonly acceptance: readonly string[];
  readonly change: FeatureChangeKind;
  readonly id: string;
  readonly slug?: string;
  readonly title: string;
}

/** One capability bucket; `uncategorized` collects unmatched features. */
export interface ChangelogGroup {
  /** Capability id from spec/capabilities.yaml, or `uncategorized`. */
  readonly capability: string;
  readonly features: readonly ChangelogFeature[];
  readonly title: string;
}

/** The four counted inventory dimensions (absent block ⇒ zeros). */
export interface InventoryCounts {
  readonly capabilities: number;
  readonly features: number;
  readonly scenarios: number;
  readonly test_files: number;
}

/** A conventional feat/fix commit touching src/ that names no F-id. */
export interface UnshardedCommit {
  readonly hash: string;
  readonly subject: string;
}

/** The deterministic shipped-changes manifest (keys sorted). */
export interface ChangelogManifest {
  readonly groups: readonly ChangelogGroup[];
  readonly head: string;
  readonly inventory: {
    readonly after: InventoryCounts;
    readonly before: InventoryCounts;
  };
  readonly since: string;
  readonly unsharded_commits: readonly UnshardedCommit[];
}

/** Minimal shard shape the collector needs (raw-parsed, not schema-validated). */
interface ShardDoc {
  readonly id: string;
  readonly slug?: string;
  readonly title: string;
  readonly status: string;
  readonly acceptance_criteria?: readonly AcceptanceCriterion[];
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Resolves the default `--since` ref: the latest reachable tag
 * (`git describe --tags --abbrev=0`). Throws a clear error when the
 * repository has no tags — the caller must pass `--since` explicitly
 * rather than receive a silently unbounded (or empty) range.
 */
export function defaultSinceRef(cwd: string): string {
  try {
    const tag = git(cwd, ['describe', '--tags', '--abbrev=0']).trim();
    if (tag.length > 0) return tag;
  } catch {
    /* fall through to the explicit error below */
  }
  throw new Error(
    'changelog: no git tag found to anchor the default range — pass --since <ref> explicitly (e.g. clad changelog --since v1.0.0)',
  );
}

/**
 * Collects the shipped-changes manifest for `sinceRef..HEAD`.
 *
 * @param cwd - Project root (must be the git work-tree root, as everywhere in cladding).
 * @param sinceRef - Tag / branch / sha to diff from.
 * @returns A deterministic, sorted manifest — byte-identical across runs on the same state.
 * @throws Error with a clear, exit-2-style message when `sinceRef` does not
 *         resolve to a commit. Never returns a silently empty manifest for bad input.
 */
export function collectChangelog(cwd: string, sinceRef: string): ChangelogManifest {
  assertValidRef(cwd, sinceRef);
  const head = git(cwd, ['rev-parse', 'HEAD']).trim();
  const entries = classifyShards(cwd, sinceRef);
  return {
    groups: groupByCapability(cwd, entries),
    head,
    inventory: {
      after: inventoryCounts(readWorktreeOrNull(cwd, 'spec.yaml')),
      before: inventoryCounts(gitShowOrNull(cwd, sinceRef, 'spec.yaml')),
    },
    since: sinceRef,
    unsharded_commits: unshardedCommits(cwd, sinceRef),
  };
}

/**
 * Renders one AC as a plain sentence: the pre-rendered `text` when present,
 * otherwise composed from the EARS parts. Shared with the catalog renderer.
 * Returns null for a skeleton AC with nothing renderable.
 */
export function acSentence(ac: AcceptanceCriterion): string | null {
  if (ac.text && ac.text.trim().length > 0) return ac.text.trim();
  const action = ac.action?.trim();
  if (!action) return null;
  const condition = ac.condition?.trim();
  const response = ac.response?.trim();
  const stem = condition
    ? `${condition.charAt(0).toUpperCase()}${condition.slice(1)}, the system shall ${action}`
    : `The system shall ${action}`;
  return response ? `${stem} — ${response}.` : `${stem}.`;
}

function assertValidRef(cwd: string, sinceRef: string): void {
  const ref = (sinceRef ?? '').trim();
  if (ref.length === 0) {
    throw new Error('changelog: empty since ref — pass --since <tag|branch|sha>');
  }
  if (!refExists(cwd, ref)) {
    throw new Error(
      `changelog: '${ref}' does not resolve to a commit in this repository — pass --since <tag|branch|sha> that exists. ` +
        'An unknown ref is an error, never a silently empty changelog.',
    );
  }
}

/**
 * Classifies feature shards from ONE `git diff --name-status <ref>..HEAD -- spec/`.
 * `git show <ref>:<path>` is invoked ONLY for shards whose status must be
 * compared (modified / renamed / deleted) — never as a per-shard loop.
 */
function classifyShards(cwd: string, sinceRef: string): ChangelogFeature[] {
  const raw = git(cwd, ['diff', '--name-status', `${sinceRef}..HEAD`, '--', 'spec/']);
  const out: ChangelogFeature[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    const fields = line.split('\t');
    const status = fields[0] ?? '';
    const oldPath = fields[1] ?? '';
    const newPath = fields.length > 2 ? fields[2] : oldPath;
    if (!isFeatureShard(newPath) && !isFeatureShard(oldPath)) continue;

    if (status.startsWith('A')) {
      // Added since the ref — the worktree alone tells the story.
      const doc = parseShard(readWorktreeOrNull(cwd, newPath));
      if (!doc) continue;
      if (doc.status === 'done') out.push(toEntry(doc, 'added-as-done'));
      else if (doc.status === 'archived') out.push(toEntry(doc, 'archived'));
      // planned/in_progress additions are unshipped — not changelog material.
    } else if (status.startsWith('D')) {
      // Removed shard — read its last known shape from the ref.
      const doc = parseShard(gitShowOrNull(cwd, sinceRef, oldPath));
      if (doc) out.push(toEntry(doc, 'archived'));
    } else {
      // M / R / C / T — status must be compared against the ref.
      const current = parseShard(readWorktreeOrNull(cwd, newPath));
      if (!current) continue;
      const before = parseShard(gitShowOrNull(cwd, sinceRef, oldPath));
      const was = before?.status;
      if (current.status === 'done' && was !== 'done') {
        out.push(toEntry(current, 'flipped-to-done'));
      } else if (current.status === 'done' && was === 'done') {
        out.push(toEntry(current, 'modified-while-done'));
      } else if (current.status === 'archived' && was !== 'archived') {
        out.push(toEntry(current, 'archived'));
      }
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function isFeatureShard(path: string): boolean {
  return path.startsWith('spec/features/') && (path.endsWith('.yaml') || path.endsWith('.yml'));
}

/** One feature spec entry as it stood at both ends of a range (AC-a2278f11). */
export interface SpecEntryRevision {
  /** Repo-relative path of the entry at HEAD (or at the ref, when deleted). */
  readonly path: string;
  readonly id: string;
  readonly slug?: string;
  readonly title: string;
  /** Status at the ref; null when the entry was added within the range. */
  readonly statusBefore: string | null;
  /** Status at HEAD; null when the entry was deleted within the range. */
  readonly statusAfter: string | null;
  readonly baseAcs: readonly AcceptanceCriterion[];
  readonly headAcs: readonly AcceptanceCriterion[];
}

/**
 * Every feature spec entry the range touched, at BOTH revisions, regardless of
 * status — the review packet's input.
 *
 * WHY this exists alongside classifyShards: that one is a *shipped* filter. It
 * keeps only done/archived lifecycle transitions and drops `planned` /
 * `in_progress` entries outright, which is right for a changelog and wrong for
 * a reviewer. Measured on a live corpus, 74% of a range's touched entries sat
 * in those two states — a review packet built on the changelog's population
 * would silently omit most of what the range actually did to the spec.
 *
 * Same cost discipline as its sibling: ONE `git diff --name-status` classifies
 * the candidate set, and `git show` runs only for entries that existed at the
 * ref. Sorted by id, so callers serialize deterministically.
 */
export function collectSpecEntryRevisions(cwd: string, sinceRef: string): readonly SpecEntryRevision[] {
  assertValidRef(cwd, sinceRef);
  const raw = git(cwd, ['diff', '--name-status', `${sinceRef}..HEAD`, '--', 'spec/']);
  const out: SpecEntryRevision[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    const fields = line.split('\t');
    const status = fields[0] ?? '';
    const oldPath = fields[1] ?? '';
    const newPath = fields.length > 2 ? (fields[2] ?? '') : oldPath;
    if (!isFeatureShard(newPath) && !isFeatureShard(oldPath)) continue;

    const added = status.startsWith('A');
    const deleted = status.startsWith('D');
    // BOTH sides are revisions. Reading the head from the working tree let an
    // uncommitted edit hide a rewrite that IS in the range, or charge the range
    // with one it never made — and the same leak reached the status, which
    // manufactures the rewrite-plus-done pairing this data exists to surface.
    // The candidate set and the co-change column already come from the
    // committed diff; this was the odd one out.
    const head = added || !deleted ? parseShard(gitShowOrNull(cwd, 'HEAD', newPath)) : null;
    const base = added ? null : parseShard(gitShowOrNull(cwd, sinceRef, oldPath));
    const anchor = head ?? base;
    if (!anchor) continue;

    out.push({
      path: deleted ? oldPath : newPath,
      id: anchor.id,
      ...(anchor.slug ? {slug: anchor.slug} : {}),
      title: anchor.title,
      statusBefore: base ? base.status : null,
      statusAfter: head ? head.status : null,
      baseAcs: base?.acceptance_criteria ?? [],
      headAcs: head?.acceptance_criteria ?? [],
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function toEntry(doc: ShardDoc, change: FeatureChangeKind): ChangelogFeature {
  const acceptance = (doc.acceptance_criteria ?? [])
    .map((ac) => acSentence(ac))
    .filter((s): s is string => s !== null);
  return {
    acceptance,
    change,
    id: doc.id,
    ...(doc.slug ? {slug: doc.slug} : {}),
    title: doc.title,
  };
}

function parseShard(body: string | null): ShardDoc | null {
  if (body === null) return null;
  let doc: unknown;
  try {
    doc = parseYaml(body);
  } catch {
    return null;
  }
  const rec = doc as {id?: unknown; title?: unknown; status?: unknown};
  if (!rec || typeof rec.id !== 'string' || typeof rec.status !== 'string') return null;
  return {
    id: rec.id,
    slug: typeof (rec as {slug?: unknown}).slug === 'string' ? (rec as {slug: string}).slug : undefined,
    title: typeof rec.title === 'string' ? rec.title : rec.id,
    status: rec.status,
    acceptance_criteria: (rec as {acceptance_criteria?: readonly AcceptanceCriterion[]}).acceptance_criteria,
  };
}

function readWorktreeOrNull(cwd: string, relPath: string): string | null {
  const abs = join(cwd, relPath);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function gitShowOrNull(cwd: string, ref: string, relPath: string): string | null {
  try {
    return git(cwd, ['show', `${ref}:${relPath}`]);
  } catch {
    return null; // path did not exist at the ref
  }
}

/**
 * Groups classified features by capability (spec/capabilities.yaml, worktree
 * state). Groups sort by capability id; features within a group are already
 * id-sorted. Features no capability claims land in a trailing `uncategorized`
 * bucket — itself a useful drift signal (shipped without a Tier-B link).
 */
function groupByCapability(cwd: string, entries: readonly ChangelogFeature[]): ChangelogGroup[] {
  const capabilities = loadCapabilities(cwd)
    .filter((c) => typeof c.id === 'string' && c.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const groups: ChangelogGroup[] = [];
  const claimed = new Set<string>();
  for (const cap of capabilities) {
    const ids = new Set(cap.features ?? []);
    const members = entries.filter((e) => ids.has(e.id) && !claimed.has(e.id));
    if (members.length === 0) continue;
    for (const m of members) claimed.add(m.id);
    groups.push({capability: cap.id, features: members, title: cap.title ?? cap.id});
  }
  const rest = entries.filter((e) => !claimed.has(e.id));
  if (rest.length > 0) {
    groups.push({capability: 'uncategorized', features: rest, title: 'Uncategorized'});
  }
  return groups;
}

function loadCapabilities(cwd: string): readonly Capability[] {
  const body = readWorktreeOrNull(cwd, join('spec', 'capabilities.yaml'));
  if (body === null) return [];
  try {
    const doc = parseYaml(body) as {capabilities?: readonly Capability[]};
    return Array.isArray(doc?.capabilities) ? doc.capabilities : [];
  } catch {
    return [];
  }
}

function inventoryCounts(specYamlBody: string | null): InventoryCounts {
  let inv: Record<string, unknown> = {};
  if (specYamlBody !== null) {
    try {
      const doc = parseYaml(specYamlBody) as {inventory?: Record<string, unknown>};
      if (doc && typeof doc.inventory === 'object' && doc.inventory !== null) inv = doc.inventory;
    } catch {
      /* unparseable historic spec.yaml → zeros */
    }
  }
  const count = (key: string): number => (typeof inv[key] === 'number' ? (inv[key] as number) : 0);
  return {
    capabilities: count('capabilities'),
    features: count('features'),
    scenarios: count('scenarios'),
    test_files: count('test_files'),
  };
}

/** Conventional-commit subject: feat/fix, optional scope, optional `!`. */
const CONVENTIONAL_FEAT_FIX = /^(feat|fix)(\([^)]*\))?!?:/;
/** Any internal feature id (sequential or hash form) named in the subject. */
const NAMES_FEATURE_ID = /\bF-(\d{3,}|[a-f0-9]{6,})\b/;

/**
 * User-visible commits that bypassed the spec: `feat:`/`fix:` subjects
 * touching src/ that name no F-id. Log order (newest first) is deterministic
 * for a fixed repo state.
 */
function unshardedCommits(cwd: string, sinceRef: string): UnshardedCommit[] {
  const raw = git(cwd, ['log', `${sinceRef}..HEAD`, '--format=%h%x09%s', '--', 'src/']);
  const out: UnshardedCommit[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const hash = line.slice(0, tab);
    const subject = line.slice(tab + 1);
    if (!CONVENTIONAL_FEAT_FIX.test(subject)) continue;
    if (NAMES_FEATURE_ID.test(subject)) continue;
    out.push({hash, subject});
  }
  return out;
}
