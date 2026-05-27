// Cladding · scan · intent-onboarding (v0.3.43, F-56abaa)
//
// Intent-aware init: 사용자가 던진 짧은 의도와 환경 관찰을 결합해
// LLM 으로 4-section 고품질 onboarding 산출물을 만든다. 사용자가 명시한
// 것 이상의 도메인 베스트프랙티스까지 추론 — payment → idempotency,
// webhook signing, ledger; ML pipeline → data lineage, eval harness.
//
// Result shape:
//   - mode: greenfield | existing-adoption | mixed
//   - projectContextMd: docs/project-context.md body
//   - capabilitiesYaml: spec/capabilities.yaml body
//   - architectureYaml: spec/architecture.yaml body
//   - specSeedTitle: F-001 title (CLI 가 spec.yaml seed 에 적용)
//   - clarifyingQuestions: 다음 사이클의 Q&A 루프 seeded
//
// conventions.md 는 본 모듈에서 안 만듦 — toolchain 디폴트가 도메인
// 무관하므로 src/cli/scan/greenfield-seeds.ts 의 renderer 를 init 이
// 직접 호출.
//
// Fallback 매트릭스:
//   - dispatcher === null: deterministic 폴백 (project-context = 의도 quote, 나머지는 greenfield seeds)
//   - LLM throw: 동일 폴백 + sentinel_miss 이벤트 (phase: 'onboarding', cause: 'dispatcher_error')
//   - sentinel-miss (PROJECT_CONTEXT_MD 또는 CAPABILITIES_YAML 빈)
//     : 부분 폴백 (해당 산출물만 deterministic) + sentinel_miss 이벤트
//
// @see src/cli/scan/llm.ts — 4-sentinel buildPrompt 패턴 재사용
// @see src/cli/scan/greenfield-seeds.ts — 폴백시 토대

import yaml from 'yaml';

import {appendEvent, newEvent} from '../../events/log.js';
import {
  renderGreenfieldArchitectureYaml,
  renderGreenfieldCapabilitiesYaml,
} from './greenfield-seeds.js';
import type {ScanLlmDispatcher} from './llm.js';

/** Observed environment fed into the LLM prompt alongside the intent. */
export interface OnboardingObserved {
  /** `basename(resolve(cwd))` — small but useful hint about user's working directory. */
  readonly cwdBasename: string;
  /** Detected toolchain language ('typescript' | 'python' | 'go' | ... | 'unknown'). */
  readonly language: string;
  /** Source files seen by `scanRoot` (0 on a brand-new project). */
  readonly sourceFileCount: number;
  /** Whether a README.md (or variant) is present. */
  readonly readmePresent: boolean;
  /** First non-decorative paragraph of the README, if present. */
  readonly readmeFirstParagraph: string | null;
  /** Project display name used in titles + seed bodies. */
  readonly projectName: string;
}

/**
 * One user-journey scenario stub emitted by the onboarding LLM.
 * v0.3.45 (F-d12edf) — closes the project-context.md ↔ scenarios
 * loop: project-context provides the prose, this shape provides the
 * structured journey index. `features: []` stays empty at onboarding
 * time — `clad_create_feature` later binds new features to the
 * relevant scenario.
 */
export interface OnboardingScenario {
  /** `S-<hash6>` id; the renderer generates the hash from the slug. */
  readonly id: string;
  /** kebab-case slug derived from the journey name. */
  readonly slug: string;
  /** Short user-facing title in the user's language. */
  readonly title: string;
  /** 2-3 sentence prose describing the end-to-end user journey. */
  readonly flow: string;
  /** Always `[]` at onboarding time; `clad_create_feature` populates later. */
  readonly features: readonly string[];
}

/** Structured artifacts produced by an onboarding pass. */
/**
 * AI agent behavior hints emitted by the LLM as part of the
 * PROJECT_METADATA sentinel. Matches the shape of `Project.ai_hints`
 * in `src/spec/types.ts`. v0.3.57+ (F-00eb1a).
 */
export interface OnboardingPreferredPattern {
  readonly when: string;
  readonly prefer: string;
  readonly over?: string;
}

export interface OnboardingAiHints {
  readonly preferred_persona?: string;
  readonly token_budget_per_session?: number;
  readonly test_framework?: string;
  readonly primary_branch?: string;
  readonly forbidden_patterns?: readonly string[];
  /** Advisory preferred-pattern triples. v0.3.58+ (F-32b1e0). */
  readonly preferred_patterns?: readonly OnboardingPreferredPattern[];
}

