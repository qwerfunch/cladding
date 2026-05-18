// Cladding · stage_1.1 Type
// Reference implementation of Ironclad iron-law.md stage_1.1
//   pass criteria: type checker exit 0, no errors
//   determinism: deterministic
//   llm cost: 0
//
// L2 — first Lego brick of L1 conformance.

import { spawnSync } from 'node:child_process';

/**
 * Run the project's type checker.
 *
 * @param {object} opts
 * @param {string} [opts.cwd='.']      project root to run in
 * @param {string} [opts.cmd='npx']    binary
 * @param {string[]} [opts.args=['tsc','--noEmit']] arguments
 * @returns {{stage:string, pass:boolean, exit_code:number, stderr?:string}}
 */
export function runType({
  cwd = '.',
  cmd = 'npx',
  args = ['tsc', '--noEmit'],
} = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const exit_code = result.status ?? 1;
  const pass = exit_code === 0;
  const out = { stage: 'stage_1.1', pass, exit_code };
  if (!pass && result.stderr) out.stderr = result.stderr.trim();
  return out;
}

// CLI entry — invoked as `node stages/type.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runType();
  console.log(JSON.stringify(result));
  process.exit(result.exit_code);
}
