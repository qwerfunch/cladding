// Cladding · UI · Soft Shell formatter
//
// Per `ironclad-design/03-ux-routing.md` §1.2-1.3 (Iron Core vs Soft
// Shell boundary), internal identifiers (`F-NNN`, `AC-NNN`, stage IDs,
// halt-class enum values) must not leak into user-facing output by
// default. The audit log retains them verbatim for replay and forensic
// use; the user surface sees business language.
//
// This module is the single conversion layer. Anywhere the CLI prints
// to a user, route the value through one of these functions first.
// Anywhere the audit log records evidence, keep the internal id raw.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parse as parseYaml} from 'yaml';

import type {HaltReason} from '../drive/halt.js';
import type {Spec} from '../spec/types.js';

const HALT_MESSAGES: Readonly<Record<HaltReason['class'], string>> = {
  ALL_FEATURES_DONE: 'All work complete.',
  MAX_ITERATIONS: 'Stopped — reached the iteration limit.',
  WALL_CLOCK: 'Stopped — exceeded the time budget.',
  BUDGET_EXCEEDED: 'Stopped — budget exhausted.',
  BLOCKED_FEATURE: 'Stopped — a feature is blocked by dependencies.',
  RETRY_THRESHOLD: 'Stopped — a feature failed too many times.',
  GATE_NO_PROGRESS: 'Stopped — gates are not making progress.',
  HUMAN_REQUIRED: 'Paused — needs human sign-off.',
  TRANSPORT_AUTH_FAILED: 'Stopped — agent rejected the credentials. Check your API key.',
  TRANSPORT_RATE_LIMITED: 'Stopped — agent is rate-limited. Try again after the cooldown.',
  TRANSPORT_NETWORK: 'Stopped — could not reach the agent over the network.',
  LLM_UNAVAILABLE: 'Stopped — could not reach the agent.',
  UNCAUGHT_ERROR: 'Stopped — unexpected error.',
};

const GATE_LABELS: Readonly<Record<string, string>> = {
  'stage_1.1': 'Type',
  'stage_1.2': 'Lint',
  'stage_1.3': 'Drift',
  'stage_1.4': 'Commit',
  'stage_1.5': 'Architecture',
  'stage_1.6': 'Secret',
  'stage_2.1': 'Unit tests',
  'stage_2.2': 'Coverage',
  'stage_2.3': 'Spec conformance',
  'stage_2.4': 'Deliverable smoke',
  'stage_3.1': 'Smoke',
  'stage_3.2': 'Performance',
  'stage_3.3': 'Visual',
  'stage_4.1': 'Audit',
  'stage_4.2': 'UAT',
};

/**
 * Returns the user-facing label for a feature.
 *
 * Falls back to the raw id when the spec has no matching entry — this
 * preserves debuggability for an audit-time mismatch without crashing
 * the render.
 *
 * @param featureId - Internal feature id, e.g. `F-049`.
 * @param spec - The loaded spec; `spec.features[].title` is the source.
 * @returns The feature's business title, or the id when no title exists.
 * @see ironclad-design/03-ux-routing.md §1.2 — user-facing ID ban.
 */
export function featureLabel(featureId: string, spec: Spec): string {
  const match = spec.features.find((f) => f.id === featureId);
  if (match && match.title) return match.title;
  return featureId;
}

/**
 * Converts a `HaltReason` into a plain user-facing sentence.
 *
 * The internal enum (`HUMAN_REQUIRED`, `LLM_UNAVAILABLE`, …) stays in
 * the audit log; the user sees a sentence. When the halt detail field
 * starts with a known feature id, the id is rewritten to the feature's
 * business title for the user-facing string.
 *
 * @param halt - The internal halt reason.
 * @param spec - The loaded spec, used for id-to-title translation.
 * @returns A user-readable sentence.
 * @see drive/halt.ts — the closed halt-class enum this maps from.
 */
export function haltMessage(halt: HaltReason, spec: Spec): string {
  const base = HALT_MESSAGES[halt.class] ?? 'Stopped.';
  const detail = translateFeatureIdsInDetail(halt.detail, spec);
  return detail ? `${base} ${detail}` : base;
}

/**
 * Returns the user-facing label for an Iron Law stage id.
 *
 * @param stageId - Internal stage id, e.g. `stage_1.3`.
 * @returns A short business name (e.g. `Drift`), or the id when unknown.
 */
export function gateLabel(stageId: string): string {
  return GATE_LABELS[stageId] ?? stageId;
}

/**
 * Rewrites any `F-NNN` token in a detail string to its feature title.
 *
 * Halt detail strings are produced by the drive loop in internal form
 * (e.g. `F-042 retried 3 times`). We translate the id portion so the
 * user-facing line reads `"Login flow" retried 3 times` instead. The
 * rest of the string passes through unchanged.
 */
function translateFeatureIdsInDetail(detail: string, spec: Spec): string {
  if (!detail) return '';
  // Match legacy sequential ids (F-NNN) AND the v0.3.9+ hash model (F-<6-8 hex>),
  // so a hash-id feature title translates in halt detail strings too.
  return detail.replace(/\bF-(?:[0-9a-f]{6,8}|\d{3,})\b/g, (id) => {
    const title = featureLabel(id, spec);
    return title === id ? id : `"${title}"`;
  });
}

