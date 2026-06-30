// Cladding · graph · stellar color math — F webgl-stellar-viewer
//
// Pure, headless-testable color logic for the WebGL galaxy viewer. The reference
// (DeusData/codebase-memory-mcp) colors stars BY DEGREE (blue-white giants → red
// dwarfs) and BOOSTS every instance color above 1.0 so an UnrealBloom pass picks up
// the excess as a glow corona (`meshBasicMaterial vertexColors toneMapped={false}`).
//
// We keep cladding's VALUE — node HUE still encodes meaning (SSoT tier A/B/C/D, or the
// kind feature/scenario/capability/module/test/doc) — and fold the reference's stellar
// idea on top: DEGREE drives LUMINOSITY (a node's core is mixed toward white the more
// load-bearing it is), and that brighter core in turn earns a stronger bloom boost. So
// hubs burn blue/violet/teal-white with a wide corona; leaves stay dim and hue-true.
//
// The viewer (src/graph/viewer/main.ts, WebGL, untestable headless) imports these exact
// functions, so what the tests pin is what ships. Colors are returned as linear RGB in
// 0..1 and MAY exceed 1.0 on purpose (that overflow is what blooms).

/** A node as the color math needs it — only hue inputs. */
export interface ColorNode {
  readonly tier?: string;
  readonly kind?: string;
}

export type Rgb = readonly [number, number, number];

/** SSoT tier hue (A/B/C/D) — used only by the sidebar tier FILTER, no longer by node hue. */
export const TIER_COL: Readonly<Record<string, string>> = {
  A: '#3b82f6', // spec (sealed) — blue
  B: '#a855f7', // design — violet
  C: '#14b8a6', // derived — teal
  D: '#f59e0b', // audit — amber
};

// Per-kind hue — the ONE thing a node's color encodes (tier no longer touches hue).
// Grouped by what the node IS, so the group reads at a glance on the near-black galaxy:
//   SPEC  = blue family (feature/scenario/capability) — similar blues, told apart by luminance
//   CODE  = orange (module) · TEST = green (test) — the two strong anchors, deliberately far apart
//   DOCS  = pink family (doc/skill) — skill is SKILL.md, a document, NOT code
// All hexes verified Y≥125 (bloom floor) and clear of the 0-45° health-burn arc, EXCEPT module
// orange (anchor, kept from the original) — the health burn pulses 2.2-3× so motion disambiguates.
export const KIND_COL: Readonly<Record<string, string>> = {
  feature: '#4f8ef7', // SPEC — blue (anchor)
  scenario: '#45b5ed', // SPEC — cyan-blue
  capability: '#8f86f0', // SPEC — lavender-blue
  module: '#f97316', // CODE — orange (anchor)
  test: '#22c55e', // TEST — green (anchor)
  doc: '#f368a8', // DOCS — rose
  skill: '#f7a8e6', // DOCS — light pink (SKILL.md is a doc, not code)
};

/** Per-edge-kind hue (additive filaments). */
export const EDGE_COL: Readonly<Record<string, string>> = {
  depends_on: '#3b82f6',
  touches: '#f97316',
  covers: '#22c55e',
  binds: '#22d3ee',
  implements: '#a855f7',
  references: '#ec4899',
  links: '#64748b',
};

export const DEFAULT_NODE = '#9ca3af';
export const DEFAULT_EDGE = '#1C8585'; // reference's DEFAULT_EDGE_COLOR

