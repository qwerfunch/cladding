// Cladding · instruction-led language — the 2026-07-06 locale-machinery pivot
// (F-9af291fa)
//
// TEST-AUTHOR context: authored from spec/features/instruction-led-language-9af291fa.yaml's
// 3 ACs (the implementation diff was read only to locate the live exports and
// signatures to import — not to copy assertions from it).
//
// AC map:
//   AC-71ce42e5 — DETECTOR_PLAIN + the surface templates are English-only,
//                 completeness derived from the live detector registry (never
//                 a hardcoded count), templates carry no locale parameter, and
//                 the plain-lead-first render order is unchanged.
//   AC-ddb938fb — the interpreter instruction (CLAUDE_MD_SECTION +
//                 AGENTS_MD_TEMPLATE) explicitly directs the agent to relay
//                 cladding's own gate/hook messages by meaning, both freshness
//                 literals survive, and the size guard is respected.
//   AC-3f34759a — unwanted-behaviour: no locale-machinery symbol may reappear
//                 under src/ (structural sweep, with a mutation probe proving
//                 the sweep discriminates).
//
// NEW FILE (not appended to tests/plain-render.test.ts): that file is the
// AC-owning suite for the SIBLING feature F-dd8dc994 (its own header says so)
// — this file owns F-9af291fa's 3 ACs so each feature keeps a 1:1 spec-to-suite
// mapping, matching the repo's convention of one file per feature even where
// two features touch the same module (see claude-md-diet.test.ts vs
// agent-interpreter-rule.test.ts, both against src/init/host-instructions.ts).
// A few checks below are deliberately narrower re-derivations of things
// tests/plain-render.test.ts and tests/human-first-cards.test.ts already pin
// for F-dd8dc994 — kept here too because F-9af291fa's own AC text names them
// explicitly, and this suite must not depend on a sibling feature's tests
// surviving future edits.
//
// Needle-list design note: the AC-3f34759a sweep matches five EXACT symbol
// names — the locale-resolver function, the locale type alias, the sidecar
// reader function, the sidecar's path fragment, and the schema field's dotted
// path — rather than the bare word "locale": a bare sweep would false-positive
// on the ~30 unrelated `.localeCompare(...)` calls this codebase uses for
// stable string sorting (src/graph, src/report, src/optimizer, etc.). The
// exact-symbol sweep is a textual/substring scan; it does not see a runtime
// property chain like `doc?.project?.locale` (the `?.` breaks the dotted-path
// substring) — but that gap is closed by TypeScript itself: the field no
// longer exists on the `Project` type (src/spec/types.ts), so any code that
// read it would fail `tsc --noEmit`, independent of this sweep.
//
// Needle hygiene: like tests/cli/verb-residue.test.ts and
// tests/terminology-canon.test.ts, the five symbol names are assembled at
// runtime from fragments (see `assemble()` below) — never literal in this
// file's source — so this suite (itself a `tests/**/*.ts` file the sweep
// walks) does not self-trip its own tests/ pinned-allowlist check. No path-
// based self-exclusion is used; the assembly is what keeps this file honest.

import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {describe, expect, test} from 'vitest';

import {allDetectors} from '../src/stages/detectors/index.js';
import {AGENTS_MD_TEMPLATE, CLAUDE_MD_SECTION, isStaleInstructions} from '../src/init/host-instructions.js';
import {
  DETECTOR_PLAIN,
  doneRefusalLead,
  driftNudge,
  plainFinding,
  plainLead,
  stopBlockMessage,
} from '../src/ui/softShell.js';

const ROOT = process.cwd();
const norm = (s: string): string => s.replace(/\s+/g, ' ');

