// Cladding · scenarios · ab · query benchmark (v0.3.47, F-ba2e05)
//
// Outcome-quality dimension #2 — measures how many files an AI agent
// must open to answer 5 deterministic domain questions about each
// tmpdir. Cladding-managed trees expose the answer in a single spec
// file (e.g. `spec/features/refund-flow-*.yaml`); vanilla trees have
// no canonical source so the agent must grep the codebase or admit
// inability.
//
// `filesOpened` is the literal count of file-reads the deterministic
// answer function performs. Lower = better. `answered=false` means
// the tree does not contain the answer at all (worse than a high
// count). The benchmark is intentionally a simple cost proxy, not
// a real LLM run; see docs/ab-evaluation/README.md §Limitations.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

import yaml from 'yaml';

export interface QueryAnswer {
  readonly questionId: string;
  readonly question: string;
  /** True when the tree contained enough information to answer; false = unanswerable. */
  readonly answered: boolean;
  /** Number of file reads the answer function performed. 0 when unanswerable. */
  readonly filesOpened: number;
  /** Short string of the answer (for the report). */
  readonly answer: string;
}

export interface DomainQuery {
  readonly id: string;
  readonly question: string;
  readonly run: (cwd: string) => QueryAnswer;
}

function unanswered(id: string, question: string, reason = 'not found'): QueryAnswer {
  return {questionId: id, question, answered: false, filesOpened: 0, answer: reason};
}

// ──────────────────────────────────────────────────────────────────
// Q1 — Which feature implements the refund flow?
//
// Cladding tree: `grep -l refund-flow spec/features/*.yaml` → 1 file
// open, returns the feature id.
// Vanilla tree:   no spec/ → must grep src/ + tests/, returns code
// paths but no canonical feature identity.
// ──────────────────────────────────────────────────────────────────

const Q1: DomainQuery = {
  id: 'Q1',
  question: 'Which feature implements the refund flow?',
  run: (cwd) => {
    const featuresDir = join(cwd, 'spec/features');
    if (existsSync(featuresDir)) {
      let filesOpened = 0;
      for (const name of readdirSync(featuresDir)) {
        if (!name.endsWith('.yaml')) continue;
        filesOpened++;
        const body = readFileSync(join(featuresDir, name), 'utf8');
        if (body.includes('refund-flow') || body.includes('refund')) {
          const idMatch = body.match(/id:\s*(F-\w+)/);
          return {
            questionId: 'Q1',
            question: Q1.question,
            answered: true,
            filesOpened,
            answer: idMatch ? idMatch[1] : 'matched but no id',
          };
        }
      }
    }
    // Vanilla path — grep src/ + tests/ for "refund" substring.
    const candidates: string[] = [];
    for (const root of ['src', 'tests']) {
      walkTs(join(cwd, root), candidates);
    }
    let filesOpened = 0;
    let hit = '';
    for (const abs of candidates) {
      filesOpened++;
      try {
        if (readFileSync(abs, 'utf8').toLowerCase().includes('refund')) {
          hit = hit || abs.replace(cwd + '/', '');
        }
      } catch {
        // ignore
      }
    }
    if (hit) {
      return {
        questionId: 'Q1',
        question: Q1.question,
        answered: true,
        filesOpened,
        answer: `code path: ${hit} (no canonical feature id)`,
      };
    }
    return unanswered('Q1', Q1.question);
  },
};

// ──────────────────────────────────────────────────────────────────
// Q2 — How many acceptance criteria does the refund flow have?
//
// Cladding: parse the matching feature shard → count.
// Vanilla:   no AC concept exists. Always unanswerable.
// ──────────────────────────────────────────────────────────────────

const Q2: DomainQuery = {
  id: 'Q2',
  question: 'How many acceptance criteria does the refund flow have?',
  run: (cwd) => {
    const featuresDir = join(cwd, 'spec/features');
    if (!existsSync(featuresDir)) return unanswered('Q2', Q2.question, 'no spec/features/ — vanilla cannot answer');
    let filesOpened = 0;
    for (const name of readdirSync(featuresDir)) {
      if (!name.endsWith('.yaml')) continue;
      filesOpened++;
      const body = readFileSync(join(featuresDir, name), 'utf8');
      if (!body.includes('refund')) continue;
      try {
        const parsed = yaml.parse(body) as {acceptance_criteria?: readonly unknown[]} | null;
        const count = Array.isArray(parsed?.acceptance_criteria) ? parsed.acceptance_criteria.length : 0;
        return {
          questionId: 'Q2',
          question: Q2.question,
          answered: true,
          filesOpened,
          answer: `${count} AC(s)`,
        };
      } catch {
        // ignore parse errors
      }
    }
    return unanswered('Q2', Q2.question, 'refund feature shard not found');
  },
};

// ──────────────────────────────────────────────────────────────────
// Q3 — What layers are forbidden from importing each other?
//
// Cladding: 1 file (spec/architecture.yaml) → explicit rules.
// Vanilla:   no architecture.yaml; rules are convention-only.
// ──────────────────────────────────────────────────────────────────

