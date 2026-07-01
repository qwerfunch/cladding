import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {buildGraph, extractTierFromDoc} from '../../src/graph/model.js';
import {getTierColor, getTierLegend, TIER_META, CODE_COLOR} from '../../src/graph/render.js';
import {toHtmlShell} from '../../src/graph/viewer-shell.js';
import type {Spec} from '../../src/spec/types.js';
import type {KnowledgeGraph} from '../../src/graph/model.js';

describe('F-02343cd1 — SSoT-tier coloring + slug labels + self-contained HTML viewer', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'clad-viewer-'));
  });

  afterEach(() => {
    rmSync(tmp, {recursive: true, force: true});
  });

  const byId = (g: KnowledgeGraph, id: string) => g.nodes.find((n) => n.id === id);

  const writeFile = (cwd: string, relPath: string, content: string): void => {
    const full = join(cwd, relPath);
    mkdirSync(dirname(full), {recursive: true});
    writeFileSync(full, content, 'utf8');
  };

  test('assigns tier by kind and parses doc banner; feature label prefers slug', () => {
    const spec = {
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      features: [
        {id: 'F-1', slug: 'my-slug', title: 'My Feature', status: 'done', modules: ['src/a.ts']},
        {id: 'F-2', title: 'No Slug', status: 'done'},
      ],
      scenarios: [{id: 'S-1', title: 'sc', features: ['F-1']}],
      capabilities: [{id: 'cap', title: 'Cap', features: ['F-1']}],
    } as unknown as Spec;

    const g = buildGraph(spec, tmp);

    const f1 = byId(g, 'feature:F-1');
    expect(f1).toBeDefined();
    expect(f1!.tier).toBe('A');
    expect(f1!.label).toBe('my-slug');

    const f2 = byId(g, 'feature:F-2');
    expect(f2).toBeDefined();
    expect(f2!.tier).toBe('A');
    expect(f2!.label).toBe('No Slug');

    const s1 = byId(g, 'scenario:S-1');
    expect(s1).toBeDefined();
    expect(s1!.tier).toBe('A');

    const cap = byId(g, 'capability:cap');
    expect(cap).toBeDefined();
    expect(cap!.tier).toBe('B');

    const mod = byId(g, 'module:src/a.ts');
    expect(mod).toBeDefined();
    expect(mod!.tier).toBeUndefined();

    writeFile(tmp, 'docs/x.md', '<!-- Cladding · Tier C · derived -->\nmore lines\n');
    expect(extractTierFromDoc('docs/x.md', tmp)).toBe('C');

    writeFile(tmp, 'spec/architecture.yaml', 'not a banner\nstuff: here\n');
    expect(extractTierFromDoc('spec/architecture.yaml', tmp)).toBe('B');

    expect(extractTierFromDoc('docs/nope.md', tmp)).toBeUndefined();
  });

  test('tier color mapping is stable and the legend counts per tier', () => {
    expect(getTierColor('A')).toBe(TIER_META.A.color);
    expect(getTierColor('B')).toBe(TIER_META.B.color);
    expect(getTierColor(undefined)).toBe(CODE_COLOR);

    const tierColors = [TIER_META.A.color, TIER_META.B.color, TIER_META.C.color, TIER_META.D.color];
    for (const c of tierColors) {
      expect(typeof c).toBe('string');
    }
    const distinct = new Set([...tierColors, CODE_COLOR]);
    expect(distinct.size).toBe(5);

    const g: KnowledgeGraph = {
      nodes: [
        {id: 'feature:F-1', kind: 'feature', label: 'a', tier: 'A'},
        {id: 'scenario:S-1', kind: 'scenario', label: 's', tier: 'A'},
        {id: 'capability:c', kind: 'capability', label: 'c', tier: 'B'},
        {id: 'module:m.ts', kind: 'module', label: 'm.ts'},
      ],
      edges: [],
    };

    const leg = getTierLegend(g);

    const a = leg.find((e) => e.key === 'A');
    expect(a).toBeDefined();
    expect(a!.count).toBe(2);
    expect(typeof a!.color).toBe('string');

    const b = leg.find((e) => e.key === 'B');
    expect(b).toBeDefined();
    expect(b!.count).toBe(1);
    expect(typeof b!.color).toBe('string');

    const code = leg.find((e) => e.key === 'code');
    expect(code).toBeDefined();
    expect(code!.count).toBe(1);
    expect(typeof code!.color).toBe('string');

    expect(leg.find((e) => e.key === 'C')).toBeUndefined();
    expect(leg.find((e) => e.key === 'D')).toBeUndefined();
  });

  test('emits one self-contained offline html embedding the graph, deterministically', () => {
    const g: KnowledgeGraph = {
      nodes: [
        {id: 'feature:F-1', kind: 'feature', label: 'my-slug', tier: 'A', status: 'done', detail: 'My Feature'},
        {id: 'module:src/a.ts', kind: 'module', label: 'src/a.ts'},
      ],
      edges: [{from: 'feature:F-1', to: 'module:src/a.ts', kind: 'touches'}],
    };

    const html = toHtmlShell(g);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<canvas');
    expect(html).toContain('id="side"');
    expect(html).toContain('window.__CLADDING_GRAPH=');

    // Self-contained / offline: assert no external resource LOADS. (The inlined three.js
    // bundle carries a couple of benign URL *strings* — the XHTML namespace and a shader
    // citation — which are not network fetches, so the old blanket `http://` check is the
    // wrong proxy; this checks the real intent: nothing is fetched over the wire.)
    expect(html).not.toContain('<script src');
    expect(html).not.toContain('<link ');
    expect(html).not.toMatch(/\bsrc=["']https?:/);
    expect(html).not.toMatch(/\bhref=["']https?:/);
    expect(html).not.toMatch(/\b(?:fetch|import)\(\s*["']https?:/);

    expect(html).toContain(TIER_META.A.color);
    expect(html).toContain('my-slug');

    const m = html.match(/window\.__CLADDING_GRAPH=(\{[\s\S]*?\});<\/script>/);
    expect(m).not.toBeNull();
    const data = JSON.parse(m![1].replace(/\\u003c/g, '<'));
    expect(data.nodes.length).toBe(2);
    expect(data.edges.length).toBe(1);
    expect(Array.isArray(data.legend)).toBe(true);
    expect(data.legend.length).toBeGreaterThan(0);

    expect(toHtmlShell(g)).toBe(toHtmlShell(g));
  });

  test('sidebar groups kinds into spec/code/test/docs zones and labels tiers as a filter', () => {
    const g: KnowledgeGraph = {
      nodes: [{id: 'feature:F-1', kind: 'feature', label: 's', tier: 'A', status: 'done', detail: 'F'}],
      edges: [],
    };
    const html = toHtmlShell(g);
    // One color legend, grouped by what the node IS (the zone reads at a glance).
    expect(html).toContain('id="kinds-spec"');
    expect(html).toContain('id="kinds-code"');
    expect(html).toContain('id="kinds-test"');
    expect(html).toContain('id="kinds-docs"');
    // Tier is demoted to a filter (no competing color legend) — label says so.
    expect(html).toContain('SSoT layer');
    expect(html).toContain('(filter)');
  });
});