export interface OnboardingResult {
  /** Identifies which path the LLM saw the project as. */
  readonly mode: 'greenfield' | 'existing-adoption' | 'mixed';
  /** Full body for `docs/project-context.md` — Why/What/Purpose. */
  readonly projectContextMd: string;
  /** Full body for `spec/capabilities.yaml`. */
  readonly capabilitiesYaml: string;
  /** Full body for `spec/architecture.yaml`. */
  readonly architectureYaml: string;
  /** Suggested title for the placeholder F-001 in `spec.yaml`. */
  readonly specSeedTitle: string;
  /** 2-3 product/business-level questions the orchestrator can ask next. */
  readonly clarifyingQuestions: readonly string[];
  /**
   * 1-3 user-journey scenarios extracted by the LLM from the intent
   * + project-context prose. Empty when the deterministic fallback
   * fired (scenario calibration depends on the LLM). v0.3.45+.
   */
  readonly scenarios: readonly OnboardingScenario[];
  /**
   * AI behavior hints inferred from intent (preferred persona,
   * test framework, forbidden patterns, etc.). Undefined when the
   * LLM didn't return PROJECT_METADATA or when the deterministic
   * fallback fired. v0.3.57+ (F-00eb1a).
   */
  readonly aiHints?: OnboardingAiHints;
  /** llm | deterministic | hybrid (per-section fallback). */
  readonly source: 'llm' | 'deterministic' | 'hybrid';
}

const ONBOARDING_HEADER =
  '<!-- Cladding · Tier B · SSoT — intent + Why/What/Purpose · Refreshed by: clad init / clad refine -->\n' +
  '<!-- Onboarding refined from user intent + environment observation. ' +
  'Edit freely — re-running `clad init <new-intent>` diverts the new ' +
  'body to `.cladding/scan/project-context.md.proposal` for review. -->';

const DETERMINISTIC_HEADER =
  '<!-- Cladding · Tier B · SSoT — intent quoted (deterministic fallback) · Refreshed by: clad init / clad refine -->\n' +
  '<!-- LLM unavailable or response sentinel-miss; the body below ' +
  'quotes your intent verbatim. Re-run with a connected LLM dispatcher ' +
  'to capture inferred domain context. -->';

/**
 * Builds the LLM prompt asking for 6 sentinel-labelled sections that
 * together produce the four onboarding artifacts. The prompt is
 * deliberately written in *senior architect* tone — the LLM is told
 * to produce output that exceeds the user's literal request.
 *
 * The CLARIFYING_QUESTIONS section is guard-railed at the prompt level:
 * the LLM MUST ask product/business questions, not implementation
 * choices, and MUST match vocabulary to the user's intent.
 */
