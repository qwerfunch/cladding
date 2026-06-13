// Cladding · plugin hooks wiring shape (F-1d23a6, AC-03da31)
//
// The plugin ships hooks/hooks.json wiring the five lifecycle events to the
// bundled engine via `node ${CLAUDE_PLUGIN_ROOT}/dist/clad.js hook <event>`.
// This suite pins that shape so the wiring itself cannot drift silently —
// scripts/build-plugin.mjs Phase A3 only checks presence; the contract
// lives here.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, test} from 'vitest';

const ROOT = process.cwd();
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const;

interface HookCommand {
  readonly type: string;
  readonly command: string;
}

interface HookEntry {
  readonly matcher?: string;
  readonly hooks: readonly HookCommand[];
}

const doc = JSON.parse(readFileSync(join(ROOT, 'plugins/claude-code/hooks/hooks.json'), 'utf8')) as {
  hooks: Record<string, readonly HookEntry[]>;
};

describe('claude-code plugin hooks.json — five events wired to the bundled engine', () => {
  test('every key is one of the five events, and all five are present', () => {
    expect(Object.keys(doc.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
  });

  test('every entry is a command hook invoking ${CLAUDE_PLUGIN_ROOT}/dist/clad.js hook <its own event>', () => {
    for (const event of HOOK_EVENTS) {
      const entries = doc.hooks[event];
      expect(entries.length, `${event} has at least one entry`).toBeGreaterThanOrEqual(1);
      for (const entry of entries) {
        expect(entry.hooks.length, `${event} entry has hooks[]`).toBeGreaterThanOrEqual(1);
        for (const h of entry.hooks) {
          expect(h.type, `${event} hook type`).toBe('command');
          expect(h.command, `${event} command targets the bundled engine`).toContain(
            '${CLAUDE_PLUGIN_ROOT}/dist/clad.js hook ' + event,
          );
        }
      }
    }
  });

  test('tool-scoped events carry the Edit|Write|MultiEdit matcher', () => {
    for (const event of ['PreToolUse', 'PostToolUse'] as const) {
      expect(doc.hooks[event][0].matcher, `${event} matcher`).toBe('Edit|Write|MultiEdit');
    }
  });

  test('plugin.json declares the hooks field pointing at hooks/hooks.json', () => {
    const plugin = JSON.parse(
      readFileSync(join(ROOT, 'plugins/claude-code/.claude-plugin/plugin.json'), 'utf8'),
    ) as {hooks?: string};
    expect(plugin.hooks).toBe('./hooks/hooks.json');
  });
});
