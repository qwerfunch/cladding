import {describe, test, expect} from 'vitest';
import {
  TIER_COL,
  KIND_COL,
  EDGE_COL,
  DEFAULT_NODE,
  DEFAULT_EDGE,
  hexToRgb01,
  semanticHue,
  nodeRadius,
  degreeLuminosity,
  coreColor,
  bloomBoost,
  healthOverride,
  instanceColor,
  edgeColor,
  edgeIntensity,
} from '../../src/graph/stellar.js';

type RGB = readonly [number, number, number];

const maxChannel = (c: RGB): number => Math.max(c[0], c[1], c[2]);

/** Perceptual Y (0..255) used by the near-black graph bloom floor. */
const luminance = (hex: string): number => {
  const [red, green, blue] = hexToRgb01(hex);
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) * 255;
};

const whiteDistance = (color: RGB): number => color.reduce((sum, channel) => sum + (1 - channel) ** 2, 0);

describe('color constant tables', () => {
  test('TIER_COL has the four declared tiers', () => {
    expect(TIER_COL.A).toBe('#3b82f6');
    expect(TIER_COL.B).toBe('#a855f7');
    expect(TIER_COL.C).toBe('#14b8a6');
    expect(TIER_COL.D).toBe('#f59e0b');
  });

  test('KIND_COL has the seven declared kinds (spec=blue · module=orange · test=green · docs=pink)', () => {
    expect(KIND_COL.feature).toBe('#4f8ef7');
    expect(KIND_COL.scenario).toBe('#45b5ed');
    expect(KIND_COL.capability).toBe('#8f86f0');
    expect(KIND_COL.module).toBe('#f97316');
    expect(KIND_COL.test).toBe('#22c55e');
    expect(KIND_COL.doc).toBe('#f368a8');
    expect(KIND_COL.skill).toBe('#f7a8e6');
    expect(KIND_COL.skill).not.toBe(KIND_COL.module); // skills must NOT look like code
  });

  test('skill sits in the DOCS pink family (≈300-340° hue), not the CODE/TEST zone', () => {
    // skill is SKILL.md, a document — its hue must be in the magenta-pink arc with doc, far from
    // the orange module (≈25°) and green test (≈142°).
    const hueOf = (hex: string): number => {
      const v = parseInt(hex.slice(1), 16);
      const r = ((v >> 16) & 255) / 255,
        g = ((v >> 8) & 255) / 255,
        b = (v & 255) / 255;
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b),
        d = mx - mn;
      let h = 0;
      if (d) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      return h;
    };
    const skillHue = hueOf(KIND_COL.skill);
    expect(skillHue).toBeGreaterThan(295);
    expect(skillHue).toBeLessThan(345);
    expect(hueOf(KIND_COL.doc)).toBeGreaterThan(295); // doc is in the same pink family
  });

  test('[covers:F-5b188856/AC-6b822a] groups doc and skill in the pink arc and keeps every emitted kind color above the bloom luminance floor', () => {
    const hueOf = (hex: string): number => {
      const [red, green, blue] = hexToRgb01(hex);
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      const delta = high - low;
      if (delta === 0) return 0;
      const hue = high === red ? ((green - blue) / delta) % 6 : high === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
      return (hue * 60 + 360) % 360;
    };

    expect(hueOf(KIND_COL.doc)).toBeGreaterThan(295);
    expect(hueOf(KIND_COL.skill)).toBeGreaterThan(295);
    expect(hueOf(KIND_COL.doc)).toBeLessThan(345);
    expect(hueOf(KIND_COL.skill)).toBeLessThan(345);
    for (const [kind, color] of Object.entries(KIND_COL)) {
      expect(luminance(color), `${kind} must clear the bloom luminance floor`).toBeGreaterThanOrEqual(125);
    }
  });

  test('EDGE_COL has the seven declared edge kinds', () => {
    expect(EDGE_COL.depends_on).toBe('#3b82f6');
    expect(EDGE_COL.touches).toBe('#f97316');
    expect(EDGE_COL.covers).toBe('#22c55e');
    expect(EDGE_COL.binds).toBe('#22d3ee');
    expect(EDGE_COL.implements).toBe('#a855f7');
    expect(EDGE_COL.references).toBe('#ec4899');
    expect(EDGE_COL.links).toBe('#64748b');
  });

  test('DEFAULT_NODE and DEFAULT_EDGE are the declared fallbacks', () => {
    expect(DEFAULT_NODE).toBe('#9ca3af');
    expect(DEFAULT_EDGE).toBe('#1C8585');
  });
});

