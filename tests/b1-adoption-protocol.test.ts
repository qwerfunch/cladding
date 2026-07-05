// Cladding · B1 adoption observation protocol pins (F-e803c149)
//
// Dogfood self-check (sibling home: tests/readme-record-honesty.test.ts at the
// tests root). The adoption reducer (F-0023ba22) and report surface (F-1e7a10c3)
// produce a three-valued verdict, but a verdict without a written decision rule
// invites motivated reading. docs/b1-adoption-protocol.md IS that rule. These
// pins hold the doc to the exported thresholds (a constant change without a doc
// edit must fail), the observation window, the run recipe, the seeded first
// real data point, the bias caveats, and both branches of the 0.9 fork — plus
// the backlog gate pointer and the glossary definition that reference it.
//
// cladding-SELF pins (they read this repo's own docs), NOT shipped detectors.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';
import {B1_ADOPTION_THRESHOLDS} from '../src/events/session-report.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const PROTOCOL = 'docs/b1-adoption-protocol.md';
const VERDICTS = ['confirmed', 'not_confirmed', 'insufficient_data'];

describe('AC-538802ac · protocol doc fixes the B1 decision rule before the data is read', () => {
  test('the doc exists and heads with the protocol title', () => {
    expect(read(PROTOCOL), 'protocol title heading').toContain('# B1 adoption observation protocol');
  });

  test('all four thresholds are cited verbatim from B1_ADOPTION_THRESHOLDS (a constant bump without a doc edit fails)', () => {
    const doc = read(PROTOCOL);
    expect(doc, 'the doc names the constant it cites').toContain('B1_ADOPTION_THRESHOLDS');
    const entries = Object.entries(B1_ADOPTION_THRESHOLDS);
    expect(entries.length, 'exactly four confirmation gates').toBe(4);
    for (const [name, value] of entries) {
      // The doc renders each gate as a table row: `name` | `value` | gate.
      // The needle is built from the IMPORTED value, so a threshold change in
      // src/events/session-report.ts that skips the doc breaks this assertion.
      const cell = `\`${name}\` | \`${value}\``;
      expect(doc, `${name}=${value} must appear as a table cell pair`).toContain(cell);
    }
  });

  test('the three verdict values are all defined', () => {
    const doc = read(PROTOCOL);
    for (const v of VERDICTS) {
      expect(doc, `verdict value ${v}`).toContain(v);
    }
  });

  test('observation window requires 10 cladding-self plus 5 external completed cycles', () => {
    const doc = read(PROTOCOL);
    expect(doc, 'self-cycle floor').toContain('10 cladding-self completed cycles');
    expect(doc, 'external-cycle floor').toContain('5 external-project completed cycles');
  });

  test('runner and cadence: maintainer, weekly, release prep', () => {
    const doc = read(PROTOCOL);
    expect(doc, 'runner is the maintainer').toContain('maintainer');
    expect(doc, 'weekly cadence').toContain('weekly');
    expect(doc, 'release-prep cadence').toContain('release prep');
  });

  test('both run forms are documented — human --sessions and --json for the record', () => {
    const doc = read(PROTOCOL);
    expect(doc, 'human read form').toContain('clad measure --sessions');
    expect(doc, 'record form (JSON)').toContain('clad measure --sessions --json');
  });

  test('the append-only results table is seeded with the first real data point (row cells load-bearing)', () => {
    const doc = read(PROTOCOL);
    const seeded = doc.split('\n').find((l) => l.includes('2026-07-05') && l.includes('cladding-self'));
    expect(seeded, 'the seeded 2026-07-05 cladding-self row is present').toBeDefined();
    expect(seeded ?? '', 'the seeded row records the not_confirmed verdict').toContain('not_confirmed');
  });

  test('bias caveats: per-machine locality, 5 MB single-generation rotation, silent-vs-unwired', () => {
    const doc = read(PROTOCOL);
    expect(doc, 'per-machine locality caveat').toContain('Per-machine locality');
    expect(doc, '5 MB single-generation rotation caveat').toContain('5 MB single-generation rotation');
    expect(doc, 'silent-vs-unwired reading rule').toContain('Silent vs unwired');
  });

  test('the fork: confirmed proceeds to the 0.9 deprecation, not_confirmed is wiring/push and never more capability', () => {
    const doc = read(PROTOCOL);
    expect(doc, 'confirmed branch leads to the B1 deprecation').toContain('proceed with the B1 deprecation');
    expect(doc, 'not_confirmed branch names the wiring/push lever').toContain('wiring / push improvement');
    // "**not** adding more\n  capability" wraps a line, so tolerate the bold
    // markers and whitespace between the words. The load-bearing clause is
    // "the next lever is NOT more capability", not the exact wrapping.
    expect(doc, 'not_confirmed lever is explicitly NOT more capability').toMatch(/not\W+adding\s+more\s+capability/);
  });
});

describe('AC-8753c264 · the backlog B1 row is gated on the protocol doc', () => {
  test('refinement-backlog.md B1 row points at docs/b1-adoption-protocol.md', () => {
    const backlog = read('docs/refinement-backlog.md');
    const b1Row = backlog.split('\n').find((l) => l.startsWith('| B1 |'));
    expect(b1Row, 'the B1 row is present in the backlog table').toBeDefined();
    expect(b1Row ?? '', 'the B1 row names the deprecation it gates').toContain('clad_get_context');
    expect(b1Row ?? '', 'the B1 row references the protocol doc as its gate').toContain('docs/b1-adoption-protocol.md');
  });
});

describe('AC-d2182432 · the glossary defines the adoption verdict and links the protocol', () => {
  test('glossary.md defines pull-vs-push, the three verdict values, and points at the protocol doc', () => {
    const glossary = read('docs/glossary.md');
    const row = glossary.split('\n').find((l) => l.startsWith('| `adoption verdict`'));
    expect(row, 'the adoption verdict glossary row is present').toBeDefined();
    const entry = row ?? '';
    expect(entry, 'the pull signal is named').toContain('pull');
    expect(entry, 'the push signal is named').toContain('push');
    for (const v of VERDICTS) {
      expect(entry, `verdict value ${v} in the glossary row`).toContain(v);
    }
    expect(entry, 'the glossary row links the protocol doc').toContain('docs/b1-adoption-protocol.md');
  });
});
