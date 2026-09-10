// Cladding · unit tests for cli/spec linkCapability (the accumulative capability-link upsert)
//
// linkCapability(opts) is an UPSERT, not a create-new: it links a feature into a
// capability inside the single spec/capabilities.yaml, creating the capability (and
// the file) when absent. It preserves the file header + schema/source and re-emits
// only the capabilities: block. Authored from the behavioral contract — the
// implementation in src/spec/new.ts is intentionally NOT read (anti-self-cert).

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {parse as parseYaml} from 'yaml';

import {linkCapability} from '../../src/spec/new.js';
import {loadSpec} from '../../src/spec/load.js';

// A minimal valid spec.yaml so loadSpec(cwd) can resolve + schema-validate the
// emitted capabilities.yaml. Features are empty — CAPABILITIES_FEATURE_MAPPING
// is a detector concern, not a loadSpec-time invariant.
const SEED_SPEC = 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n';

function seed(dir: string): void {
  writeFileSync(join(dir, 'spec.yaml'), SEED_SPEC, 'utf8');
  mkdirSync(join(dir, 'spec'), {recursive: true});
}

/** Path to the single accumulative capabilities file. */
function capPath(dir: string): string {
  return join(dir, 'spec', 'capabilities.yaml');
}

/** Parse capabilities.yaml back into its { schema, source, capabilities } wrapper. */
function readCaps(dir: string): {capabilities?: Array<Record<string, unknown>>} {
  return parseYaml(readFileSync(capPath(dir), 'utf8'));
}

