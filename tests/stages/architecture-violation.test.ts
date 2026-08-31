// Cladding · unit tests for stages/detectors/architecture-violation.ts
//
// Detector under test delegates to the toolchain's architecture
// validator (madge for TS, lint-imports for Python). Branches mirror
// HARDCODED_SECRET:
//   - no validator registered     → info  (compiler may enforce)
//   - validator exit 0            → silent
//   - validator non-zero exit     → error (with truncated output)
//   - validator binary absent     → info  (ENOENT)
//   - validator throws otherwise  → re-thrown
//
// Most subprocess branches use vi.mock('execa'); the generated-output
// regression below deliberately drives local Madge through this detector.

import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('execa', () => ({
  execaSync: vi.fn(),
}));

const {architectureViolation} = await import(
  '../../src/stages/detectors/architecture-violation.js'
);
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;
const actualExeca = await vi.importActual<typeof import('execa')>('execa');
const madgeBin = resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/.bin/madge');

describe('ARCHITECTURE_VIOLATION detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-arch-'));
    execaSyncMock.mockReset();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('no toolchain gate → info finding (language with no validator)', () => {
    // Empty dir → toolchain unknown → no arch gate spec → info finding.
    // Real-world case: Rust / Go projects do not register an arch gate
    // because the compiler enforces acyclic imports.
    const findings = architectureViolation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('no architecture validator');
    expect(findings[0].message).toContain('acyclic imports');
    expect(execaSyncMock).not.toHaveBeenCalled();
  });

  test('validator exits 0 → silent', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 0, stdout: '', stderr: ''});
    expect(architectureViolation.run({cwd: dir})).toEqual([]);
    expect(execaSyncMock).toHaveBeenCalledOnce();
  });

  test("[covers:F-058/AC-138] validator non-zero exit → error finding (with tool output)", () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: 'Circular dependency: a -> b -> a',
      stderr: '',
    });
    const findings = architectureViolation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('reported architecture violations');
    expect(findings[0].message).toContain('Circular dependency');
  });

  test('validator not installed (ENOENT on RESULT) → info, NOT a false "violations"', () => {
    // execaSync(reject:false) RETURNS {code:'ENOENT', exitCode:undefined} for a
    // missing binary — it does NOT throw. A registered-but-uninstalled validator
    // must yield an info skip, never a false architecture-violation error.
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({code: 'ENOENT', exitCode: undefined, stdout: '', stderr: ''});
    const findings = architectureViolation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('not installed');
  });

  test('an unexpected throw is not swallowed (defensive)', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    const err = new Error('EACCES') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    execaSyncMock.mockImplementationOnce(() => {
      throw err;
    });
    expect(() => architectureViolation.run({cwd: dir})).toThrow('EACCES');
  });

  test('non-zero exit with only stderr → error message draws from stderr', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'rule violation via stderr',
    });
    const findings = architectureViolation.run({cwd: dir});
    expect(findings[0].message).toContain('rule violation via stderr');
  });

  test('non-zero exit with no output → exit-code fallback', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
    execaSyncMock.mockReturnValueOnce({exitCode: 3, stdout: '', stderr: ''});
    const findings = architectureViolation.run({cwd: dir});
    expect(findings[0].message).toContain('exit 3');
  });

  test('[covers:F-2c02991f/AC-dd5c3abf] a handwritten source cycle is reported while generated-output cycles stay excluded', () => {
    // The fixture has one cycle in authored TypeScript and one in generated JS.
    // Run the real local Madge binary through the detector's exact npx command:
    // success requires both the composed exclusion and a source-level finding.
    writeFileSync(join(dir, 'package.json'), '{"name":"arch-fixture"}\n');
    mkdirSync(join(dir, 'src'), {recursive: true});
    mkdirSync(join(dir, 'dist'), {recursive: true});
    writeFileSync(join(dir, 'src', 'a.ts'), "import {b} from './b';\nexport const a = b;\n");
    writeFileSync(join(dir, 'src', 'b.ts'), "import {a} from './a';\nexport const b = a;\n");
    writeFileSync(join(dir, 'dist', 'a.js'), "import {b} from './b.js';\nexport const a = b;\n");
    writeFileSync(join(dir, 'dist', 'b.js'), "import {a} from './a.js';\nexport const b = a;\n");
    mkdirSync(join(dir, 'node_modules', '.bin'), {recursive: true});
    symlinkSync(madgeBin, join(dir, 'node_modules', '.bin', 'madge'));
    const home = join(dir, 'home');
    mkdirSync(home);
    vi.stubEnv('HOME', home);
    try {
      execaSyncMock.mockImplementation(
        actualExeca.execaSync as unknown as (...args: unknown[]) => unknown,
      );

      const findings = architectureViolation.run({cwd: dir});

      expect(execaSyncMock).toHaveBeenCalledOnce();
      const [, args] = execaSyncMock.mock.calls[0] as [string, string[]];
      const exclude = args[args.indexOf('--exclude') + 1];
      expect(exclude).toBeTypeOf('string');
      expect(new RegExp(exclude).test('dist/a.js')).toBe(true);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].message).toContain('src/a.ts');
      expect(findings[0].message).toContain('src/b.ts');
      expect(findings[0].message).not.toContain('dist/a.js');
      expect(findings[0].message).not.toContain('dist/b.js');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