// ═══════════════════════════════════════════════════════════════════════
// AC-71ce42e5 — DETECTOR_PLAIN + surface templates: English-only, live-
// derived completeness, no locale params, plain-first order unchanged.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-71ce42e5 — English-only catalog + templates, no locale machinery, order unchanged', () => {
  describe('DETECTOR_PLAIN completeness is derived from the live registry (never a hardcoded count)', () => {
    const names = allDetectors.map((d) => d.name);

    test('the derivation is not vacuous: the live registry is non-empty with unique names', () => {
      expect(names.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
    });

    test('the catalog key set equals the live registry name set exactly — bidirectional, no literal count asserted', () => {
      const catalogKeys = Object.keys(DETECTOR_PLAIN);
      expect(new Set(catalogKeys)).toEqual(new Set(names));
      expect(catalogKeys.length).toBe(names.length);
    });

    test('every registered detector has a non-empty English lead', () => {
      for (const name of names) {
        expect(DETECTOR_PLAIN[name].lead.trim().length, `${name}.lead`).toBeGreaterThan(0);
      }
    });
  });

  describe('every catalog entry is a flat {lead, action?} — no locale sub-keys (en/ko/ja/zh) survive', () => {
    const localeSubkeys = ['en', 'ko', 'ja', 'zh'];

    test('no entry key is a locale sub-key, and .lead is a plain string (not a locale-keyed object)', () => {
      for (const name of Object.keys(DETECTOR_PLAIN)) {
        const entry = DETECTOR_PLAIN[name] as unknown as Record<string, unknown>;
        for (const k of Object.keys(entry)) {
          expect(localeSubkeys, `${name} entry key "${k}"`).not.toContain(k);
          expect(k === 'lead' || k === 'action', `${name} entry key "${k}" must be lead or action`).toBe(true);
        }
        expect(typeof entry.lead, `${name}.lead must be a string`).toBe('string');
      }
    });

    test('negative control: the old nested shape would fail this check (proves the assertion has teeth)', () => {
      const oldShaped = {en: {lead: 'x'}, ko: {lead: 'y'}};
      const keys = Object.keys(oldShaped);
      expect(keys.some((k) => localeSubkeys.includes(k))).toBe(true);
      expect((oldShaped as Record<string, unknown>).lead).toBeUndefined();
    });
  });

  describe('templates carry no locale parameter (structural arity pin)', () => {
    // Function.prototype.length counts only REQUIRED parameters (a default,
    // like plainLead's `fallback = ''`, is excluded) — every one of these
    // dropped by exactly 1 when the locale plumbing was removed (verified
    // against the pre-pivot signatures read from git history). Pinning
    // today's arity means a locale param reappearing — even renamed — trips
    // this immediately.
    test('plainLead(detector, fallback?) — 1 required param (was 2, with locale, pre-pivot)', () => {
      expect(plainLead.length).toBe(1);
    });

    test('plainFinding(f) — 1 required param (was 2, with locale, pre-pivot)', () => {
      expect(plainFinding.length).toBe(1);
    });

    test('stopBlockMessage(count, examples) — 2 required params (was 3, with locale, pre-pivot)', () => {
      expect(stopBlockMessage.length).toBe(2);
    });

    test('driftNudge(count, lead, detector, deferred) — 4 required params (was 5, with locale, pre-pivot)', () => {
      expect(driftNudge.length).toBe(4);
    });

    test('doneRefusalLead() — 0 required params (was 1, with locale, pre-pivot)', () => {
      expect(doneRefusalLead.length).toBe(0);
    });
  });

  describe('plain-lead-first render order is unchanged', () => {
    test('plainFinding: the lead occupies position 0; the (detector · path) tail follows', () => {
      const out = plainFinding({detector: 'MISSING_IMPLEMENTATION', path: 'src/x.ts', message: 'raw'});
      const lead = DETECTOR_PLAIN.MISSING_IMPLEMENTATION.lead;
      expect(out.indexOf(lead)).toBe(0);
      expect(out.indexOf('MISSING_IMPLEMENTATION')).toBeGreaterThan(lead.length);
      expect(out.indexOf('src/x.ts')).toBeGreaterThan(out.indexOf('MISSING_IMPLEMENTATION'));
    });

    test('driftNudge: the lead precedes the "(details: DETECTOR)" tail', () => {
      const out = driftNudge(1, 'a plain lead', 'AC_DRIFT', '');
      expect(out.indexOf('a plain lead')).toBeLessThan(out.indexOf('(details: AC_DRIFT)'));
    });

    test('stopBlockMessage: the plain examples clause precedes no machine-id tail (order unchanged, singular/plural)', () => {
      expect(stopBlockMessage(1, 'EX')).toContain('e.g. EX');
      expect(stopBlockMessage(1, 'EX').indexOf('e.g.')).toBeLessThan(stopBlockMessage(1, 'EX').indexOf('EX') + 1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-ddb938fb — interpreter relay clause, freshness literals, size guard.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-ddb938fb — interpreter relay clause, freshness literals, size guard', () => {
  const GATE_AND_HOOK = /gate and hook messages/i;
  const RELAY_BY_MEANING = /relay them(?: in the user's language,)? by meaning/i;

  test('CLAUDE_MD_SECTION explicitly directs relaying cladding\'s own gate/hook messages, by meaning', () => {
    expect(CLAUDE_MD_SECTION).toMatch(GATE_AND_HOOK);
    expect(norm(CLAUDE_MD_SECTION)).toMatch(RELAY_BY_MEANING);
  });

  test('AGENTS_MD_TEMPLATE carries the equivalent relay clause', () => {
    expect(AGENTS_MD_TEMPLATE).toMatch(GATE_AND_HOOK);
    expect(norm(AGENTS_MD_TEMPLATE)).toMatch(RELAY_BY_MEANING);
  });

  test('planted-needle control: a stub anchor lacking the relay clause misses; the real sentence matches (both patterns)', () => {
    const stub = "**Speak the user's language** — translate cladding terms into plain words for the user.";
    expect(GATE_AND_HOOK.test(stub)).toBe(false);
    expect(RELAY_BY_MEANING.test(stub)).toBe(false);

    const realClaudeMd = "including cladding's own gate and hook messages: relay them by meaning.";
    expect(GATE_AND_HOOK.test(realClaudeMd)).toBe(true);
    expect(RELAY_BY_MEANING.test(realClaudeMd)).toBe(true);

    const realAgentsMd = "cladding's own gate and hook messages: relay them in the user's language, by meaning, rather than echoing the raw text.";
    expect(GATE_AND_HOOK.test(realAgentsMd)).toBe(true);
    expect(RELAY_BY_MEANING.test(realAgentsMd)).toBe(true);
  });

  test('both freshness literals survive verbatim in both templates', () => {
    for (const tpl of [CLAUDE_MD_SECTION, AGENTS_MD_TEMPLATE]) {
      expect(tpl).toContain('anti-self-cert');
      expect(tpl).toContain('Feature cycle — one at a time');
    }
  });

  test('round trip holds: a freshly emitted section of either template is NOT stale (no re-sync churn)', () => {
    expect(isStaleInstructions(CLAUDE_MD_SECTION)).toBe(false);
    expect(isStaleInstructions(AGENTS_MD_TEMPLATE)).toBe(false);
  });

  test('CLAUDE_MD_SECTION stays under the ceiling declared in tests/claude-md-diet.test.ts (derived, not a duplicated magic number)', () => {
    const dietSrc = readFileSync(join(ROOT, 'tests/claude-md-diet.test.ts'), 'utf8');
    const m = dietSrc.match(/expect\(bytes\)\.toBeLessThan\((\d+)\)/);
    expect(m, 'tests/claude-md-diet.test.ts must declare its byte ceiling via expect(bytes).toBeLessThan(N)').toBeTruthy();
    const ceiling = Number((m as RegExpMatchArray)[1]);
    expect(Buffer.byteLength(CLAUDE_MD_SECTION, 'utf8')).toBeLessThan(ceiling);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-3f34759a — unwanted: no locale-machinery symbol may reappear under src/.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-3f34759a — structural sweep: no locale machinery under src/', () => {
  /** Joins fragments at runtime — see the "Needle hygiene" file-header note. */
  const assemble = (...parts: readonly string[]): string => parts.join('');
  const RESOLVE_LOCALE = assemble('resolve', 'Locale');
  const PLAIN_LOCALE = assemble('Plain', 'Locale');
  const READ_SIDECAR_LOCALE = assemble('read', 'Sidecar', 'Locale');
  const USER_LOCALE_SIDECAR = assemble('user', '-locale');
  const PROJECT_LOCALE_FIELD = assemble('project', '.locale');
  const NEEDLES = [RESOLVE_LOCALE, PLAIN_LOCALE, READ_SIDECAR_LOCALE, USER_LOCALE_SIDECAR, PROJECT_LOCALE_FIELD] as const;

  /** Recursively collect files matching an extension, skipping build/vendor dirs. */
  function walk(dir: string, exts: readonly string[], acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, exts, acc);
      else if (exts.some((e) => entry.name.endsWith(e))) acc.push(full);
    }
    return acc;
  }

  /** Returns every {file, needle} hit — one entry per (file, needle) pair that co-occurs. */
  function scanForNeedles(files: readonly string[], needles: readonly string[]): {file: string; needle: string}[] {
    const hits: {file: string; needle: string}[] = [];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      for (const n of needles) if (content.includes(n)) hits.push({file: f, needle: n});
    }
    return hits;
  }

  test('src/**/*.ts carries zero occurrences of any locale-machinery symbol', () => {
    const files = walk(join(ROOT, 'src'), ['.ts']);
    expect(files.length).toBeGreaterThan(100); // vacuous-walk guard (173 today)
    const hits = scanForNeedles(files, NEEDLES);
    expect(hits, `locale-machinery symbols found under src/:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });

  test('docs/**/*.md carries zero occurrences of any locale-machinery symbol', () => {
    const files = walk(join(ROOT, 'docs'), ['.md']);
    expect(files.length).toBeGreaterThan(10); // vacuous-walk guard (48 today)
    const hits = scanForNeedles(files, NEEDLES);
    expect(hits, `locale-machinery symbols found under docs/:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });

  test('mutation probe — the scanner is non-vacuous: a planted symbol in a scratch copy is caught, then discarded (never touches the real tree)', () => {
    // The scratch dir lives under os.tmpdir(), entirely outside this repo —
    // even a crash mid-test can never leave a plant inside src/ or tests/.
    // One forbidden symbol per file, covering each of the five needles
    // individually, so the probe proves the WHOLE needle list has teeth, not
    // just the first entry.
    const dir = mkdtempSync(join(tmpdir(), 'clad-locale-sweep-probe-'));
    try {
      writeFileSync(join(dir, 'a.ts'), `export function ${RESOLVE_LOCALE}() { return "en"; }\n`);
      writeFileSync(join(dir, 'b.ts'), `export type ${PLAIN_LOCALE} = "en" | "ko";\n`);
      writeFileSync(join(dir, 'c.ts'), `function ${READ_SIDECAR_LOCALE}() { return null; }\n`);
      writeFileSync(join(dir, 'd.ts'), `const p = ".cladding/${USER_LOCALE_SIDECAR}";\n`);
      writeFileSync(join(dir, 'e.ts'), `// re-reads spec.yaml ${PROJECT_LOCALE_FIELD} for the old behavior\n`);
      writeFileSync(join(dir, 'clean.ts'), 'export const x = 1;\n');

      const files = walk(dir, ['.ts']);
      expect(files).toHaveLength(6);
      const hits = scanForNeedles(files, NEEDLES);
      expect(hits).toHaveLength(5);
      expect(new Set(hits.map((h) => h.needle))).toEqual(new Set(NEEDLES));
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
    // Revert note: the plant lived only in `dir` (a fresh os.tmpdir()
    // directory, now removed by the rmSync above) — nothing under the real
    // repo tree was ever written to.
  });

  test('tests/ carries the machinery symbols in exactly one known file — the pivot\'s own absence-guard needles (pinned file + count, not a blind zero-sweep)', () => {
    // tests/human-first-cards.test.ts legitimately contains two of the five
    // symbol names above (the resolver function and the sidecar path) — as
    // the literal needle arguments to `expect(...).not.toContain(...)`
    // absence-guards proving the machinery is gone (its "no locale-detection
    // artifacts" describe block). A blind
    // zero-occurrence sweep over tests/ would misfire on exactly those lines.
    // Rather than reproduce that file's own quote-vs-code discrimination
    // here, this test pins today's precise, known exception: file + count +
    // needle set. A hit in ANY OTHER file, or a different count or needle,
    // fails loudly — which is exactly what "reappears" should mean for a
    // suite full of legitimate absence-guard needles.
    const files = walk(join(ROOT, 'tests'), ['.ts']);
    expect(files.length).toBeGreaterThan(150); // vacuous-walk guard (244 today)
    const hits = scanForNeedles(files, NEEDLES);
    const distinctFiles = [...new Set(hits.map((h) => relative(ROOT, h.file)))];
    expect(distinctFiles).toEqual(['tests/human-first-cards.test.ts']);
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((h) => h.needle))).toEqual(new Set([RESOLVE_LOCALE, USER_LOCALE_SIDECAR]));
  });
});