// ─── Plain-first finding render (F-dd8dc994) ───────────────────────────
//
// The loudest emitters — the Stop hook block, the PostToolUse drift line, the
// `clad check` finding block, and the `clad done` refusal — used to print raw
// `DETECTOR_ID: mechanism message`. This catalog is the human-render boundary
// for those surfaces: every drift detector gets a one-sentence plain lead in
// each shipped locale, and the machine detail (detector id + path) is demoted
// to a parenthetical tail. Locale is resolved HERE, not by an agent, because
// hook text reaches the user raw — before anything can translate it.

/** The shipped user-facing locales. Machine tails stay language-neutral. */
export type PlainLocale = 'en' | 'ko' | 'ja' | 'zh';

interface PlainEntry {
  /** One plain sentence a non-developer understands. No trailing period. */
  readonly lead: string;
  /** Optional next step. CLI commands allowed; MCP tool names never. */
  readonly action?: string;
}

/**
 * Per-detector plain wording, one entry per shipped locale. Keys are the frozen
 * detector ids from `allDetectors` (src/stages/detectors/index.ts); the
 * completeness test asserts every registered detector has a row here with a
 * non-empty lead in BOTH locales (AC-746969b3). Seeded from docs/glossary.md
 * and each detector file header — one plain sentence, jargon-free.
 */
