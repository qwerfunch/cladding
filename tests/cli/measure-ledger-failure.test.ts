// Cladding · F-39609db4 — `clad measure` treats ledger persistence as telemetry.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const appendSnapshot = vi.fn(() => ({appended: false, reason: 'error' as const}));

vi.mock('../../src/spec/load.js', () => ({loadSpec: vi.fn(() => ({features: []}))}));
vi.mock('../../src/optimizer/measurement.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/optimizer/measurement.js')>();
  return {
    ...actual,
    measureGraphEfficiency: vi.fn(() => ({
      featureCount: 1,
      measured: 1,
      context: {
        medianContextRatio: 1,
        medianShrinkFactor: 1,
        fitsCount: 1,
        truncatedCount: 0,
        medianShrinkFit: 1,
        medianShrinkTruncated: 0,
        medianStructuralRatio: 1,
        medianSliceTokens: 10,
        medianNaiveTokens: 10,
      },
      search: {medianDepth: 1, p95Depth: 1, medianEdges: 0, maxEdges: 0},
      stability: {byStopReason: {}, medianCoverage: 1, medianRegressionTests: 0},
      features: [],
    })),
  };
});
vi.mock('../../src/optimizer/measure-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/optimizer/measure-ledger.js')>();
  return {...actual, appendMeasureSnapshot: appendSnapshot};
});

const {createProgram, runMeasureCommand} = await import('../../src/cli/clad.js');

describe('clad measure ledger persistence failure', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let exit: ReturnType<typeof vi.spyOn>;
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    appendSnapshot.mockClear();
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    stdout.mockRestore();
    exit.mockRestore();
  });

  test('[covers:F-39609db4/AC-2c4f07d8] a ledger persistence failure still emits the measure report and exits zero', () => {
    runMeasureCommand();

    expect(appendSnapshot).toHaveBeenCalledTimes(1);
    expect(chunks.join('')).toContain('graph efficiency · 1/1 features');
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('[covers:F-1e9ef827/AC-815591d4] default clad measure keeps its complete report bytes and zero exit across the extraction', () => {
    runMeasureCommand();

    expect(chunks.join('')).toBe([
      'graph efficiency · 1/1 features',
      '  context: working-set 10 tok vs naive 10 tok — no feature hit the budget cap, 1x on 1 fitting',
      '           uncapped structural slice = 1x of naive — the value is the guaranteed budget + wired needs/breaks/verify, not raw shrink',
      '  search:  median 1 hop(s) resolved (p95 1), median 0 edge(s)/feature (max hub 0)',
      '  stability: median blast-radius coverage 1, median 0 regression test(s) surfaced; stops {}',
      '  (deterministic upper bound vs the shard+all-modules baseline — not an agent-adoption measurement)',
      '',
    ].join('\n'));
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('registers measure and prints the efficiency report', async () => {
    await createProgram().parseAsync(['measure'], {from: 'user'});

    expect(chunks.join('')).toBe([
      'graph efficiency · 1/1 features',
      '  context: working-set 10 tok vs naive 10 tok — no feature hit the budget cap, 1x on 1 fitting',
      '           uncapped structural slice = 1x of naive — the value is the guaranteed budget + wired needs/breaks/verify, not raw shrink',
      '  search:  median 1 hop(s) resolved (p95 1), median 0 edge(s)/feature (max hub 0)',
      '  stability: median blast-radius coverage 1, median 0 regression test(s) surfaced; stops {}',
      '  (deterministic upper bound vs the shard+all-modules baseline — not an agent-adoption measurement)',
      '',
    ].join('\n'));
    expect(exit).toHaveBeenCalledWith(0);
  });
});