/** "#rgb" or "#rrggbb" → linear RGB in 0..1. */
export function hexToRgb01(hex: string): Rgb {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = parseInt(h, 16) || 0;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/**
 * The semantic hue (hex): KIND only, never tier. Encoding both tier and kind in one hue
 * double-counted (tier is derivable from kind) and collided — same blue meant "feature" AND
 * "tier A". Tier now lives in the sidebar filter + tooltip, not the node color.
 */
export function semanticHue(node: ColorNode): string {
  return (node.kind && KIND_COL[node.kind]) || DEFAULT_NODE;
}

/** Node sphere radius from degree — bounded so the biggest hub never dominates. */
export function nodeRadius(deg: number): number {
  return Math.min(15, 3 + Math.sqrt(Math.max(0, deg)) * 1.7);
}

/** 0..1 luminosity from degree (the "stellar class": hubs → 1, leaves → 0). */
export function degreeLuminosity(deg: number, maxDeg: number): number {
  return maxDeg > 0 ? Math.max(0, Math.min(1, deg / maxDeg)) : 0;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const WHITE: Rgb = [1, 1, 1];

/** Core color: the hue mixed toward white by luminosity — hubs run hot/white. */
export function coreColor(hue: Rgb, norm: number): Rgb {
  return mix(hue, WHITE, 0.1 + 0.46 * Math.max(0, Math.min(1, norm)));
}

/**
 * Push color above 1.0 so the bloom pass renders the excess as a corona.
 * Verbatim from the reference: boost = 1.2 + brightness*0.8 (1.2× red → 2.0× white).
 * Because coreColor already whitens hubs, hubs land near 2.0× → big corona.
 */
export function bloomBoost(rgb: Rgb): Rgb {
  const brightness = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const boost = 1.2 + brightness * 0.8;
  return [rgb[0] * boost, rgb[1] * boost, rgb[2] * boost];
}

/** Drift override (the live killer): a node burns red (error) / amber (warn), far above 1.0. */
export function healthOverride(severity: 'error' | 'warn', norm: number, pulse = 1): Rgb {
  const base: Rgb = severity === 'error' ? [239 / 255, 68 / 255, 68 / 255] : [245 / 255, 158 / 255, 11 / 255];
  const mag = (2.2 + 0.8 * Math.max(0, Math.min(1, norm))) * pulse; // brightest things on screen
  return [base[0] * mag, base[1] * mag, base[2] * mag];
}

export interface InstanceColorOpts {
  readonly node: ColorNode;
  readonly deg: number;
  readonly maxDeg: number;
  /** A highlight set is active and this node is NOT in it → dim (no boost). */
  readonly dimmed?: boolean;
  /** Live drift on this node → burn instead of hue. */
  readonly health?: {readonly severity: 'error' | 'warn'} | null;
  /** Pulse multiplier for the health burn (1 = steady). */
  readonly pulse?: number;
}

/**
 * The final per-instance linear RGB (may exceed 1.0 → blooms). Mutually exclusive
 * branches, matching the reference: a node is dimmed (×0.15) OR burning OR boosted.
 */
export function instanceColor(opts: InstanceColorOpts): Rgb {
  const hue = hexToRgb01(semanticHue(opts.node));
  const norm = degreeLuminosity(opts.deg, opts.maxDeg);
  const core = coreColor(hue, norm);
  if (opts.dimmed) return [core[0] * 0.15, core[1] * 0.15, core[2] * 0.15];
  if (opts.health) return healthOverride(opts.health.severity, norm, opts.pulse ?? 1);
  return bloomBoost(core);
}

/** Edge filament hue. */
export function edgeColor(kind: string): string {
  return EDGE_COL[kind] || DEFAULT_EDGE;
}

export interface EdgeIntensityOpts {
  readonly highlightActive: boolean;
  readonly sourceHi: boolean;
  readonly targetHi: boolean;
  /** Endpoints share a kind (cladding's analogue of the reference's same-cluster). */
  readonly sameKind: boolean;
}

/**
 * Edge brightness scalar (premultiplied into the additive line color). Returns 0 when a
 * highlight is active and neither endpoint is in it — the caller skips drawing that edge.
 * Verbatim intensities from the reference EdgeLines.
 */
export function edgeIntensity(o: EdgeIntensityOpts): number {
  if (o.highlightActive) {
    if (!o.sourceHi && !o.targetHi) return 0; // skipped
    return o.sourceHi && o.targetHi ? 0.5 : 0.04;
  }
  return o.sameKind ? 0.25 : 0.06;
}