export const DETECTOR_PLAIN: Readonly<Record<string, Readonly<Record<PlainLocale, PlainEntry>>>> = {
  HARDCODED_SECRET: {
    en: {lead: 'A password or API key looks hard-coded in the source', action: 'move it to an environment variable or secret store'},
    ko: {lead: '소스 코드에 비밀번호나 API 키가 그대로 들어가 있는 것 같아요', action: '환경 변수나 비밀 저장소로 옮겨 주세요'},
    ja: {lead: 'パスワードや API キーがソースにそのまま書き込まれているようです', action: '環境変数やシークレットストアに移してください'},
    zh: {lead: '密码或 API 密钥似乎被直接写死在源代码里', action: '请把它移到环境变量或密钥库中'},
  },
  ARCHITECTURE_VIOLATION: {
    en: {lead: 'The code has an import loop or crosses a layer boundary the design forbids', action: 'break the import cycle or remove the disallowed import'},
    ko: {lead: '코드에 import 순환이 있거나, 설계가 금지한 계층 경계를 넘고 있어요', action: 'import 순환을 끊거나 금지된 import를 없애 주세요'},
    ja: {lead: 'コードに import の循環があるか、設計が禁じた層の境界を越えています', action: 'import の循環を断つか、禁止された import を取り除いてください'},
    zh: {lead: '代码存在 import 循环，或跨越了设计禁止的分层边界', action: '请打断 import 循环，或移除被禁止的 import'},
  },
  MISSING_IMPLEMENTATION: {
    en: {lead: 'The spec lists a file that is not on disk yet', action: 'create the file, or remove it from the feature module list'},
    ko: {lead: '스펙에는 있는 파일이 아직 디스크에 없어요', action: '파일을 만들거나, 기능의 모듈 목록에서 빼 주세요'},
    ja: {lead: '仕様に載っているファイルがまだディスク上にありません', action: 'ファイルを作成するか、機能のモジュール一覧から外してください'},
    zh: {lead: '规格里列出的文件还不在磁盘上', action: '请创建该文件，或从功能的模块清单中移除'},
  },
  UNMAPPED_ARTIFACT: {
    en: {lead: 'A source file exists that no feature in the spec claims', action: 'add it to a feature module list, or delete the file'},
    ko: {lead: '어떤 기능도 자기 것이라고 하지 않은 소스 파일이 있어요', action: '그 파일을 기능의 모듈 목록에 넣거나 삭제해 주세요'},
    ja: {lead: 'どの機能も自分のものだと主張していないソースファイルがあります', action: '機能のモジュール一覧に加えるか、ファイルを削除してください'},
    zh: {lead: '有一个源文件没有任何功能声明拥有它', action: '请把它加入某个功能的模块清单，或删除该文件'},
  },
  TECH_STACK_MISMATCH: {
    en: {lead: 'The spec names one programming language but the code looks like another', action: 'update project.language in the spec to match the code'},
    ko: {lead: '스펙에 적힌 프로그래밍 언어와 실제 코드의 언어가 달라요', action: '스펙의 project.language를 코드에 맞게 고쳐 주세요'},
    ja: {lead: '仕様が挙げているプログラミング言語と、実際のコードの言語が違います', action: '仕様の project.language をコードに合わせて直してください'},
    zh: {lead: '规格声明的编程语言与实际代码的语言不一致', action: '请把规格里的 project.language 改成与代码一致'},
  },
  STATUS_DRIFT: {
    en: {lead: 'A feature is marked done but its files or checks do not back that up', action: 'add the missing modules, or set the status back'},
    ko: {lead: '완료로 표시된 기능인데 파일이나 검증이 그것을 뒷받침하지 못해요', action: '빠진 모듈을 채우거나 상태를 되돌려 주세요'},
    ja: {lead: '完了と記された機能ですが、ファイルや検証がそれを裏付けていません', action: '足りないモジュールを補うか、状態を戻してください'},
    zh: {lead: '某功能被标记为已完成，但文件或检查并不支持这一点', action: '请补上缺失的模块，或把状态改回去'},
  },
  STALE_SPECIFICATION: {
    en: {lead: 'A feature has inconsistent lifecycle labels — for example archived but still marked active', action: 'reconcile the feature status and archive fields'},
    ko: {lead: '기능의 생명주기 표시가 서로 맞지 않아요 — 예를 들어 보관됨인데 아직 활성으로 표시돼 있어요', action: '기능의 상태와 보관 정보를 맞춰 주세요'},
    ja: {lead: '機能のライフサイクル表示が食い違っています — 例えばアーカイブ済みなのにまだ有効のままです', action: '機能の状態とアーカイブ情報をそろえてください'},
    zh: {lead: '功能的生命周期标记互相矛盾 — 例如已归档却仍标为进行中', action: '请让功能的状态与归档信息保持一致'},
  },
  REFERENCE_INTEGRITY: {
    en: {lead: 'The spec points to a feature id that does not exist', action: 'fix the reference or add the missing feature'},
    ko: {lead: '스펙이 존재하지 않는 기능 ID를 가리키고 있어요', action: '참조를 고치거나 빠진 기능을 추가해 주세요'},
    ja: {lead: '仕様が存在しない機能 ID を指しています', action: '参照を直すか、足りない機能を追加してください'},
    zh: {lead: '规格指向了一个不存在的功能 ID', action: '请修正引用，或补上缺失的功能'},
  },
  DOC_LINK_INTEGRITY: {
    en: {lead: 'A documentation link or feature reference points to something that no longer exists', action: 'fix the broken link or reference in the doc'},
    ko: {lead: '문서의 링크나 기능 참조가 더 이상 존재하지 않는 대상을 가리켜요', action: '문서의 깨진 링크나 참조를 고쳐 주세요'},
    ja: {lead: 'ドキュメントのリンクや機能参照が、もう存在しない対象を指しています', action: 'ドキュメントの壊れたリンクや参照を直してください'},
    zh: {lead: '文档里的链接或功能引用指向了已不存在的对象', action: '请修复文档里失效的链接或引用'},
  },
  HARNESS_INTEGRITY: {
    en: {lead: 'The cladding setup is inconsistent — a version or count does not match across its files'},
    ko: {lead: '클래딩 설정이 서로 맞지 않아요 — 버전이나 개수가 파일마다 달라요'},
    ja: {lead: 'cladding の設定に食い違いがあります — バージョンや個数がファイルごとに違います'},
    zh: {lead: 'cladding 的配置存在不一致 — 版本号或数量在各文件之间对不上'},
  },
  META_INTEGRITY: {
    en: {lead: 'The spec schema files are missing or malformed', action: 'restore spec/schema.json (reinstall cladding if needed)'},
    ko: {lead: '스펙 스키마 파일이 없거나 손상됐어요', action: 'spec/schema.json을 복구해 주세요(필요하면 클래딩을 다시 설치)'},
    ja: {lead: '仕様スキーマのファイルが見つからないか壊れています', action: 'spec/schema.json を復元してください(必要なら cladding を入れ直してください)'},
    zh: {lead: '规格 schema 文件缺失或已损坏', action: '请恢复 spec/schema.json（必要时重装 cladding）'},
  },
  AC_DRIFT: {
    en: {lead: 'An acceptance criterion is incomplete or out of sync with the spec', action: 'write the criterion text or its when/shall/so-that fields'},
    ko: {lead: '인수 기준이 불완전하거나 스펙과 맞지 않아요', action: '그 기준의 문장이나 조건·동작·결과 항목을 채워 주세요'},
    ja: {lead: 'ある受け入れ基準が不完全か、仕様と合っていません', action: 'その基準の文章、または条件・動作・結果の項目を埋めてください'},
    zh: {lead: '某条验收标准不完整，或与规格不一致', action: '请补全该标准的描述，或它的条件·动作·结果字段'},
  },
  MISSING_TESTS: {
    en: {lead: 'A finished feature has an acceptance criterion with nothing proving it works', action: 'add a test file or evidence reference to the criterion'},
    ko: {lead: '완료된 기능의 인수 기준 중 하나에 그것이 동작함을 증명할 것이 없어요', action: '그 기준에 테스트 파일이나 증거 참조를 추가해 주세요'},
    ja: {lead: '完了した機能の受け入れ基準に、動作を証明するものが何もありません', action: 'その基準にテストファイルか証拠の参照を追加してください'},
    zh: {lead: '已完成功能的某条验收标准没有任何东西能证明它可用', action: '请为该标准添加测试文件或证据引用'},
  },
  STALE_TESTS: {
    en: {lead: 'The tests are much older than the code they cover, so they may no longer match', action: 'review and refresh the outdated tests'},
    ko: {lead: '테스트가 대상 코드보다 훨씬 오래돼서 더 이상 맞지 않을 수 있어요', action: '오래된 테스트를 살펴보고 갱신해 주세요'},
    ja: {lead: 'テストが対象コードよりかなり古く、もう合っていないかもしれません', action: '古くなったテストを見直して更新してください'},
    zh: {lead: '测试比它覆盖的代码旧很多，可能已经对不上了', action: '请检查并更新过时的测试'},
  },
  COVERAGE_DROP: {
    en: {lead: 'Test coverage fell below the project minimum', action: 'add tests until coverage clears the floor'},
    ko: {lead: '테스트 커버리지가 프로젝트 최소 기준 아래로 떨어졌어요', action: '커버리지가 기준을 넘을 때까지 테스트를 추가해 주세요'},
    ja: {lead: 'テストカバレッジがプロジェクトの最低基準を下回りました', action: '基準を超えるまでテストを追加してください'},
    zh: {lead: '测试覆盖率跌到了项目的最低标准以下', action: '请补充测试，直到覆盖率达标'},
  },
  PERFORMANCE_DRIFT: {
    en: {lead: 'A measured performance number is noticeably worse than the saved baseline', action: 'investigate the slowdown or update the baseline'},
    ko: {lead: '측정된 성능 수치가 저장된 기준선보다 눈에 띄게 나빠졌어요', action: '느려진 원인을 확인하거나 기준선을 갱신해 주세요'},
    ja: {lead: '計測した性能値が、保存された基準値より目立って悪くなっています', action: '遅くなった原因を調べるか、基準値を更新してください'},
    zh: {lead: '实测的性能数值明显比保存的基准差', action: '请排查变慢的原因，或更新基准值'},
  },
  EVIDENCE_MISMATCH: {
    en: {lead: 'A recorded piece of evidence points to a file that is gone from disk', action: 'restore the file or update the evidence record'},
    ko: {lead: '기록된 증거가 디스크에서 사라진 파일을 가리켜요', action: '파일을 복구하거나 증거 기록을 갱신해 주세요'},
    ja: {lead: '記録された証拠が、ディスクから消えたファイルを指しています', action: 'ファイルを復元するか、証拠の記録を更新してください'},
    zh: {lead: '一条已记录的证据指向了磁盘上已消失的文件', action: '请恢复该文件，或更新证据记录'},
  },
  STALE_EVIDENCE: {
    en: {lead: 'A piece of verification evidence is more than 90 days old', action: 're-verify so the evidence is current'},
    ko: {lead: '검증 증거가 90일이 넘었어요', action: '다시 검증해서 증거를 최신으로 만들어 주세요'},
    ja: {lead: '検証の証拠が 90 日より古くなっています', action: '再検証して証拠を最新にしてください'},
    zh: {lead: '某条验证证据已超过 90 天', action: '请重新验证，让证据保持最新'},
  },
  UNTESTED_AC: {
    en: {lead: 'A finished criterion names a test file that is not on disk', action: 'add the missing test file or fix the reference'},
    ko: {lead: '완료된 기준이 디스크에 없는 테스트 파일을 가리켜요', action: '빠진 테스트 파일을 추가하거나 참조를 고쳐 주세요'},
    ja: {lead: '完了した基準が、ディスクにないテストファイルを指しています', action: '足りないテストファイルを追加するか、参照を直してください'},
    zh: {lead: '已完成的标准指向了磁盘上不存在的测试文件', action: '请补上缺失的测试文件，或修正引用'},
  },
  UNVERIFIED_AC: {
    en: {lead: 'A finished criterion has a test that exists but never actually ran and passed', action: 'run the test suite so the result is recorded'},
    ko: {lead: '완료된 기준의 테스트가 존재하지만 실제로 실행되어 통과한 적이 없어요', action: '테스트를 실행해서 결과가 기록되게 해 주세요'},
    ja: {lead: '完了した基準のテストは存在しますが、実際に実行され合格したことがありません', action: 'テストを実行して結果が記録されるようにしてください'},
    zh: {lead: '已完成标准的测试虽然存在，却从未真正运行并通过', action: '请运行测试套件，让结果被记录下来'},
  },
  CONVENTION_DRIFT: {
    en: {lead: 'A source file is missing its leading explanatory comment', action: 'add a short header comment explaining the file purpose'},
    ko: {lead: '소스 파일 맨 위에 설명 주석이 없어요', action: '그 파일의 목적을 설명하는 짧은 머리말 주석을 달아 주세요'},
    ja: {lead: 'ソースファイルの先頭に説明のコメントがありません', action: 'そのファイルの目的を説明する短い見出しコメントを付けてください'},
    zh: {lead: '某个源文件缺少开头的说明性注释', action: '请加一段简短的文件头注释，说明该文件的用途'},
  },
  FIXTURE_REFERENCE_INVALID: {
    en: {lead: 'A criterion refers to a test fixture that is not registered', action: 'register the fixture or fix the reference name'},
    ko: {lead: '어떤 기준이 등록되지 않은 테스트 픽스처를 가리켜요', action: '픽스처를 등록하거나 참조 이름을 고쳐 주세요'},
    ja: {lead: 'ある基準が、登録されていないテストフィクスチャを指しています', action: 'フィクスチャを登録するか、参照名を直してください'},
    zh: {lead: '某条标准引用了一个未注册的测试夹具(fixture)', action: '请注册该夹具，或修正引用名称'},
  },
  SLUG_CONFLICT: {
    en: {lead: 'Two features or two scenarios share the same short name', action: 'rename one so each short name is unique'},
    ko: {lead: '두 기능(또는 두 시나리오)이 같은 짧은 이름을 쓰고 있어요', action: '하나의 이름을 바꿔 각 이름이 겹치지 않게 해 주세요'},
    ja: {lead: '二つの機能(または二つのシナリオ)が同じ短い名前を使っています', action: 'どちらかの名前を変えて、重ならないようにしてください'},
    zh: {lead: '两个功能（或两个场景）用了相同的短名称', action: '请重命名其中一个，让名称各自唯一'},
  },
  ID_COLLISION: {
    en: {lead: 'Two features or two scenarios share the same id', action: 'give one of them a new id'},
    ko: {lead: '두 기능(또는 두 시나리오)이 같은 ID를 쓰고 있어요', action: '둘 중 하나에 새 ID를 부여해 주세요'},
    ja: {lead: '二つの機能(または二つのシナリオ)が同じ ID を使っています', action: 'どちらかに新しい ID を付けてください'},
    zh: {lead: '两个功能（或两个场景）用了相同的 ID', action: '请给其中一个分配新的 ID'},
  },
  INVENTORY_DRIFT: {
    en: {lead: 'The spec summary counts do not match the shard files on disk', action: 'run `clad sync` to refresh the counts'},
    ko: {lead: '스펙 요약 개수가 실제 디스크의 조각 파일 수와 맞지 않아요', action: '`clad sync`를 실행해 개수를 갱신해 주세요'},
    ja: {lead: '仕様のまとめの件数が、ディスク上の分割ファイルの数と合っていません', action: '`clad sync` を実行して件数を更新してください'},
    zh: {lead: '规格里的汇总数量与磁盘上的分片文件数对不上', action: '请运行 `clad sync` 刷新数量'},
  },
  AC_DUPLICATE_WITHIN_FEATURE: {
    en: {lead: 'The same criterion id appears twice inside one feature', action: 'renumber or remove the duplicate criterion'},
    ko: {lead: '한 기능 안에 같은 기준 ID가 두 번 나와요', action: '중복된 기준의 번호를 바꾸거나 제거해 주세요'},
    ja: {lead: '一つの機能の中に同じ基準 ID が二回出てきます', action: '重複した基準の番号を変えるか、削除してください'},
    zh: {lead: '同一个功能里出现了两次相同的标准 ID', action: '请给重复的标准改号或删除'},
  },
  ARCHITECTURE_FROM_SPEC: {
    en: {lead: 'The code imports across layers in a way the architecture rules forbid', action: 'remove the cross-layer import or update the architecture rules'},
    ko: {lead: '코드가 아키텍처 규칙이 금지한 방식으로 계층을 넘어 import 해요', action: '계층을 넘는 import를 없애거나 아키텍처 규칙을 고쳐 주세요'},
    ja: {lead: 'コードが、アーキテクチャの規則が禁じた形で層をまたいで import しています', action: '層をまたぐ import を外すか、アーキテクチャ規則を直してください'},
    zh: {lead: '代码以架构规则禁止的方式跨层 import', action: '请移除跨层 import，或修改架构规则'},
  },
  CAPABILITIES_FEATURE_MAPPING: {
    en: {lead: 'A capability lists a feature id that does not exist', action: 'fix the capability feature list'},
    ko: {lead: '어떤 역량(capability)이 존재하지 않는 기능 ID를 나열하고 있어요', action: '그 역량의 기능 목록을 고쳐 주세요'},
    ja: {lead: 'ある能力(capability)が、存在しない機能 ID を挙げています', action: 'その能力の機能一覧を直してください'},
    zh: {lead: '某项能力(capability)列出了一个不存在的功能 ID', action: '请修正该能力的功能清单'},
  },
  ABSENCE_OF_GOVERNANCE: {
    en: {lead: 'This project has no cladding spec set up, so the checks have nothing to inspect', action: 'run `clad init` to set up the spec'},
    ko: {lead: '이 프로젝트에 클래딩 스펙이 설정돼 있지 않아서 검사가 살펴볼 것이 없어요', action: '`clad init`으로 스펙을 만들어 주세요'},
    ja: {lead: 'このプロジェクトには cladding の仕様が用意されておらず、検査するものがありません', action: '`clad init` を実行して仕様を用意してください'},
    zh: {lead: '这个项目还没有配置 cladding 规格，检查无从下手', action: '请运行 `clad init` 来建立规格'},
  },
  AI_HINTS_FORBIDDEN_PATTERN: {
    en: {lead: 'The code uses a pattern the project rules told the AI never to use', action: 'remove the forbidden pattern named in the project ai_hints'},
    ko: {lead: '프로젝트 규칙이 AI에게 쓰지 말라고 한 패턴이 코드에 있어요', action: '프로젝트 ai_hints에 지정된 금지 패턴을 제거해 주세요'},
    ja: {lead: 'プロジェクトの規則が AI に使うなと指定したパターンがコードにあります', action: 'プロジェクトの ai_hints に挙げられた禁止パターンを取り除いてください'},
    zh: {lead: '代码里出现了项目规则明确禁止 AI 使用的写法', action: '请移除项目 ai_hints 中列出的禁用写法'},
  },
  PLANNED_BACKLOG: {
    en: {lead: 'Several features are specced but have no code yet — the plan has run ahead of the work', action: 'implement the pending features before adding more'},
    ko: {lead: '여러 기능이 스펙만 있고 아직 코드가 없어요 — 계획이 작업보다 앞서갔어요', action: '새 기능을 더 만들기 전에 밀린 기능들을 먼저 구현해 주세요'},
    ja: {lead: 'いくつもの機能が仕様だけあってまだコードがありません — 計画が作業より先走っています', action: '新しい機能を増やす前に、たまった機能を先に作ってください'},
    zh: {lead: '有好几个功能只有规格却还没有代码 — 计划跑到了实现前面', action: '请先实现积压的功能，再添加新的'},
  },
  HOLLOW_GOVERNANCE: {
    en: {lead: 'The design files exist but are still empty templates', action: 'fill in the capabilities and architecture files'},
    ko: {lead: '설계 파일이 있긴 하지만 아직 빈 템플릿이에요', action: '역량과 아키텍처 파일을 채워 주세요'},
    ja: {lead: '設計ファイルはありますが、まだ空のひな形のままです', action: '能力とアーキテクチャのファイルを埋めてください'},
    zh: {lead: '设计文件虽然存在，但还是空的模板', action: '请填写能力与架构文件'},
  },
  DEPENDENCY_CYCLE: {
    en: {lead: 'Features depend on each other in a loop, so none of them can ever start', action: 'break the dependency loop between the features'},
    ko: {lead: '기능들이 서로 순환으로 의존해서 아무것도 시작할 수 없어요', action: '기능들 사이의 의존 순환을 끊어 주세요'},
    ja: {lead: '機能どうしが輪になって依存しているため、どれも始められません', action: '機能どうしの依存の輪を断ってください'},
    zh: {lead: '功能之间形成了环状依赖，导致谁都无法开始', action: '请打断功能之间的依赖环'},
  },
  SCENARIO_COVERAGE: {
    en: {lead: 'This project defines no user-journey scenarios, or a scenario links no features', action: 'add a scenario, or bind features to the empty one'},
    ko: {lead: '이 프로젝트에 사용자 흐름 시나리오가 없거나, 어떤 시나리오가 아무 기능과도 연결돼 있지 않아요', action: '시나리오를 추가하거나 빈 시나리오에 기능을 연결해 주세요'},
    ja: {lead: 'このプロジェクトには利用者の流れのシナリオが無いか、どの機能ともつながっていないシナリオがあります', action: 'シナリオを追加するか、空のシナリオに機能を結び付けてください'},
    zh: {lead: '这个项目没有定义用户旅程场景，或有场景没有关联任何功能', action: '请添加场景，或给空场景关联功能'},
  },
  PROJECT_CONTEXT_DRIFT: {
    en: {lead: 'The project why-it-exists document is still the empty starter stub', action: 'write docs/project-context.md, or re-run `clad init`'},
    ko: {lead: '프로젝트의 "존재 이유" 문서가 아직 빈 시작 틀 그대로예요', action: 'docs/project-context.md를 작성하거나 `clad init`을 다시 실행해 주세요'},
    ja: {lead: 'プロジェクトの「なぜ存在するか」の文書が、まだ空の初期ひな形のままです', action: 'docs/project-context.md を書くか、`clad init` をやり直してください'},
    zh: {lead: '项目的“为什么存在”文档还是空的初始模板', action: '请撰写 docs/project-context.md，或重新运行 `clad init`'},
  },
  SPEC_CONFORMANCE: {
    en: {lead: 'A finished feature is missing the spec-derived test that should prove it', action: 'add the required oracle test — `clad oracle <feature>` prints the brief'},
    ko: {lead: '완료된 기능에 그것을 증명해야 할 스펙 기반 검증 테스트가 없어요', action: '필요한 오라클 테스트를 추가해 주세요 — `clad oracle <기능>`이 안내를 출력해요'},
    ja: {lead: '完了した機能に、それを裏付けるはずの仕様由来のテストがありません', action: '必要なオラクルテストを追加してください — `clad oracle <機能>` が手引きを出します'},
    zh: {lead: '已完成的功能缺少本应证明它的、由规格推导出的测试', action: '请补上所需的 oracle 测试 —— `clad oracle <功能>` 会给出说明'},
  },
  DELIVERABLE_INTEGRITY: {
    en: {lead: 'The declared entry point is missing, or a shipped feature declares none to smoke-test', action: 'fix project.deliverable.path, or declare the entry point'},
    ko: {lead: '선언한 실행 진입점이 없거나, 출하된 기능에 점검할 진입점이 선언돼 있지 않아요', action: 'project.deliverable.path를 고치거나 진입점을 선언해 주세요'},
    ja: {lead: '宣言した実行の入口が見つからないか、出荷した機能に点検できる入口が宣言されていません', action: 'project.deliverable.path を直すか、入口を宣言してください'},
    zh: {lead: '声明的运行入口不存在，或已交付的功能没有声明可供冒烟检查的入口', action: '请修正 project.deliverable.path，或声明入口'},
  },
  SMOKE_PROBE_DEMAND: {
    en: {lead: 'A shipped, runnable project has no smoke check proving its entry point actually runs', action: 'add a smoke probe under project.smoke'},
    ko: {lead: '실행 가능한 출하 프로젝트인데 진입점이 실제로 도는지 증명할 스모크 점검이 없어요', action: 'project.smoke 아래에 스모크 프로브를 추가해 주세요'},
    ja: {lead: '実行できる出荷プロジェクトなのに、入口が実際に動くと証明する煙テストがありません', action: 'project.smoke の下に煙テスト(smoke probe)を追加してください'},
    zh: {lead: '这是一个可运行的交付项目，却没有冒烟检查来证明入口确实能跑', action: '请在 project.smoke 下添加一个冒烟探针'},
  },
  STALE_ATTESTATION: {
    en: {lead: 'Shipped code has changed since it was last verified', action: 're-run `clad check --tier=pre-push --strict` to refresh the attestation'},
    ko: {lead: '출하된 코드가 마지막으로 검증된 이후 바뀌었어요', action: '`clad check --tier=pre-push --strict`를 다시 실행해 검증 서명을 갱신해 주세요'},
    ja: {lead: '出荷したコードが、最後に検証されて以降に変わっています', action: '`clad check --tier=pre-push --strict` をもう一度実行して検証署名を更新してください'},
    zh: {lead: '已交付的代码自上次验证以来发生了改动', action: '请重新运行 `clad check --tier=pre-push --strict` 刷新验证签名'},
  },
  INFERABLE_DEPENDS_ON: {
    en: {lead: 'The code imports across feature boundaries the spec never recorded as dependencies', action: 'run `clad infer-deps` to see suggested dependency links'},
    ko: {lead: '코드가 기능 경계를 넘어 import 하는데 스펙에는 그 의존 관계가 기록돼 있지 않아요', action: '`clad infer-deps`를 실행해 추천 의존 관계를 확인해 주세요'},
    ja: {lead: 'コードは機能の境界を越えて import しているのに、仕様にその依存関係が記録されていません', action: '`clad infer-deps` を実行して、提案された依存関係を確認してください'},
    zh: {lead: '代码跨越功能边界 import，但规格里没有记录相应的依赖关系', action: '请运行 `clad infer-deps` 查看建议的依赖关系'},
  },
  HOST_CLAIM_DRIFT: {
    en: {lead: 'The README claims a support level that the recorded test evidence does not back', action: 'align the README host-claim with the evidence'},
    ko: {lead: 'README가 주장하는 지원 수준을 기록된 테스트 증거가 뒷받침하지 못해요', action: 'README의 호스트 지원 주장을 증거에 맞춰 주세요'},
    ja: {lead: 'README がうたう対応レベルを、記録されたテストの証拠が裏付けていません', action: 'README の対応表明を証拠に合わせてください'},
    zh: {lead: 'README 声称的支持级别，记录的测试证据并不支持', action: '请让 README 的主机支持声明与证据一致'},
  },
};

