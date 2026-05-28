// Cladding · unit tests for build-plugin.mjs Phase E 4-host transpile
// (0.4.10 PR-A.3, F-9c2741).
//
// Phase E reads the canonical persona files (src/agents/*.md) and
// emits one artifact per host:
//   E.1  plugins/claude-code/.claude-plugin/plugin.json `agents[]`
//   E.2  plugins/codex/agents/<persona>.toml
//   E.3  plugins/cursor/modes.json (single file, modes[] array)
//   E.4  plugins/gemini-cli/agents/<persona>.md
//
// We do NOT re-run the build inside the test (slow + has side effects
// on tracked files). We assert the *committed* artifacts match the
// canonical 5 personas and carry the host-specific shape. If the
// build script regresses, `npm run build:plugin` regenerates them and
// these tests catch any divergence in the next CI run.

import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {parse as parseYaml} from 'yaml';

const ROOT = join(__dirname, '..', '..');
const PERSONAS = ['librarian', 'observability', 'orchestrator', 'reviewer', 'specialists'] as const;

describe('build-plugin.mjs Phase E — Claude Code agents[]', () => {
  const pluginJsonPath = join(ROOT, 'plugins/claude-code/.claude-plugin/plugin.json');
  const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));

  test('plugin.json declares 5 agents', () => {
    expect(Array.isArray(pluginJson.agents)).toBe(true);
    expect(pluginJson.agents).toHaveLength(PERSONAS.length);
  });

  test('each agent entry has {name, path} pointing to ./agents/<name>.md', () => {
    for (const persona of PERSONAS) {
      const entry = pluginJson.agents.find((a: {name: string}) => a.name === persona);
      expect(entry, `missing agent: ${persona}`).toBeDefined();
      expect(entry.path).toBe(`./agents/${persona}.md`);
    }
  });

  test('agents[] is sorted alphabetically (deterministic build output)', () => {
    const names = pluginJson.agents.map((a: {name: string}) => a.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe('build-plugin.mjs Phase E — Codex TOML', () => {
  const agentsDir = join(ROOT, 'plugins/codex/agents');

  test('emits one .toml per canonical persona', () => {
    for (const persona of PERSONAS) {
      const tomlPath = join(agentsDir, `${persona}.toml`);
      expect(existsSync(tomlPath), `missing TOML: ${persona}`).toBe(true);
    }
  });

  test('each TOML carries name, description, model, sandbox_mode, developer_instructions', () => {
    for (const persona of PERSONAS) {
      const content = readFileSync(join(agentsDir, `${persona}.toml`), 'utf8');
      expect(content).toContain(`name = "${persona}"`);
      expect(content).toMatch(/description = ".+"/);
      // Codex requires sandbox_mode for write-capable agents; read-only personas keep it explicit.
      expect(content).toMatch(/sandbox_mode = "(read-only|workspace-write|danger-full-access)"/);
      expect(content).toContain(`developer_instructions = '''`);
    }
  });

  test('reviewer TOML pins model=opus + sandbox=read-only + max_turns=3', () => {
    const reviewer = readFileSync(join(agentsDir, 'reviewer.toml'), 'utf8');
    expect(reviewer).toContain('model = "opus"');
    expect(reviewer).toContain('sandbox_mode = "read-only"');
    expect(reviewer).toContain('max_turns = 3');
  });

  test('observability TOML pins model=haiku + sandbox=read-only', () => {
    const obs = readFileSync(join(agentsDir, 'observability.toml'), 'utf8');
    expect(obs).toContain('model = "haiku"');
    expect(obs).toContain('sandbox_mode = "read-only"');
  });
});

describe('build-plugin.mjs Phase E — Cursor modes.json', () => {
  const modesPath = join(ROOT, 'plugins/cursor/modes.json');
  const modes = JSON.parse(readFileSync(modesPath, 'utf8'));

  test('single file with version + modes[]', () => {
    expect(modes.version).toBe(1);
    expect(Array.isArray(modes.modes)).toBe(true);
    expect(modes.modes).toHaveLength(PERSONAS.length);
  });

  test('each mode has name, description, instructions, model, tools[]', () => {
    for (const persona of PERSONAS) {
      const mode = modes.modes.find((m: {name: string}) => m.name === persona);
      expect(mode, `missing mode: ${persona}`).toBeDefined();
      expect(typeof mode.description).toBe('string');
      expect(typeof mode.instructions).toBe('string');
      expect(mode.instructions.length).toBeGreaterThan(100);
      expect(typeof mode.model).toBe('string');
      expect(Array.isArray(mode.tools)).toBe(true);
    }
  });

  test('reviewer mode pins model=opus + tools restricted to Read/Bash', () => {
    const reviewer = modes.modes.find((m: {name: string}) => m.name === 'reviewer');
    expect(reviewer.model).toBe('opus');
    // Reviewer is read-only — no Write/Edit allowed.
    expect(reviewer.tools).not.toContain('Write');
    expect(reviewer.tools).not.toContain('Edit');
    expect(reviewer.tools).toContain('Read');
  });
});

describe('build-plugin.mjs Phase E — Gemini agents/*.md', () => {
  const agentsDir = join(ROOT, 'plugins/gemini-cli/agents');

  test('emits one .md per canonical persona', () => {
    for (const persona of PERSONAS) {
      const mdPath = join(agentsDir, `${persona}.md`);
      expect(existsSync(mdPath), `missing Gemini md: ${persona}`).toBe(true);
    }
  });

  test('each .md has YAML frontmatter with name, description, model', () => {
    for (const persona of PERSONAS) {
      const content = readFileSync(join(agentsDir, `${persona}.md`), 'utf8');
      const match = content.match(/^---\n([\s\S]+?)\n---/);
      expect(match, `frontmatter missing in ${persona}.md`).not.toBeNull();
      const fm = parseYaml(match![1]);
      expect(fm.name).toBe(persona);
      expect(typeof fm.description).toBe('string');
      expect(typeof fm.model).toBe('string');
    }
  });

  test('orchestrator emits allowed_tools per Gemini frontmatter convention', () => {
    const orchestrator = readFileSync(join(agentsDir, 'orchestrator.md'), 'utf8');
    const match = orchestrator.match(/^---\n([\s\S]+?)\n---/);
    const fm = parseYaml(match![1]);
    expect(Array.isArray(fm.allowed_tools)).toBe(true);
  });
});

describe('build-plugin.mjs Phase E — cross-host consistency', () => {
  test('same persona inventory across all four hosts', () => {
    // Claude Code
    const pluginJson = JSON.parse(
      readFileSync(join(ROOT, 'plugins/claude-code/.claude-plugin/plugin.json'), 'utf8'),
    );
    const claudeNames = pluginJson.agents.map((a: {name: string}) => a.name).sort();

    // Codex
    const codexNames = readdirSync(join(ROOT, 'plugins/codex/agents'))
      .filter((f) => f.endsWith('.toml'))
      .map((f) => f.replace(/\.toml$/, ''))
      .sort();

    // Cursor
    const modes = JSON.parse(readFileSync(join(ROOT, 'plugins/cursor/modes.json'), 'utf8'));
    const cursorNames = modes.modes.map((m: {name: string}) => m.name).sort();

    // Gemini — exclude README.md alongside .md filter.
    const geminiNames = readdirSync(join(ROOT, 'plugins/gemini-cli/agents'))
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .map((f) => f.replace(/\.md$/, ''))
      .sort();

    expect(codexNames).toEqual(claudeNames);
    expect(cursorNames).toEqual(claudeNames);
    expect(geminiNames).toEqual(claudeNames);
  });
});
