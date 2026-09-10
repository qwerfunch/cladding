// Cladding · strict-gate integration for host-claim evidence (F-5283985e).
//
// This exercises the public gate boundary with the real drift stage and the
// real registered detector. The other pre-commit runners are inert so their
// toolchain availability cannot obscure whether a warn becomes a strict fail.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/stages/type.js', () => ({runType: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/lint.js', () => ({runLint: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/arch.js', () => ({runArch: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: () => ({pass: true, exitCode: 0})}));

const [{runCheckStages}, {clearDetectors, registerDetector}, {allDetectors}, {hostClaimDrift}] = await Promise.all([
  import('../../src/cli/clad.js'),
  import('../../src/stages/drift.js'),
  import('../../src/stages/detectors/index.js'),
  import('../../src/stages/detectors/host-claim-drift.js'),
]);

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-host-claim-gate-'));
  writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: probe, language: typescript}\nfeatures: []\n');
  mkdirSync(join(dir, 'docs', 'dogfood'), {recursive: true});
  writeFileSync(join(dir, 'README.md'), '<!-- clad:host-claims {"codex":"verified"} -->\n');
  writeFileSync(
    join(dir, 'docs', 'dogfood', 'matrix.md'),
    [
      '# Host matrix',
      `- Generated: ${new Date().toISOString()}`,
      '- Cladding version: `9999.0.0`',
      '<!-- clad:matrix-grades {"codex":"fail"} -->',
      '',
    ].join('\n'),
  );
  clearDetectors();
  registerDetector(hostClaimDrift);
});

afterEach(() => {
  clearDetectors();
  for (const detector of allDetectors) registerDetector(detector);
  if (dir) rmSync(dir, {recursive: true, force: true});
});

describe('strict host-claim gate', () => {
  test('[covers:F-5283985e/AC-922cd29d] a README host claim exceeding the newest matrix is a named divergence warning that fails strict check', () => {
    const origin = process.cwd();
    process.chdir(dir);
    try {
      const result = runCheckStages({tier: 'pre-commit', strict: true, silent: true});
      const drift = result.stages?.find((stage) => stage.stage === 'stage_1.3');
      const finding = drift?.findings?.find((entry) => entry.detector === 'HOST_CLAIM_DRIFT');

      expect(result).toMatchObject({worst: 1, anyFailed: true});
      expect(drift).toMatchObject({status: 'fail', exitCode: 1});
      expect(finding).toMatchObject({severity: 'warn', path: 'README.md'});
      expect(finding?.message).toContain('codex');
      expect(finding?.message).toContain('exceeds the evidence');
    } finally {
      process.chdir(origin);
    }
  });
});
