// Cladding · unit tests for ui/pulse.ts
//
// pulse emits one terminal line per call with a fixed glyph set. Tests
// capture stdout via process.stdout.write spy and assert:
//   - glyph mapping for each PulseKind
//   - label + detail rendering
//   - TTY mode adds ANSI color codes; non-TTY mode does not

import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';

import {pulse, pulseProgress, pulseProgressEnd} from '../../src/ui/pulse.js';

describe('pulse', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    originalIsTTY = process.stdout.isTTY;
  });
  afterEach(() => {
    writeSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', {value: originalIsTTY, configurable: true});
  });

  function setTty(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', {value, configurable: true});
  }

  test('non-TTY: pass glyph + label without ANSI', () => {
    setTty(false);
    pulse('pass', 'stage_1.1');
    expect(writeSpy).toHaveBeenCalledOnce();
    const out = writeSpy.mock.calls[0]?.[0] as string;
    expect(out).toBe('✓ stage_1.1\n');
    expect(out).not.toMatch(/\x1b\[/); // no ANSI escape
  });

  test('non-TTY: fail glyph', () => {
    setTty(false);
    pulse('fail', 'stage_1.2');
    expect(writeSpy.mock.calls[0]?.[0]).toBe('✗ stage_1.2\n');
  });

  test('non-TTY: start / skip both use the · glyph', () => {
    setTty(false);
    pulse('start', 'foo');
    pulse('skip', 'bar');
    expect(writeSpy.mock.calls[0]?.[0]).toBe('· foo\n');
    expect(writeSpy.mock.calls[1]?.[0]).toBe('· bar\n');
  });

  test('non-TTY: note glyph is ℹ', () => {
    setTty(false);
    pulse('note', 'info');
    expect(writeSpy.mock.calls[0]?.[0]).toBe('ℹ info\n');
  });

  test('detail string appears with two-space indent', () => {
    setTty(false);
    pulse('pass', 'stage_1.1', '42ms');
    expect(writeSpy.mock.calls[0]?.[0]).toBe('✓ stage_1.1  42ms\n');
  });

  test('empty detail produces no trailing whitespace', () => {
    setTty(false);
    pulse('pass', 'stage_1.1', '');
    expect(writeSpy.mock.calls[0]?.[0]).toBe('✓ stage_1.1\n');
  });

  test('TTY mode wraps glyph in ANSI color + reset', () => {
    setTty(true);
    pulse('pass', 'stage_1.1');
    const out = writeSpy.mock.calls[0]?.[0] as string;
    expect(out).toContain('\x1b[32m'); // green
    expect(out).toContain('\x1b[0m'); // reset
    expect(out).toContain('✓');
    expect(out).toContain('stage_1.1');
  });

  test('TTY mode + detail emits one line per call', () => {
    setTty(true);
    pulse('note', 'route → drive', 'prompt text');
    expect(writeSpy).toHaveBeenCalledOnce();
    const out = writeSpy.mock.calls[0]?.[0] as string;
    expect(out).toContain('route → drive');
    expect(out).toContain('prompt text');
    expect(out).toContain('\x1b[36m'); // cyan
  });
});

// Progressive surface (v0.3.23, F-x) — pulseProgress + pulseProgressEnd
// provide in-place status updates on TTY and stay silent on non-TTY
// until the End call commits the final transition.
describe('pulseProgress + pulseProgressEnd', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    originalIsTTY = process.stdout.isTTY;
  });
  afterEach(() => {
    writeSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', {value: originalIsTTY, configurable: true});
  });
  function setTty(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', {value, configurable: true});
  }

  test('[covers:F-063/AC-162][covers:F-ba4b7a/AC-001] non-TTY: pulseProgress is silent (no write)', () => {
    setTty(false);
    pulseProgress('run', 'F-001', 'specialist');
    pulseProgress('run', 'F-001', 'L1 gates');
    pulseProgress('run', 'F-001', 'reviewer');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test('[covers:F-ba4b7a/AC-003] non-TTY: pulseProgressEnd emits one line equivalent to pulse', () => {
    setTty(false);
    pulseProgress('run', 'F-001', 'specialist');
    pulseProgressEnd('pass', 'F-001', 'done');
    // Only the End call writes; the intermediate Progress was silent.
    expect(writeSpy).toHaveBeenCalledOnce();
    expect(writeSpy.mock.calls[0]?.[0]).toBe('✓ F-001  done\n');
  });

  test('[covers:F-ba4b7a/AC-002] TTY: pulseProgress writes a clear-line escape and stays open (no newline)', () => {
    setTty(true);
    pulseProgress('run', 'F-001', 'specialist');
    const out = writeSpy.mock.calls[0]?.[0] as string;
    expect(out).toContain('\r\x1b[K'); // clear-line
    expect(out).toContain('run · F-001');
    expect(out).toContain('specialist');
    expect(out.endsWith('\n')).toBe(false); // stays in-place
  });

  test('TTY: successive pulseProgress calls each begin with clear-line', () => {
    setTty(true);
    pulseProgress('run', 'F-001', 'specialist');
    pulseProgress('run', 'F-001', 'L1 gates');
    expect(writeSpy).toHaveBeenCalledTimes(2);
    for (const call of writeSpy.mock.calls) {
      expect(call[0] as string).toContain('\r\x1b[K');
    }
  });

  test('TTY: pulseProgressEnd commits a final line with newline + ANSI colour', () => {
    setTty(true);
    pulseProgressEnd('pass', 'F-001', 'done');
    const out = writeSpy.mock.calls[0]?.[0] as string;
    expect(out).toContain('\r\x1b[K');
    expect(out).toContain('\x1b[32m'); // green
    expect(out).toContain('✓');
    expect(out).toContain('F-001');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('TTY: pulseProgressEnd("fail") uses the red glyph', () => {
    setTty(true);
    pulseProgressEnd('fail', 'F-001', 'reviewer fail');
    const out = writeSpy.mock.calls[0]?.[0] as string;
    expect(out).toContain('\x1b[31m'); // red
    expect(out).toContain('✗');
    expect(out).toContain('reviewer fail');
  });

  test('non-TTY: detail is rendered with two-space indent on the End line', () => {
    setTty(false);
    pulseProgressEnd('fail', 'F-001', 'retry 3/3');
    expect(writeSpy.mock.calls[0]?.[0]).toBe('✗ F-001  retry 3/3\n');
  });
});
