// Cladding · scenarios · ab · focused drift-injection proofs (F-ba2e05)

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const detectorState = vi.hoisted(() => ({mutated: new Set<string>()}));

vi.mock('../../../src/stages/detectors/index.js', () => ({
  allDetectors: [
    {
      name: 'MUTATION_WATCH',
      run: ({cwd = '.'}: {readonly cwd?: string}) =>
        detectorState.mutated.has(cwd)
          ? [{detector: 'MUTATION_WATCH', severity: 'warn' as const, message: 'named mutation observed'}]
          : [],
    },
  ],
}));

const {
  captureDriftCatch,
  makeArchitectureViolationDrift,
  makeHardcodedSecretDrift,
  makeStaleReferenceDrift,
  makeUnverifiedCriterionDrift,
} = await import('./_drift-injection.js');

describe('A/B drift injection (F-ba2e05)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-ab-drift-'));
    detectorState.mutated.clear();
  });

  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
  });

  test('[covers:F-ba2e05/AC-001] constructs a stale-reference drift', () => {
    mkdirSync(join(cwd, 'src'), {recursive: true});
    writeFileSync(join(cwd, 'src', 'before.ts'), 'export const before = true;\n');

    makeStaleReferenceDrift('src/before.ts', 'src/after.ts').apply(cwd);

    expect(existsSync(join(cwd, 'src', 'before.ts'))).toBe(false);
    expect(existsSync(join(cwd, 'src', 'after.ts'))).toBe(true);
  });

  test('[covers:F-ba2e05/AC-e25d101e] constructs an architecture-violation drift', () => {
    mkdirSync(join(cwd, 'src', 'api'), {recursive: true});
    writeFileSync(join(cwd, 'src', 'api', 'refund.ts'), '// module\nexport const refund = true;\n');

    makeArchitectureViolationDrift('src/api/refund.ts', '../ledger/store.js').apply(cwd);

    expect(readFileSync(join(cwd, 'src', 'api', 'refund.ts'), 'utf8')).toContain('import {forbidden} from "../ledger/store.js";');
  });

  test('[covers:F-ba2e05/AC-32ce46c4] constructs a hardcoded-secret drift', () => {
    mkdirSync(join(cwd, 'src'), {recursive: true});
    writeFileSync(join(cwd, 'src', 'refund.ts'), 'export const refund = true;\n');

    makeHardcodedSecretDrift('src/refund.ts').apply(cwd);

    expect(readFileSync(join(cwd, 'src', 'refund.ts'), 'utf8')).toContain('LEAKED_API_KEY');
  });

  test('[covers:F-ba2e05/AC-f121d0b9] constructs an unverified-criterion drift', () => {
    mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
    writeFileSync(join(cwd, 'spec', 'features', 'refund.yaml'), 'id: F-refund\nacceptance_criteria: []\n');

    makeUnverifiedCriterionDrift('spec/features/refund.yaml', 'AC-003', 'Refunds shall support partial amounts.').apply(cwd);

    expect(readFileSync(join(cwd, 'spec', 'features', 'refund.yaml'), 'utf8')).toContain('id: AC-003');
  });

  test('[covers:F-ba2e05/AC-a0e59911] captures a deterministic before-and-after diff around one named mutation', () => {
    const result = captureDriftCatch(cwd, 'A', {
      id: 'DI-1',
      name: 'single named mutation',
      apply: (target) => {
        detectorState.mutated.add(target);
        writeFileSync(join(target, 'named-mutation.txt'), 'one\n');
      },
    });

    expect(result.scenarioName).toBe('single named mutation');
    expect(result.newFindings).toEqual([
      {detector: 'MUTATION_WATCH', severity: 'warn', message: 'named mutation observed', path: undefined},
    ]);
    expect(result.newDetectors).toEqual(['MUTATION_WATCH']);
  });
});
