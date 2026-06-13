// Cladding · unit tests for router/intent.ts

import {describe, expect, test} from 'vitest';

import {classifyIntent, suggestIntent} from '../../src/router/intent.js';

describe('classifyIntent — clear-intent matches', () => {
  // 0.6.0: the former `work` verb's build/implement patterns classify to
  // `run` (the verb that absorbed the removed stub's slot).
  test('Korean "기능 만들어줘" → run', () => {
    expect(classifyIntent('기능 X 만들어줘')).toBe('run');
  });

  test('English "build the feature" → run', () => {
    expect(classifyIntent('please build the auth feature')).toBe('run');
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

  // 0.6.0: `drive` was renamed to `run`; the match patterns are unchanged.
  test('Korean "드라이브 돌려" → run', () => {
    expect(classifyIntent('드라이브 돌려줘')).toBe('run');
  });

  test('English "execute the loop" → run', () => {
    expect(classifyIntent('execute the loop')).toBe('run');
  });

  test('English "kick off the drive" → run', () => {
    expect(classifyIntent('kick off the drive')).toBe('run');
  });

  test('Korean "이걸 끌고 가" → run', () => {
    expect(classifyIntent('이걸 끌고 가')).toBe('run');
  });
});

describe('classifyIntent — ambiguous or out-of-vocab → unknown', () => {
  test('planning intent "기획 세워줘" → unknown (planner territory)', () => {
    // Run means *executing* an already-defined plan, not *making* one.
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
  test('"initialize and build" → init (init rule evaluated before the broad build rule)', () => {
    expect(classifyIntent('initialize and build')).toBe('init');
  });

  test('"sync and check" → sync (sync rule evaluated before check)', () => {
    expect(classifyIntent('sync and check')).toBe('sync');
  });
});

// 0.6.0 (F-1d23a6) — suggestion-only recall tier. Output is injected context
// (UserPromptSubmit hook), never execution, so high recall is acceptable here
// while classifyIntent's precision contract stays byte-identical.
describe('suggestIntent — high-recall suggestion tier (F-1d23a6)', () => {
  test('EN "add a login feature" → run, while classifyIntent stays unknown (pre-0.6 behavior unchanged)', () => {
    expect(suggestIntent('add a login feature')).toBe('run');
    expect(classifyIntent('add a login feature')).toBe('unknown');
  });

  test('EN "create a new api endpoint" → run', () => {
    expect(suggestIntent('create a new api endpoint')).toBe('run');
  });

  test('EN "make a settings page" → run', () => {
    expect(suggestIntent('make a settings page')).toBe('run');
  });

  test('EN "let\'s finish and ship this" → check', () => {
    expect(suggestIntent("let's finish and ship this")).toBe('check');
  });

  test('EN "is the spec in sync with the code?" → check (consistency question, not the sync verb)', () => {
    expect(suggestIntent('is the spec in sync with the code?')).toBe('check');
  });

  test('EN "is everything consistent?" → check', () => {
    expect(suggestIntent('is everything consistent?')).toBe('check');
  });

  test('KO "로그인 기능 추가해줘" → run (existing KO patterns flow through)', () => {
    expect(suggestIntent('로그인 기능 추가해줘')).toBe('run');
  });

  test('KO "결제 화면 만들어줘" → run', () => {
    expect(suggestIntent('결제 화면 만들어줘')).toBe('run');
  });

  test('precision-tier verdicts pass through: "sync the spec" → sync', () => {
    expect(suggestIntent('sync the spec')).toBe('sync');
  });

  test('negative control: "explain how auth works" → null', () => {
    expect(suggestIntent('explain how auth works')).toBe(null);
  });

  test('negative control: "rename this variable" → null', () => {
    expect(suggestIntent('rename this variable')).toBe(null);
  });

  test('bare verb without an artifact noun stays null: "add it to the list"', () => {
    expect(suggestIntent('add it to the list')).toBe(null);
  });
});
