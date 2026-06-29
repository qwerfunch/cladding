import {describe, test, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {formatImpactCard, editMagnitude} from '../../src/cli/hook.js';
import type {ImpactSlice} from '../../src/optimizer/reverse-slice.js';

describe('impact card', () => {
  test('formatImpactCard renders owner, breaks, and tests for a touched file', () => {
    const slice: ImpactSlice = {
      focus: {id: 'F-abc123', title: 'Login'},
      impacted: [
        {id: 'F-one', title: 'One'},
        {id: 'F-two', title: 'Two'},
      ],
      impacted_modules: [],
      scenarios: [],
      test_refs: ['t1', 't2', 't3'],
    };

    const card = formatImpactCard(slice, 'src/login.ts');
    expect(card).not.toBe('');
    expect(card).toContain('cladding impact:');
    expect(card).toContain('src/login.ts');
    expect(card).toContain('F-abc123');
    expect(card).toContain('breaks 2 feature');
    expect(card).toContain('run 3 test');

    const moduleSlice: ImpactSlice = {
      focus: {module: 'src/x.ts', owners: ['F-aaa', 'F-bbb']},
      impacted: [],
      impacted_modules: [],
      scenarios: [],
      test_refs: [],
    };

    const moduleCard = formatImpactCard(moduleSlice, 'src/x.ts');
    expect(moduleCard).not.toBe('');
    expect(moduleCard).toContain('F-aaa');
    expect(moduleCard).toContain('co-owner');
  });

  test('formatImpactCard is empty when the file touches no feature', () => {
    const slice: ImpactSlice = {
      focus: {module: 'src/x.ts'},
      impacted: [],
      impacted_modules: [],
      scenarios: [],
      test_refs: [],
    };

    expect(formatImpactCard(slice, 'src/x.ts')).toBe('');
  });

  test('editMagnitude measures Edit, Write, and MultiEdit changed-char size', () => {
    expect(editMagnitude({content: 'abcde'})).toBe(5);
    expect(editMagnitude({new_string: 'abc'})).toBe(3);
    expect(
      editMagnitude({edits: [{new_string: 'ab'}, {new_string: 'cde'}]}),
    ).toBe(5);
    expect(editMagnitude({})).toBe(0);
  });

  test('ai_hints and the developer persona steer agents to the working-set tools', () => {
    const specText = readFileSync('spec.yaml', 'utf8');
    expect(specText).toContain('clad_get_working_set');

    const developerText = readFileSync('src/agents/developer.md', 'utf8');
    expect(developerText).toContain('clad_get_working_set');
  });
});
