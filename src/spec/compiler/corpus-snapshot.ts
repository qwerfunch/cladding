// Cladding · Spec 0.2 F1 · independent source-YAML corpus scanner.

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

import {LineCounter, parseDocument} from 'yaml';

/** Exact source span emitted by the independent scanner. */
export interface SnapshotSourceRange {
  /** Inclusive UTF-16 source offset. */
  readonly start: number;
  /** Exclusive UTF-16 source offset. */
  readonly end: number;
  /** One-based source line. */
  readonly line: number;
  /** One-based source column. */
  readonly column: number;
}

/** Source locator stored in the committed oracle. */
export interface SnapshotSourceLocator {
  /** Repository-relative source artifact. */
  readonly path: string;
  /** YAML path within the source artifact. */
  readonly yamlPath: string;
  /** Exact source span. */
  readonly range: SnapshotSourceRange;
}

/** Semantic owner record scanned directly from YAML. */
export interface SnapshotSemanticOwner {
  /** Canonical semantic address. */
  readonly address: string;
  /** Semantic owner; criteria are owned by their parent feature. */
  readonly owner: string;
  /** Source locator for the declared identifier. */
  readonly source: SnapshotSourceLocator;
}

/** Authored prerequisite record scanned directly from YAML. */
export interface SnapshotPrerequisite {
  /** Dependent feature address. */
  readonly feature: string;
  /** Required feature address. */
  readonly prerequisite: string;
  /** Source locator for the dependency scalar. */
  readonly source: SnapshotSourceLocator;
}

/** Derived reverse prerequisite record retained as a snapshot view. */
export interface SnapshotDependent {
  /** Prerequisite feature address. */
  readonly feature: string;
  /** Feature that depends on it. */
  readonly dependent: string;
  /** Source locator of the authored forward relation. */
  readonly source: SnapshotSourceLocator;
}

/** Multi-owner physical artifact record. */
export interface SnapshotArtifactOwner {
  /** Canonical physical artifact address. */
  readonly artifact: string;
  /** Every semantic owner; a scanner never chooses one silently. */
  readonly owners: readonly string[];
}

/** One legacy proof reference scanned without any production parser or graph closure. */
export interface SnapshotProofRecord {
  /** Composite criterion address. */
  readonly owner: string;
  /** Original reference channel. */
  readonly channel: 'test' | 'oracle' | 'evidence';
  /** Exact YAML string spelling. */
  readonly raw: string;
  /** Structural target address after deterministic normalization. */
  readonly normalizedTarget: string;
  /** Selector precision; selectors are absent unless the YAML spelled one. */
  readonly selector: {readonly precision: 'none' | 'fragment'; readonly value?: string};
  /** Structural file or script resolution only. */
  readonly resolution: 'resolved' | 'unresolved';
  /** Source locator for the reference scalar. */
  readonly source: SnapshotSourceLocator;
}

/** Derived census views generated from records rather than maintained as assertions. */
export interface SnapshotDerivedViews {
  /** Number of proof occurrences. */
  readonly proofOccurrences: number;
  /** Number of unique criterion/address proof tuples. */
  readonly uniqueCriterionProofAddresses: number;
  /** Number of structurally resolved proof records. */
  readonly resolvedProofs: number;
  /** Number of structurally unresolved proof records. */
  readonly unresolvedProofs: number;
}

/** Sorted independent snapshot committed as the F1 parity oracle. */
export interface IndependentCorpusSnapshot {
  /** Snapshot serialization schema. */
  readonly schema: 1;
  /** Source scanner protocol version. */
  readonly scanner: 'source-yaml-v1';
  /** Source semantic and proof records. */
  readonly records: {
    readonly semanticOwners: readonly SnapshotSemanticOwner[];
    readonly prerequisites: readonly SnapshotPrerequisite[];
    readonly dependents: readonly SnapshotDependent[];
    readonly artifactOwners: readonly SnapshotArtifactOwner[];
    readonly proofs: readonly SnapshotProofRecord[];
    readonly regressions: readonly SnapshotProofRecord[];
  };
  /**
   * Historic source bindings retained in the schema-0.2 migration receipt.
   *
   * They are intentionally outside `records`: the live 0.2 compiler graph
   * does not promote pre-migration bindings into authored supports edges.
   */
  readonly migrationProofs?: readonly SnapshotProofRecord[];
  /** Derived views recalculated every scan. */
  readonly derived: SnapshotDerivedViews;
}

