// Cladding · stage_1.1 Type
// Reference implementation of Ironclad iron-law.md stage_1.1
//   pass criteria: type checker exit 0, no errors
//   determinism: deterministic
//   llm cost: 0
//
// L2 — first Lego brick of L1 conformance. TypeScript so cladding can
// apply stage_1.1 to itself (self-dogfood; required for L7 conformance).

import { spawnSync } from 'node:child_process';
import process from 'node:process';

export interface StageResult {
  stage: string;
  pass: boolean;
  exit_code: number;
  stderr?: string;
}

export interface RunTypeOptions {
  cwd?: string;
  cmd?: string;
  args?: string[];
}

/** Run the project's type checker. Pass = exit 0. */
export function runType(opts: RunTypeOptions = {}): StageResult {
  const { cwd = '.', cmd = 'npx', args = ['tsc', '--noEmit'] } = opts;
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const exit_code = result.status ?? 1;
  const pass = exit_code === 0;
  const out: StageResult = { stage: 'stage_1.1', pass, exit_code };
  if (!pass && result.stderr) out.stderr = result.stderr.trim();
  return out;
}

// CLI entry — `tsx stages/type.ts` or `npm run stage:type`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const result = runType();
  console.log(JSON.stringify(result));
  process.exit(result.exit_code);
}
