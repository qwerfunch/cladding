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
const projectSettings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as {
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, {
    source?: {source?: string; path?: string};
    autoUpdate?: boolean;
  }>;
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

  test('tool-scoped events carry their tool matchers', () => {
    // PreToolUse guards spec WRITES — the three native write tools only.
    // PostToolUse additionally matches Bash since F-e7d59c88 (AC-d6c8d5ed):
    // shell-made source mutations (sed -i, heredoc, tee) get the git-delta
    // impact-card lane; the block lane stays write-tool-scoped.
    expect(doc.hooks.PreToolUse[0].matcher, 'PreToolUse matcher').toBe('Edit|Write|MultiEdit');
    expect(doc.hooks.PostToolUse[0].matcher, 'PostToolUse matcher').toBe('Edit|Write|MultiEdit|Bash');
  });

  test('plugin.json declares the hooks field pointing at hooks/hooks.json', () => {
    const plugin = JSON.parse(
      readFileSync(join(ROOT, 'plugins/claude-code/.claude-plugin/plugin.json'), 'utf8'),
    ) as {hooks?: string};
    expect(plugin.hooks).toBe('./hooks/hooks.json');
  });

  test('the dogfood project declares where Claude Code can install the enabled plugin', () => {
    expect(projectSettings.enabledPlugins?.['claude-code@cladding']).toBe(true);
    expect(projectSettings.extraKnownMarketplaces?.cladding).toEqual({
      source: {source: 'directory', path: '.'},
      autoUpdate: true,
    });
  });
});
