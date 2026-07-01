// Cladding · graph · deterministic 3D force layout — F webgl-stellar-viewer
//
// The reference (DeusData/codebase-memory-mcp) computes positions server-side in C:
// a deterministic ring/anchor INITIALIZATION (per-node hash → concentric shells) plus a
// force pass (Barnes-Hut repulsion + linear edge springs + an anchor spring back to the
// seed, fixed iterations, a per-step displacement cap — no temperature, no community
// detection). We do the same in TS, scaled to cladding's ~721 nodes (plain O(n²)
// repulsion — no octree needed at this size), so the layout is:
//
//   • DETERMINISTIC — every coordinate derives from FNV-1a(id); no Math.random / Date.
//     Same graph → byte-identical positions (the offline-export reproducibility contract).
//   • BOUNDED + FINITE — the anchor spring + a faint center pull keep nodes near their
//     seed shell; each step clamps to ±BOUND and reseeds any NaN/Infinity.
//   • CLUSTERED — kind chooses a base shell radius, so spec sits inner and code/test/doc
//     fan outward — a readable 3D galaxy you orbit, hubs blazing (color is in stellar.ts).
//
// Pure + headless-tested (tests/graph/layout3d.test.ts). main.ts (WebGL) imports this
// exact function, so the tested layout is the shipped layout.

export interface LayoutNode {
  readonly id: string;
  readonly kind?: string;
}
export interface LayoutEdge {
  readonly from: string;
  readonly to: string;
}
export type Vec3 = [number, number, number];

export interface Layout3dOptions {
  /** Force-relaxation passes (default 140). */
  readonly iterations?: number;
  /** Hard coordinate clamp (default 4000). */
  readonly bound?: number;
}

// Force constants (tuned for ~700 nodes at the ~210..630 seed-shell scale).
const REPEL = 7000; // inverse-square charge magnitude
const FMAX = 34; // per-pair repulsion cap (stops near-coincident blow-ups)
const LINK = 0.02; // edge spring stiffness
const LINKDIST = 90; // edge spring rest length
const ANCHOR = 0.05; // pull back toward the deterministic seed (preserves shells)
const CENTER = 0.0015; // faint pull to origin (cohesion + guaranteed boundedness)
const MAXSTEP = 14; // per-iteration displacement cap (the reference's pseudo-cooling)

// Kind → base shell radius: spec inner, code/test/doc outer (a readable galaxy).
const BAND: Readonly<Record<string, number>> = {
  feature: 0,
  capability: 40,
  scenario: 70,
  module: 150,
  doc: 210,
  test: 270,
};

/** FNV-1a 32-bit. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic seed position on a per-kind sphere shell (uniform over the sphere). */
function seedOf(node: LayoutNode): Vec3 {
  const h = hashStr(node.id);
  const theta = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  const u = ((h >>> 16) & 0xff) / 255;
  const phi = Math.acos(2 * u - 1); // uniform latitude
  const jitter = ((h >>> 24) & 0xff) / 255;
  const band = BAND[node.kind ?? ''] ?? 120;
  const r = 210 + band + jitter * 150;
  const sp = Math.sin(phi);
  return [r * sp * Math.cos(theta), r * sp * Math.sin(theta), r * Math.cos(phi)];
}

/**
 * Computes deterministic, finite, bounded 3D positions for the graph.
 * Returns a plain object keyed by node id → [x, y, z].
 */
export function computeLayout3d(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  opts: Layout3dOptions = {},
): Record<string, Vec3> {
  const iterations = opts.iterations ?? 140;
  const bound = opts.bound ?? 4000;
  const n = nodes.length;
  const out: Record<string, Vec3> = {};
  if (n === 0) return out;

  const idx: Record<string, number> = {};
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  const ax = new Float64Array(n); // anchors (seed)
  const ay = new Float64Array(n);
  const az = new Float64Array(n);
  const deg = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    idx[nodes[i].id] = i;
    const s = seedOf(nodes[i]);
    px[i] = ax[i] = s[0];
    py[i] = ay[i] = s[1];
    pz[i] = az[i] = s[2];
  }
  // Edge index list (only edges whose endpoints both resolve).
  const es: number[] = [];
  const et: number[] = [];
  for (const e of edges) {
    const a = idx[e.from];
    const b = idx[e.to];
    if (a === undefined || b === undefined || a === b) continue;
    es.push(a);
    et.push(b);
    deg[a]++;
    deg[b]++;
  }
  const mass = new Float64Array(n);
  for (let i = 0; i < n; i++) mass[i] = 1 + Math.sqrt(deg[i]);

  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const fz = new Float64Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    fx.fill(0);
    fy.fill(0);
    fz.fill(0);

    // Repulsion — O(n²) inverse-square, capped.
    for (let i = 0; i < n; i++) {
      const xi = px[i];
      const yi = py[i];
      const zi = pz[i];
      for (let j = i + 1; j < n; j++) {
        let dx = xi - px[j];
        let dy = yi - py[j];
        let dz = zi - pz[j];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) {
          // near-coincident: nudge deterministically by index so they separate
          dx = (i - j) % 2 === 0 ? 0.1 : -0.1;
          dy = 0.07;
          dz = 0.05;
          d2 = dx * dx + dy * dy + dz * dz;
        }
        const inv = 1 / Math.sqrt(d2);
        let f = REPEL / d2;
        if (f > FMAX) f = FMAX;
        const ux = dx * inv * f;
        const uy = dy * inv * f;
        const uz = dz * inv * f;
        fx[i] += ux;
        fy[i] += uy;
        fz[i] += uz;
        fx[j] -= ux;
        fy[j] -= uy;
        fz[j] -= uz;
      }
    }
    // Attraction — linear edge springs toward rest length.
    for (let k = 0; k < es.length; k++) {
      const a = es[k];
      const b = et[k];
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      const dz = pz[b] - pz[a];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      const f = ((d - LINKDIST) * LINK) / d;
      const ux = dx * f;
      const uy = dy * f;
      const uz = dz * f;
      fx[a] += ux;
      fy[a] += uy;
      fz[a] += uz;
      fx[b] -= ux;
      fy[b] -= uy;
      fz[b] -= uz;
    }
    // Anchor spring (preserves the seed shell) + faint center pull; integrate, capped.
    for (let i = 0; i < n; i++) {
      fx[i] += (ax[i] - px[i]) * ANCHOR * mass[i] - px[i] * CENTER;
      fy[i] += (ay[i] - py[i]) * ANCHOR * mass[i] - py[i] * CENTER;
      fz[i] += (az[i] - pz[i]) * ANCHOR * mass[i] - pz[i] * CENTER;
      const fm = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i] + fz[i] * fz[i]);
      const speed = fm > MAXSTEP ? MAXSTEP / fm : 1;
      let nx = px[i] + fx[i] * speed;
      let ny = py[i] + fy[i] * speed;
      let nz = pz[i] + fz[i] * speed;
      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
        nx = ax[i];
        ny = ay[i];
        nz = az[i];
      }
      px[i] = nx < -bound ? -bound : nx > bound ? bound : nx;
      py[i] = ny < -bound ? -bound : ny > bound ? bound : ny;
      pz[i] = nz < -bound ? -bound : nz > bound ? bound : nz;
    }
  }

  for (let i = 0; i < n; i++) out[nodes[i].id] = [px[i], py[i], pz[i]];
  return out;
}
