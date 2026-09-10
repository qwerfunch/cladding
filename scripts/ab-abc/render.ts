// Cladding · scripts/ab-abc/render.ts — score.json[] + sidetable.json → markdown
//
// Renders exactly what the scorer recorded, in three groups: what each arm
// produced, what it cost, and how the harness behaved. Every group shows both a
// per-run row and a median row — with n of 1 to 3, a summary that hides the
// spread is a summary that lies. Medians rather than means, because one
// budget-capped cell would otherwise move the number further than the treatment.
//
// Arm A has no engine, so its harness columns render as `—` rather than zero:
// "not applicable" and "none happened" are different facts.
//
// The report is one call: score.json lives per cell under `<root>/artifacts/`
// and the side-table under `<root>/results/`, so rendering takes the campaign
// ROOT and reads both. Pointing it at `results/` alone used to produce a report
// with no cells in it and no complaint.
//
// Usage: npx tsx scripts/ab-abc/render.ts [abc-root] [--out report.md]
//        (root defaults to $ABC_ROOT, then ~/abc-0100)

import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';

import type {CellScore} from './score.js';

/** One row of the deterministic L0/L3 side-table (sidetable.ts's output). */
interface SideRow {
  readonly id: string;
  readonly fixtureFamily: string;
  readonly question: string;
  readonly b: string;
  readonly c: string;
  readonly expectation: string;
  readonly verdict: string;
}

interface SideTable {
  readonly generatedAt: string;
  readonly rows: readonly SideRow[];
}

const median = (values: readonly number[]): number | null => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const fmt = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

const yn = (value: boolean | null | undefined): string => (value === null || value === undefined ? '—' : value ? 'yes' : 'no');

/** `—` for arm A wherever a measure only exists because an engine does. */
const armed = (score: CellScore, value: string): string => (score.arm === 'A' ? '—' : value);

function collectScores(root: string): CellScore[] {
  const found: CellScore[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) queue.push(abs);
      else if (name === 'score.json') found.push(JSON.parse(readFileSync(abs, 'utf8')) as CellScore);
    }
  }
  return found.sort((a, b) => `${a.arm}${a.cell}`.localeCompare(`${b.arm}${b.cell}`));
}

// ── group 1 · what each arm produced ────────────────────────────────────────
function renderProduct(scores: readonly CellScore[]): string {
  const rows = [
    '| Arm | Cell | src LoC | files | tsc | lint e/w | cx max/mean | `any` | API | comment/code | tests | asserts | AC titled | negative | skip | cov % | oracle |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of scores) {
    const api = [
      s.code.apiConformance.slugifyExported ? 'export' : '—',
      s.code.apiConformance.signatureMatches ? 'sig' : '—',
      s.code.apiConformance.extendsError ? 'err' : '—',
      s.code.errorClassNamed ? 'named' : '—',
    ].join('/');
    rows.push(
      `| ${s.arm} | ${s.cell} | ${s.code.locSrc} | ${s.code.srcFiles} | ${yn(s.code.tscClean)} | ` +
        `${s.code.lintErrors ?? '—'}/${s.code.lintWarnings ?? '—'} | ${s.code.complexityMax ?? '—'}/${fmt(s.code.complexityMean, 1)} | ` +
        `${s.code.anyCount} | ${api} | ${fmt(s.code.commentDensity, 2)} | ${s.tests.testCount ?? '—'} | ${s.tests.assertionCount} | ` +
        `${s.tests.acTitled.length}/3 | ${yn(s.tests.negativeTestPresent)} | ${s.tests.skipOrOnly} | ${fmt(s.tests.coverageLinesPct, 1)} | ` +
        `${s.tests.blindOracle.passed ?? '—'}/${s.tests.blindOracle.total ?? '—'} |`,
    );
  }
  return rows.join('\n');
}

// ── group 2 · time, tokens, cost ────────────────────────────────────────────
function renderCost(scores: readonly CellScore[]): string {
  const rows = [
    '| Arm | Cell | Wall s | API s | Turns | To first edit s | In | Out | Cache read | Cache write | Thinking | Total tok | Cache ratio | Cost (est.) | Aux model $ | Static instr. tok |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of scores) {
    rows.push(
      `| ${s.arm} | ${s.cell} | ${fmt(s.time.wallMs === null ? null : s.time.wallMs / 1000, 0)} | ` +
        `${fmt(s.time.durationApiMs === null ? null : s.time.durationApiMs / 1000, 0)} | ${s.time.numTurns ?? '—'} | ` +
        `${fmt(s.time.timeToFirstEditMs === null ? null : s.time.timeToFirstEditMs / 1000, 0)} | ` +
        `${s.tokens.input} | ${s.tokens.output} | ${s.tokens.cacheRead} | ${s.tokens.cacheCreation} | ${s.tokens.thinking} | ` +
        `${s.tokens.total} | ${fmt(s.tokens.cacheReadRatio, 2)} | $${fmt(s.tokens.totalCostUsd)} | $${fmt(s.tokens.secondaryModelCostUsd)} | ${s.tokens.staticInstructionTokens} |`,
    );
  }
  return rows.join('\n');
}

