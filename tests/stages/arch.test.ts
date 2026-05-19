// Cladding · unit tests for stages/arch.ts (stage_1.5)
//
// Thin adapter over the ARCHITECTURE_VIOLATION detector. The stage
// folds the detector's findings into an Ironclad StageResult:
//   - zero error-severity findings  → pass=true, exitCode=0
//   - at least one error finding    → pass=false, exitCode=1, stderr joins messages
//   - info findings only            → pass=true (info < error)
//
// Detector internals are mocked via vi.mock so this suite tests only
// the adapter's findings-to-result transformation. Real subprocess
// coverage lives in conformance fixtures (stage_1.5.pass/fail).

import {describe, expect, test, vi, beforeEach} from 'vitest';

vi.mock('../../stages/detectors/architecture-violation.js', () => ({
  architectureViolation: {
    name: 'ARCHITECTURE_VIOLATION',
    run: vi.fn(),
  },
}));

const {runArch} = await import('../../stages/arch.js');
const detectorMod = await import('../../stages/detectors/architecture-violation.js');
const detectorRun = detectorMod.architectureViolation.run as unknown as ReturnType<typeof vi.fn>;

describe('runArch (stage_1.5)', () => {
  beforeEach(() => {
    detectorRun.mockReset();
  });

  test('detector returns no findings → pass=true', () => {
    detectorRun.mockReturnValueOnce([]);
    const r = runArch();
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stage).toBe('stage_1.5');
    expect(r.stderr).toBeUndefined();
  });

  test('detector returns only info findings → pass=true (info < error)', () => {
    detectorRun.mockReturnValueOnce([
      {detector: 'ARCHITECTURE_VIOLATION', severity: 'info', message: 'no validator registered'},
    ]);
    const r = runArch();
    expect(r.pass).toBe(true);
    expect(r.stderr).toBeUndefined();
  });

  test('detector returns one error → pass=false, exitCode=1, stderr is the message', () => {
    detectorRun.mockReturnValueOnce([
      {
        detector: 'ARCHITECTURE_VIOLATION',
        severity: 'error',
        message: 'circular dependency a -> b -> a',
      },
    ]);
    const r = runArch();
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('circular dependency a -> b -> a');
  });

  test('detector returns multiple errors → stderr joins all messages with newlines', () => {
    detectorRun.mockReturnValueOnce([
      {detector: 'ARCHITECTURE_VIOLATION', severity: 'error', message: 'first violation'},
      {detector: 'ARCHITECTURE_VIOLATION', severity: 'error', message: 'second violation'},
    ]);
    const r = runArch();
    expect(r.pass).toBe(false);
    expect(r.stderr).toBe('first violation\nsecond violation');
  });

  test('mixed error and info → only error messages reach stderr', () => {
    detectorRun.mockReturnValueOnce([
      {detector: 'ARCHITECTURE_VIOLATION', severity: 'info', message: 'note'},
      {detector: 'ARCHITECTURE_VIOLATION', severity: 'error', message: 'real problem'},
    ]);
    const r = runArch();
    expect(r.pass).toBe(false);
    expect(r.stderr).toBe('real problem');
  });

  test('opts forwarded to detector', () => {
    detectorRun.mockReturnValueOnce([]);
    runArch({cwd: '/some/path'});
    expect(detectorRun).toHaveBeenCalledWith({cwd: '/some/path'});
  });
});
