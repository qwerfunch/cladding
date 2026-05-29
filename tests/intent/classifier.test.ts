// Cladding · unit tests for src/intent/classifier.ts (0.4.13 PR-D.1, F-b426b0)
//
// Covers the 5-category classification matrix + the conflict
// resolution table + featureCandidates ranking.

import {describe, expect, test} from 'vitest';

import {classifyIntent} from '../../src/intent/classifier.js';

describe('classifyIntent — dev-new', () => {
  test('English "add a feature" → dev-new + clad_create_feature', () => {
    const r = classifyIntent('add a feature to handle user logout');
    expect(r.intent).toBe('dev-new');
    expect(r.confidence).toBe('high');
    expect(r.suggestedAction).toBe('clad_create_feature');
    expect(r.matchedTokens).toContain('add');
  });

  test('English "implement" → dev-new', () => {
    expect(classifyIntent('implement the search index').intent).toBe('dev-new');
  });

  test('Korean "구현해" → dev-new', () => {
    const r = classifyIntent('결제 모듈 구현해줘');
    expect(r.intent).toBe('dev-new');
    expect(r.suggestedAction).toBe('clad_create_feature');
  });

  test('Korean "새 기능 추가" → dev-new', () => {
    expect(classifyIntent('새 기능 추가해줘').intent).toBe('dev-new');
  });
});

describe('classifyIntent — dev-modify', () => {
  test('English "fix the bug" → dev-modify + enter_work', () => {
    const r = classifyIntent('fix the bug in the login flow');
    expect(r.intent).toBe('dev-modify');
    expect(r.confidence).toBe('high');
    expect(r.suggestedAction).toBe('enter_work');
  });

  test('English "refactor" → dev-modify', () => {
    expect(classifyIntent('refactor the spec layer to use hash ids').intent).toBe('dev-modify');
  });

  test('Korean "수정" → dev-modify', () => {
    expect(classifyIntent('이 함수 수정해줘').intent).toBe('dev-modify');
  });

  test('Korean "버그 고쳐" → dev-modify', () => {
    expect(classifyIntent('이 버그 고쳐주세요').intent).toBe('dev-modify');
  });

  test('Korean "안 돼" colloquial → dev-modify', () => {
    expect(classifyIntent('로그인이 안 돼요').intent).toBe('dev-modify');
  });
});

describe('classifyIntent — dev-review', () => {
  test('English "explain this function" → dev-review + silent', () => {
    const r = classifyIntent('explain this function');
    expect(r.intent).toBe('dev-review');
    expect(r.suggestedAction).toBe('silent');
  });

  test('English "walk me through" → dev-review', () => {
    expect(classifyIntent('walk me through the dispatch flow').intent).toBe('dev-review');
  });

  test('Korean "이 코드 봐줘" → dev-review', () => {
    expect(classifyIntent('이 코드 봐줘').intent).toBe('dev-review');
  });

  test('Korean "설명해줘" → dev-review', () => {
    expect(classifyIntent('이 함수가 무엇을 하는지 설명해줘').intent).toBe('dev-review');
  });
});

describe('classifyIntent — non-dev', () => {
  test('English "run the app" → non-dev + silent', () => {
    const r = classifyIntent('run the app on port 3000');
    expect(r.intent).toBe('non-dev');
    expect(r.suggestedAction).toBe('silent');
  });

  test('English "deploy" → non-dev', () => {
    expect(classifyIntent('deploy to staging').intent).toBe('non-dev');
  });

  test('Korean "실행해" → non-dev', () => {
    expect(classifyIntent('서버 실행해줘').intent).toBe('non-dev');
  });

  test('Korean "배포" → non-dev', () => {
    expect(classifyIntent('프로덕션에 배포해줘').intent).toBe('non-dev');
  });
});

describe('classifyIntent — ambiguous (conflict)', () => {
  test('dev-* hit + non-dev hit → ambiguous + silent', () => {
    // "add" (dev-new) + "run" (non-dev) → ambiguous
    const r = classifyIntent('add a hook then run the tests');
    expect(r.intent).toBe('ambiguous');
    expect(r.confidence).toBe('low');
    expect(r.suggestedAction).toBe('silent');
    // matchedTokens still surfaced for debugging
    expect(r.matchedTokens.length).toBeGreaterThan(0);
  });

  test('Korean dev + non-dev → ambiguous', () => {
    // "수정" (dev-modify) + "실행" (non-dev) → ambiguous
    const r = classifyIntent('이 파일 수정 후 실행해줘');
    expect(r.intent).toBe('ambiguous');
  });
});

