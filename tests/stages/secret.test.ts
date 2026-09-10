// Cladding · unit tests for stages/secret.ts (stage_1.6)
//
// Thin adapter over the HARDCODED_SECRET detector. Same shape as
// stages/arch.ts: zero error findings → pass; one or more errors →
// fail with joined stderr; info findings never fail.
//
// Detector internals are mocked via vi.mock. Real subprocess coverage
// lives in conformance fixtures (stage_1.6.pass/fail).

import {describe, expect, test, vi, beforeEach} from 'vitest';

vi.mock('../../src/stages/detectors/hardcoded-secret.js', () => ({
  hardcodedSecret: {
    name: 'HARDCODED_SECRET',
    run: vi.fn(),
  },
}));
vi.mock('../../src/stages/detector-result-cache.js', () => ({
  readDetectorResult: vi.fn(),
}));

const {runSecret} = await import('../../src/stages/secret.js');
const detectorMod = await import('../../src/stages/detectors/hardcoded-secret.js');
const detectorRun = detectorMod.hardcodedSecret.run as unknown as ReturnType<typeof vi.fn>;
const cacheMod = await import('../../src/stages/detector-result-cache.js');
const readDetectorResultMock = cacheMod.readDetectorResult as unknown as ReturnType<typeof vi.fn>;

describe('runSecret (stage_1.6)', () => {
  beforeEach(() => {
    detectorRun.mockReset();
    readDetectorResultMock.mockReset();
  });

  test('[covers:F-060/AC-145] cached secret findings preserve error severity and diagnostic order', () => {
    readDetectorResultMock.mockReturnValueOnce([
      {detector: 'HARDCODED_SECRET', severity: 'info', message: 'scanner context'},
      {detector: 'HARDCODED_SECRET', severity: 'error', message: 'first secret'},
      {detector: 'HARDCODED_SECRET', severity: 'error', message: 'second secret'},
    ]);

    const result = runSecret({cwd: '/cached-project'});

    expect(readDetectorResultMock).toHaveBeenCalledWith('HARDCODED_SECRET', '/cached-project');
    expect(detectorRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({stage: 'stage_1.6', pass: false, exitCode: 1});
    expect(result.stderr).toBe('first secret\nsecond secret');
  });

  test('detector returns no findings → pass=true', () => {
    detectorRun.mockReturnValueOnce([]);
    const r = runSecret();
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stage).toBe('stage_1.6');
  });

  test('detector returns only info → pass=true', () => {
    detectorRun.mockReturnValueOnce([
      {detector: 'HARDCODED_SECRET', severity: 'info', message: 'scanner not installed'},
    ]);
    expect(runSecret().pass).toBe(true);
  });

  test('detector returns one error → pass=false, stderr is the message', () => {
    detectorRun.mockReturnValueOnce([
      {
        detector: 'HARDCODED_SECRET',
        severity: 'error',
        message: 'secretlint reported: api_key at config.ts:5',
      },
    ]);
    const r = runSecret();
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('api_key');
  });

  test('multiple errors → stderr joins with newlines', () => {
    detectorRun.mockReturnValueOnce([
      {detector: 'HARDCODED_SECRET', severity: 'error', message: 'leak 1'},
      {detector: 'HARDCODED_SECRET', severity: 'error', message: 'leak 2'},
    ]);
    const r = runSecret();
    expect(r.stderr).toBe('leak 1\nleak 2');
  });

  test('mixed error + info → only error messages in stderr', () => {
    detectorRun.mockReturnValueOnce([
      {detector: 'HARDCODED_SECRET', severity: 'info', message: 'tool noted'},
      {detector: 'HARDCODED_SECRET', severity: 'error', message: 'leak'},
    ]);
    const r = runSecret();
    expect(r.stderr).toBe('leak');
  });

  test('[covers:F-060/AC-145] uncached secret checks forward supplied options to the detector', () => {
    detectorRun.mockReturnValueOnce([]);
    runSecret({cwd: '/p', cmd: 'mysecret', args: ['scan']});
    expect(detectorRun).toHaveBeenCalledWith({cwd: '/p', cmd: 'mysecret', args: ['scan']});
  });
});