describe('hexToRgb01', () => {
  test('white maps to [1,1,1]', () => {
    const [r, g, b] = hexToRgb01('#ffffff');
    expect(r).toBeCloseTo(1);
    expect(g).toBeCloseTo(1);
    expect(b).toBeCloseTo(1);
  });

  test('black maps to [0,0,0]', () => {
    const [r, g, b] = hexToRgb01('#000000');
    expect(r).toBeCloseTo(0);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
  });

  test('pure red maps to [1,0,0]', () => {
    const [r, g, b] = hexToRgb01('#ff0000');
    expect(r).toBeCloseTo(1);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
  });

  test('3-digit shorthand expands (#fff -> [1,1,1])', () => {
    const [r, g, b] = hexToRgb01('#fff');
    expect(r).toBeCloseTo(1);
    expect(g).toBeCloseTo(1);
    expect(b).toBeCloseTo(1);
  });
});

describe('semanticHue', () => {
  test('[covers:F-77f7ead0/AC-1a2b3c4d] all live kinds alone choose their hue across tiers, while degree whitens and boosted instances bloom', () => {
    const tiers = ['A', 'B', 'C', 'D'];
    for (const [kind, hue] of Object.entries(KIND_COL)) {
      const leafCore = coreColor(hexToRgb01(hue), degreeLuminosity(0, 30));
      const hubCore = coreColor(hexToRgb01(hue), degreeLuminosity(30, 30));
      const leafInstance = instanceColor({node: {kind}, deg: 0, maxDeg: 30});
      for (const tier of tiers) {
        expect(semanticHue({kind, tier})).toBe(hue);
        expect(instanceColor({node: {kind, tier}, deg: 0, maxDeg: 30})).toEqual(leafInstance);
      }
      expect(whiteDistance(hubCore)).toBeLessThan(whiteDistance(leafCore));
      expect(maxChannel(leafInstance)).toBeGreaterThan(1);
      expect(maxChannel(instanceColor({node: {kind}, deg: 30, maxDeg: 30}))).toBeGreaterThan(1);
    }
  });

  test('[covers:F-5b188856/AC-590579] kind always wins — tier never touches the node hue (double-encoding removed)', () => {
    // Even a tiered node colors by kind: a tier-A module is orange (its kind), NOT tier-A blue.
    expect(semanticHue({tier: 'A', kind: 'module'})).toBe('#f97316');
    expect(semanticHue({tier: 'B', kind: 'test'})).toBe('#22c55e');
  });

  test('kind maps to its KIND_COL hue', () => {
    expect(semanticHue({kind: 'module'})).toBe('#f97316');
  });

  test('neither tier nor kind falls back to DEFAULT_NODE', () => {
    expect(semanticHue({})).toBe(DEFAULT_NODE);
  });

  test('module, test and doc kinds are three distinct colors', () => {
    const m = semanticHue({kind: 'module'});
    const t = semanticHue({kind: 'test'});
    const d = semanticHue({kind: 'doc'});
    expect(new Set([m, t, d]).size).toBe(3);
  });

  test('[covers:F-5b188856/AC-590579] a tier-only node (no kind) falls back to DEFAULT_NODE — tier is not a hue', () => {
    expect(semanticHue({tier: 'A'})).toBe(DEFAULT_NODE);
    expect(semanticHue({tier: 'B'})).toBe(DEFAULT_NODE);
    expect(semanticHue({tier: 'C'})).toBe(DEFAULT_NODE);
  });

  test('TIER_COL still carries distinct A/B/C/D colors for the sidebar tier FILTER', () => {
    // Tier no longer colors a node, but the sidebar filter legend still needs distinct swatches.
    expect(new Set([TIER_COL.A, TIER_COL.B, TIER_COL.C, TIER_COL.D]).size).toBe(4);
  });
});