interface ScannerDocument {
  readonly path: string;
  readonly document: ReturnType<typeof parseDocument>;
  readonly lineCounter: LineCounter;
  readonly value: unknown;
}

/**
 * Scans source YAML into sorted parity records without importing the production
 * loader, reverse index, GraphIR builder, or any graph query closure.
 *
 * @param cwd - Workspace root containing the source corpus.
 * @returns A byte-stable snapshot object suitable for committed JSON serialization.
 */
export function scanIndependentCorpus(cwd: string = '.'): IndependentCorpusSnapshot {
  const root = resolve(cwd);
  const master = readDocument(root, 'spec.yaml');
  const rootValue = objectOrNull(master.value);
  const schema = rootValue?.schema;
  if (!rootValue || (schema !== '0.1' && schema !== '0.2')) {
    throw new Error(`independent scanner requires schema 0.1 or 0.2, received ${JSON.stringify(schema)}`);
  }
  const semanticOwners: SnapshotSemanticOwner[] = [];
  const prerequisites: SnapshotPrerequisite[] = [];
  const artifactOwners = new Map<string, Set<string>>();
  const proofs: SnapshotProofRecord[] = [];

  if (objectOrNull(rootValue.project)) semanticOwners.push({address: 'project', owner: 'project', source: locate(master, ['project'])});
  const featureDocuments = childDocuments(root, master, rootValue.features, 'features');
  for (const document of featureDocuments) {
    scanFeatures(root, document, semanticOwners, prerequisites, artifactOwners, proofs, schema);
  }
  const scenarioDocuments = childDocuments(root, master, rootValue.scenarios, 'scenarios');
  for (const document of scenarioDocuments) scanScenarios(document, semanticOwners, artifactOwners);
  if (schema === '0.2') scanSchema02Catalogs(root, semanticOwners);

  const dependents = prerequisites.map((record): SnapshotDependent => ({
    feature: record.prerequisite,
    dependent: record.feature,
    source: record.source,
  }));
  const sortedProofs = sortRecords(proofs);
  const records = {
    semanticOwners: sortRecords(semanticOwners),
    prerequisites: sortRecords(prerequisites),
    dependents: sortRecords(dependents),
    artifactOwners: sortRecords([...artifactOwners.entries()].map(([artifact, owners]) => ({artifact, owners: [...owners].sort()}))),
    proofs: sortedProofs,
    regressions: sortRecords(sortedProofs.filter((proof) => proof.channel === 'test')),
  };
  return {
    schema: 1,
    scanner: 'source-yaml-v1',
    records,
    ...(schema === '0.2' ? {migrationProofs: scanMigrationProofs(root)} : {}),
    derived: {
      proofOccurrences: records.proofs.length,
      uniqueCriterionProofAddresses: new Set(records.proofs.map((proof) => `${proof.owner}|${proof.normalizedTarget}|${proof.raw}`)).size,
      resolvedProofs: records.proofs.filter((proof) => proof.resolution === 'resolved').length,
      unresolvedProofs: records.proofs.filter((proof) => proof.resolution === 'unresolved').length,
    },
  };
}

