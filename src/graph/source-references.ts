// Cladding · Spec 0.2 F8 · bounded authored source-reference GraphIR facts.

import {lstatSync, readFileSync, type Stats} from 'node:fs';
import {join} from 'node:path';
import {TextDecoder} from 'node:util';

import {resolveArtifactDescriptors} from '../spec/compiler/artifact-registry.js';
import {anchorAddress} from '../spec/compiler/graph-address.js';
import type {
  GraphIrV2Augmentation,
  GraphIrV2AugmentationNode,
  GraphIrV2StructuralEdge,
} from '../spec/compiler/graph-ir-v2.js';
import type {GraphNode, SpecCompilation} from '../spec/compiler/types.js';

const LAYER_ID = 'source-references';
const EXCLUDED_AUTHORITIES = new Set(['generated', 'transient', 'evidence', 'migration']);

/** A source navigation hint that is deliberately outside graph identity. */
export interface SourceReferenceLocation {
  /** One-based physical line in the source artifact. */
  readonly line: number;
  /** One-based physical column in the source artifact. */
  readonly column: number;
}

/** A static, comment-authored source reference before GraphIR materialization. */
export interface SourceReferenceRecord {
  /** Canonical source artifact path. */
  readonly sourcePath: string;
  /** Exact authored spelling, including the `@see` carrier. */
  readonly raw: string;
  /** Canonical target selected only from the compiler snapshot. */
  readonly normalizedTarget: string;
  /** Structural target state. */
  readonly state: 'resolved' | 'unresolved';
  /** Stable selector made from canonical fact content and its duplicate ordinal. */
  readonly selector: string;
  /** Navigation-only source position. */
  readonly location: SourceReferenceLocation;
}

/** A source carrier that cannot safely become a complete GraphIR fact. */
export interface SourceReferenceIssue {
  /** Machine-readable source-reference reconciliation class. */
  readonly code: 'FEATURE_ONLY' | 'NONCANONICAL_FEATURE_PATH' | 'UNKNOWN_FEATURE_SHARD' | 'UNKNOWN_CRITERION';
  /** Canonical source artifact that carried the issue. */
  readonly sourcePath: string;
  /** Exact authored carrier spelling. */
  readonly raw: string;
  /** Navigation-only source position. */
  readonly location: SourceReferenceLocation;
  /** Stable selector made from the carrier content and duplicate ordinal. */
  readonly selector: string;
  /** Parsed feature-shard spelling when it is safe to retain. */
  readonly featurePath?: string;
  /** Canonical target spelling when a known shard has an absent criterion. */
  readonly normalizedTarget?: string;
}

/**
 * An eligible bounded source artifact that could not be scanned without
 * following unsafe state. Directory ownership artifacts are inapplicable and
 * never appear in this fail-closed list.
 */
export interface SourceReferenceUnknownFile {
  /** Canonical source artifact path. */
  readonly path: string;
  /** Stable failure class without exposing OS-specific error text. */
  readonly reason: 'missing' | 'unreadable' | 'invalid_utf8' | 'symlink' | 'not_file';
}

/** One immutable compiler-bounded source-reference census. */
export interface SourceReferenceScan {
  /** Registered criterion-bearing source references. */
  readonly records: readonly SourceReferenceRecord[];
  /** Registered carriers that require later strict reconciliation. */
  readonly issues: readonly SourceReferenceIssue[];
  /** Source authority artifacts that were unsafe or unavailable to scan. */
  readonly unknownFiles: readonly SourceReferenceUnknownFile[];
  /** Explicit scan state; no failed read can become an empty success. */
  readonly completeness: 'complete' | 'unknown';
  /** Stable explanations for an incomplete scan. */
  readonly unknownReasons: readonly string[];
}

interface ParsedCarrier {
  readonly rawPath: string;
  readonly criteria: readonly string[];
  readonly raw: string;
  readonly location: SourceReferenceLocation;
}

interface UnselectedSourceReferenceRecord {
  readonly sourcePath: string;
  readonly raw: string;
  readonly normalizedTarget: string;
  readonly state: 'resolved' | 'unresolved';
  readonly occurrenceKey: string;
  readonly location: SourceReferenceLocation;
}

type SourceReadResult =
  | {readonly text: string}
  | {readonly inapplicable: true}
  | {readonly reason: SourceReferenceUnknownFile['reason']};

/** The minimal file boundary used by the bounded scanner. */
export interface SourceReferenceFileSystem {
  /** Inspects one already-bounded path without resolving symbolic links. */
  readonly lstat: (path: string) => Stats;
  /** Reads one already-checked regular file as raw bytes. */
  readonly readFile: (path: string) => Buffer;
}

