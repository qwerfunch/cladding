// Cladding · drift detector · AI_HINTS_FORBIDDEN_PATTERN
//
// Detector #27 (axis: spec ↔ code, severity: error). v0.3.57 / F-00eb1a.
//
// Reads `spec.project.ai_hints.forbidden_patterns` and grep-checks every
// `*.ts(x)` file under `src/` for any pattern in that list. Each occurrence
// emits an error finding with file:line context. Silent when ai_hints is
// absent or forbidden_patterns is empty — the detector is **opt-in**, not
// a default policy.
//
// Why grep-based (not AST): forbidden_patterns are identifier substrings
// like 'eval(', 'innerHTML', 'dangerouslySetInnerHTML'. Substring match is
// the right granularity — AST would lose the e.g. `// eslint-disable-next-line` comment
// cases that should still fire.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import {resolveLanguageConfig} from '../toolchain/language-config.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'AI_HINTS_FORBIDDEN_PATTERN';

function walkSourceFiles(rootAbs: string, extensions: readonly string[]): readonly string[] {
  if (!existsSync(rootAbs)) return [];
  const out: string[] = [];
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
      if (name === 'node_modules' || name === '.cladding' || name.startsWith('.')) continue;
      const abs = join(dir, name);
      let s;
      try {
        s = statSync(abs);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        queue.push(abs);
      } else if (extensions.some((e) => name.endsWith(e))) {
        out.push(abs);
      }
    }
  }
  return out;
}

/** Lines that are pure comments don't execute — skip to avoid false positives on documentation. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

/**
 * Inline disable mechanism — when a line ends with
 * `// cladding-disable AI_HINTS_FORBIDDEN_PATTERN` (or `: AI_HINTS_…`),
 * the detector skips that line. Lets LLM prompt builders + similar
 * code mention forbidden tokens as data without tripping enforcement.
 */
const DISABLE_RE = /\/\/\s*cladding-disable[:\s]+AI_HINTS_FORBIDDEN_PATTERN\b/;
function isDisabled(line: string): boolean {
  return DISABLE_RE.test(line);
}

function runAiHintsForbiddenPattern(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch {
    // Load-failure policy (see detectors/with-spec.ts): within-spec-validity
    // detector — no spec means no ai_hints.forbidden_patterns to scan for;
    // ABSENCE_OF_GOVERNANCE + the info-emitting detectors surface the failure.
    return [];
  }
  const patterns = spec.project.ai_hints?.forbidden_patterns;
  if (!patterns || patterns.length === 0) return [];

  const cfg = resolveLanguageConfig(cwd, spec.project?.language);
  const files = cfg.sourceRoots.flatMap((root) =>
    walkSourceFiles(join(cwd, root), cfg.extensions),
  );
  if (files.length === 0) return [];

  const findings: DriftFinding[] = [];
  for (const abs of files) {
    let body: string;
    try {
      body = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      if (isDisabled(lines[i])) continue;
      for (const pattern of patterns) {
        if (typeof pattern !== 'string' || pattern.length === 0) continue;
        if (lines[i].includes(pattern)) {
          findings.push({
            detector: NAME,
            severity: 'error',
            path: relative(cwd, abs),
            line: i + 1,
            message:
              `forbidden pattern matched in ${relative(cwd, abs)}:${i + 1} ` +
              `— project.ai_hints.forbidden_patterns prohibits this identifier. ` +
              `Remove the usage or update spec.yaml.project.ai_hints.forbidden_patterns.`,
          });
        }
      }
    }
  }
  return findings;
}

export const aiHintsForbiddenPattern: DriftDetector = {
  name: NAME,
  run: runAiHintsForbiddenPattern,
};