/** Returns canonical JSON bytes for a committed independent snapshot. */
export function serializeIndependentCorpusSnapshot(snapshot: IndependentCorpusSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Returns the SHA-256 digest of the canonical snapshot bytes. */
export function independentCorpusSnapshotDigest(snapshot: IndependentCorpusSnapshot): string {
  return createHash('sha256').update(serializeIndependentCorpusSnapshot(snapshot)).digest('hex');
}

function scanFeatures(
  root: string,
  document: ScannerDocument,
  semanticOwners: SnapshotSemanticOwner[],
  prerequisites: SnapshotPrerequisite[],
  artifactOwners: Map<string, Set<string>>,
  proofs: SnapshotProofRecord[],
  schema: '0.1' | '0.2',
): void {
  const value = objectOrNull(document.value);
  const records = document.path === 'spec.yaml' ? arrayOf(value?.features) : [value];
  records.forEach((record, index) => {
    const feature = objectOrNull(record);
    const prefix: readonly (string | number)[] = document.path === 'spec.yaml' ? ['features', index] : [];
    if (!feature || typeof feature.id !== 'string') return;
    const featureId = feature.id;
    const featureAddress = `feature:${featureId}`;
    semanticOwners.push({address: featureAddress, owner: featureAddress, source: locate(document, [...prefix, 'id'])});
    addArtifactOwner(artifactOwners, `artifact:${document.path}`, featureAddress);
    for (const [dependencyIndex, dependency] of strings(feature.depends_on).entries()) {
      prerequisites.push({feature: featureAddress, prerequisite: `feature:${dependency}`, source: locate(document, [...prefix, 'depends_on', dependencyIndex])});
    }
    for (const [moduleIndex, module] of strings(feature.modules).entries()) {
      addArtifactOwner(artifactOwners, `artifact:${normalPath(module)}`, featureAddress);
      void moduleIndex;
    }
    arrayOf(feature.acceptance_criteria).forEach((criterionRecord, criterionIndex) => {
      const criterion = objectOrNull(criterionRecord);
      if (!criterion || typeof criterion.id !== 'string') return;
      const criterionId = criterion.id;
      const criterionAddress = `criterion:${featureId}/${criterionId}`;
      const criterionPrefix = [...prefix, 'acceptance_criteria', criterionIndex];
      semanticOwners.push({address: criterionAddress, owner: featureAddress, source: locate(document, [...criterionPrefix, 'id'])});
      // Schema 0.2 preserves its authored oracle/evidence declarations as
      // structural supports. Historic pre-migration bindings remain below in
      // the receipt-only view, and inline test refs remain forbidden.
      // @see docs/design/spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir
      if (schema === '0.1') {
        scanReferences(root, document, criterionPrefix, criterionAddress, 'test', criterion.test_refs, proofs);
        scanReferences(root, document, criterionPrefix, criterionAddress, 'oracle', criterion.oracle_refs, proofs);
        scanReferences(root, document, criterionPrefix, criterionAddress, 'evidence', criterion.evidence_refs, proofs);
      } else {
        scanReferences(root, document, criterionPrefix, criterionAddress, 'oracle', criterion.oracle_refs, proofs);
        scanReferences(root, document, criterionPrefix, criterionAddress, 'evidence', criterion.evidence_refs, proofs);
      }
    });
  });
}

/** Scans the two schema-0.2 catalogs whose semantic nodes are not feature-owned. */
function scanSchema02Catalogs(root: string, semanticOwners: SnapshotSemanticOwner[]): void {
  const capabilitiesPath = 'spec/capabilities.yaml';
  if (existsSync(join(root, capabilitiesPath))) {
    const document = readDocument(root, capabilitiesPath);
    const catalog = objectOrNull(document.value);
    arrayOf(catalog?.capabilities).forEach((record, index) => {
      const capability = objectOrNull(record);
      if (typeof capability?.id !== 'string') return;
      const address = `capability:${capability.id}`;
      semanticOwners.push({address, owner: address, source: locate(document, ['capabilities', index, 'id'])});
    });
  }

  const architecturePath = 'spec/architecture.yaml';
  if (existsSync(join(root, architecturePath))) {
    const document = readDocument(root, architecturePath);
    const architecture = objectOrNull(document.value);
    arrayOf(architecture?.rules).forEach((record, index) => {
      const rule = objectOrNull(record);
      if (typeof rule?.id !== 'string') return;
      const address = `architecture_rule:${rule.id}`;
      semanticOwners.push({address, owner: address, source: locate(document, ['rules', index, 'id'])});
    });
  }
}

/**
 * Reads historic proof bindings directly from the migration receipt.
 *
 * This remains an independent YAML scan: it deliberately does not load the
 * compiler, consumer projection, proof resolver, or legacy-binding adapter.
 */
function scanMigrationProofs(root: string): readonly SnapshotProofRecord[] {
  const path = 'spec/generated/migration-baseline-0.1-to-0.2.yaml';
  if (!existsSync(join(root, path))) return [];
  const document = readDocument(root, path);
  const baseline = objectOrNull(document.value);
  const proofs: SnapshotProofRecord[] = [];
  arrayOf(baseline?.criteria).forEach((criterionRecord, criterionIndex) => {
    const criterion = objectOrNull(criterionRecord);
    if (criterion === null) return;
    const {address: owner, bindings} = criterion;
    if (typeof owner !== 'string') return;
    arrayOf(bindings).forEach((bindingRecord, bindingIndex) => {
      const binding = objectOrNull(bindingRecord);
      const channel = binding?.channel;
      const raw = binding?.raw;
      if ((channel !== 'test' && channel !== 'oracle' && channel !== 'evidence') || typeof raw !== 'string') return;
      const normalized = normalizeReference(root, raw);
      proofs.push({
        owner,
        channel,
        raw,
        normalizedTarget: normalized.target,
        selector: normalized.selector,
        resolution: normalized.resolution,
        source: locate(document, ['criteria', criterionIndex, 'bindings', bindingIndex, 'raw']),
      });
    });
  });
  return sortRecords(proofs);
}

function scanScenarios(
  document: ScannerDocument,
  semanticOwners: SnapshotSemanticOwner[],
  artifactOwners: Map<string, Set<string>>,
): void {
  const value = objectOrNull(document.value);
  const records = document.path === 'spec.yaml' ? arrayOf(value?.scenarios) : [value];
  records.forEach((record, index) => {
    const scenario = objectOrNull(record);
    if (!scenario || typeof scenario.id !== 'string') return;
    const id = scenario.id;
    const address = `scenario:${id}`;
    const prefix: readonly (string | number)[] = document.path === 'spec.yaml' ? ['scenarios', index] : [];
    semanticOwners.push({address, owner: address, source: locate(document, [...prefix, 'id'])});
    addArtifactOwner(artifactOwners, `artifact:${document.path}`, address);
  });
}

function scanReferences(
  root: string,
  document: ScannerDocument,
  criterionPrefix: readonly (string | number)[],
  owner: string,
  channel: SnapshotProofRecord['channel'],
  values: unknown,
  proofs: SnapshotProofRecord[],
): void {
  for (const [index, raw] of strings(values).entries()) {
    const normalized = normalizeReference(root, raw);
    proofs.push({
      owner,
      channel,
      raw,
      normalizedTarget: normalized.target,
      selector: normalized.selector,
      resolution: normalized.resolution,
      source: locate(document, [...criterionPrefix, `${channel}_refs`, index]),
    });
  }
}

function normalizeReference(root: string, raw: string): {
  readonly target: string;
  readonly selector: SnapshotProofRecord['selector'];
  readonly resolution: SnapshotProofRecord['resolution'];
} {
  const hash = raw.indexOf('#');
  const rawPath = (hash < 0 ? raw : raw.slice(0, hash)).trim();
  const selectorValue = hash < 0 ? undefined : raw.slice(hash + 1);
  const selector = selectorValue === undefined || selectorValue.length === 0
    ? {precision: 'none' as const}
    : {precision: 'fragment' as const, value: selectorValue};
  if (rawPath.startsWith('fixture:')) {
    const name = rawPath.slice('fixture:'.length);
    if (registeredFixtureNames(root).has(name)) {
      return {target: `anchor:conformance/fixtures.yaml#${name}`, selector, resolution: 'resolved'};
    }
    return {target: `artifact:${rawPath}`, selector, resolution: 'unresolved'};
  }
  if (rawPath.startsWith('script:') || rawPath.startsWith('self-dogfood:')) {
    const prefix = rawPath.startsWith('script:') ? 'script:' : 'self-dogfood:';
    const name = rawPath.slice(prefix.length);
    if (packageScriptNames(root).has(name)) {
      return {target: `anchor:package.json#scripts.${name}`, selector, resolution: 'resolved'};
    }
    return {target: `artifact:${rawPath}`, selector, resolution: 'unresolved'};
  }
  if (rawPath.startsWith('derived:')) {
    return {target: `artifact:${rawPath}`, selector, resolution: 'unresolved'};
  }
  const path = normalPath(rawPath);
  const target = selector.precision === 'fragment' ? `anchor:${path}#${selector.value}` : `artifact:${path}`;
  return {
    target,
    selector,
    resolution: isPortableStructuralTarget(path) && existsSync(join(root, path)) ? 'resolved' : 'unresolved',
  };
}

/**
 * Keeps exact local workspace outputs out of portable proof closure without
 * importing the production artifact registry.
 */
function isPortableStructuralTarget(path: string): boolean {
  return ![
    '.cladding/audit',
    '.cladding/cache/spec-compiler',
  ].some((transientRoot) => path === transientRoot || path.startsWith(`${transientRoot}/`));
}

function childDocuments(root: string, master: ScannerDocument, inline: unknown, directory: 'features' | 'scenarios'): readonly ScannerDocument[] {
  if (Array.isArray(inline) && inline.length > 0) return [master];
  const path = join(root, 'spec', directory);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map((name) => readDocument(root, join('spec', directory, name)));
}

function readDocument(root: string, path: string): ScannerDocument {
  const absolute = join(root, path);
  const lineCounter = new LineCounter();
  const document = parseDocument(readFileSync(absolute, 'utf8'), {lineCounter});
  return {path: normalPath(relative(root, absolute)), document, lineCounter, value: document.toJS()};
}

/** Reads exact fixture names directly from the independent YAML registry. */
function registeredFixtureNames(root: string): ReadonlySet<string> {
  const path = 'conformance/fixtures.yaml';
  if (!existsSync(join(root, path))) return new Set<string>();
  const registry = objectOrNull(readDocument(root, path).value);
  return new Set(
    arrayOf(registry?.fixtures)
      .map((fixture) => objectOrNull(fixture)?.name)
      .filter((name): name is string => typeof name === 'string'),
  );
}

/** Reads exact package-script keys without importing a production package reader. */
function packageScriptNames(root: string): ReadonlySet<string> {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return new Set<string>();
  const packageValue = objectOrNull(JSON.parse(readFileSync(path, 'utf8')));
  const scripts = objectOrNull(packageValue?.scripts);
  return new Set(Object.entries(scripts ?? {})
    .filter(([, value]) => typeof value === 'string')
    .map(([name]) => name));
}

function locate(document: ScannerDocument, parts: readonly (string | number)[]): SnapshotSourceLocator {
  const node = document.document.getIn(parts, true) as unknown as {readonly range?: readonly number[]} | undefined;
  const start = node?.range?.[0] ?? 0;
  const end = node?.range?.[1] ?? start;
  const position = document.lineCounter.linePos(start);
  return {
    path: document.path,
    yamlPath: parts.length === 0 ? '$' : `$${parts.map((part) => typeof part === 'number' ? `[${part}]` : `.${part}`).join('')}`,
    range: {start, end, line: position.line, column: position.col},
  };
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): readonly string[] {
  return arrayOf(value).filter((entry): entry is string => typeof entry === 'string');
}

function addArtifactOwner(owners: Map<string, Set<string>>, artifact: string, owner: string): void {
  let records = owners.get(artifact);
  if (!records) {
    records = new Set();
    owners.set(artifact, records);
  }
  records.add(owner);
}

function normalPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`independent scanner path must be repository-relative: ${path}`);
  }
  return normalized;
}

function sortRecords<T>(records: readonly T[]): readonly T[] {
  return [...records].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
