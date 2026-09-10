import {describe, expect, test} from 'vitest';
import {graphStats, renderStats} from '../../src/graph/stats.js';
import type {KnowledgeGraph} from '../../src/graph/presentation.js';

describe('graph stats (F-569f4b37)', () => {
  test('counts nodes and edges by kind and ranks hubs by degree', () => {
    const g: KnowledgeGraph = {
      nodes: [
        {id: 'feature:H', kind: 'feature', label: 'Hub'},
        {id: 'feature:A', kind: 'feature', label: 'A'},
        {id: 'feature:B', kind: 'feature', label: 'B'},
        {id: 'module:m', kind: 'module', label: 'm'},
      ],
      edges: [
        {from: 'feature:A', to: 'feature:H', kind: 'depends_on'},
        {from: 'feature:B', to: 'feature:H', kind: 'depends_on'},
        {from: 'feature:H', to: 'module:m', kind: 'touches'},
      ],
    };

    const s = graphStats(g);

    expect(s.nodeCount).toBe(4);
    expect(s.edgeCount).toBe(3);

    expect(s.nodesByKind.feature).toBe(3);
    expect(s.nodesByKind.module).toBe(1);

    expect(s.edgesByKind.depends_on).toBe(2);
    expect(s.edgesByKind.touches).toBe(1);

    // H has degree 3 (2 incoming depends_on + 1 outgoing touches), the top hub.
    expect(s.hubs[0].id).toBe('feature:H');
    expect(s.hubs[0].degree).toBe(3);

    const rendered = renderStats(s);
    expect(rendered).toContain('nodes:');
    expect(rendered).toContain('hubs');
  });
});
