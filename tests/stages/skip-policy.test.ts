// Cladding · F-67d2e9 — strict skip-policy demand table (unit level)

import {describe, expect, test} from 'vitest';

import {strictSkipViolations} from '../../src/stages/skip-policy.js';

const skip = (stage: string) => [{stage, status: 'skip' as const}];

describe('strictSkipViolations (F-67d2e9)', () => {
  test('1.1: declared language + done feature → violation; undeclared language → none', () => {
    const spec = {project: {name: 'x', language: 'typescript'}, features: [{id: 'F-a', status: 'done'}]} as never;
    expect(strictSkipViolations(spec, skip('stage_1.1')).length).toBe(1);
    const noLang = {project: {name: 'x'}, features: [{id: 'F-a', status: 'done'}]} as never;
    expect(strictSkipViolations(noLang, skip('stage_1.1')).length).toBe(0);
  });

  test('2.3: done AC with oracle_refs → violation; planned AC with oracle_refs → none (done-direction only)', () => {
    const done = {features: [{id: 'F-a', status: 'done', acceptance_criteria: [{id: 'AC-1', oracle_refs: ['tests/oracle/x.ts']}]}]} as never;
    expect(strictSkipViolations(done, skip('stage_2.3')).length).toBe(1);
    const planned = {features: [{id: 'F-a', status: 'planned', acceptance_criteria: [{id: 'AC-1', oracle_refs: ['tests/oracle/x.ts']}]}]} as never;
    expect(strictSkipViolations(planned, skip('stage_2.3')).length).toBe(0);
  });

  test('2.4: safe declared deliverable + done feature → violation; opt-out or undeclared deliverable → none', () => {
    const safe = {project: {name: 'x', deliverable: {path: './run', is_safe_to_smoke: true}}, features: [{id: 'F-a', status: 'done'}]} as never;
    expect(strictSkipViolations(safe, skip('stage_2.4')).map((v) => v.stage)).toEqual(['stage_2.4']);
    const optOut = {project: {name: 'x', deliverable: {path: './run', is_safe_to_smoke: false}}, features: [{id: 'F-a', status: 'done'}]} as never;
    expect(strictSkipViolations(optOut, skip('stage_2.4'))).toEqual([]);
    const undeclared = {project: {name: 'x'}, features: [{id: 'F-a', status: 'done'}]} as never;
    expect(strictSkipViolations(undeclared, skip('stage_2.4'))).toEqual([]);
  });

  test('a demanded stage that PASSED (not skipped) yields no violation', () => {
    const spec = {project: {name: 'x', language: 'typescript'}, features: [{id: 'F-a', status: 'done'}]} as never;
    expect(strictSkipViolations(spec, [{stage: 'stage_1.1', status: 'pass'}]).length).toBe(0);
  });

  test('multiple demands violated in one run are all reported', () => {
    const spec = {
      project: {name: 'x', language: 'typescript', deliverable: {path: './run', is_safe_to_smoke: true}},
      features: [{id: 'F-a', status: 'done', acceptance_criteria: [{id: 'AC-1', test_refs: ['t.ts'], oracle_refs: ['tests/oracle/x.ts']}]}],
    } as never;
    const outcomes = [
      {stage: 'stage_1.1', status: 'skip' as const},
      {stage: 'stage_2.1', status: 'skip' as const},
      {stage: 'stage_2.3', status: 'skip' as const},
      {stage: 'stage_2.4', status: 'skip' as const},
    ];
    expect(strictSkipViolations(spec, outcomes).map((v) => v.stage)).toEqual(['stage_1.1', 'stage_2.1', 'stage_2.3', 'stage_2.4']);
  });
});
