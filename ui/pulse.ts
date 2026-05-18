// Cladding · Pulse UI — quiet terminal status renderer
//
// "Pulse" per ironclad-design/16-visual-experience.md: short
// status lines that emit only on transition (start / pass / fail /
// skipped). No spinners, no ANSI cursor games — `tail -f`-friendly.
// One line per call; the caller's reduce-noise judgment is final.

import process from 'node:process';

/** Render verb that maps to a small fixed glyph set. */
export type PulseKind = 'start' | 'pass' | 'fail' | 'skip' | 'note';

const GLYPHS: Record<PulseKind, string> = {
  start: '·',
  pass: '✓',
  fail: '✗',
  skip: '·',
  note: 'ℹ',
};

const COLORS: Record<PulseKind, string> = {
  start: '\x1b[90m', // gray
  pass: '\x1b[32m', // green
  fail: '\x1b[31m', // red
  skip: '\x1b[90m', // gray
  note: '\x1b[36m', // cyan
};

const RESET = '\x1b[0m';

function isTty(): boolean {
  return Boolean(process.stdout.isTTY);
}

/**
 * Emit a single Pulse line to stdout.
 *
 * @example pulse('pass', 'stage_1.1', '42ms') → "✓ stage_1.1  42ms"
 */
export function pulse(kind: PulseKind, label: string, detail: string = ''): void {
  const glyph = GLYPHS[kind];
  const dim = detail ? `  ${detail}` : '';
  if (isTty()) {
    process.stdout.write(`${COLORS[kind]}${glyph}${RESET} ${label}${dim}\n`);
  } else {
    process.stdout.write(`${glyph} ${label}${dim}\n`);
  }
}
