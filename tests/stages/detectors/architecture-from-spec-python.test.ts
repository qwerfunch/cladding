// Cladding · unit tests for stages/detectors/architecture-from-spec.ts (Python)
//
// ARCHITECTURE_FROM_SPEC flexes by spec.project.language. For a Python project
// the layer dirs live under src/<layer>/, sources are `**/*.py`, and
// forbidden-import matching uses DOTTED module segments (reused verbatim from
// Kotlin): both `from a.b import c` and `import a.b` resolve against declared
// layers. Pins (F-803386ab, AC-d43aabcc): a web→db import crossing a forbidden
// boundary emits an error naming the layers; both import forms are caught;
// removing the forbidden imports clears it.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {architectureFromSpec} from '../../../src/stages/detectors/architecture-from-spec.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-arch-py-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** A schema-valid Python spec with an inline web→db forbidden-import rule. */
function writePythonSpec(): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject:\n  name: t\n  language: python\n' +
      'architecture:\n  layers:\n    - [web, db]\n  forbidden_imports:\n    - {from: web, to: db}\n' +
      'features:\n  - id: F-001\n    title: f\n    status: done\n' +
      '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n',
  );
}

/** Writes a source file under src/<layer>/<name>. */
function writePyLayerFile(layer: string, name: string, body: string): void {
  const layerDir = join(dir, 'src', layer);
  mkdirSync(layerDir, {recursive: true});
  writeFileSync(join(layerDir, name), body);
}

function run(): readonly {detector: string; severity: string; message: string; path?: string}[] {
  return architectureFromSpec.run({cwd: dir}).filter((f) => f.detector === 'ARCHITECTURE_FROM_SPEC');
}

describe('ARCHITECTURE_FROM_SPEC detector (Python, dotted imports)', () => {
  test('ERROR when a web file does `from db.models import User` (dotted from-import) (AC-d43aabcc)', () => {
    writePythonSpec();
    writePyLayerFile('web', 'handler.py', 'from db.models import User\n\n\ndef view():\n    return User\n');
    writePyLayerFile('db', 'models.py', 'class User:\n    pass\n');
    const errors = run().filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('src/web/handler.py');
    // Names both the crossing layer and the rule's endpoints.
    expect(errors[0].message).toContain('db');
    expect(errors[0].message).toContain('web');
  });

  test('ERROR also on the `import db.session` plain-import form (both dotted forms caught) (AC-d43aabcc)', () => {
    writePythonSpec();
    writePyLayerFile(
      'web',
      'handler.py',
      'from db.models import User\nimport db.session\n\n\ndef view():\n    return User\n',
    );
    writePyLayerFile('db', 'models.py', 'class User:\n    pass\n');
    const errors = run().filter((f) => f.severity === 'error');
    // One finding per crossing import: the from-import AND the plain import.
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.path === 'src/web/handler.py')).toBe(true);
    expect(errors.every((e) => e.message.includes('db'))).toBe(true);
  });

  test('CLEAN when the web file only imports allowed modules (AC-d43aabcc)', () => {
    writePythonSpec();
    writePyLayerFile('web', 'handler.py', 'import logging\nfrom web.helpers import fmt\n\n\ndef view():\n    return fmt(logging)\n');
    // Keep the db layer present so the empty-layer warn does not fire — this
    // test pins the forbidden-import ERROR count only.
    writePyLayerFile('db', 'models.py', 'class User:\n    pass\n');
    expect(run().filter((f) => f.severity === 'error')).toHaveLength(0);
  });
});
