// Cladding · unit tests for router/intent.ts

import {describe, expect, test} from 'vitest';

import {classifyIntent} from '../../router/intent.js';

describe('classifyIntent', () => {
  test('classifies Korean "기능 만들어줘" as work', () => {
    expect(classifyIntent('기능 X 만들어줘')).toBe('work');
  });

  test('classifies English "build the feature" as work', () => {
    expect(classifyIntent('please build the auth feature')).toBe('work');
  });

  test('classifies "새 프로젝트 시작해줘" as init', () => {
    expect(classifyIntent('새 프로젝트 시작해줘')).toBe('init');
  });

  test('classifies "전체 확인해줘" as check', () => {
    expect(classifyIntent('전체 확인해줘')).toBe('check');
  });

  test('classifies "기획 세워줘" as drive', () => {
    expect(classifyIntent('기획 세워줘')).toBe('drive');
  });

  test('classifies "명세 동기화" as sync', () => {
    expect(classifyIntent('명세 동기화')).toBe('sync');
  });

  test('unrelated prompt resolves to unknown', () => {
    expect(classifyIntent('what is the weather today')).toBe('unknown');
  });

  test('init beats work when both phrases appear', () => {
    // 'init' rule runs first in RULES — by design.
    expect(classifyIntent('initialize and build')).toBe('init');
  });
});