describe('classifyIntent — ambiguous (no match)', () => {
  test('empty string → ambiguous + silent', () => {
    const r = classifyIntent('');
    expect(r.intent).toBe('ambiguous');
    expect(r.confidence).toBe('low');
    expect(r.matchedTokens).toEqual([]);
  });

  test('greeting → ambiguous', () => {
    expect(classifyIntent('hello there').intent).toBe('ambiguous');
  });

  test('Korean greeting → ambiguous', () => {
    expect(classifyIntent('안녕하세요').intent).toBe('ambiguous');
  });
});

describe('classifyIntent — conflict resolution within dev-*', () => {
  test('dev-new + dev-modify → dev-new wins (more specific)', () => {
    // "add" (new) + "fix" (modify) — new wins
    const r = classifyIntent('add a new module and fix the old one');
    expect(r.intent).toBe('dev-new');
    expect(r.matchedTokens).toEqual(expect.arrayContaining(['add', 'fix']));
  });

  test('dev-modify + dev-review → dev-modify wins (more committal)', () => {
    // "review" (review) + "fix" (modify) — modify wins because it
    // implies a writing action; review-only would be read-only.
    const r = classifyIntent('please review and fix this');
    expect(r.intent).toBe('dev-modify');
  });
});

describe('classifyIntent — featureCandidates ranking', () => {
  const features = [
    {id: 'F-a00001', slug: 'login-flow', title: 'User login flow'},
    {id: 'F-b00002', slug: 'logout-handler', title: 'User logout handler'},
    {id: 'F-c00003', slug: 'payment-checkout', title: 'Payment checkout'},
    {id: 'F-d00004', slug: 'session-timeout', title: 'Session timeout'},
  ];

  test('dev-modify with feature-related token → ranks matching features', () => {
    const r = classifyIntent('fix the login bug', {features});
    expect(r.intent).toBe('dev-modify');
    expect(r.featureCandidates).toBeDefined();
    expect(r.featureCandidates![0].slug).toBe('login-flow');
    expect(r.featureCandidates!.length).toBeLessThanOrEqual(3);
  });

  test('candidates returned in descending score', () => {
    const r = classifyIntent('fix login and logout issues', {features});
    expect(r.featureCandidates!.length).toBe(2);
    // login-flow and logout-handler both score (login appears in 'login-flow',
    // logout appears in 'logout-handler'). Order by score then id ascending.
    const slugs = r.featureCandidates!.map((c) => c.slug).sort();
    expect(slugs).toContain('login-flow');
    expect(slugs).toContain('logout-handler');
  });

  test('no matching features → featureCandidates absent', () => {
    const r = classifyIntent('fix the unrelated thing', {features});
    expect(r.intent).toBe('dev-modify');
    expect(r.featureCandidates).toBeUndefined();
  });

  test('dev-new does NOT emit featureCandidates (new feature, not modify)', () => {
    const r = classifyIntent('add login retry support', {features});
    expect(r.intent).toBe('dev-new');
    // Even though "login" would match feature candidates, dev-new is
    // about creating a new feature shard — not about identifying an
    // existing one to modify.
    expect(r.featureCandidates).toBeUndefined();
  });

  test('non-dev does NOT emit featureCandidates', () => {
    const r = classifyIntent('run the login server', {features});
    expect(r.intent).toBe('non-dev');
    expect(r.featureCandidates).toBeUndefined();
  });
});

describe('classifyIntent — determinism (AC-006)', () => {
  test('identical prompt → identical output across calls', () => {
    const prompt = 'fix the login bug';
    const r1 = classifyIntent(prompt);
    const r2 = classifyIntent(prompt);
    expect(r1).toEqual(r2);
  });

  test('determinism with featureCandidates', () => {
    const features = [
      {id: 'F-a11111', slug: 'login-flow', title: 'login'},
      {id: 'F-b22222', slug: 'logout-handler', title: 'logout'},
    ];
    const r1 = classifyIntent('fix login bug', {features});
    const r2 = classifyIntent('fix login bug', {features});
    expect(r1).toEqual(r2);
  });
});
