// Cladding · spec validate CLI entry — `tsx spec/cli.ts [path]`
//
// Reads a spec (single-file or sharded), validates the merged result,
// prints a one-line JSON outcome, and exits 0 (valid) / 1 (invalid) /
// 2 (parse failure). Exit codes match the StageResult convention so
// this command composes with CI scripts the same way as `stage:*`.
//
// As of L21.8 this CLI delegates to `loadSpec`, which auto-detects
// the sharded layout. Calling with an explicit path also works — the
// path resolves the *master* spec file; child shards are picked up
// relative to its directory.

import {dirname, isAbsolute, resolve} from 'node:path';
import process from 'node:process';

import {loadSpec} from './load.js';
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
  const absolutePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
  const cwd = dirname(absolutePath);
  const fileName = absolutePath.slice(cwd.length + 1);
  try {
    const spec = loadSpec(cwd, fileName);
    const {valid, errors} = validateSpec(spec);
    return {
      task: 'spec_validate',
      valid,
      exitCode: valid ? 0 : 1,
      path,
      errors,
    };
  } catch (err) {
    return {
      task: 'spec_validate',
      valid: false,
      exitCode: 2,
      path,
      errors: [(err as Error).message],
    };
  }
}

const result = run();
console.log(JSON.stringify(result));
process.exit(result.exitCode);