export function buildOnboardingPrompt(
  intent: string,
  observed: OnboardingObserved,
): string {
  const readmePara = observed.readmeFirstParagraph
    ? `"${observed.readmeFirstParagraph}"`
    : '(none observed)';
  return [
    'You are a senior software architect setting up a new project workspace',
    'via cladding. The user gave a short description; your job is to produce',
    'artifacts that REPRESENT THE PROJECT BETTER THAN THE USER EXPLICITLY STATED.',
    '',
    `User intent: "${intent}"`,
    '',
    'Observed environment:',
    `- Project name (cwd basename): ${observed.projectName}`,
    `- Detected language: ${observed.language}`,
    `- Existing source files: ${observed.sourceFileCount}`,
    `- README present: ${observed.readmePresent ? 'yes' : 'no'}`,
    `- README first paragraph: ${readmePara}`,
    '',
    'For the user\'s intent, identify the domain and produce 6 sentinel sections.',
    'Use the EXACT sentinel strings below so the response is parsable.',
    '',
    '=== ONBOARDING_MODE ===',
    'One word: greenfield | existing-adoption | mixed. Choose based on',
    'whether the intent text + observed files indicate a brand-new project',
    '(greenfield), an adoption of cladding into an existing codebase',
    '(existing-adoption), or a hybrid (greenfield code + intent that names',
    'an existing project).',
    '',
    '=== PROJECT_CONTEXT_MD ===',
    `Full body for docs/project-context.md. Use markdown headings.`,
    'Capture BOTH the user\'s stated intent AND inferred domain context',
    '(compliance norms, scale assumptions, common architectural patterns).',
    'Three subsections: "## 1. Why does this project exist?", "## 2. What',
    'problem does it solve?", "## 3. What is its purpose?". Be specific.',
    'Avoid generic phrases ("modern", "powerful", "robust").',
    '',
    '=== CAPABILITIES_YAML ===',
    'Full body for spec/capabilities.yaml. Schema:',
    '  schema: "0.1"',
    '  source: intent (greenfield) | README.md (existing-adoption)',
    '  capabilities:',
    '    - id: <kebab-slug>',
    '      title: "<verbatim or inferred capability name>"',
    '      summary: "<one sentence>"',
    '      surface: feature | platform | tool | infrastructure',
    'Mix user-stated capabilities (preserve names verbatim when they used',
    'specific terms) with domain best-practice inferred capabilities.',
    'Aim for 3-8 entries total. Inferred entries should be ones the user',
    'would forget to mention but the domain expects (e.g., payment →',
    'idempotency, webhook signing, audit trail; ML pipeline → data',
    'lineage, eval harness; SaaS → multi-tenancy, audit log).',
    '',
    '=== ARCHITECTURE_YAML ===',
    'Full body for spec/architecture.yaml. Schema:',
    '  layers: [{name, modules:[<glob>], forbidden_imports:[<layer>]}, ...]',
    'Tailor layers to the domain + language. Add a 1-line comment per',
    'layer summarising its responsibility. Add forbidden_imports',
    'candidates matching the domain\'s typical isolation rules.',
    '',
    '=== SPEC_SEED_TITLE ===',
    'A single short line: the natural first feature for this kind of',
    'project. NOT a placeholder — pick something the user would actually',
    'build first (e.g., payment SaaS → "결제 인증 흐름"; ML pipeline →',
    '"데이터 수집 파이프라인"; marketing site → "랜딩 페이지 렌더링").',
    'Match the user\'s language (Korean intent → Korean title).',
    '',
    '=== SCENARIOS_YAML ===',
    '1-3 user-journey scenarios that this project enables. Each scenario',
    'captures a top-level business flow (NOT an architecture layer). Output',
    'a YAML list (no schema wrapper). Each entry shape:',
    '  - slug: <kebab-slug>            # e.g., purchase-flow',
    '    title: "<short user-facing name>"',
    '    flow: |',
    '      <2-3 sentences describing the end-to-end user journey.',
    '       Derive from the project context above; this is NOT',
    '       implementation, just the user\'s story.>',
    '    features: []  # always empty at onboarding; clad_create_feature binds later',
    '(The `id` field is omitted — the renderer assigns `S-<hash6>` from',
    'the slug.)',
    '',
    'GUIDELINES:',
    '- Identify journeys from the user intent + observed README, NOT from',
    '  inferred technical layers. Payment SaaS → "purchase flow", "refund',
    '  flow", "settlement flow". NOT "auth layer", "ledger layer".',
    '- 1-3 scenarios is the sweet spot. More than 3 → those become',
    '  follow-up scenarios in a later cycle.',
    '- Match the user\'s language (Korean intent → Korean title + flow).',
    '- The `flow` prose IS the user-journey summary that lives in',
    '  project-context.md; the same paragraph can appear in both, just',
    '  structured here for scenario-aware tooling.',
    '',
    '=== PROJECT_METADATA ===',
    'AI behavior hints inferred from the intent. YAML with these optional',
    'keys (omit any you cannot confidently infer):',
    '  preferred_persona: <software-engineer | specialist | reviewer | librarian | observability>',
    '  token_budget_per_session: <integer · default 4000>',
    '  test_framework: <vitest | jest | pytest | cargo-test | …>',
    '  primary_branch: <develop | main>',
    '  forbidden_patterns: ["eval(", "innerHTML", ...]  # identifier substrings the AI should refuse', // cladding-disable AI_HINTS_FORBIDDEN_PATTERN
    '  preferred_patterns:  # 1-3 advisory {when, prefer, over?} triples (advisory only — AI follows, no enforcement)',
    '    - when: "React state management"',
    '      prefer: "useState, useReducer hooks"',
    '      over: "this.state, class components"',
    '',
    'Rules:',
    '- For UI projects (React/Vue/Svelte) include innerHTML + dangerouslySetInnerHTML in forbidden_patterns.', // cladding-disable AI_HINTS_FORBIDDEN_PATTERN
    '- For Node/Deno projects without UI, focus on eval(, Function constructor, child_process.exec.', // cladding-disable AI_HINTS_FORBIDDEN_PATTERN
    '- preferred_patterns should reflect domain practices (e.g. React → hooks, async work → async/await, queries → prepared statements).',
    '- Each preferred_pattern is concrete + actionable. Skip if you cannot name a specific pattern.',
    '- preferred_persona reflects the dominant work type — software-engineer is the right default.',
    '- Leave the block EMPTY (no keys) if the intent is too vague to infer anything useful.',
    '',
    '=== CLARIFYING_QUESTIONS ===',
    '2-3 PRODUCT/BUSINESS-level questions to ask the user next, one per',
    'line. RULES (mandatory):',
    '- Ask GOAL / AUDIENCE / SCOPE questions, not implementation choices.',
    '- Match vocabulary to what the user used in their intent.',
    '  - Casual intent ("결제 SaaS", "쇼핑몰") → plain-language questions.',
    '  - Technical intent ("PCI-DSS gateway") → deeper questions OK.',
    '- Each question must be answerable by a product owner without research.',
    '- NEVER ask about technical jargon the user did not bring up first.',
    '',
    'BAD examples (intimidating, expert-only):',
    '  "PCI-DSS SAQ A vs SAQ D?"',
    '  "Webhook idempotency — single-flight or distributed lock?"',
    '  "SSR vs SSG vs ISR?"',
    '',
    'GOOD examples (product/business level):',
    '  payment SaaS: "주 사용자가 개인? 사업자?", "어떤 결제수단 우선?",',
    '                "한국 시장 위주? 글로벌?"',
    '  ML pipeline: "사용자가 실시간 결과 기다리나? 배치 OK?",',
    '               "어떤 데이터로 학습? 공개 vs 자체수집?"',
    '  shopping mall: "재고 실시간 정확성 중요? 약간 느려도 OK?",',
    '                 "어떤 결제수단 / 배송 방식?"',
    '',
    'CRITICAL: aim for *informed* output, not safe output. A short intent',
    'deserves a richly-inferred scaffold. The user can edit anything; they',
    'cannot add what you did not suggest. Questions, however, MUST stay',
    'at the level the user can actually answer.',
  ].join('\n');
}

