import {describe, it, expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as path from 'node:path';

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