/** Clip a string to a budget, appending an ellipsis. Keeps a render bounded. */
function clip(s: string, max = 160): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * The plain lead for a detector in the resolved locale. Falls back to the raw
 * machine message for synthetic findings that carry no catalog row (the Stop
 * gate's ARCH / SECRET adapter failures), so nothing is ever swallowed.
 *
 * @param detector - The frozen detector id (or a synthetic label).
 * @param locale - The resolved user locale.
 * @param fallback - Raw message used when the detector has no catalog row.
 */
export function plainLead(detector: string, locale: PlainLocale, fallback = ''): string {
  const entry = DETECTOR_PLAIN[detector];
  if (entry) return entry[locale].lead;
  return clip(fallback || detector);
}

/**
 * Renders one finding plain-first as `<lead> (<detector> · <path>)`: the plain
 * sentence leads, and the machine detail (detector id + path) is demoted to the
 * parenthetical tail (AC-263adf79). The parameter is structural so it accepts a
 * DriftFinding, a Stop-gate failure, or a check-stage finding alike.
 *
 * @param f - Any finding-shaped value with a detector, message, and path.
 * @param locale - The resolved user locale.
 */
export function plainFinding(f: {readonly detector: string; readonly path?: string; readonly message: string}, locale: PlainLocale): string {
  const lead = plainLead(f.detector, locale, f.message);
  const where = f.path ? ` · ${f.path}` : '';
  return `${lead} (${f.detector}${where})`;
}

/**
 * Stop-gate block message. `examples` are already rendered via {@link plainFinding};
 * the count is preserved so the surface still says how many things drifted.
 */
export function stopBlockMessage(count: number, examples: string, locale: PlainLocale): string {
  if (locale === 'ko') {
    return `cladding이 마무리를 잠시 붙잡았어요: 스펙과 어긋난 항목 ${count}개 — 예: ${examples}. 작업 중이면 한 번 더 종료하면 넘어갑니다.`;
  }
  if (locale === 'ja') {
    return `cladding が仕上げの前で一旦止まりました: 仕様と食い違う項目が ${count} 件あります — 例: ${examples}。作業中なら、もう一度停止すれば見送ります。`;
  }
  if (locale === 'zh') {
    return `cladding 在收尾前先停了一下：有 ${count} 处还和规格对不上 —— 例如 ${examples}。还在改？再停一次就先跳过。`;
  }
  if (count === 1) {
    return `cladding paused before finishing: 1 thing doesn't match the spec yet — e.g. ${examples}. In-progress work? Stop once more to snooze.`;
  }
  return `cladding paused before finishing: ${count} things don't match the spec yet — e.g. ${examples}. In-progress work? Stop once more to snooze.`;
}

/**
 * PostToolUse drift-nudge line. `lead` is the resolved plain sentence; the
 * detector id is demoted to a `(details: …)` tail; `deferred` carries the
 * language-neutral `(+N deferred to commit)` note verbatim (may be empty).
 */
export function driftNudge(count: number, lead: string, detector: string, deferred: string, locale: PlainLocale): string {
  if (locale === 'ko') {
    return `cladding 드리프트: 오류 ${count}건 — ${lead} (details: ${detector})${deferred}`;
  }
  if (locale === 'ja') {
    return `cladding ドリフト: エラー ${count} 件 — ${lead} (details: ${detector})${deferred}`;
  }
  if (locale === 'zh') {
    return `cladding 偏移：${count} 个错误 —— ${lead} (details: ${detector})${deferred}`;
  }
  return `cladding drift: ${count} error(s) — ${lead} (details: ${detector})${deferred}`;
}

/**
 * The plain lead a `clad done` refusal opens with. The machine sentence
 * (`strict gate not GREEN — status left at …`) follows as a language-neutral tail.
 */
export function doneRefusalLead(locale: PlainLocale): string {
  switch (locale) {
    case 'ko':
      return '완료 점검에서 위와 같은 문제가 발견됐어요 — 고친 뒤 다시 실행해 주세요';
    case 'ja':
      return '完了チェックが上記の問題を見つけました — 直してから再実行してください';
    case 'zh':
      return '完成检查发现了上面的问题 —— 请修复后重新运行';
    default:
      return 'the completion check found problems above — fix them and re-run';
  }
}

/**
 * Resolves the user-facing locale, never throwing. Priority:
 *   1. `.cladding/user-locale` sidecar — a one-line file a later feature writes
 *      from the detected user-prompt language (READ-only here; absence or garbage
 *      is tolerated);
 *   2. spec.yaml `project.locale`;
 *   3. `LANG`/`LC_ALL` env (a `ko` / `ja` / `zh` prefix);
 *   4. `en`.
 * Any malformed input degrades down the chain, so a render is always in a
 * shipped locale.
 *
 * @param cwd - Project root to read `spec.yaml` / the sidecar from. Defaults to `.`.
 */
export function resolveLocale(cwd = '.'): PlainLocale {
  const fromSidecar = readSidecarLocale(cwd);
  if (fromSidecar) return fromSidecar;
  const fromSpec = readSpecLocale(cwd);
  if (fromSpec) return fromSpec;
  const fromEnv = matchLocale(process.env.LC_ALL || process.env.LANG || '');
  return fromEnv ?? 'en';
}

/** Maps a raw locale-ish string to a shipped locale by prefix. null ⇒ no match. */
function matchLocale(raw: unknown): PlainLocale | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v.startsWith('ko')) return 'ko';
  if (v.startsWith('ja')) return 'ja';
  if (v.startsWith('zh')) return 'zh';
  if (v.startsWith('en')) return 'en';
  return null;
}

/**
 * Tolerant read of the `.cladding/user-locale` sidecar (first line only). This
 * module NEVER writes it — a later feature (the UserPromptSubmit surface) owns
 * detection-writing. null ⇒ absent/garbage ⇒ fall through.
 */
function readSidecarLocale(cwd: string): PlainLocale | null {
  try {
    const path = join(cwd, '.cladding', 'user-locale');
    if (!existsSync(path)) return null;
    return matchLocale(readFileSync(path, 'utf8').split('\n')[0]);
  } catch {
    return null;
  }
}

/** Tolerant read of `project.locale` from spec.yaml. null ⇒ fall through. */
function readSpecLocale(cwd: string): PlainLocale | null {
  try {
    const path = join(cwd, 'spec.yaml');
    if (!existsSync(path)) return null;
    const doc = parseYaml(readFileSync(path, 'utf8')) as {project?: {locale?: unknown}} | null;
    return matchLocale(doc?.project?.locale);
  } catch {
    return null; // never throw — a render must not depend on a parseable spec
  }
}