const LOCAL_FILE_SYSTEM: SourceReferenceFileSystem = Object.freeze({
  lstat: lstatSync,
  readFile: readFileSync,
});

/**
 * Scans only compiler-enumerated source artifacts for registered `@see`
 * carriers. It does not walk the workspace, follow links, read feature YAML,
 * or infer a target from a nearby feature.
 *
 * @param cwd - Workspace root that bounds every lstat and read operation.
 * @param compilation - Immutable compiler snapshot providing source authority and target locators.
 * @param fileSystem - Bounded file operations; the default reads only local workspace paths.
 * @returns One frozen source-reference census for exactly this compilation.
 * @see docs/design/spec-0.2/graph.md#documents-and-source-references
 */
export function scanSourceReferences(
  cwd: string,
  compilation: SpecCompilation,
  fileSystem: SourceReferenceFileSystem = LOCAL_FILE_SYSTEM,
): SourceReferenceScan {
  const sourcePaths = sourceAuthorityPaths(compilation);
  const targets = sourceTargets(compilation);
  const records: UnselectedSourceReferenceRecord[] = [];
  const issues: SourceReferenceIssue[] = [];
  const unknownFiles: SourceReferenceUnknownFile[] = [];

  for (const sourcePath of sourcePaths) {
    const readable = readSafeSourceText(cwd, sourcePath, fileSystem);
    if ('inapplicable' in readable) continue;
    if ('reason' in readable) {
      unknownFiles.push(Object.freeze({path: sourcePath, reason: readable.reason}));
      continue;
    }
    for (const carrier of parseCommentCarriers(readable.text)) {
      const feature = targets.featuresByPath.get(carrier.rawPath);
      if (!feature) {
        issues.push(Object.freeze({
          code: 'UNKNOWN_FEATURE_SHARD', sourcePath, raw: carrier.raw, location: carrier.location,
          selector: '',
          ...(isCanonicalFeaturePath(carrier.rawPath) ? {featurePath: carrier.rawPath} : {}),
        }));
        continue;
      }
      if (carrier.criteria.length === 0) {
        issues.push(Object.freeze({
          code: 'FEATURE_ONLY', sourcePath, raw: carrier.raw, location: carrier.location, featurePath: carrier.rawPath,
          selector: '',
        }));
        continue;
      }
      const targetsByAddress = new Map<string, 'resolved' | 'unresolved'>();
      for (const criterion of carrier.criteria) {
        const normalizedTarget = `criterion:${feature}/${criterion}`;
        const state = targets.criteriaByPath.get(carrier.rawPath)?.has(normalizedTarget) ? 'resolved' : 'unresolved';
        targetsByAddress.set(normalizedTarget, state);
      }
      const occurrenceKey = JSON.stringify([
        sourcePath,
        `feature:${feature}`,
        [...targetsByAddress.keys()].sort(),
      ]);
      for (const [normalizedTarget, state] of [...targetsByAddress.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        records.push({
          sourcePath,
          raw: carrier.raw,
          normalizedTarget,
          state,
          occurrenceKey,
          location: carrier.location,
        });
        if (state === 'unresolved') {
          issues.push(Object.freeze({
            code: 'UNKNOWN_CRITERION', sourcePath, raw: carrier.raw, location: carrier.location,
            selector: '', featurePath: carrier.rawPath, normalizedTarget,
          }));
        }
      }
    }
    for (const carrier of parseNoncanonicalFeatureCarriers(readable.text)) {
      issues.push(Object.freeze({
        code: 'NONCANONICAL_FEATURE_PATH', sourcePath, raw: carrier.raw, location: carrier.location,
        selector: '',
      }));
    }
  }

  const withSelectors = addStableSelectors(records);
  const sortedIssues = addStableIssueSelectors(issues, withSelectors);
  const sortedUnknownFiles = [...unknownFiles].sort((left, right) => left.path.localeCompare(right.path));
  const unknownReasons = [
    ...sortedUnknownFiles.map((unknown) => `source artifact ${unknown.path} is ${unknown.reason}`),
    ...sortedIssues.map(issueReason),
  ];
  return freezeScan({
    records: withSelectors,
    issues: sortedIssues,
    unknownFiles: sortedUnknownFiles,
    completeness: unknownReasons.length === 0 ? 'complete' : 'unknown',
    unknownReasons,
  });
}

/**
 * Converts one caller-owned source scan into authored `traces_to` facts while
 * preserving compiler artifact identity and an explicit incomplete state.
 *
 * @param compilation - Canonical compiler snapshot supplying existing artifacts and criteria.
 * @param scan - One bounded scan supplied by the workspace query boundary.
 * @returns Immutable source-reference augmentation; compiler records stay untouched.
 * @see docs/design/spec-0.2/graph.md#documents-and-source-references
 */
export function sourceReferenceAugmentation(
  compilation: SpecCompilation,
  scan: SourceReferenceScan,
): GraphIrV2Augmentation {
  const artifacts = new Set(compilation.nodes
    .filter((node): node is Extract<GraphNode, {readonly nodeType: 'artifact'}> => node.nodeType === 'artifact')
    .map((node) => node.address));
  const nodes: GraphIrV2AugmentationNode[] = [];
  const edges: GraphIrV2StructuralEdge[] = [];
  const anchors = new Set<string>();
  const unknownReasons = [...scan.unknownReasons];
  for (const record of scan.records) {
    const artifact = `artifact:${record.sourcePath}`;
    if (!artifacts.has(artifact)) {
      unknownReasons.push(`compiler source artifact is absent: ${record.sourcePath}`);
      continue;
    }
    const anchor = anchorAddress(record.sourcePath, record.selector);
    const locator = Object.freeze({kind: 'text_source' as const, path: record.sourcePath, selector: record.selector});
    if (!anchors.has(anchor)) {
      anchors.add(anchor);
      nodes.push(Object.freeze({
        address: anchor,
        nodeType: 'anchor' as const,
        artifact,
        selector: record.selector,
        selectorProvenance: 'authored' as const,
        provenance: 'authored' as const,
        locator,
      }));
    }
    edges.push(Object.freeze({
      identity: `source-reference:${anchor}->${record.normalizedTarget}`,
      from: anchor,
      to: record.normalizedTarget,
      relation: 'traces_to' as const,
      provenance: 'authored' as const,
      owner: locator,
      state: record.state,
      raw: record.raw,
      normalizedTarget: record.normalizedTarget,
      selector: Object.freeze({precision: 'fragment' as const, value: record.selector}),
    }));
    if (record.state === 'unresolved') {
      unknownReasons.push(`source reference target is unresolved: ${record.normalizedTarget}`);
    }
  }
  for (const issue of scan.issues) {
    const artifact = `artifact:${issue.sourcePath}`;
    if (!artifacts.has(artifact)) {
      unknownReasons.push(`compiler source artifact is absent: ${issue.sourcePath}`);
      continue;
    }
    const anchor = anchorAddress(issue.sourcePath, issue.selector);
    if (anchors.has(anchor)) continue;
    anchors.add(anchor);
    const locator = Object.freeze({kind: 'text_source' as const, path: issue.sourcePath, selector: issue.selector});
    nodes.push(Object.freeze({
      address: anchor,
      nodeType: 'anchor' as const,
      artifact,
      selector: issue.selector,
      selectorProvenance: 'authored' as const,
      provenance: 'authored' as const,
      locator,
    }));
  }
  const reasons = [...new Set(unknownReasons)].sort();
  return freezeLayer({
    layerId: LAYER_ID,
    nodes: nodes.sort((left, right) => left.address.localeCompare(right.address)),
    edges: edges.sort((left, right) => left.identity.localeCompare(right.identity)),
    completeness: reasons.length === 0 ? 'complete' : 'unknown',
    unknownReasons: reasons,
  });
}

function sourceAuthorityPaths(compilation: SpecCompilation): readonly string[] {
  const paths = compilation.nodes
    .filter((node): node is Extract<GraphNode, {readonly nodeType: 'artifact'}> => node.nodeType === 'artifact')
    .filter((node) => node.roles.includes('source'))
    .map((node) => node.address.slice('artifact:'.length))
    .filter((path) => !resolveArtifactDescriptors(path).some((descriptor) => EXCLUDED_AUTHORITIES.has(descriptor.authority)));
  return Object.freeze([...new Set(paths)].sort());
}

function sourceTargets(compilation: SpecCompilation): {
  readonly featuresByPath: ReadonlyMap<string, string>;
  readonly criteriaByPath: ReadonlyMap<string, ReadonlySet<string>>;
} {
  const featuresByPath = new Map<string, string>();
  const criteriaByPath = new Map<string, Set<string>>();
  for (const node of compilation.nodes) {
    if (node.nodeType !== 'semantic') continue;
    if (node.kind === 'feature' && isCanonicalFeaturePath(node.source.path)) {
      featuresByPath.set(node.source.path, node.address.slice('feature:'.length));
    }
    if (node.kind === 'criterion' && isCanonicalFeaturePath(node.source.path)) {
      const criteria = criteriaByPath.get(node.source.path) ?? new Set<string>();
      criteria.add(node.address);
      criteriaByPath.set(node.source.path, criteria);
    }
  }
  return {featuresByPath, criteriaByPath};
}

function readSafeSourceText(
  cwd: string,
  sourcePath: string,
  fileSystem: SourceReferenceFileSystem,
): SourceReadResult {
  let current = cwd;
  try {
    if (fileSystem.lstat(current).isSymbolicLink()) return {reason: 'symlink'};
  } catch {
    return {reason: 'unreadable'};
  }
  const segments = sourcePath.split('/');
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let stat: Stats;
    try {
      stat = fileSystem.lstat(current);
    } catch (error) {
      return {reason: isMissingError(error) ? 'missing' : 'unreadable'};
    }
    if (stat.isSymbolicLink()) return {reason: 'symlink'};
    if (index !== segments.length - 1) continue;
    if (stat.isDirectory()) return {inapplicable: true};
    if (!stat.isFile()) return {reason: 'not_file'};
  }
  try {
    return {text: new TextDecoder('utf-8', {fatal: true}).decode(fileSystem.readFile(current))};
  } catch (error) {
    if (isMissingError(error)) return {reason: 'missing'};
    return {reason: isUtf8Error(error) ? 'invalid_utf8' : 'unreadable'};
  }
}

