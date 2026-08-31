import {mkdtempSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import * as path from 'node:path';
import {describe, it, expect, vi} from 'vitest';

import type {Spec} from '../../src/spec/types.js';
import {computeVerdict, type VerdictOutcome, type VerdictStage} from '../../src/verdict/verdict.js';

vi.mock('../../src/spec/load.js', () => ({loadSpec: vi.fn()}));

const specMod = await import('../../src/spec/load.js');
const loadSpecMock = specMod.loadSpec as unknown as ReturnType<typeof vi.fn>;
const {runVerdictCommand} = await import('../../src/cli/verdict.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// `clad verdict` computes over the SAME gate `clad done` uses (AC4). That gate
// re-runs the whole suite (this file included), so invoking it here sets a
// nesting guard; the nested run skips this test and the gate cannot recurse.
const NEST_GUARD = 'CLAD_VERDICT_CONTRACT_NESTED';
const isNested = process.env[NEST_GUARD] === '1';

const KINDS = ['DONE', 'ITERATE', 'ESCALATE', 'BLOCKED', 'BOOTSTRAP'];

function extractJson(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    /* fall through: tolerate leading log lines before the JSON body */
  }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(t.slice(first, last + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

describe('F-2e28cc72 clad verdict — CLI contract (AC4/AC5)', () => {
  it('[covers:F-2e28cc72/AC-eb5de98c] in-process handler emits machine JSON and the pure reducer is deterministic for the same input', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'clad-verdict-contract-'));
    const originalCwd = process.cwd();
    const chunks: string[] = [];
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    const spec: Spec = {
      schema: '0.1',
      project: {name: 'verdict-contract', language: 'typescript'},
      features: [{id: 'F-done', slug: 'done', title: 'done', status: 'done'}],
    };
    const outcome: VerdictOutcome = {
      worst: 0,
      anyFailed: false,
      stages: [{stage: 'stage_2.1', label: 'unit', status: 'pass', exitCode: 0} as VerdictStage],
    };
    const checkStages = vi.fn(() => outcome);

    try {
      process.chdir(cwd);
      loadSpecMock.mockReset();
      loadSpecMock.mockReturnValue(spec);
      runVerdictCommand({json: true}, {checkStages});

      const pureInput = {outcome, spec};
      const first = computeVerdict(pureInput);
      const second = computeVerdict(pureInput);
      const emitted = JSON.parse(chunks.join('')) as Record<string, unknown>;
      expect(first).toEqual(second);
      expect(emitted).toMatchObject(first);
      expect(checkStages).toHaveBeenCalledOnce();
      expect(checkStages).toHaveBeenCalledWith({tier: 'pre-push', strict: true, silent: true});
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(originalCwd);
      loadSpecMock.mockReset();
      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
      rmSync(cwd, {recursive: true, force: true});
    }
  });

  it.skipIf(isNested)(
    'AC4/AC5: `clad verdict --json` emits one machine verdict object over the real gate',
    () => {
      let stdout = '';
      try {
        // Use --tier=pre-commit (drift/arch/secret only — NO vitest, NO
        // coverage) so the nested gate cannot spawn a second `vitest --coverage`
        // against the same coverage/ reportsDirectory as the outer suite; that
        // collision crashes the pre-push Coverage stage (stage_2.2). The full
        // CLI path (loadSpec -> real gate -> computeVerdict -> emit JSON) is
        // still exercised, so the verdict-shape assertions still hold.
        stdout = execFileSync(
          process.execPath,
          ['./bin/clad', 'verdict', '--tier=pre-commit', '--json'],
          {
            cwd: repoRoot,
            encoding: 'utf8',
            env: {...process.env, [NEST_GUARD]: '1'},
            maxBuffer: 64 * 1024 * 1024,
          },
        );
      } catch (err) {
        // A non-DONE verdict legitimately exits non-zero while still printing
        // the JSON object on stdout — capture it rather than treating as fatal.
        const e = err as {stdout?: Buffer | string};
        stdout = e.stdout ? e.stdout.toString() : '';
      }
      const parsed = extractJson(stdout);
      expect(parsed, `no JSON verdict on stdout:\n${stdout}`).not.toBeNull();
      expect(KINDS).toContain(parsed!.verdict);
      expect(Array.isArray(parsed!.remaining)).toBe(true);
      expect('next_action' in parsed!).toBe(true);
    },
    600_000,
  );
});
