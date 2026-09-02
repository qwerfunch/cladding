import {describe, expect, test} from 'vitest';
import {toMermaid, toDot, toJson, toObsidianVault} from '../../src/graph/render.js';
import type {KnowledgeGraph} from '../../src/graph/presentation.js';

describe('graph render (F-569f4b37)', () => {
  const g: KnowledgeGraph = {
    nodes: [
      {id: 'feature:F-1', kind: 'feature', label: 'Feat one', status: 'done'},
      {id: 'module:src/a.ts', kind: 'module', label: 'src/a.ts'},
    ],
    edges: [{from: 'feature:F-1', to: 'module:src/a.ts', kind: 'touches'}],
  };

  test('renders deterministic mermaid, dot, and json', () => {
    const mermaid = toMermaid(g);
    expect(mermaid).toContain('graph LR');
    expect(mermaid).toContain('touches');
    expect(mermaid).toContain('Feat one');
    expect(toMermaid(g)).toBe(toMermaid(g));

    const dot = toDot(g);
    expect(dot).toContain('digraph cladding {');
    expect(dot).toContain('->');
    expect(dot).toContain('[label="touches"]');
    expect(dot.trimEnd().endsWith('}')).toBe(true);

    const parsed = JSON.parse(toJson(g)) as unknown;
    expect(parsed).toEqual({nodes: g.nodes, edges: g.edges});
  });

  test('obsidian vault emits one note per node with wikilinks and backlinks', () => {
    const v = toObsidianVault(g);

    expect(v.size).toBe(2);

    const keys = [...v.keys()];
    expect(keys.some((k) => k.startsWith('feature/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('module/'))).toBe(true);

    const moduleKey = keys.find((k) => k.startsWith('module/'));
    const featureKey = keys.find((k) => k.startsWith('feature/'));
    expect(moduleKey).toBeDefined();
    expect(featureKey).toBeDefined();

    const moduleNote = v.get(moduleKey as string) as string;
    const featureNote = v.get(featureKey as string) as string;

    // module note: incoming touches edge -> a backlink to the feature.
    expect(moduleNote).toContain('## Backlinks');
    expect(moduleNote).toContain('[[');
    expect(moduleNote).toContain('kind:');

    // feature note: outgoing touches edge -> a link to the module.
    expect(featureNote).toContain('## Links');
    expect(featureNote).toContain('[[');
    expect(featureNote).toContain('kind:');
  });
});