function isMissingError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as {readonly code?: unknown}).code === 'ENOENT';
}

function isUtf8Error(error: unknown): boolean {
  return error instanceof TypeError && /utf-8/i.test(error.message);
}

function parseCommentCarriers(text: string): readonly ParsedCarrier[] {
  const carriers: ParsedCarrier[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const comment = commentText(lines[index]!);
    if (!comment) continue;
    const match = /@see\s+([^\s]+)/.exec(comment.text);
    if (!match || !isCanonicalFeaturePath(match[1]!)) continue;
    const rawPath = match[1]!;
    const criteria = criterionIds(comment.text.slice((match.index ?? 0) + match[0].length));
    const rawLines = [comment.raw];
    let last = index;
    while (last + 1 < lines.length) {
      const continuation = commentText(lines[last + 1]!);
      if (!continuation || !/^AC-[A-Za-z0-9][A-Za-z0-9._-]*\b/.test(continuation.text.trimStart())) break;
      criteria.push(...criterionIds(continuation.text));
      rawLines.push(continuation.raw);
      last++;
    }
    carriers.push({
      rawPath,
      criteria,
      raw: rawLines.join('\n'),
      location: {line: index + 1, column: comment.contentColumn + (match.index ?? 0)},
    });
  }
  return carriers;
}