// ── group 3 · gates, friction, spec artifacts ───────────────────────────────
function renderHarness(scores: readonly CellScore[]): string {
  const rows = [
    '| Arm | Cell | Engaged | Honest done | Hand-flip | Binding | Gate runs | Red→green | Judge exit | Failed stages | Tools | MCP tools | Tool errors | Denials | Red loop | Commits | Clean tree | Shards | Criteria | Disqualifiers |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const s of scores) {
    rows.push(
      `| ${s.arm} | ${s.cell} | ${armed(s, yn(s.outcome.engaged))} | ${yn(s.outcome.completedHonest)} | ` +
        `${armed(s, yn(s.outcome.handFlip))} | ${s.outcome.bindingMode} | ${armed(s, String(s.extras.gateRuns))} | ` +
        `${armed(s, yn(s.extras.gateRedThenGreen))} | ${armed(s, String(s.outcome.judgeExit ?? '—'))} | ` +
        `${armed(s, s.outcome.judgeFailedStages.length === 0 ? '—' : s.outcome.judgeFailedStages.join(', '))} | ` +
        `${s.extras.toolCallsTotal} | ${armed(s, String(s.extras.toolCallsMcp))} | ${s.extras.toolErrors} | ${s.extras.permissionDenials} | ${yn(s.signals.honestRedLoop)} | ` +
        `${s.extras.gitCommits} | ${yn(s.extras.worktreeCleanAtEnd)} | ${armed(s, String(s.extras.specArtifacts.shards))} | ` +
        `${armed(s, String(s.extras.specArtifacts.criteria))} | ${s.disqualifiers.length === 0 ? '—' : s.disqualifiers.join('; ')} |`,
    );
  }
  return rows.join('\n');
}

function renderMedians(scores: readonly CellScore[]): string {
  const arms = [...new Set(scores.map((s) => s.arm))].sort();
  const rows = [
    '| Arm | n | Honest done | Engaged | Median cost (est.) | Median turns | Median wall s | Median out tok | Median total tok | Median src LoC | Median tests | Median cov % | Median oracle % |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const arm of arms) {
    const cells = scores.filter((s) => s.arm === arm);
    const honest = cells.filter((c) => c.outcome.completedHonest).length;
    const engaged = arm === 'A' ? '—' : `${cells.filter((c) => c.outcome.engaged).length}/${cells.length}`;
    const pick = (f: (c: CellScore) => number | null): number | null =>
      median(cells.map(f).filter((v): v is number => v !== null));
    rows.push(
      `| ${arm} | ${cells.length} | ${honest}/${cells.length} | ${engaged} | ` +
        `$${fmt(pick((c) => c.tokens.totalCostUsd))} | ${fmt(pick((c) => c.time.numTurns), 0)} | ` +
        `${fmt(pick((c) => (c.time.wallMs === null ? null : c.time.wallMs / 1000)), 0)} | ` +
        `${fmt(pick((c) => c.tokens.output), 0)} | ${fmt(pick((c) => c.tokens.total), 0)} | ` +
        `${fmt(pick((c) => c.code.locSrc), 0)} | ${fmt(pick((c) => c.tests.testCount), 0)} | ` +
        `${fmt(pick((c) => c.tests.coverageLinesPct), 1)} | ${fmt(pick((c) => c.tests.blindOracle.pct), 1)} |`,
    );
  }
  return rows.join('\n');
}

function renderSideTable(table: SideTable): string {
  return [
    `Generated ${table.generatedAt}.`,
    '',
    '| Row | Fixture family | Question | B (0.9.4) | C (0.10.0) | Expectation | Verdict |',
    '|---|---|---|---|---|---|---|',
    ...table.rows.map((r) => `| ${r.id} | ${r.fixtureFamily} | ${r.question} | ${r.b} | ${r.c} | ${r.expectation} | ${r.verdict} |`),
  ].join('\n');
}

const outFlagIndex = process.argv.indexOf('--out');
const outPath = outFlagIndex === -1 ? null : process.argv[outFlagIndex + 1];

const args = process.argv.slice(2);
const positional = args.filter((arg, i) => arg !== '--out' && args[i - 1] !== '--out');
const root = positional[0] ?? process.env.ABC_ROOT ?? join(homedir(), 'abc-0100');
const artifactsDir = join(root, 'artifacts');
// A missing artifacts/ almost always means a results/ directory was passed —
// the old invocation. Saying so beats rendering an empty report as if the
// campaign had simply not run any cells yet.
if (!existsSync(artifactsDir)) {
  throw new Error(
    `no artifacts directory under ${root} — render.ts takes the campaign root ` +
      '(it reads <root>/artifacts/**/score.json and <root>/results/sidetable.json), not the results directory',
  );
}

const scores = collectScores(artifactsDir);
const sidePath = join(root, 'results', 'sidetable.json');
const side = existsSync(sidePath) ? (JSON.parse(readFileSync(sidePath, 'utf8')) as SideTable) : null;
const empty = '_No scored cells yet._';

const rendered = `${[
  '## 1 · What each arm produced',
  '',
  scores.length === 0 ? empty : renderProduct(scores),
  '',
  'Code quality and the hidden oracle are **reported only** — pre-registered as not feeding the release verdict.',
  '',
  '## 2 · Time, tokens, cost',
  '',
  scores.length === 0 ? empty : renderCost(scores),
  '',
  'Cost is the host-reported list-price estimate for an OAuth session, not an amount billed.',
  '',
  '## 3 · Gates, friction, spec artifacts',
  '',
  scores.length === 0 ? empty : renderHarness(scores),
  '',
  '## Medians per arm',
  '',
  scores.length === 0 ? empty : renderMedians(scores),
  '',
  '## Deterministic side-table (no agent)',
  '',
  side === null ? '_No sidetable.json in this directory._' : renderSideTable(side),
  '',
].join('\n')}\n`;

if (outPath !== undefined && outPath !== null) writeFileSync(outPath, rendered);
else process.stdout.write(rendered);