const Q3: DomainQuery = {
  id: 'Q3',
  question: 'What are the architecture forbidden-import rules?',
  run: (cwd) => {
    const archAbs = join(cwd, 'spec/architecture.yaml');
    if (!existsSync(archAbs)) {
      return unanswered('Q3', Q3.question, 'no spec/architecture.yaml — vanilla has no explicit rules');
    }
    const body = readFileSync(archAbs, 'utf8');
    try {
      const parsed = yaml.parse(body) as {
        layers?: readonly unknown[];
        forbidden_imports?: readonly {from?: string; to?: string}[];
      } | null;
      const rules: string[] = [];
      // Object-form layers (LLM seed): `[{name, forbidden_imports: string[]}]`
      for (const layer of parsed?.layers ?? []) {
        if (typeof layer === 'object' && layer !== null && !Array.isArray(layer)) {
          const obj = layer as {name?: string; forbidden_imports?: readonly string[]};
          for (const forbidden of obj.forbidden_imports ?? []) {
            rules.push(`${obj.name} ↛ ${forbidden}`);
          }
        }
      }
      // Canonical-form forbidden_imports (top-level array of {from, to})
      for (const rule of parsed?.forbidden_imports ?? []) {
        if (rule?.from && rule?.to) rules.push(`${rule.from} ↛ ${rule.to}`);
      }
      return {
        questionId: 'Q3',
        question: Q3.question,
        answered: true,
        filesOpened: 1,
        answer: rules.length > 0 ? rules.join(', ') : 'no forbidden-import rules declared',
      };
    } catch {
      return unanswered('Q3', Q3.question, 'architecture.yaml unparseable');
    }
  },
};

// ──────────────────────────────────────────────────────────────────
// Q4 — Which capability is bound to which features?
//
// Cladding: 1 file (spec/capabilities.yaml) → explicit bindings.
// Vanilla:   no capability concept. Unanswerable.
// ──────────────────────────────────────────────────────────────────

const Q4: DomainQuery = {
  id: 'Q4',
  question: 'Which capabilities are bound to which features?',
  run: (cwd) => {
    const capsAbs = join(cwd, 'spec/capabilities.yaml');
    if (!existsSync(capsAbs)) {
      return unanswered('Q4', Q4.question, 'no spec/capabilities.yaml — vanilla has no capability concept');
    }
    const body = readFileSync(capsAbs, 'utf8');
    try {
      const parsed = yaml.parse(body) as {capabilities?: readonly {id?: string; features?: readonly string[]}[]} | null;
      const bindings: string[] = [];
      for (const cap of parsed?.capabilities ?? []) {
        const feats = cap?.features ?? [];
        if (feats.length > 0) bindings.push(`${cap.id}=[${feats.join(',')}]`);
      }
      return {
        questionId: 'Q4',
        question: Q4.question,
        answered: true,
        filesOpened: 1,
        answer: bindings.length > 0 ? bindings.join('; ') : 'all capabilities orphan (no bindings)',
      };
    } catch {
      return unanswered('Q4', Q4.question, 'capabilities.yaml unparseable');
    }
  },
};

// ──────────────────────────────────────────────────────────────────
// Q5 — How many test scenarios are declared?
//
// Cladding: 1 directory read (spec/scenarios/*.yaml).
// Vanilla:   no scenarios concept; must reverse-engineer from test files.
// ──────────────────────────────────────────────────────────────────

const Q5: DomainQuery = {
  id: 'Q5',
  question: 'How many test scenarios are declared?',
  run: (cwd) => {
    const scenariosDir = join(cwd, 'spec/scenarios');
    if (existsSync(scenariosDir)) {
      try {
        const shards = readdirSync(scenariosDir).filter((n) => n.endsWith('.yaml'));
        return {
          questionId: 'Q5',
          question: Q5.question,
          answered: true,
          filesOpened: 1, // single directory read
          answer: `${shards.length} scenario shard(s)`,
        };
      } catch {
        // ignore
      }
    }
    // Vanilla — count test files as a weak proxy.
    const testsDir = join(cwd, 'tests');
    if (!existsSync(testsDir)) return unanswered('Q5', Q5.question, 'no spec/scenarios/ and no tests/');
    const testFiles: string[] = [];
    walkTs(testsDir, testFiles);
    return {
      questionId: 'Q5',
      question: Q5.question,
      answered: true,
      filesOpened: testFiles.length,
      answer: `${testFiles.length} test file(s) (weak proxy — no canonical scenario declaration)`,
    };
  },
};

export const DOMAIN_QUERIES: readonly DomainQuery[] = [Q1, Q2, Q3, Q4, Q5];

export function answerAllQueries(cwd: string): readonly QueryAnswer[] {
  return DOMAIN_QUERIES.map((q) => q.run(cwd));
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function walkTs(rootAbs: string, out: string[]): void {
  if (!existsSync(rootAbs)) return;
  const queue: string[] = [rootAbs];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const childAbs = join(dir, name);
      let s;
      try {
        s = statSync(childAbs);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (name === 'node_modules' || name === '.cladding') continue;
        queue.push(childAbs);
      } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
        out.push(childAbs);
      }
    }
  }
}
