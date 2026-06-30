// Cladding · knowledge-graph viewer — REAL three.js stellar galaxy (F webgl-stellar-viewer)
//
// A faithful replication of DeusData/codebase-memory-mcp's WebGL look over cladding's own
// SSoT graph: instanced sphere "stars" whose colors are boosted >1.0 so an UnrealBloom pass
// renders the excess as a glow corona, additive edge filaments, deep-space background,
// OrbitControls + 60s idle auto-rotate. Vanilla three.js (no React) bundled offline by
// scripts/build.mjs (esbuild → dist/viewer/app.js, three vendored in, zero network).
//
// What stays cladding's: node HUE encodes meaning (SSoT tier / kind) while DEGREE drives
// luminosity (stellar.ts); and the LIVE KILLER — drift nodes BURN red/amber and heal on an
// SSE refresh (window.__CLADDING_HEALTH / clad graph serve's /health.json).
//
// This file is the WebGL glue and cannot run headless (no GL in vitest); the testable cores
// it imports — ../stellar and ../layout3d — are pinned by tests, so the tested math ships.
//
// eslint-disabled via src/graph/viewer/** ignore; tsc-excluded (DOM + three globals).

import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';

import {computeLayout3d} from '../layout3d';
import {edgeColor, edgeIntensity, instanceColor, KIND_COL, nodeRadius, semanticHue} from '../stellar';

// What-I-write is what-renders: skip sRGB conversion so boosted (>1) linear colors bloom.
THREE.ColorManagement.enabled = false;

