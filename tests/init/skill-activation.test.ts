// Cladding · globally installed skill activation boundary (F-0f4dd6 AC-017).

import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, test} from 'vitest';

const ACTIVATION_GUARD =
  'Activate only when the connected project contains spec.yaml or the user explicitly names Cladding; ignore ordinary requests in uninitialized projects.';

describe('Cladding skill activation boundary', () => {
  test('every non-init verb and persona description excludes unrelated uninitialized projects', () => {
    const verbFiles = readdirSync('skills')
      .filter((name) => name !== 'init')
      .map((name) => join('skills', name, 'SKILL.md'));
    const personaFiles = readdirSync('src/agents')
      .filter((name) => name.endsWith('.md') && name !== 'README.md')
      .map((name) => join('src/agents', name));

    for (const path of [...verbFiles, ...personaFiles]) {
      expect(readFileSync(path, 'utf8'), path).toContain(ACTIVATION_GUARD);
    }
  });
});