describe('nodeRadius', () => {
  test('degree 0 gives radius 3', () => {
    expect(nodeRadius(0)).toBeCloseTo(3);
  });

  test('matches min(15, 3 + sqrt(deg)*1.7) for a mid value', () => {
    expect(nodeRadius(4)).toBeCloseTo(Math.min(15, 3 + Math.sqrt(4) * 1.7));
  });

  test('monotonic non-decreasing in deg', () => {
    let prev = -Infinity;
    for (let d = 0; d <= 200; d++) {
      const r = nodeRadius(d);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  test('capped at 15 for huge degree', () => {
    expect(nodeRadius(1e6)).toBe(15);
  });
});

describe('degreeLuminosity', () => {
  test('zero degree gives 0', () => {
    expect(degreeLuminosity(0, 10)).toBeCloseTo(0);
  });

  test('full degree gives 1', () => {
    expect(degreeLuminosity(10, 10)).toBeCloseTo(1);
  });

  test('half degree gives 0.5', () => {
    expect(degreeLuminosity(5, 10)).toBeCloseTo(0.5);
  });

  test('zero maxDeg is guarded to 0', () => {
    expect(degreeLuminosity(5, 0)).toBeCloseTo(0);
  });

  test('clamped to 0..1 even when deg > maxDeg', () => {
    const v = degreeLuminosity(50, 10);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  test('monotonic non-decreasing in deg', () => {
    let prev = -Infinity;
    for (let d = 0; d <= 20; d++) {
      const v = degreeLuminosity(d, 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('coreColor', () => {
  const hue: RGB = hexToRgb01('#3b82f6'); // a non-white hue

  test('norm=1 channels >= norm=0 channels, at least one strictly greater', () => {
    const lo = coreColor(hue, 0);
    const hi = coreColor(hue, 1);
    let anyStrictlyGreater = false;
    for (let i = 0; i < 3; i++) {
      expect(hi[i]).toBeGreaterThanOrEqual(lo[i] - 1e-9);
      if (hi[i] > lo[i] + 1e-9) anyStrictlyGreater = true;
    }
    expect(anyStrictlyGreater).toBe(true);
  });

  test('norm=0 is hue mixed ~10% toward white, not exactly hue', () => {
    const lo = coreColor(hue, 0);
    let differsFromHue = false;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(lo[i] - hue[i]) > 1e-6) differsFromHue = true;
    }
    expect(differsFromHue).toBe(true);
  });
});

describe('bloomBoost', () => {
  test('[1,1,1] boosts to ~[2,2,2] (brightness 1 -> boost 2.0)', () => {
    const [r, g, b] = bloomBoost([1, 1, 1]);
    expect(r).toBeCloseTo(2);
    expect(g).toBeCloseTo(2);
    expect(b).toBeCloseTo(2);
  });

  test('[0,0,0] stays [0,0,0]', () => {
    const [r, g, b] = bloomBoost([0, 0, 0]);
    expect(r).toBeCloseTo(0);
    expect(g).toBeCloseTo(0);
    expect(b).toBeCloseTo(0);
  });

  test('a near-white input produces a channel > 1.0', () => {
    const out = bloomBoost([0.9, 0.9, 0.9]);
    expect(maxChannel(out)).toBeGreaterThan(1.0);
  });
});

describe('healthOverride', () => {
  test('error is red-dominant (r is the largest channel)', () => {
    const [r, g, b] = healthOverride('error', 0.5);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  test('[covers:F-77f7ead0/AC-2b3c4d5e] error red channel exceeds 1.0', () => {
    const [r] = healthOverride('error', 0);
    expect(r).toBeGreaterThan(1.0);
  });

  test('warn is amber: g is substantial and >> error g at same norm', () => {
    const warn = healthOverride('warn', 0.5);
    const err = healthOverride('error', 0.5);
    // warn green channel substantial
    expect(warn[1]).toBeGreaterThan(0.5);
    // distinctly higher green than error at same norm
    expect(warn[1]).toBeGreaterThan(err[1]);
  });

  test('larger norm -> brighter (error)', () => {
    const lo = healthOverride('error', 0);
    const hi = healthOverride('error', 1);
    expect(maxChannel(hi)).toBeGreaterThan(maxChannel(lo));
  });

  test('pulse scales linearly (pulse=0.5 is half of pulse=1)', () => {
    const full = healthOverride('error', 0.5, 1);
    const half = healthOverride('error', 0.5, 0.5);
    for (let i = 0; i < 3; i++) {
      expect(half[i]).toBeCloseTo(full[i] * 0.5);
    }
  });

  test('default pulse is 1', () => {
    const def = healthOverride('error', 0.5);
    const one = healthOverride('error', 0.5, 1);
    for (let i = 0; i < 3; i++) {
      expect(def[i]).toBeCloseTo(one[i]);
    }
  });
});

describe('instanceColor', () => {
  const healthyHub = instanceColor({
    node: {kind: 'feature'},
    deg: 30,
    maxDeg: 30,
  });

  test('a healthy hub blooms (at least one channel > 1.0)', () => {
    expect(maxChannel(healthyHub)).toBeGreaterThan(1.0);
  });

  test('dimmed node every channel small and strictly less than non-dimmed boosted', () => {
    const normal = instanceColor({
      node: {kind: 'feature'},
      deg: 30,
      maxDeg: 30,
      dimmed: false,
    });
    const dim = instanceColor({
      node: {kind: 'feature'},
      deg: 30,
      maxDeg: 30,
      dimmed: true,
    });
    for (let i = 0; i < 3; i++) {
      expect(dim[i]).toBeLessThan(normal[i] + 1e-9);
    }
    // dimmed max channel strictly less than healthy same node max channel
    expect(maxChannel(dim)).toBeLessThan(maxChannel(normal));
  });

  test('an error drift node has a channel > 1.0', () => {
    const drift = instanceColor({
      node: {kind: 'feature'},
      deg: 5,
      maxDeg: 30,
      health: {severity: 'error'},
    });
    expect(maxChannel(drift)).toBeGreaterThan(1.0);
  });

  test('[covers:F-77f7ead0/AC-2b3c4d5e] error drift is the brightest: its max channel > any healthy node max channel', () => {
    const drift = instanceColor({
      node: {kind: 'feature'},
      deg: 1,
      maxDeg: 30,
      health: {severity: 'error'},
    });
    // build several healthy nodes across kinds and degrees
    const healthyMaxes: number[] = [];
    for (const kind of ['feature', 'module', 'test', 'doc', 'scenario', 'capability']) {
      for (const deg of [0, 5, 15, 30]) {
        healthyMaxes.push(
          maxChannel(instanceColor({node: {kind}, deg, maxDeg: 30})),
        );
      }
    }
    const brightestHealthy = Math.max(...healthyMaxes);
    expect(maxChannel(drift)).toBeGreaterThan(brightestHealthy);
  });

  test('health set on a non-dimmed node takes the health branch (amber for warn)', () => {
    const warn = instanceColor({
      node: {kind: 'feature'},
      deg: 5,
      maxDeg: 30,
      health: {severity: 'warn'},
    });
    // amber: red and green both substantial
    expect(warn[0]).toBeGreaterThan(0.5);
    expect(warn[1]).toBeGreaterThan(0.5);
  });

  test('dimmed wins over health (mutually exclusive, dimmed first)', () => {
    const dimmedWithHealth = instanceColor({
      node: {kind: 'feature'},
      deg: 5,
      maxDeg: 30,
      dimmed: true,
      health: {severity: 'error'},
    });
    // dimmed core *0.15 -> every channel small, well below 1.0
    expect(maxChannel(dimmedWithHealth)).toBeLessThan(1.0);
  });
});

describe('edgeColor', () => {
  test('[covers:F-77f7ead0/AC-4d5e6f70] known kind maps to its color', () => {
    expect(edgeColor('depends_on')).toBe('#3b82f6');
  });

  test('unknown kind falls back to DEFAULT_EDGE', () => {
    expect(edgeColor('totally-unknown')).toBe(DEFAULT_EDGE);
    expect(edgeColor('totally-unknown')).toBe('#1C8585');
  });
});

describe('edgeIntensity', () => {
  test('[covers:F-77f7ead0/AC-4d5e6f70] no highlight, same kind -> 0.25', () => {
    expect(
      edgeIntensity({highlightActive: false, sourceHi: false, targetHi: false, sameKind: true}),
    ).toBeCloseTo(0.25);
  });

  test('no highlight, different kind -> 0.06', () => {
    expect(
      edgeIntensity({highlightActive: false, sourceHi: false, targetHi: false, sameKind: false}),
    ).toBeCloseTo(0.06);
  });

  test('[covers:F-77f7ead0/AC-4d5e6f70] highlight active, both endpoints hi -> 0.5', () => {
    expect(
      edgeIntensity({highlightActive: true, sourceHi: true, targetHi: true, sameKind: false}),
    ).toBeCloseTo(0.5);
  });

  test('[covers:F-77f7ead0/AC-4d5e6f70] highlight active, neither hi -> 0 (skip)', () => {
    expect(
      edgeIntensity({highlightActive: true, sourceHi: false, targetHi: false, sameKind: true}),
    ).toBeCloseTo(0);
  });

  test('highlight active, exactly one hi -> 0.04', () => {
    expect(
      edgeIntensity({highlightActive: true, sourceHi: true, targetHi: false, sameKind: false}),
    ).toBeCloseTo(0.04);
    expect(
      edgeIntensity({highlightActive: true, sourceHi: false, targetHi: true, sameKind: false}),
    ).toBeCloseTo(0.04);
  });
});
