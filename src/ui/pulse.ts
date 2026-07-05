// Cladding · Pulse UI — quiet terminal status renderer
//
// "Pulse" per ironclad-design/16-visual-experience.md: short
// status lines that emit only on transition (start / pass / fail /
// skipped). No spinners, no ANSI cursor games — `tail -f`-friendly.
// One line per call; the caller's reduce-noise judgment is final.
//
// v0.3.23 (ironclad-design 03-ux §4.1) adds a *progressive* surface
// — `pulseProgress` + `pulseProgressEnd` — for long-running
// operations like `clad run`. The progressive API uses ANSI
// in-place updates on TTYs and stays silent on non-TTY (CI, pipes)
// until `pulseProgressEnd` so the audit-log discipline of the
// original `pulse` contract is preserved. The two surfaces are
// orthogonal — `pulse` is the per-transition event log; progressive
// is "what cladding is doing right now".

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

/**
 * ANSI sequence that moves the cursor to column 0 and erases the
 * line — used by `pulseProgress` to overwrite the previous status
 * line in place. Safe on every xterm-compatible terminal cladding
 * targets; falls back to a plain newline path on non-TTY.
 */
const CLEAR_LINE = '\r\x1b[K';

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

/**
 * Updates the progressive status line in place on a TTY. On non-TTY
 * (CI, pipe) the call is silent so the captured stdout stays a clean
 * append-only stream and `pulse` remains the single transition
 * channel. Multiple `pulseProgress` calls in sequence overwrite the
 * same terminal row; the line is committed with a newline only when
 * `pulseProgressEnd` fires.
 *
 * @example
 *   pulseProgress('drive', 'F-001', 'specialist');
 *   pulseProgress('drive', 'F-001', 'L1 gates');
 *   pulseProgressEnd('pass', 'F-001', 'done in 1.2s');
 */
export function pulseProgress(stage: string, label: string, detail: string = ''): void {
  if (!isTty()) return;
  const dim = detail ? `  ${detail}` : '';
  // The spinner glyph stays a single dot; the visual rhythm comes
  // from the changing detail text, not animation, so the line stays
  // readable in screen recordings and terminal sharing tools.
  process.stdout.write(`${CLEAR_LINE}${COLORS.start}·${RESET} ${stage} · ${label}${dim}`);
}

/**
 * Commits the progressive status line as a final transition. On TTY
 * the in-place line is replaced with a `pulse`-equivalent final
 * row; on non-TTY this becomes the sole emission for the entire
 * progress sequence, so CI logs still see one tidy event-log entry.
 * Kinds `'start'` and `'note'` are accepted but uncommon — typical
 * callers pass `'pass'`, `'fail'`, or `'skip'`.
 */
export function pulseProgressEnd(kind: PulseKind, label: string, detail: string = ''): void {
  const glyph = GLYPHS[kind];
  const dim = detail ? `  ${detail}` : '';
  if (isTty()) {
    process.stdout.write(`${CLEAR_LINE}${COLORS[kind]}${glyph}${RESET} ${label}${dim}\n`);
  } else {
    process.stdout.write(`${glyph} ${label}${dim}\n`);
  }
}
