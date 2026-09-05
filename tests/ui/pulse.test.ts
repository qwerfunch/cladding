// Cladding · unit tests for ui/pulse.ts
//
// pulse emits one terminal line per call with a fixed glyph set. Tests
// capture stdout via process.stdout.write spy and assert:
//   - glyph mapping for each PulseKind
//   - label + detail rendering
//   - TTY mode adds ANSI color codes; non-TTY mode does not

import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';

import {pulse} from '../../src/ui/pulse.js';

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

  test('[covers:F-063/AC-162] non-TTY: pass glyph + label without ANSI', () => {
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