/** Splits the LLM response into the labelled sections (8 since F-00eb1a). */
export function parseOnboardingResponse(text: string): {
  readonly mode: string;
  readonly projectContext: string;
  readonly capabilities: string;
  readonly architecture: string;
  readonly specSeedTitle: string;
  readonly scenariosRaw: string;
  readonly projectMetadataRaw: string;
  readonly clarifyingQuestionsRaw: string;
} {
  return {
    mode: extractSection(text, 'ONBOARDING_MODE'),
    projectContext: extractSection(text, 'PROJECT_CONTEXT_MD'),
    capabilities: extractSection(text, 'CAPABILITIES_YAML'),
    architecture: extractSection(text, 'ARCHITECTURE_YAML'),
    specSeedTitle: extractSection(text, 'SPEC_SEED_TITLE'),
    scenariosRaw: extractSection(text, 'SCENARIOS_YAML'),
    projectMetadataRaw: extractSection(text, 'PROJECT_METADATA'),
    clarifyingQuestionsRaw: extractSection(text, 'CLARIFYING_QUESTIONS'),
  };
}

function extractSection(text: string, name: string): string {
  const re = new RegExp(`=== ${name} ===([\\s\\S]*?)(?:===\\s*[A-Z_]+\\s*===|$)`);
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Parses the raw `CLARIFYING_QUESTIONS` block into a list of questions.
 * Accepts bullets ("- ", "* ", "1. ") or plain lines. Filters empty
 * lines. Caps at 5 to keep the CLI hint compact.
 */
export function extractClarifyingQuestions(raw: string): readonly string[] {
  if (!raw.trim()) return [];
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

/**
 * Normalises the LLM's `ONBOARDING_MODE` to one of the three allowed
 * values. Defaults to `greenfield` when the LLM returned something
 * unexpected, since the caller can always re-run with `--scan` to
 * force the observed path.
 */
export function normaliseMode(raw: string): OnboardingResult['mode'] {
  const cleaned = raw.toLowerCase().trim();
  if (cleaned.includes('existing')) return 'existing-adoption';
  if (cleaned.includes('mixed')) return 'mixed';
  return 'greenfield';
}

/**
 * Parses the raw SCENARIOS_YAML block (a YAML list) into a list of
 * OnboardingScenario entries. The LLM emits scenarios without an `id`
 * (it doesn't know the hash to use); this helper assigns
 * `S-<hash6>` deterministically from the slug so two scenarios with
 * the same slug always get the same id.
 *
 * Robust to YAML hand-roll quirks: caps at 5 entries, drops malformed
 * entries (missing slug or title), forces `features: []` regardless of
 * what the LLM emitted (onboarding-time scenarios are unbound).
 */
export function extractScenarios(raw: string): readonly OnboardingScenario[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: OnboardingScenario[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const slug = slugifyScenario(String(e.slug ?? ''));
    const title = String(e.title ?? '').trim();
    const flow = String(e.flow ?? '').trim();
    if (!slug || !title) continue;
    out.push({
      id: `S-${hashFromSlug(slug)}`,
      slug,
      title,
      flow,
      features: [], // always empty at onboarding time
    });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Parses the `PROJECT_METADATA` sentinel into AI hints. Robust to:
 * - empty block (returns undefined)
 * - missing keys (returns partial — only fields present)
 * - malformed YAML (returns undefined, silently)
 * - unknown extra keys (ignored — additionalProperties: false at schema layer)
 *
 * Added v0.3.57 (F-00eb1a).
 */
export function extractProjectMetadata(raw: string): OnboardingAiHints | undefined {
  if (!raw.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  const out: {
    preferred_persona?: string;
    token_budget_per_session?: number;
    test_framework?: string;
    primary_branch?: string;
    forbidden_patterns?: readonly string[];
    preferred_patterns?: readonly OnboardingPreferredPattern[];
  } = {};
  if (typeof obj.preferred_persona === 'string' && obj.preferred_persona.trim()) {
    out.preferred_persona = obj.preferred_persona.trim();
  }
  if (typeof obj.token_budget_per_session === 'number' && obj.token_budget_per_session >= 100) {
    out.token_budget_per_session = Math.floor(obj.token_budget_per_session);
  }
  if (typeof obj.test_framework === 'string' && obj.test_framework.trim()) {
    out.test_framework = obj.test_framework.trim();
  }
  if (typeof obj.primary_branch === 'string' && obj.primary_branch.trim()) {
    out.primary_branch = obj.primary_branch.trim();
  }
  if (Array.isArray(obj.forbidden_patterns)) {
    const patterns = obj.forbidden_patterns
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (patterns.length > 0) out.forbidden_patterns = patterns;
  }
  if (Array.isArray(obj.preferred_patterns)) {
    const triples: OnboardingPreferredPattern[] = [];
    for (const entry of obj.preferred_patterns) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const when = typeof e.when === 'string' ? e.when.trim() : '';
      const prefer = typeof e.prefer === 'string' ? e.prefer.trim() : '';
      if (!when || !prefer) continue;
      const triple: OnboardingPreferredPattern = {when, prefer};
      if (typeof e.over === 'string' && e.over.trim()) {
        (triple as {over: string}).over = e.over.trim();
      }
      triples.push(triple);
    }
    if (triples.length > 0) (out as {preferred_patterns?: readonly OnboardingPreferredPattern[]}).preferred_patterns = triples;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function slugifyScenario(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ㄱ-힝]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministic 6-char hex hash from the scenario slug. Same slug →
 * same hash so re-running onboarding on the same intent produces
 * stable scenario ids. Not cryptographically strong; this is a name
 * derivation, not a security boundary.
 */
function hashFromSlug(slug: string): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Top-level orchestration. Calls the LLM (if available), parses the
 * response, fills any blank sentinels with deterministic fallbacks,
 * and emits `sentinel_miss` events for telemetry parity with the
 * existing scan pipeline.
 *
 * The optional `cwd` is the workspace root used for event emission —
 * tests that call this helper without a workspace omit it to stay
 * telemetry-silent (mirrors `interpretScanWithFallback` in llm.ts).
 */
export async function interpretOnboardingWithFallback(
  intent: string,
  observed: OnboardingObserved,
  dispatcher: ScanLlmDispatcher | null,
  cwd?: string,
): Promise<OnboardingResult> {
  if (dispatcher === null) {
    return deterministicOnboarding(intent, observed);
  }
  let raw: string;
  try {
    raw = await dispatcher(buildOnboardingPrompt(intent, observed));
  } catch (e) {
    emitSentinelMiss(cwd, {
      phase: 'onboarding',
      cause: 'dispatcher_error',
      fallback: 'total',
      error: truncateError(e),
    });
    return deterministicOnboarding(intent, observed);
  }
  const parsed = parseOnboardingResponse(raw);
  const missed: string[] = [];
  if (!parsed.projectContext.trim()) missed.push('PROJECT_CONTEXT_MD');
  if (!parsed.capabilities.trim()) missed.push('CAPABILITIES_YAML');
  if (!parsed.architecture.trim()) missed.push('ARCHITECTURE_YAML');
  if (!parsed.specSeedTitle.trim()) missed.push('SPEC_SEED_TITLE');
  // CLARIFYING_QUESTIONS is allowed to be empty — not all intents
  // need a follow-up. Mode is normalised, so a blank value still
  // resolves to greenfield.

  // Critical sentinel-miss: project-context + capabilities both blank
  // → total fallback. Otherwise per-section fallback (keeps mode=hybrid).
  const total =
    missed.includes('PROJECT_CONTEXT_MD') &&
    missed.includes('CAPABILITIES_YAML') &&
    missed.includes('ARCHITECTURE_YAML');
  if (total) {
    emitSentinelMiss(cwd, {
      phase: 'onboarding',
      cause: 'blank_section',
      fallback: 'total',
      missed_sections: missed,
    });
    return deterministicOnboarding(intent, observed);
  }
  if (missed.length > 0) {
    emitSentinelMiss(cwd, {
      phase: 'onboarding',
      cause: 'blank_section',
      fallback: 'per_artifact',
      missed_sections: missed,
    });
  }

  const mode = normaliseMode(parsed.mode);
  return {
    mode,
    projectContextMd: parsed.projectContext.trim()
      ? wrapProjectContext(parsed.projectContext, observed.projectName, ONBOARDING_HEADER)
      : deterministicProjectContext(intent, observed),
    capabilitiesYaml: parsed.capabilities.trim()
      ? ensureTierBBannerYaml(parsed.capabilities)
      : renderGreenfieldCapabilitiesYaml(observed.projectName),
    architectureYaml: parsed.architecture.trim()
      ? ensureTierBBannerYaml(stripArchVersionKey(parsed.architecture))
      : renderGreenfieldArchitectureYaml(observed.language),
    specSeedTitle: parsed.specSeedTitle.trim() || deterministicSeedTitle(intent),
    scenarios: extractScenarios(parsed.scenariosRaw),
    aiHints: extractProjectMetadata(parsed.projectMetadataRaw),
    clarifyingQuestions: extractClarifyingQuestions(parsed.clarifyingQuestionsRaw),
    source: missed.length === 0 ? 'llm' : 'hybrid',
  };
}

/**
 * Deterministic fallback used when the LLM is unavailable or the
 * response is unusable. Produces a complete OnboardingResult so the
 * caller can still write artifacts and surface intent context.
 *
 * Deterministic mode emits no scenarios because scenario extraction
 * depends on the LLM (calibrating "user-journey vs architecture layer"
 * needs the same domain-aware reasoning as the clarifying questions).
 */
export function deterministicOnboarding(
  intent: string,
  observed: OnboardingObserved,
): OnboardingResult {
  return {
    mode: observed.sourceFileCount >= 3 ? 'existing-adoption' : 'greenfield',
    projectContextMd: deterministicProjectContext(intent, observed),
    capabilitiesYaml: renderGreenfieldCapabilitiesYaml(observed.projectName),
    architectureYaml: renderGreenfieldArchitectureYaml(observed.language),
    specSeedTitle: deterministicSeedTitle(intent),
    scenarios: [],
    // Deterministic mode has no clarifying questions — the LLM was the
    // source of question calibration; without it we cannot guarantee
    // question quality.
    clarifyingQuestions: [],
    source: 'deterministic',
  };
}

function deterministicProjectContext(intent: string, observed: OnboardingObserved): string {
  const lines: string[] = [
    DETERMINISTIC_HEADER,
    '',
    `# ${observed.projectName} — Project Context`,
    '',
    '## 1. Why does this project exist?',
    '',
    `_User intent (verbatim)_: ${intent}`,
    '',
    'The LLM dispatcher was unavailable or returned an unusable response,',
    'so this section quotes your intent without inferred domain context.',
    'Re-run `clad init <intent>` once a dispatcher is connected to get a',
    'refined Why/What/Purpose write-up.',
    '',
    '## 2. What problem does it solve?',
    '',
    '_Refine by hand or re-run with LLM available._',
    '',
    '## 3. What is its purpose?',
    '',
    '_Refine by hand or re-run with LLM available._',
    '',
    '## See also',
    '',
    '- `docs/conventions.md` — observed code conventions',
    '- `spec/architecture.yaml` — observed layers',
    '- `spec/capabilities.yaml` — README-derived capability inventory',
    '- `spec.yaml` — feature registry',
    '',
  ];
  return lines.join('\n');
}

function deterministicSeedTitle(intent: string): string {
  const trimmed = intent.trim();
  if (trimmed.length === 0) return 'Your first feature';
  // Use the first ~60 chars of the intent as the title.
  const cut = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  return cut;
}

function wrapProjectContext(body: string, projectName: string, header: string): string {
  // If the LLM-produced body already starts with a heading or
  // comment, prepend just the header. Otherwise add a title line.
  const trimmed = body.trim();
  const hasTitle = trimmed.startsWith('# ') || trimmed.startsWith('<!--');
  const titleLine = hasTitle ? '' : `# ${projectName} — Project Context\n\n`;
  return `${header}\n\n${titleLine}${trimmed}\n`;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Tier B banner for YAML artifacts (capabilities, architecture). The
 * LLM is instructed to emit a body starting with the schema/version
 * line, not the banner — so we prepend the banner here if the body
 * doesn't already carry it. This keeps every Tier B artifact's first
 * line consistent with `docs/ssot-model.md` regardless of which path
 * (greenfield seed / LLM response / hand-edit) produced it.
 */
const TIER_B_YAML_BANNER =
  '# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad refine';

function ensureTierBBannerYaml(body: string): string {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('# Cladding · ')) {
    return ensureTrailingNewline(trimmed);
  }
  return `${TIER_B_YAML_BANNER}\n${ensureTrailingNewline(trimmed)}`;
}

// Defensive strip: drop top-level `version: "..."` lines from an
// LLM-emitted architecture body. The architecture schema (see
// src/spec/schema.json::definitions.architecture) declares
// `additionalProperties: false` with only `layers` + `forbidden_imports`
// allowed, so any `version:` key the LLM still emits would fail
// `clad sync`. The LLM prompt no longer requests one (v0.4.0); this
// keeps cladding robust against models that learned the older shape.
function stripArchVersionKey(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*version\s*:\s*["']?[0-9.]+["']?\s*$/.test(line))
    .join('\n');
}

function emitSentinelMiss(cwd: string | undefined, payload: Record<string, unknown>): void {
  if (!cwd) return;
  try {
    appendEvent(cwd, newEvent('sentinel_miss', payload));
  } catch {
    // Telemetry must never break init.
  }
}

function truncateError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

// ─────────────────────────────────────────────────────────────────────
// Refinement path (v0.3.44 / F-09d68b)
//
// Once `clad init <intent>` has produced the initial onboarding state,
// `clad refine <answer>` advances the Q&A loop: it records the user's
// answer to the next pending question, then re-runs the LLM with the
// full Q-A history + current artifact bodies so the response can
// refine each artifact based on the new information.
// ─────────────────────────────────────────────────────────────────────

/** One answered Q-A pair forwarded into the refinement prompt. */
export interface RefinementQa {
  readonly question: string;
  readonly answer: string;
}

/** Current artifact bodies on disk — passed to the LLM so it knows what to refine vs preserve. */
export interface RefinementCurrent {
  readonly projectContextMd: string;
  readonly capabilitiesYaml: string;
  readonly architectureYaml: string;
}

/**
 * Builds the refinement-pass prompt. Re-uses the same 6 sentinels as
 * `buildOnboardingPrompt` so the parser stays shared — only the body
 * differs: the LLM sees the full Q-A history and the current artifact
 * bodies, and is told to produce *refined* artifacts that preserve
 * accurate prior decisions while updating anything contradicted by the
 * new answer.
 */
export function buildRefinementPrompt(
  intent: string,
  observed: OnboardingObserved,
  qaHistory: readonly RefinementQa[],
  current: RefinementCurrent,
): string {
  const qaBlock = qaHistory
    .map((qa, i) => `${i + 1}. Q: ${qa.question}\n   A: ${qa.answer}`)
    .join('\n');
  return [
    'You are a senior software architect refining a project workspace via',
    'cladding. The user has answered a clarifying question; update the',
    'artifacts to reflect every answer so far. PRESERVE decisions still',
    'consistent with the new information; REVISE anything contradicted.',
    '',
    `Original user intent: "${intent}"`,
    '',
    'Q-A history (most recent answer last):',
    qaBlock || '(no Q-A yet)',
    '',
    'Observed environment:',
    `- Project name: ${observed.projectName}`,
    `- Detected language: ${observed.language}`,
    `- Existing source files: ${observed.sourceFileCount}`,
    `- README present: ${observed.readmePresent ? 'yes' : 'no'}`,
    '',
    'Current docs/project-context.md body (refine in place):',
    '```',
    current.projectContextMd.trim() || '(empty)',
    '```',
    '',
    'Current spec/capabilities.yaml body:',
    '```',
    current.capabilitiesYaml.trim() || '(empty)',
    '```',
    '',
    'Current spec/architecture.yaml body:',
    '```',
    current.architectureYaml.trim() || '(empty)',
    '```',
    '',
    'Emit the same 7 sentinel sections as the original onboarding pass.',
    'Re-emit refined bodies — do not produce a diff or summary. Each',
    'sentinel section must contain the complete new body for that artifact.',
    '',
    '=== ONBOARDING_MODE ===',
    'Same options: greenfield | existing-adoption | mixed.',
    '',
    '=== PROJECT_CONTEXT_MD ===',
    'Full refined docs/project-context.md body.',
    '',
    '=== CAPABILITIES_YAML ===',
    'Full refined spec/capabilities.yaml body.',
    '',
    '=== ARCHITECTURE_YAML ===',
    'Full refined spec/architecture.yaml body.',
    '',
    '=== SPEC_SEED_TITLE ===',
    'F-001 title. Update only if the new answer changed the first',
    'feature; otherwise repeat the previous title.',
    '',
    '=== SCENARIOS_YAML ===',
    'Refined scenarios YAML list. PRESERVE the existing slug + id of',
    'scenarios that still apply (carry them forward with the same slug);',
    'REVISE the flow when the new answer changes the journey; ADD a new',
    'scenario only if the answer reveals a journey not previously',
    'captured. Same shape as the original onboarding (slug, title, flow,',
    'features: [], no id — renderer assigns S-<hash6>).',
    '',
    '=== CLARIFYING_QUESTIONS ===',
    'NEW questions that the answer makes worth asking. Empty when the',
    'onboarding is sufficiently captured. Same product/business-level',
    'calibration as the original prompt — NEVER ask about technical',
    'jargon the user did not bring up first. List one per line.',
    'When `=== CLARIFYING_QUESTIONS ===` is empty the caller marks the',
    'onboarding session as `status: done` in `.cladding/onboarding/state.yaml`.',
  ].join('\n');
}

/**
 * Top-level refinement orchestration. Mirrors
 * {@link interpretOnboardingWithFallback} — calls the LLM with the
 * refinement prompt when a dispatcher is available, falls back to a
 * deterministic body that quotes the latest answer in
 * `docs/project-context.md` when not. Sentinel-miss telemetry uses
 * the same `phase: 'onboarding'` value (already documented in the
 * sentinel_miss schema) since refine is part of the same surface.
 */
export async function interpretRefinementWithFallback(
  intent: string,
  observed: OnboardingObserved,
  qaHistory: readonly RefinementQa[],
  current: RefinementCurrent,
  dispatcher: ScanLlmDispatcher | null,
  cwd?: string,
): Promise<OnboardingResult> {
  if (dispatcher === null) {
    return deterministicRefinement(intent, observed, qaHistory, current);
  }
  let raw: string;
  try {
    raw = await dispatcher(buildRefinementPrompt(intent, observed, qaHistory, current));
  } catch (e) {
    emitSentinelMiss(cwd, {
      phase: 'onboarding',
      cause: 'dispatcher_error',
      fallback: 'total',
      error: truncateError(e),
    });
    return deterministicRefinement(intent, observed, qaHistory, current);
  }
  const parsed = parseOnboardingResponse(raw);
  const missed: string[] = [];
  if (!parsed.projectContext.trim()) missed.push('PROJECT_CONTEXT_MD');
  if (!parsed.capabilities.trim()) missed.push('CAPABILITIES_YAML');
  if (!parsed.architecture.trim()) missed.push('ARCHITECTURE_YAML');
  if (!parsed.specSeedTitle.trim()) missed.push('SPEC_SEED_TITLE');

  const total =
    missed.includes('PROJECT_CONTEXT_MD') &&
    missed.includes('CAPABILITIES_YAML') &&
    missed.includes('ARCHITECTURE_YAML');
  if (total) {
    emitSentinelMiss(cwd, {
      phase: 'onboarding',
      cause: 'blank_section',
      fallback: 'total',
      missed_sections: missed,
    });
    return deterministicRefinement(intent, observed, qaHistory, current);
  }
  if (missed.length > 0) {
    emitSentinelMiss(cwd, {
      phase: 'onboarding',
      cause: 'blank_section',
      fallback: 'per_artifact',
      missed_sections: missed,
    });
  }

  const mode = normaliseMode(parsed.mode);
  return {
    mode,
    projectContextMd: parsed.projectContext.trim()
      ? wrapProjectContext(parsed.projectContext, observed.projectName, ONBOARDING_HEADER)
      : current.projectContextMd,
    capabilitiesYaml: parsed.capabilities.trim() ? ensureTierBBannerYaml(parsed.capabilities) : current.capabilitiesYaml,
    architectureYaml: parsed.architecture.trim() ? ensureTierBBannerYaml(stripArchVersionKey(parsed.architecture)) : current.architectureYaml,
    specSeedTitle: parsed.specSeedTitle.trim() || deterministicSeedTitle(intent),
    scenarios: extractScenarios(parsed.scenariosRaw),
    aiHints: extractProjectMetadata(parsed.projectMetadataRaw),
    clarifyingQuestions: extractClarifyingQuestions(parsed.clarifyingQuestionsRaw),
    source: missed.length === 0 ? 'llm' : 'hybrid',
  };
}

/**
 * Deterministic fallback for the refinement pass. Preserves the
 * current artifact bodies (the LLM was unavailable, so we cannot
 * meaningfully refine) and appends the latest Q-A pair as a footnote
 * to `docs/project-context.md` so the user's answer is captured
 * somewhere visible.
 */
export function deterministicRefinement(
  intent: string,
  observed: OnboardingObserved,
  qaHistory: readonly RefinementQa[],
  current: RefinementCurrent,
): OnboardingResult {
  const lastQa = qaHistory[qaHistory.length - 1];
  const footnote = lastQa
    ? `\n\n---\n\n## Q&A log (refinement, LLM unavailable)\n\n_Q_: ${lastQa.question}\n\n_A_: ${lastQa.answer}\n`
    : '';
  return {
    mode: observed.sourceFileCount >= 3 ? 'existing-adoption' : 'greenfield',
    projectContextMd: appendFootnoteOnce(current.projectContextMd, footnote),
    capabilitiesYaml: current.capabilitiesYaml,
    architectureYaml: current.architectureYaml,
    specSeedTitle: deterministicSeedTitle(intent),
    scenarios: [],
    clarifyingQuestions: [],
    source: 'deterministic',
  };
}

function appendFootnoteOnce(body: string, footnote: string): string {
  if (!footnote) return body;
  // If the body already ends in a Q&A log (deterministic path was
  // exercised on a previous refine) append the new entry under the
  // existing log header instead of duplicating it. The detection is
  // intentionally loose — a sentinel-string match.
  if (body.includes('## Q&A log (refinement, LLM unavailable)')) {
    const lines = footnote.split('\n').slice(4); // drop the leading `---` + heading lines
    return body.endsWith('\n') ? `${body}${lines.join('\n')}` : `${body}\n${lines.join('\n')}`;
  }
  return body.endsWith('\n') ? `${body}${footnote.slice(1)}` : `${body}${footnote}`;
}
