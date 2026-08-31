// Cladding · F6 P1-1 — authority mint ownership is an architectural invariant.

import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, test} from 'vitest';

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

describe('F6 P1-1 run authority mint census', () => {
  test('keeps the raw-facts-free mint callable only from runCheckStages', () => {
    const callers = sourceFiles('src').filter((path) => path !== 'src/assurance/run-authority.ts'
      && readFileSync(path, 'utf8').includes('mintRunCheckStagesAuthority'));
    expect(callers).toEqual(['src/cli/clad.ts']);
  });

  test('keeps the attestation boundary below the CLI import graph', () => {
    expect(readFileSync('src/assurance/attestation.ts', 'utf8')).not.toContain('../cli/');
    expect(readFileSync('src/assurance/run-authority.ts', 'utf8')).not.toContain('../cli/');
  });

  test('keeps feature-closure row minting inside the workspace assembler', () => {
    const callers = sourceFiles('src').filter((path) => path !== 'src/assurance/attestation.ts'
      && readFileSync(path, 'utf8').includes('mintWorkspaceAttestationV3'));
    expect(callers).toEqual(['src/assurance/workspace.ts']);
  });
});
