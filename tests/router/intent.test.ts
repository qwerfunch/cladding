// Cladding · unit tests for router/intent.ts

import {describe, expect, test} from 'vitest';

import {classifyIntent} from '../../src/router/intent.js';

describe('classifyIntent — clear-intent matches', () => {
  test('Korean "기능 만들어줘" → work', () => {
    expect(classifyIntent('기능 X 만들어줘')).toBe('work');
  });

  test('English "build the feature" → work', () => {
    expect(classifyIntent('please build the auth feature')).toBe('work');
  });

  test('Korean "새 프로젝트 시작해줘" → init', () => {
    expect(classifyIntent('새 프로젝트 시작해줘')).toBe('init');
  });

  test('English "initialize the workspace" → init', () => {
    expect(classifyIntent('initialize the workspace')).toBe('init');
  });

  test('Korean "전체 확인해줘" → check', () => {
    expect(classifyIntent('전체 확인해줘')).toBe('check');
  });

  test('English "verify everything" → check', () => {
    expect(classifyIntent('verify everything')).toBe('check');
  });

  test('Korean "명세 동기화" → sync', () => {
    expect(classifyIntent('명세 동기화')).toBe('sync');
  });

  test('English "sync the spec" → sync', () => {
    expect(classifyIntent('sync the spec')).toBe('sync');
  });

  test('Korean "드라이브 돌려" → drive', () => {
    expect(classifyIntent('드라이브 돌려줘')).toBe('drive');
  });

  test('English "execute the loop" → drive', () => {
    expect(classifyIntent('execute the loop')).toBe('drive');
  });

  test('English "kick off the drive" → drive', () => {
    expect(classifyIntent('kick off the drive')).toBe('drive');
  });

  test('Korean "이걸 끌고 가" → drive', () => {
    expect(classifyIntent('이걸 끌고 가')).toBe('drive');
  });
});

describe('classifyIntent — ambiguous or out-of-vocab → unknown', () => {
  test('planning intent "기획 세워줘" → unknown (librarian territory)', () => {
    // Drive means *executing* an already-defined plan, not *making* one.
    expect(classifyIntent('기획 세워줘')).toBe('unknown');
  });

  test('planning intent "let\'s plan this out" → unknown', () => {
    expect(classifyIntent("let's plan this out")).toBe('unknown');
  });

  test('planning intent "로드맵 그려줘" → unknown', () => {
    expect(classifyIntent('로드맵 그려줘')).toBe('unknown');
  });

  test('planning intent "draw a roadmap" → unknown', () => {
    expect(classifyIntent('draw a roadmap')).toBe('unknown');
  });

  test('vague "어떻게든 마무리해" → unknown', () => {
    expect(classifyIntent('어떻게든 마무리해')).toBe('unknown');
  });

  test('vague "좀 해줘" → unknown', () => {
    expect(classifyIntent('좀 해줘')).toBe('unknown');
  });

  test('vague "전부 다 끝내줘" → unknown', () => {
    expect(classifyIntent('전부 다 끝내줘')).toBe('unknown');
  });

  test('off-topic "what is the weather" → unknown', () => {
    expect(classifyIntent('what is the weather today')).toBe('unknown');
  });
});

describe('classifyIntent — rule order invariant', () => {
  test('"initialize and build" → init (init rule evaluated before work)', () => {
    expect(classifyIntent('initialize and build')).toBe('init');
  });

  test('"sync and check" → sync (sync rule evaluated before check)', () => {
    expect(classifyIntent('sync and check')).toBe('sync');
  });
});