describe('linkCapability — accumulative upsert (J2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-link-cap-'));
    seed(dir);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  // 1 — no file yet: creates capabilities.yaml with the capability + feature.
  test('[covers:F-836a90/AC-001] no capabilities.yaml → creates it with the capability containing the feature', () => {
    const r = linkCapability({capability: 'authentication', feature: 'F-001', cwd: dir});
    expect(r.created).toBe(true);
    expect(r.alreadyLinked).toBe(false);
    expect(r.capability).toBe('authentication');
    expect(r.feature).toBe('F-001');
    expect(existsSync(capPath(dir))).toBe(true);

    const parsed = readCaps(dir);
    expect(parsed.capabilities).toHaveLength(1);
    expect(parsed.capabilities![0].id).toBe('authentication');
    expect(parsed.capabilities![0].features).toContain('F-001');
  });

  // 2 — file exists, brand-new capability id: appends a new capability entry.
  test('existing file, new capability id → created:true, both capabilities present', () => {
    linkCapability({capability: 'authentication', feature: 'F-001', cwd: dir});
    const r = linkCapability({capability: 'billing', feature: 'F-a1b2c3', cwd: dir});
    expect(r.created).toBe(true);
    expect(r.alreadyLinked).toBe(false);

    const parsed = readCaps(dir);
    const ids = (parsed.capabilities ?? []).map((c) => c.id);
    expect(ids).toContain('authentication');
    expect(ids).toContain('billing');
  });

  // 3 — capability present, feature NOT yet linked: appends the feature.
  test('[covers:F-836a90/AC-001] existing capability + new feature → created:false, alreadyLinked:false; features[] has both in order', () => {
    linkCapability({capability: 'authentication', feature: 'F-001', cwd: dir});
    const r = linkCapability({capability: 'authentication', feature: 'F-a1b2c3', cwd: dir});
    expect(r.created).toBe(false);
    expect(r.alreadyLinked).toBe(false);

    const parsed = readCaps(dir);
    const cap = (parsed.capabilities ?? []).find((c) => c.id === 'authentication');
    expect(cap).toBeDefined();
    expect(cap!.features).toEqual(['F-001', 'F-a1b2c3']);
  });

  // 4 — capability present, feature already linked: idempotent, no duplicate.
  test('[covers:F-836a90/AC-001] existing capability + already-linked feature → alreadyLinked:true; feature appears exactly once', () => {
    linkCapability({capability: 'authentication', feature: 'F-001', cwd: dir});
    const r = linkCapability({capability: 'authentication', feature: 'F-001', cwd: dir});
    expect(r.created).toBe(false);
    expect(r.alreadyLinked).toBe(true);

    const parsed = readCaps(dir);
    const cap = (parsed.capabilities ?? []).find((c) => c.id === 'authentication');
    const features = (cap!.features as string[]) ?? [];
    expect(features.filter((f) => f === 'F-001')).toHaveLength(1);
  });

  // 5 — invalid capability slug throws.
  test.each([['Auth Bang!'], ['F-001'], ['-leading'], ['UPPER'], ['']])(
    'throws on invalid capability id %s',
    (capability) => {
      expect(() => linkCapability({capability, feature: 'F-001', cwd: dir})).toThrow();
    },
  );

  // 6 — invalid feature id throws.
  test.each([['not-a-feature'], ['F-00'], ['feature-1'], ['F-XYZ'], ['']])(
    'throws on invalid feature id %s',
    (feature) => {
      expect(() => linkCapability({capability: 'authentication', feature, cwd: dir})).toThrow();
    },
  );

  // 7 — title/surface applied only on create; a later append does not overwrite the title.
  test('title+surface written on create; a later append with a different title does NOT change the stored title', () => {
    linkCapability({
      capability: 'authentication',
      feature: 'F-001',
      title: 'User Authentication',
      surface: 'feature',
      cwd: dir,
    });
    let parsed = readCaps(dir);
    let cap = (parsed.capabilities ?? []).find((c) => c.id === 'authentication');
    expect(cap!.title).toBe('User Authentication');
    expect(cap!.surface).toBe('feature');

    // Append a second feature with a DIFFERENT title — must be ignored on upsert.
    linkCapability({
      capability: 'authentication',
      feature: 'F-a1b2c3',
      title: 'Totally Different Title',
      surface: 'platform',
      cwd: dir,
    });
    parsed = readCaps(dir);
    cap = (parsed.capabilities ?? []).find((c) => c.id === 'authentication');
    expect(cap!.title).toBe('User Authentication');
    expect(cap!.surface).toBe('feature');
    expect(cap!.features).toEqual(['F-001', 'F-a1b2c3']);
  });

  // 8 — schema validity: loadSpec resolves the capability + its features (proves the
  // emitted YAML validates against the J2 schema).
  test('[covers:F-836a90/AC-003] after a link, loadSpec(dir).capabilities resolves the capability and its features', () => {
    linkCapability({capability: 'authentication', feature: 'F-001', cwd: dir});
    linkCapability({capability: 'authentication', feature: 'F-a1b2c3', cwd: dir});

    const spec = loadSpec(dir);
    expect(spec.capabilities).toBeDefined();
    const cap = (spec.capabilities ?? []).find((c) => c.id === 'authentication');
    expect(cap).toBeDefined();
    expect(cap!.features).toEqual(['F-001', 'F-a1b2c3']);
  });

  // 9 — header preservation: a distinctive leading comment survives a re-emit.
  test('a pre-existing distinctive header comment is preserved after a link', () => {
    const preExisting =
      '# my custom header\n' +
      'schema: "0.1"\n' +
      'source: hand-authored\n' +
      'capabilities:\n' +
      '  - id: billing\n' +
      '    title: Billing\n' +
      '    features:\n' +
      '      - F-bbbbbb\n';
    writeFileSync(capPath(dir), preExisting, 'utf8');

    linkCapability({capability: 'authentication', feature: 'F-001', cwd: dir});

    const raw = readFileSync(capPath(dir), 'utf8');
    expect(raw).toContain('# my custom header');

    // And the prior capability is still there alongside the new one.
    const parsed = readCaps(dir);
    const ids = (parsed.capabilities ?? []).map((c) => c.id);
    expect(ids).toContain('billing');
    expect(ids).toContain('authentication');
  });
});