(function () {
  'use strict';
  const G: any = (window as any).__CLADDING_GRAPH || {nodes: [], edges: [], legend: [], tierMeta: {}, codeColor: '#9ca3af'};
  let HEALTH: any = (window as any).__CLADDING_HEALTH || null;

  const canvas = document.getElementById('g') as HTMLCanvasElement;
  if (!canvas) return;

  // ---- graph model: nodes, degree, adjacency ----
  const nodes: any[] = (G.nodes || []).map((n: any) => ({...n}));
  const byId: Record<string, any> = {};
  nodes.forEach((n, i) => {
    n._i = i;
    n.deg = 0;
    byId[n.id] = n;
  });
  const edges: any[] = (G.edges || [])
    .map((e: any) => ({s: byId[e.from], t: byId[e.to], kind: e.kind}))
    .filter((e: any) => e.s && e.t && e.s !== e.t);
  const adj: Record<string, Record<string, 1>> = {};
  nodes.forEach((n) => (adj[n.id] = {}));
  edges.forEach((e) => {
    e.s.deg++;
    e.t.deg++;
    adj[e.s.id][e.t.id] = 1;
    adj[e.t.id][e.s.id] = 1;
  });
  const maxDeg = nodes.reduce((m, n) => Math.max(m, n.deg), 1);

  // ---- WebGL renderer (graceful fallback if unavailable) ----
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: false, powerPreference: 'high-performance'});
  } catch {
    const stage = document.getElementById('stage') || document.body;
    const msg = document.createElement('div');
    msg.setAttribute(
      'style',
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#8b949e;font:14px -apple-system,sans-serif;text-align:center;padding:24px',
    );
    msg.textContent = 'This 3D graph needs WebGL — enable hardware acceleration or open it in a WebGL-capable browser.';
    stage.replaceChildren(msg);
    return;
  }
  renderer.setPixelRatio(Math.min(1.5, Math.max(1, window.devicePixelRatio || 1)));
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010204); // deep space (darker per user) — NO fog
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
  camera.position.set(0, 0, 800);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const pl1 = new THREE.PointLight(0xffffff, 0.6);
  pl1.position.set(500, 500, 500);
  const pl2 = new THREE.PointLight(0x6040ff, 0.4);
  pl2.position.set(-300, -200, -300);
  scene.add(pl1, pl2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 1.5;
  controls.minDistance = 10;
  controls.maxDistance = 50000;
  controls.autoRotateSpeed = 0.4;
  controls.autoRotate = false;

  // ---- deterministic 3D layout (tested in layout3d.ts) ----
  const pos = computeLayout3d(
    nodes.map((n) => ({id: n.id, kind: n.kind})),
    edges.map((e) => ({from: e.s.id, to: e.t.id})),
  );
  nodes.forEach((n) => {
    const p = pos[n.id] || [0, 0, 0];
    n.x = p[0];
    n.y = p[1];
    n.z = p[2];
  });
  // Pull the camera back to frame the WHOLE galaxy with margin (not zoomed-in/packed):
  // distance to fit the cluster's bounding sphere in the vertical fov, ×1.4 breathing room.
  let maxR = 1;
  nodes.forEach((n) => {
    const r = Math.hypot(n.x, n.y, n.z);
    if (r > maxR) maxR = r;
  });
  const initialDist = Math.min(50000, (maxR / Math.sin(((camera.fov * Math.PI) / 180) / 2)) * 1.12);
  camera.position.set(0, 0, initialDist);

  // ---- nodes: one InstancedMesh of unit spheres; per-instance color via the geometry
  // 'color' attribute (vertexColors path — exactly the reference's instancedBufferAttribute
  // attach="geometry-attributes-color"). Values may exceed 1.0 → bloom corona. ----
  const geo = new THREE.SphereGeometry(1, 20, 16);
  const mat = new THREE.MeshBasicMaterial({vertexColors: true, toneMapped: false});
  const mesh = new THREE.InstancedMesh(geo, mat, nodes.length);
  mesh.frustumCulled = false;
  const colorArr = new Float32Array(nodes.length * 3);
  const colorAttr = new THREE.InstancedBufferAttribute(colorArr, 3);
  geo.setAttribute('color', colorAttr);
  scene.add(mesh);
  const dummy = new THREE.Object3D();
  function writeColor(i: number, rgb: readonly number[]): void {
    colorArr[i * 3] = rgb[0];
    colorArr[i * 3 + 1] = rgb[1];
    colorArr[i * 3 + 2] = rgb[2];
  }

  // ---- edges: one additive LineSegments ----
  const edgeGeo = new THREE.BufferGeometry();
  const edgeMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22, // additive edges converge at the core → keep them faint so they don't wash out
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.frustumCulled = false;
  scene.add(edgeLines);
  const edgePos = new Float32Array(edges.length * 6);
  const edgeCol = new Float32Array(edges.length * 6);

  // ---- post: UnrealBloom (strength=intensity, radius, threshold) + OutputPass ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // strength / radius / threshold — tuned DOWN from the reference (1.2/0.6/0.3): with our
  // ~726 boosted nodes the whole field bloomed ("너무 빛나"). A higher threshold means only
  // the brightest (hub/whitened) stars glow; lower strength keeps it from washing out.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.4, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function fit(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    // Account for the fixed left sidebar (≈264px): shift the camera's optical center right by
    // half the panel so the galaxy (centered on the origin) sits in the VISIBLE area, not under
    // the panel. setViewOffset offsetX<0 moves the rendered content right.
    const sidebar = w > 760 ? 280 : 0;
    if (sidebar) camera.setViewOffset(w, h, -sidebar / 2, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  // ---- view state ----
  const enabledKind: Record<string, boolean> = {};
  const enabledTier: Record<string, boolean> = {};
  ['feature', 'module', 'skill', 'test', 'scenario', 'capability', 'doc'].forEach((k) => (enabledKind[k] = true));
  ['A', 'B', 'C', 'D', 'code'].forEach((t) => (enabledTier[t] = true));
  // Display label for a kind in the UI (sidebar + tooltip). The spec calls a feature's files
  // "modules", but to a reader those are just code — show "code". Data model is unchanged.
  const kindLabel = (k: string): string => (k === 'module' ? 'code' : k);
  let showLabels = true; // default ON (top-degree labels)
  let healthOn = true;
  let hoverId: string | null = null;
  let selId: string | null = null;
  let lastInteraction = 0; // set after boot
  let driftIdx: number[] = [];

  const tierKey = (n: any): string => n.tier || 'code';
  const visible = (n: any): boolean => enabledKind[n.kind] && enabledTier[tierKey(n)];
  const focusNode = (): any => (selId && byId[selId]) || (hoverId && byId[hoverId]) || null;
  const lit = (n: any, f: any): boolean => !f || n.id === f.id || !!adj[f.id][n.id];

  // ---- build / rebuild instance matrices + colors + edges ----
  function rebuildMatrices(): void {
    const f = focusNode();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      let s = nodeRadius(n.deg) * 0.78;
      if (!visible(n)) s = 0;
      else {
        const dim = f && !lit(n, f);
        if (dim) s *= 0.4; // reference 0.2/0.5 ratio
        if (selId === n.id) s *= 1.7;
      }
      dummy.position.set(n.x, n.y, n.z);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  function colorFor(n: any, pulse: number): [number, number, number] {
    const f = focusNode();
    const dimmed = !!(f && !lit(n, f));
    const health = healthOn && HEALTH && HEALTH[n.id] ? {severity: HEALTH[n.id].severity} : null;
    return instanceColor({node: n, deg: n.deg, maxDeg, dimmed, health, pulse}) as any;
  }

  function rebuildColors(pulse: number): void {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      writeColor(i, visible(n) ? colorFor(n, pulse) : [0, 0, 0]);
    }
    colorAttr.needsUpdate = true;
  }

  function recomputeDrift(): void {
    driftIdx = [];
    if (!healthOn || !HEALTH) return;
    for (let i = 0; i < nodes.length; i++) if (HEALTH[nodes[i].id] && visible(nodes[i])) driftIdx.push(i);
  }

  function pulseDrift(pulse: number): void {
    if (!driftIdx.length) return;
    for (const i of driftIdx) writeColor(i, colorFor(nodes[i], pulse));
    colorAttr.needsUpdate = true;
  }

  function rebuildEdges(): void {
    const f = focusNode();
    const hl = !!f;
    let k = 0;
    for (let e = 0; e < edges.length; e++) {
      const ed = edges[e];
      if (!visible(ed.s) || !visible(ed.t)) continue;
      const sHi = !f || lit(ed.s, f);
      const tHi = !f || lit(ed.t, f);
      const inten = edgeIntensity({highlightActive: hl, sourceHi: sHi, targetHi: tHi, sameKind: ed.s.kind === ed.t.kind});
      if (inten <= 0) continue;
      const c = hexToRgbArr(edgeColor(ed.kind));
      const r = c[0] * inten;
      const g = c[1] * inten;
      const b = c[2] * inten;
      edgePos[k] = ed.s.x;
      edgePos[k + 1] = ed.s.y;
      edgePos[k + 2] = ed.s.z;
      edgePos[k + 3] = ed.t.x;
      edgePos[k + 4] = ed.t.y;
      edgePos[k + 5] = ed.t.z;
      edgeCol[k] = r;
      edgeCol[k + 1] = g;
      edgeCol[k + 2] = b;
      edgeCol[k + 3] = r;
      edgeCol[k + 4] = g;
      edgeCol[k + 5] = b;
      k += 6;
    }
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos.slice(0, k), 3));
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol.slice(0, k), 3));
  }

  function hexToRgbArr(hex: string): [number, number, number] {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const v = parseInt(h, 16) || 0;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  function rebuildAll(): void {
    rebuildMatrices();
    rebuildColors(1);
    rebuildEdges();
    recomputeDrift();
    rebuildLabels();
  }

  // ---- labels: top-degree nodes as billboard sprites (gated by toggle) ----
  const labelGroup = new THREE.Group();
  scene.add(labelGroup);
  function clearLabels(): void {
    while (labelGroup.children.length) {
      const c: any = labelGroup.children.pop();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
  }
  function makeLabel(text: string, hex: string, h = 11): THREE.Sprite {
    const pad = 8;
    const c = document.createElement('canvas');
    const cx = c.getContext('2d')!;
    cx.font = '600 64px Inter, system-ui, sans-serif';
    const tw = cx.measureText(text).width;
    c.width = Math.ceil(tw + pad * 2);
    c.height = 80;
    cx.font = '600 64px Inter, system-ui, sans-serif';
    cx.textBaseline = 'middle';
    cx.lineWidth = 11;
    cx.strokeStyle = 'rgba(0,0,0,0.96)'; // stronger dark halo so labels read on the bright core too
    cx.strokeText(text, pad, c.height / 2);
    cx.fillStyle = hex;
    cx.fillText(text, pad, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: tex, transparent: true, depthWrite: false, toneMapped: false}));
    sp.scale.set((c.width / c.height) * h, h, 1);
    sp.renderOrder = 20;
    return sp;
  }
  function rebuildLabels(): void {
    clearLabels();
    if (!showLabels) return;
    const f = focusNode();
    let show: any[];
    if (f) {
      // A node is selected/focused: ALWAYS label it, plus its lit neighbourhood — so the
      // selected node's label is guaranteed visible and you can read what it connects to.
      const neighbours = nodes.filter((n) => visible(n) && n.id !== f.id && lit(n, f)).sort((a, b) => b.deg - a.deg);
      show = [f, ...neighbours].slice(0, 60);
    } else {
      show = nodes.filter(visible).sort((a, b) => b.deg - a.deg).slice(0, 30);
    }
    for (const n of show) {
      const isFocus = !!f && n.id === f.id;
      const text = isFocus ? n.label : n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label;
      const sp = makeLabel(text, semanticHue(n), isFocus ? 15 : 11); // selected: full text, bigger
      sp.position.set(n.x, n.y + nodeRadius(n.deg) * 0.8 + 8, n.z);
      labelGroup.add(sp);
    }
  }

  // ---- raycast hover / click ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(clientX: number, clientY: number): any {
    const rc = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rc.left) / rc.width) * 2 - 1;
    ndc.y = -((clientY - rc.top) / rc.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(mesh);
    for (const h of hits) {
      const id = (h as any).instanceId;
      if (id != null && visible(nodes[id])) return nodes[id];
    }
    return null;
  }

  // Small DOM builder — textContent auto-escapes, so we build nodes instead of
  // concatenating raw HTML strings (the project's ai_hints forbids HTML injection).
  function mkEl(tag: string, cls?: string): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  const tipEl = document.getElementById('tip');
  function showTip(n: any, clientX: number, clientY: number): void {
    if (!tipEl) return;
    if (!n) {
      tipEl.style.display = 'none';
      return;
    }
    const c = semanticHue(n);
    const tl = n.tier ? 'Tier ' + n.tier : 'code';
    const hv = HEALTH && HEALTH[n.id];
    const frag = document.createDocumentFragment();
    const title = mkEl('div', 't');
    title.textContent = n.label;
    const meta = mkEl('div', 'm');
    const k = mkEl('span', 'k');
    k.style.background = c;
    k.textContent = kindLabel(n.kind) + ' · ' + tl;
    meta.appendChild(k);
    if (n.status) meta.appendChild(document.createTextNode(' · ' + n.status));
    frag.append(title, meta);
    if (hv) {
      const w = mkEl('div', 'm');
      w.style.color = hv.severity === 'error' ? '#ef4444' : '#f59e0b';
      w.textContent = '⚠ ' + ((hv.detectors || []).join(', ') || hv.severity);
      frag.appendChild(w);
    }
    if (n.detail && n.detail !== n.label) {
      const d = mkEl('div', 'm');
      d.textContent = n.detail;
      frag.appendChild(d);
    }
    const idd = mkEl('div', 'm');
    idd.textContent = n.id;
    frag.appendChild(idd);
    tipEl.replaceChildren(frag);
    tipEl.style.display = 'block';
    tipEl.style.left = clientX + 14 + 'px';
    tipEl.style.top = clientY + 14 + 'px';
  }

  let downX = 0,
    downY = 0;
  renderer.domElement.addEventListener('pointermove', (ev: PointerEvent) => {
    const n = pickAt(ev.clientX, ev.clientY);
    const id = n ? n.id : null;
    if (id !== hoverId) {
      hoverId = id;
      rebuildMatrices();
      rebuildColors(1);
      rebuildEdges();
      recomputeDrift();
      if (!selId) rebuildLabels(); // hover behaves like click for labels (unless a selection is pinned)
    }
    showTip(n, ev.clientX, ev.clientY);
    canvas.style.cursor = n ? 'pointer' : 'grab';
  });
  renderer.domElement.addEventListener('pointerdown', (ev: PointerEvent) => {
    downX = ev.clientX;
    downY = ev.clientY;
    lastInteraction = perfNow();
    controls.autoRotate = false;
  });
  renderer.domElement.addEventListener('pointerup', (ev: PointerEvent) => {
    if (Math.abs(ev.clientX - downX) > 5 || Math.abs(ev.clientY - downY) > 5) return; // was a drag
    const n = pickAt(ev.clientX, ev.clientY);
    selId = n ? (selId === n.id ? null : n.id) : null;
    if (selId) flyTo(byId[selId]);
    rebuildAll();
  });
  renderer.domElement.addEventListener('wheel', () => {
    lastInteraction = perfNow();
    controls.autoRotate = false;
  });

  // ---- fly-to: frame the node + its CONNECTED neighbours (not a fixed close dolly) ----
  let flyTarget: THREE.Vector3 | null = null;
  let flyDist = 0;
  function flyTo(n: any): void {
    const set = nodes.filter((m) => visible(m) && (m.id === n.id || !!adj[n.id][m.id]));
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const m of set) {
      cx += m.x;
      cy += m.y;
      cz += m.z;
    }
    const c = new THREE.Vector3(cx / set.length, cy / set.length, cz / set.length);
    let R = nodeRadius(n.deg);
    for (const m of set) R = Math.max(R, c.distanceTo(new THREE.Vector3(m.x, m.y, m.z)));
    flyTarget = c;
    // fit the neighbourhood sphere in the vertical fov + margin; a floor stops leaf over-zoom.
    flyDist = Math.min(50000, Math.max(140, (R / Math.sin(((camera.fov * Math.PI) / 180) / 2)) * 1.5));
  }

  // ---- sidebar ----
  function kindCounts(): Record<string, number> {
    const c: Record<string, number> = {};
    nodes.forEach((n) => (c[n.kind] = (c[n.kind] || 0) + 1));
    return c;
  }
  function filterRow(
    key: string,
    name: string,
    sw: string,
    count: number,
    store: Record<string, boolean>,
    noSwatch = false,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'row' + (store[key] ? '' : ' off') + (noSwatch ? ' noswatch' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!store[key];
    cb.onchange = () => {
      store[key] = cb.checked;
      row.className = 'row' + (cb.checked ? '' : ' off');
      rebuildAll();
    };
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = name;
    const ct = document.createElement('span');
    ct.className = 'ct';
    ct.textContent = String(count);
    if (noSwatch) {
      // Tier filter rows carry no color (tier isn't a hue) → checkbox + label only, no empty box.
      row.append(cb, nm, ct);
    } else {
      const s = document.createElement('span');
      s.className = 'sw';
      s.style.background = sw;
      row.append(cb, s, nm, ct);
    }
    return row;
  }
  // Kinds grouped by what the node IS — the color legend reads spec/code/test/docs at a glance.
  const KIND_ZONES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['spec', ['feature', 'scenario', 'capability']],
    ['code', ['module']],
    ['test', ['test']],
    ['docs', ['doc', 'skill']],
  ];
  function buildSidebar(): void {
    const kc = kindCounts();
    KIND_ZONES.forEach(([zone, kinds]) => {
      const box = document.getElementById('kinds-' + zone);
      if (!box) return;
      box.replaceChildren();
      kinds.forEach((k) => {
        if (kc[k]) box.appendChild(filterRow(k, kindLabel(k), KIND_COL[k] || '#9ca3af', kc[k], enabledKind));
      });
    });
    const th = document.getElementById('tiers');
    if (th) {
      th.replaceChildren();
      // Tier is a FILTER only now (no longer a node hue) → render without a misleading color swatch.
      (G.legend || []).forEach((L: any) => th.appendChild(filterRow(L.key, L.label, 'transparent', L.count, enabledTier, true)));
    }
  }
  function btn(id: string, on: boolean, fn: (b: HTMLElement) => void): void {
    const b = document.getElementById(id);
    if (!b) return;
    if (on) b.classList.add('on');
    b.onclick = () => fn(b);
  }
  const sb = document.getElementById('search') as HTMLInputElement | null;
  if (sb)
    sb.addEventListener('input', () => {
      const q = sb.value.trim().toLowerCase();
      if (!q) return;
      const m = nodes.find((n) => visible(n) && (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)));
      if (m) {
        selId = m.id;
        flyTo(m);
        rebuildAll();
      }
    });
  btn('labels', showLabels, (b) => {
    showLabels = !showLabels;
    b.classList.toggle('on', showLabels);
    rebuildLabels();
  });
  btn('health', healthOn, (b) => {
    healthOn = !healthOn;
    b.classList.toggle('on', healthOn);
    rebuildColors(1);
    recomputeDrift();
    refreshPill();
  });
  btn('theme', document.documentElement.classList.contains('light'), (b) => {
    // 3D canvas stays deep-space (additive bloom needs it); theme restyles UI chrome only.
    const lt = document.documentElement.classList.toggle('light');
    b.classList.toggle('on', lt);
    try {
      localStorage.setItem('clad_graph_theme', lt ? 'light' : 'dark');
    } catch {
      /* ignore */
    }
  });
  const rb = document.getElementById('reset');
  if (rb)
    rb.onclick = () => {
      selId = null;
      hoverId = null;
      flyTarget = null;
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, initialDist);
      rebuildAll();
    };

  // ---- conformance pill ----
  function refreshPill(): void {
    const el = document.getElementById('impact');
    if (!el) return;
    if (!HEALTH || !healthOn) {
      el.style.display = 'none';
      return;
    }
    let bad = 0;
    for (const k in HEALTH) if (Object.prototype.hasOwnProperty.call(HEALTH, k)) bad++;
    const pct = Math.max(0, Math.round((1 - bad / (nodes.length || 1)) * 100));
    el.style.display = 'block';
    const dot = mkEl('span', 'dot');
    dot.style.background = bad ? '#f59e0b' : '#22c55e';
    el.replaceChildren(dot, document.createTextNode(' spec↔code ' + pct + '% in sync · ' + bad + ' drift'));
  }

  // ---- live mode (clad graph serve): SSE refresh ----
  function applyHealth(h: any): void {
    HEALTH = h && Object.keys(h).length ? h : null;
    rebuildColors(1);
    recomputeDrift();
    refreshPill();
  }
  function liveWire(): void {
    if (typeof fetch !== 'function' || typeof EventSource !== 'function') return;
    fetch('graph.json', {cache: 'no-store'})
      .then((r) => {
        if (!r.ok) return; // static export / file:// → embedded data only
        const pull = (): void => {
          fetch('health.json', {cache: 'no-store'})
            .then((r2) => (r2.ok ? r2.json() : null))
            .then(applyHealth)
            .catch(() => undefined);
        };
        pull();
        const es = new EventSource('events');
        es.onmessage = () => {
          fetch('graph.json', {cache: 'no-store'})
            .then((r2) => (r2.ok ? r2.json() : null))
            .then((g2) => {
              if (g2 && g2.nodes && g2.nodes.length !== nodes.length) {
                location.reload();
                return;
              }
              pull(); // health-only → smooth heal
            })
            .catch(() => undefined);
        };
      })
      .catch(() => undefined);
  }

  // ---- timing (perf.now, no Date in the hot loop) ----
  function perfNow(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
  }

  // ---- frame loop ----
  const t0 = perfNow();
  function frame(): void {
    requestAnimationFrame(frame);
    const t = (perfNow() - t0) / 1000;
    controls.autoRotate = perfNow() - lastInteraction > 6000; // gently auto-rotate after 6s idle (was 60s)
    controls.update();
    if (flyTarget) {
      controls.target.lerp(flyTarget, 0.1);
      const dir = camera.position.clone().sub(controls.target).normalize();
      const want = flyTarget.clone().add(dir.multiplyScalar(flyDist));
      camera.position.lerp(want, 0.08);
      if (controls.target.distanceTo(flyTarget) < 1) flyTarget = null;
    }
    if (driftIdx.length) pulseDrift(0.6 + 0.4 * Math.sin(t * 2.6));
    composer.render();
  }

  // ---- boot ----
  try {
    if (localStorage.getItem('clad_graph_theme') === 'light') document.documentElement.classList.add('light');
  } catch {
    /* ignore */
  }
  fit();
  buildSidebar();
  rebuildAll();
  refreshPill();
  liveWire();
  lastInteraction = perfNow();
  window.addEventListener('resize', fit);
  frame();

  // debug seam (no GL needed by callers): expose state + the pure cores used
  try {
    (window as any).__CLAD_VIEWER_DEBUG = {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      maxDeg,
      get hoverId() {
        return hoverId;
      },
      get selId() {
        return selId;
      },
      positions: pos,
    };
  } catch {
    /* ignore */
  }
})();