function parseNoncanonicalFeatureCarriers(text: string): readonly ParsedCarrier[] {
  const carriers: ParsedCarrier[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    const comment = commentText(line);
    if (!comment) continue;
    const match = /@see\s+([^\s]+)/.exec(comment.text);
    if (!match || isCanonicalFeaturePath(match[1]!) || !looksLikeFeaturePath(match[1]!)) continue;
    carriers.push({
      rawPath: match[1]!,
      criteria: [],
      raw: comment.raw,
      location: {line: index + 1, column: comment.contentColumn + (match.index ?? 0)},
    });
  }
  return carriers;
}

function commentText(rawLine: string): {readonly text: string; readonly raw: string; readonly contentColumn: number} | undefined {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  const match = /^(\s*)(?:\/\/\/?|\/\*+|\*|#|--)(\s?)(.*)$/.exec(line);
  if (!match) return undefined;
  const content = match[3] ?? '';
  return {
    text: content,
    raw: rawLine,
    contentColumn: line.length - content.length + 1,
  };
}

function criterionIds(text: string): string[] {
  return [...text.matchAll(/\b(AC-[A-Za-z0-9][A-Za-z0-9._-]*)\b/g)].map((match) => match[1]!);
}

function isCanonicalFeaturePath(path: string): boolean {
  return /^spec\/features\/[^/\\]+\.ya?ml$/.test(path);
}

function looksLikeFeaturePath(path: string): boolean {
  return /(?:^|[./\\])spec(?:[/\\])features(?:[/\\])/.test(path)
    || /^spec[/\\]features(?:[/\\]|$)/.test(path)
    || path.includes('spec/features/')
    || path.includes('spec\\features\\');
}

function addStableSelectors(records: readonly UnselectedSourceReferenceRecord[]): readonly SourceReferenceRecord[] {
  const byKey = new Map<string, UnselectedSourceReferenceRecord[]>();
  for (const record of records) {
    const matching = byKey.get(record.occurrenceKey) ?? [];
    matching.push(record);
    byKey.set(record.occurrenceKey, matching);
  }
  const selected: SourceReferenceRecord[] = [];
  for (const [key, matching] of byKey) {
    const byOccurrence = new Map<string, UnselectedSourceReferenceRecord[]>();
    for (const record of matching) {
      const occurrence = `${record.location.line}\u0000${record.location.column}`;
      const facts = byOccurrence.get(occurrence) ?? [];
      facts.push(record);
      byOccurrence.set(occurrence, facts);
    }
    const occurrences = [...byOccurrence.values()].sort((left, right) =>
      left[0]!.location.line - right[0]!.location.line || left[0]!.location.column - right[0]!.location.column);
    for (const [ordinal, facts] of occurrences.entries()) {
      for (const record of facts) {
        selected.push(Object.freeze({
          sourcePath: record.sourcePath,
          raw: record.raw,
          normalizedTarget: record.normalizedTarget,
          state: record.state,
          selector: `source-reference:${key}:${ordinal + 1}`,
          location: record.location,
        }));
      }
    }
  }
  return Object.freeze(selected.sort((left, right) =>
    left.selector.localeCompare(right.selector) || left.normalizedTarget.localeCompare(right.normalizedTarget)));
}

function addStableIssueSelectors(
  issues: readonly SourceReferenceIssue[],
  records: readonly SourceReferenceRecord[],
): readonly SourceReferenceIssue[] {
  const recordSelectors = new Map(records.map((record) => [
    `${record.sourcePath}\u0000${record.raw}\u0000${record.normalizedTarget}\u0000${record.location.line}\u0000${record.location.column}`,
    record.selector,
  ]));
  const byKey = new Map<string, SourceReferenceIssue[]>();
  for (const issue of issues) {
    const key = JSON.stringify([issue.sourcePath, issue.code, issue.raw, issue.normalizedTarget ?? '']);
    const matching = byKey.get(key) ?? [];
    matching.push(issue);
    byKey.set(key, matching);
  }
  const selected: SourceReferenceIssue[] = [];
  for (const [key, matching] of byKey) {
    matching.sort((left, right) => left.location.line - right.location.line || left.location.column - right.location.column);
    for (const [ordinal, issue] of matching.entries()) {
      const recordKey = `${issue.sourcePath}\u0000${issue.raw}\u0000${issue.normalizedTarget ?? ''}\u0000${issue.location.line}\u0000${issue.location.column}`;
      selected.push(Object.freeze({
        ...issue,
        selector: recordSelectors.get(recordKey) ?? `source-reference-issue:${key}:${ordinal + 1}`,
      }));
    }
  }
  return Object.freeze(selected.sort(compareIssue));
}

function compareIssue(left: SourceReferenceIssue, right: SourceReferenceIssue): number {
  return left.sourcePath.localeCompare(right.sourcePath)
    || left.location.line - right.location.line
    || left.location.column - right.location.column
    || left.code.localeCompare(right.code)
    || left.raw.localeCompare(right.raw);
}

function issueReason(issue: SourceReferenceIssue): string {
  const target = issue.normalizedTarget ? `: ${issue.normalizedTarget}` : '';
  return `source reference ${issue.code} at ${issue.sourcePath}:${issue.location.line}:${issue.location.column}${target}`;
}

function freezeScan(scan: SourceReferenceScan): SourceReferenceScan {
  return Object.freeze({
    ...scan,
    records: Object.freeze(scan.records.map((record) => Object.freeze({
      ...record,
      location: Object.freeze({...record.location}),
    }))),
    issues: Object.freeze(scan.issues.map((issue) => Object.freeze({
      ...issue,
      location: Object.freeze({...issue.location}),
    }))),
    unknownFiles: Object.freeze(scan.unknownFiles.map((unknown) => Object.freeze({...unknown}))),
    unknownReasons: Object.freeze([...scan.unknownReasons]),
  });
}

function freezeLayer(layer: GraphIrV2Augmentation): GraphIrV2Augmentation {
  return Object.freeze({
    ...layer,
    nodes: Object.freeze([...layer.nodes]),
    edges: Object.freeze([...layer.edges]),
    unknownReasons: Object.freeze([...layer.unknownReasons]),
  });
}
