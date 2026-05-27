// Cladding · scenarios · helpers (v0.3.46, F-4747ef)
//
// tmpdir setup, mock dispatcher patterns, fixture loaders shared
// across greenfield + existing-adoption lifecycle tests.
//
// Mock-dispatcher pattern follows `tests/cli/refine.test.ts`: a
// shared `vi.fn` is registered via `vi.mock` at module load, then
// each stage queues its own response with `mockResolvedValueOnce`.
// This keeps the test deterministic without forking the real
// dispatcher chain.

import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Per-test tmpdir + cleanup. */
export interface ScenarioCwd {
  readonly path: string;
  cleanup(): void;
}

export function mkScenarioCwd(prefix: string): ScenarioCwd {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return {
    path,
    cleanup: () => rmSync(path, {recursive: true, force: true}),
  };
}

/** Returns the absolute path to a fixture directory under `tests/scenarios/_fixtures/`. */
export function fixturePath(name: string): string {
  return join(HERE, '_fixtures', name);
}

/** Copy a fixture tree into the scenario cwd (existing-adoption Stage 1). */
export function copyFixture(name: string, dest: string): void {
  const src = fixturePath(name);
  cpSync(src, dest, {recursive: true});
}

/** Read a file under cwd; returns null when absent. */
export function readUnderCwd(cwd: string, relPath: string): string | null {
  const abs = join(cwd, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

/** Write a file under cwd, creating intermediate dirs. */
export function writeUnderCwd(cwd: string, relPath: string, body: string): void {
  const abs = join(cwd, relPath);
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(abs, body);
}

/** Stage marker for log lines in test digests. */
export function stageBanner(stage: string): string {
  return `\n── ${stage} ──`;
}

// ──────────────────────────────────────────────────────────────────
// Realistic LLM-mocked responses for the lifecycle tests.
//
// These responses look like what an actual senior-architect-tone
// dispatcher would emit for the "결제 SaaS for B2B" greenfield intent
// or the "이 프로젝트 분석해서 클래딩 적용" existing-adoption intent.
// Keep them close to real outputs so the lifecycle tests exercise the
// real parser paths, not a stripped-down mock.
// ──────────────────────────────────────────────────────────────────

/** Greenfield Stage 1 — initial onboarding response. */
export const GREENFIELD_S1_RESPONSE = [
  '=== ONBOARDING_MODE ===',
  'greenfield',
  '',
  '=== PROJECT_CONTEXT_MD ===',
  '# 결제 SaaS for B2B — Project Context',
  '',
  '## 1. Why does this project exist?',
  '',
  'B2B 결제 게이트웨이는 사업자 간 자금 흐름의 정확성과 추적 가능성이 ',
  '소비자 결제보다 높은 기준을 요구한다. Stripe/Toss 같은 대형 PG 의',
  '범용 API 는 개별 산업의 정산 규칙 (예: 위탁판매, 분할정산, 보증금) 을',
  '직접 다루지 않으므로 도메인-특화 결제 SaaS 가 필요하다.',
  '',
  '## 2. What problem does it solve?',
  '',
  '소호~중견 B2B 사업자가 자체 결제 인프라를 구축하지 않고도',
  '카드/계좌이체/간편결제를 통합 받고, 멀티-PG 폴백, 분쟁 처리,',
  'PCI-DSS 준수 범위를 명확히 분리한다.',
  '',
  '## 3. What is its purpose?',
  '',
  'B2B 결제의 운영 비용을 70% 이상 절감하면서 정산 정확도와',
  '감사 추적성을 동시에 보장한다.',
  '',
  '=== CAPABILITIES_YAML ===',
  'schema: "0.1"',
  'source: intent',
  'capabilities:',
  '  - id: payment-auth',
  '    title: "결제 인증"',
  '    summary: "OAuth + 토큰 발급 + 한도/권한 검증"',
  '    surface: feature',
  '    features: []',
  '  - id: webhook-handling',
  '    title: "웹훅 처리"',
  '    summary: "PG 콜백 검증 + 멱등성 + 재시도"',
  '    surface: platform',
  '    features: []',
  '  - id: ledger',
  '    title: "원장"',
  '    summary: "정산 이력 + 감사 로그"',
  '    surface: infrastructure',
  '    features: []',
  '',
  '=== ARCHITECTURE_YAML ===',
  'version: "0.1"',
  'layers:',
  '  - name: api',
  '    modules: ["src/api/**"]',
  '    forbidden_imports: ["ledger"]',
  '  - name: ledger',
  '    modules: ["src/ledger/**"]',
  '    forbidden_imports: []',
  '  - name: webhook',
  '    modules: ["src/webhook/**"]',
  '    forbidden_imports: ["ledger"]',
  '',
  '=== SPEC_SEED_TITLE ===',
  '결제 인증 흐름',
  '',
  '=== SCENARIOS_YAML ===',
  '- slug: purchase-flow',
  '  title: "결제 요청 → 인증 → 정산"',
  '  flow: |',
  '    사업자가 결제 요청을 받으면 토큰 인증 → 한도 검증 →',
  '    PG 호출 → 원장 기록 → 정산 큐 등록 까지의 흐름.',
  '  features: []',
  '- slug: refund-flow',
  '  title: "환불 처리"',
  '  flow: |',
  '    환불 요청 검증 → 원거래 조회 → PG 환불 호출 →',
  '    원장 역분개 → 사업자 알림.',
  '  features: []',
  '',
  '=== CLARIFYING_QUESTIONS ===',
  '- 주 사용자가 개인사업자인가요? 법인사업자인가요?',
  '- 어떤 결제수단을 우선 지원할 계획인가요?',
  '- 한국 시장 위주인가요? 글로벌도 고려하시나요?',
  '',
].join('\n');

/** Greenfield Stage 2 — refinement response (after one Q answered). */
export const GREENFIELD_S2_RESPONSE = [
  '=== ONBOARDING_MODE ===',
  'greenfield',
  '',
  '=== PROJECT_CONTEXT_MD ===',
  '# 결제 SaaS for B2B (법인 사업자) — Project Context',
  '',
  '## 1. Why does this project exist?',
  '',
  '법인 사업자 전용 B2B 결제 게이트웨이 SaaS — PCI-DSS SAQ D 범위',
  '준수가 필수가 되어 자체 인프라 부담이 크다. 본 프로젝트가',
  '그 부담을 SaaS 로 흡수한다.',
  '',
  '## 2. What problem does it solve?',
  '',
  '법인 사업자가 자체 PCI-DSS 인증을 받지 않고도 카드 결제를',
  '받을 수 있게 한다.',
  '',
  '## 3. What is its purpose?',
  '',
  'B2B 결제 운영 비용 + 컴플라이언스 비용을 동시에 절감한다.',
  '',
  '=== CAPABILITIES_YAML ===',
  'schema: "0.1"',
  'source: intent',
  'capabilities:',
  '  - id: payment-auth',
  '    title: "결제 인증"',
  '    summary: "OAuth + 토큰 + 사업자등록증 검증"',
  '    surface: feature',
  '    features: []',
  '  - id: webhook-handling',
  '    title: "웹훅 처리"',
  '    summary: "PG 콜백 검증 + 멱등성 + 재시도"',
  '    surface: platform',
  '    features: []',
  '  - id: ledger',
  '    title: "원장"',
  '    summary: "정산 이력 + 감사 로그"',
  '    surface: infrastructure',
  '    features: []',
  '  - id: compliance',
  '    title: "PCI-DSS 준수"',
  '    summary: "SAQ D 범위 격리"',
  '    surface: infrastructure',
  '    features: []',
  '',
  '=== ARCHITECTURE_YAML ===',
  'version: "0.1"',
  'layers:',
  '  - name: api',
  '    modules: ["src/api/**"]',
  '    forbidden_imports: ["ledger"]',
  '  - name: ledger',
  '    modules: ["src/ledger/**"]',
  '    forbidden_imports: []',
  '  - name: webhook',
  '    modules: ["src/webhook/**"]',
  '    forbidden_imports: ["ledger"]',
  '  - name: compliance',
  '    modules: ["src/compliance/**"]',
  '    forbidden_imports: ["api"]',
  '',
  '=== SPEC_SEED_TITLE ===',
  '결제 인증 흐름',
  '',
  '=== SCENARIOS_YAML ===',
  '- slug: purchase-flow',
  '  title: "결제 요청 → 인증 → 정산"',
  '  flow: |',
  '    법인 사업자 결제 요청 → 사업자등록증 검증 → 토큰 인증 →',
  '    한도 검증 → PG 호출 → 원장 기록 → 정산 큐 등록.',
  '  features: []',
  '- slug: refund-flow',
  '  title: "환불 처리"',
  '  flow: |',
  '    환불 요청 검증 → 원거래 조회 → PG 환불 호출 →',
  '    원장 역분개 → 사업자 알림.',
  '  features: []',
  '',
  '=== CLARIFYING_QUESTIONS ===',
  '- 어떤 결제수단을 우선 지원할 계획인가요?',
  '- 한국 시장 위주인가요? 글로벌도 고려하시나요?',
  '',
].join('\n');

/** Greenfield Stage 5 — re-scan after code written. Conventions get refreshed. */
export const GREENFIELD_S5_RESPONSE = [
  '=== CONVENTIONS_MD ===',
  '# Project conventions',
  '',
  '_Mode: LLM-refined from observed code._',
  '',
  '## Observed style',
  '',
  '| key | value |',
  '|---|---|',
  '| indent | two-space |',
  '| quote | single |',
  '| semicolon | present |',
  '| naming (exports) | camelCase |',
  '',
  '=== ARCHITECTURE_YAML ===',
  'version: "0.1"',
  'layers:',
  '  - name: api',
  '    modules: ["api/**"]',
  '    forbidden_imports: ["ledger"]',
  '  - name: ledger',
  '    modules: ["ledger/**"]',
  '    forbidden_imports: []',
  '  - name: webhook',
  '    modules: ["webhook/**"]',
  '    forbidden_imports: ["ledger"]',
  '',
  '=== SCENARIO_FLOWS ===',
  'api: handles HTTP entrypoints',
  'ledger: write-once ledger entries',
  'webhook: PG callback signature verification',
  '',
  '=== CAPABILITIES_YAML ===',
  'schema: "0.1"',
  'source: README.md',
  'capabilities: []',
  '',
].join('\n');

/** Existing-adoption Stage 2 — intent-driven onboarding on a populated project. */
export const EXISTING_S2_RESPONSE = [
  '=== ONBOARDING_MODE ===',
  'existing-adoption',
  '',
  '=== PROJECT_CONTEXT_MD ===',
  '# sample-existing-ts — Project Context',
  '',
  '## 1. Why does this project exist?',
  '',
  '관찰된 디렉토리 구조 (api/, lib/, util/) + README 의 "결제" 키워드로',
  '보아 기존 결제 처리 모듈을 cladding 거버넌스로 끌어들이는 것이 의도.',
  '',
  '## 2. What problem does it solve?',
  '',
  'cladding 의 4-tier 거버넌스 + drift 디텍터를 기존 코드베이스에 적용해',
  'spec ↔ code 일관성을 자동 검증하게 한다.',
  '',
  '## 3. What is its purpose?',
  '',
  '기존 결제 처리 코드의 유지보수성 + 감사 추적성을 향상시킨다.',
  '',
  '=== CAPABILITIES_YAML ===',
  'schema: "0.1"',
  'source: README.md',
  'capabilities:',
  '  - id: install',
  '    title: "Install"',
  '    summary: "패키지 설치 + 환경 설정"',
  '    surface: tool',
  '    features: []',
  '  - id: usage',
  '    title: "Usage"',
  '    summary: "기본 사용법 + API 호출 예시"',
  '    surface: feature',
  '    features: []',
  '  - id: api',
  '    title: "API"',
  '    summary: "공개 API 레퍼런스"',
  '    surface: feature',
  '    features: []',
  '',
  '=== ARCHITECTURE_YAML ===',
  'version: "0.1"',
  'layers:',
  '  - name: api',
  '    modules: ["src/api/**"]',
  '    forbidden_imports: []',
  '  - name: lib',
  '    modules: ["src/lib/**"]',
  '    forbidden_imports: ["api"]',
  '  - name: util',
  '    modules: ["src/util/**"]',
  '    forbidden_imports: ["api", "lib"]',
  '',
  '=== SPEC_SEED_TITLE ===',
  '결제 처리 통합',
  '',
  '=== SCENARIOS_YAML ===',
  '- slug: payment-flow',
  '  title: "결제 처리"',
  '  flow: |',
  '    클라이언트 결제 요청 → API 인증 → lib 결제 처리 →',
  '    util 로깅 → 응답 반환.',
  '  features: []',
  '',
  '=== CLARIFYING_QUESTIONS ===',
  '- 멀티 테넌트가 필요한가요? 단일 머천트인가요?',
  '- 추가하실 결제수단이 있나요?',
  '',
].join('\n');
