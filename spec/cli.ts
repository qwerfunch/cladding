// Cladding · spec validate CLI entry — `tsx spec/cli.ts [path]`
//
// Reads a spec.yaml, validates it, prints a one-line JSON result, and
// exits 0 on valid / 1 on invalid / 2 on read/parse failure. The exit
// codes match the StageResult convention so this command composes with
// CI scripts the same way as `stage:*`.

import process from 'node:process';

import {parseSpec} from './parse.js';
import {validateSpec} from './validate.js';

interface CliResult {
  readonly task: 'spec_validate';
  readonly valid: boolean;
  readonly exitCode: number;
  readonly path: string;
  readonly errors: readonly string[];
}

function run(): CliResult {
  const path = process.argv[2] ?? './spec.yaml';
  let payload: unknown;
  try {
    payload = parseSpec(path);
  } catch (err) {
    return {
      task: 'spec_validate',
      valid: false,
      exitCode: 2,
      path,
      errors: [(err as Error).message],
    };
  }
  const {valid, errors} = validateSpec(payload);
  return {
    task: 'spec_validate',
    valid,
    exitCode: valid ? 0 : 1,
    path,
    errors,
  };
}

const result = run();
console.log(JSON.stringify(result));
process.exit(result.exitCode);
