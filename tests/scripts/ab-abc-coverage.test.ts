// Cladding · tests for scripts/ab-abc/coverage.yaml — the 0.10.0 coverage ledger
//
// The release notes claim every 0.10.0 change was checked. This suite is what
// makes that a fact rather than a sentence: it reads the release notes, the
// coverage ledger, the side-table rows and the feature entries, and fails when
// the mapping between them stops holding — a new bullet with no entry, a
// reworded heads-up sentence the ledger no longer quotes, a feature entry that
// is not done, or a row id nobody wrote.
//
// It is deliberately static. No engine, no fixtures under ~/abc-0100, no git
// tags, no network: the campaign's raw results live outside this repository and
// would make the check unrunnable in CI, which is exactly where a coverage claim
// needs to be checked.

import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parse} from 'yaml';
import {describe, expect, test} from 'vitest';

const REPO = process.cwd();
const LEDGER_PATH = join(REPO, 'scripts', 'ab-abc', 'coverage.yaml');
const EXPECTATIONS_PATH = join(REPO, 'scripts', 'ab-abc', 'expectations.yaml');
const FEATURES_DIR = join(REPO, 'spec', 'features');

interface LedgerEntry {
  readonly rows?: readonly string[];
  readonly host_probe?: boolean;
  readonly not_a_scenario?: string;
  readonly note?: string;
}

interface Ledger {
  readonly pending_rows?: readonly string[];
  readonly changelog: Record<string, LedgerEntry>;
  readonly heads_up: Record<string, LedgerEntry>;
  readonly features: Record<string, LedgerEntry>;
}

/** The 0.10.0 release-note section, up to the next released version's heading. */
function releaseSection(): string {
  const raw = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8');
  const start = raw.indexOf('## [0.10.0]');
  expect(start, 'CHANGELOG.md carries a 0.10.0 section').toBeGreaterThan(-1);
  const rest = raw.slice(start + '## [0.10.0]'.length);
  const end = rest.indexOf('\n## [');
  return end < 0 ? raw.slice(start) : raw.slice(start, start + '## [0.10.0]'.length + end);
}

/** Every bold lead of a bullet in that section — the items a reader sees. */
function boldLeads(section: string): readonly string[] {
  return [...section.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1] ?? '');
}

/** The heads-up paragraph, split where one sentence ends and the next begins. */
function headsUpSentences(section: string): readonly string[] {
  const line = section.split('\n').find((l) => l.startsWith('> Heads-up:'));
  expect(line, 'the 0.10.0 section carries a heads-up paragraph').toBeDefined();
  return (line ?? '').replace(/^> /, '').split(/(?<=\.)\s+(?=[A-Z])/);
}

const ledger = parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
const section = releaseSection();
const expectations = parse(readFileSync(EXPECTATIONS_PATH, 'utf8')) as {rows: readonly {readonly id: string}[]};
const knownRows = new Set(expectations.rows.map((r) => r.id));
const pendingRows = new Set(ledger.pending_rows ?? []);

const allEntries = (): readonly (readonly [string, LedgerEntry])[] => [
  ...Object.entries(ledger.changelog),
  ...Object.entries(ledger.heads_up),
  ...Object.entries(ledger.features),
];

describe('the 0.10.0 coverage ledger maps every released item', () => {
  test('every bold lead in the release notes has a ledger entry', () => {
    for (const lead of boldLeads(section)) {
      expect(Object.keys(ledger.changelog), `the release notes lead ${JSON.stringify(lead)} needs a coverage entry`)
        .toContain(lead);
    }
  });

  test('every changelog ledger key is a bold lead that still exists', () => {
    const leads = new Set(boldLeads(section));
    for (const key of Object.keys(ledger.changelog)) {
      expect(leads, `the ledger names ${JSON.stringify(key)}, which the release notes no longer say`).toContain(key);
    }
  });

  test('every heads-up sentence is quoted by at least one ledger entry', () => {
    const keys = Object.keys(ledger.heads_up);
    for (const sentence of headsUpSentences(section)) {
      const covered = keys.some((key) => sentence.includes(key));
      expect(covered, `no ledger entry quotes the heads-up sentence: ${JSON.stringify(sentence)}`).toBe(true);
    }
  });

  test('every heads-up ledger key is a verbatim fragment of the paragraph', () => {
    const paragraph = headsUpSentences(section).join(' ');
    for (const key of Object.keys(ledger.heads_up)) {
      expect(key.length, `the heads-up key ${JSON.stringify(key)} is too short to identify a sentence`)
        .toBeGreaterThanOrEqual(25);
      expect(paragraph, `the heads-up key ${JSON.stringify(key)} is no longer in the paragraph`).toContain(key);
    }
  });
});

describe('the ledger points only at things that exist', () => {
  test('every feature the ledger names exists as a completed spec entry', () => {
    const shards = readdirSync(FEATURES_DIR).filter((name) => name.endsWith('.yaml'));
    const byId = new Map<string, string>();
    for (const name of shards) {
      const body = readFileSync(join(FEATURES_DIR, name), 'utf8');
      const id = body.match(/^id:\s*(F-[0-9a-f]{3,8})\s*$/m)?.[1];
      if (id !== undefined) byId.set(id, body);
    }
    for (const id of Object.keys(ledger.features)) {
      const body = byId.get(id);
      expect(body, `the ledger names ${id}, which is not a spec entry`).toBeDefined();
      expect(body ?? '', `${id} is in the ledger but not done`).toMatch(/^status:\s*done\s*$/m);
    }
  });

  test('every row the ledger names is a side-table row or a declared pending one', () => {
    for (const [key, entry] of allEntries()) {
      for (const row of entry.rows ?? []) {
        const known = knownRows.has(row) || pendingRows.has(row);
        expect(known, `${JSON.stringify(key)} names row ${row}, which is in neither expectations.yaml nor pending_rows`)
          .toBe(true);
      }
    }
  });

  test('every entry carries rows, a host probe, or a reason it is not a scenario', () => {
    for (const [key, entry] of allEntries()) {
      const covered = (entry.rows ?? []).length > 0 || entry.host_probe === true || typeof entry.not_a_scenario === 'string';
      expect(covered, `${JSON.stringify(key)} claims nothing — it needs rows, host_probe, or not_a_scenario`).toBe(true);
    }
  });

  test('a reason for not being a scenario is written out, not left as a placeholder', () => {
    for (const [key, entry] of allEntries()) {
      if (entry.not_a_scenario === undefined) continue;
      expect(entry.not_a_scenario.trim().length, `${JSON.stringify(key)} gives no real reason`).toBeGreaterThan(40);
    }
  });
});
