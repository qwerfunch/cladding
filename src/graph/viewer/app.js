/* Cladding · knowledge-graph viewer — client app (read as text, inlined into the export).
 * Zero dependencies. A hand-rolled canvas force-directed graph with Obsidian-grade feel:
 *
 *  • CONTINUOUS low-alpha simulation (d3-style): alpha decays to rest; an alphaTarget
 *    thermostat reheats on drag (the web stretches + recoils elastically = tension) and
 *    the sim PAUSES on hover (motion stops under the cursor). No global rotation; motion
 *    is frame-time normalized so it is calm/slow, not jittery.
 *  • Force sliders (중심 장력 / 반발력 / 링크 장력 / 링크 거리) retune the live sim, persisted.
 *  • Color separates all node classes: SSoT tiers A/B/C/D in distinct hues; code/test/doc
 *    in their own colors. Node size by degree; subtle additive bloom on hubs.
 *  • Health overlay (optional window.__CLADDING_HEALTH): problem nodes pulse (error=red,
 *    warn=amber) over their normal color — the live spec↔code conformance, healing as you fix.
 */
(function () {
  'use strict';
  var G = window.__CLADDING_GRAPH || {nodes: [], edges: [], legend: [], tierMeta: {}, codeColor: '#9ca3af'};
  var HEALTH = window.__CLADDING_HEALTH || null; // {nodeId: {severity:'error'|'warn', count, detectors:[]}}
  var STATUS_ALPHA = {done: 0.95, in_progress: 1, planned: 0.62, blocked: 0.5, archived: 0.36};

  // ---- color: tier hue if tiered, else a distinct per-kind color ----
  var TIER_COL = {A: '#3b82f6', B: '#a855f7', C: '#14b8a6', D: '#f59e0b'};
  var KIND_COL = {feature: '#3b82f6', scenario: '#22d3ee', capability: '#a855f7', module: '#f97316', test: '#22c55e', doc: '#ec4899'};
  function nodeColor(n) { return (n.tier && TIER_COL[n.tier]) || KIND_COL[n.kind] || '#9ca3af'; }

  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var FP = hashStr(G.nodes.map(function (n) { return n.id; }).join('|') + '#' + G.edges.length);
  var POS_KEY = 'clad_graph_pos2_' + FP; // v2: layout model changed (continuous, no radial-by-degree)
  var FORCE_KEY = 'clad_graph_forces_' + FP;

  var byId = {};
  var nodes = G.nodes.map(function (n) {
    var a = (hashStr(n.id) % 1000) / 1000 * Math.PI * 2, r = 30 + (hashStr(n.id + 'r') % 520);
    var nd = {id: n.id, kind: n.kind, label: n.label, tier: n.tier, status: n.status, detail: n.detail,
      x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, fx: null, fy: null, deg: 0, norm: 0, seed: (hashStr(n.id) % 628) / 100};
    byId[n.id] = nd; return nd;
  });
  var edges = G.edges.map(function (e) { return {s: byId[e.from], t: byId[e.to], kind: e.kind}; }).filter(function (e) { return e.s && e.t; });
  var adj = {};
  nodes.forEach(function (n) { adj[n.id] = {}; });
  edges.forEach(function (e) { e.s.deg++; e.t.deg++; adj[e.s.id][e.t.id] = 1; adj[e.t.id][e.s.id] = 1; });
  var maxDeg = nodes.reduce(function (m, n) { return Math.max(m, n.deg); }, 1);
  nodes.forEach(function (n) { n.norm = n.deg / maxDeg; n.r = Math.min(15, 3 + Math.sqrt(n.deg) * 1.7); });
  function radius(n) { return n.r; }
  function alphaOf(n) { return n.status && STATUS_ALPHA[n.status] != null ? STATUS_ALPHA[n.status] : 0.95; }

  // ---- simulation state (continuous, low-alpha) ----
  var DEFAULT_FORCE = {center: 0.0008, repel: -480, linkForce: 0.06, linkDist: 40};
  var force = {center: DEFAULT_FORCE.center, repel: DEFAULT_FORCE.repel, linkForce: DEFAULT_FORCE.linkForce, linkDist: DEFAULT_FORCE.linkDist};
  var alpha = 1, alphaTarget = 0, ALPHA_DECAY = 0.0228, ALPHA_MIN = 0.0015;
  var view = {k: 1, tx: 0, ty: 0}, target = {k: 1, tx: 0, ty: 0};
  var fitPending = false, lastFrame = Date.now(), t0 = Date.now();
  var showLabels = nodes.length < 140, healthOn = true;
  var hoverId = null, selId = null, dragId = null, dragMoved = false;
  var enabledKind = {}, enabledTier = {};
  ['feature', 'module', 'test', 'scenario', 'capability', 'doc'].forEach(function (k) { enabledKind[k] = true; });
  ['A', 'B', 'C', 'D', 'code'].forEach(function (t) { enabledTier[t] = true; });
  var searchTerm = '';
  function tierKey(n) { return n.tier || 'code'; }
  function visible(n) { return enabledKind[n.kind] && enabledTier[tierKey(n)]; }
  function matches(n) { if (!searchTerm) return false; var q = searchTerm.toLowerCase(); return n.label.toLowerCase().indexOf(q) >= 0 || n.id.toLowerCase().indexOf(q) >= 0 || (n.detail && n.detail.toLowerCase().indexOf(q) >= 0); }

  var canvas = document.getElementById('g'), ctx = canvas.getContext('2d'), DPR = 1, W = 0, H = 0;
  function resize() { DPR = window.devicePixelRatio || 1; W = canvas.clientWidth || 800; H = canvas.clientHeight || 600; canvas.width = W * DPR; canvas.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  if (window.addEventListener) window.addEventListener('resize', function () { resize(); kick(); });

  // ---- one simulation step; velocity scaled by `a` (alpha) so motion eases to rest ----
  function tick(a) {
    var i, j, A, B, dx, dy, d2, d, f, inv, fx, fy;
    var K = force.repel, FMAX = 800, LINK = force.linkDist, LK = force.linkForce, CEN = force.center, DAMP = 0.6;
    for (i = 0; i < nodes.length; i++) {
      A = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        B = nodes[j]; dx = A.x - B.x; dy = A.y - B.y; d2 = dx * dx + dy * dy || 0.01; inv = 1 / Math.sqrt(d2);
        f = K / d2; if (f < -FMAX) f = -FMAX; if (f > FMAX) f = FMAX;
        fx = dx * inv * f; fy = dy * inv * f; A.vx -= fx; A.vy -= fy; B.vx += fx; B.vy += fy; // K<0 = repel
        // collision: hard-separate overlapping nodes so the layout breathes (no confetti clump)
        var dd = 1 / inv, minD = A.r + B.r + 7;
        if (dd < minD) { var sep = (minD - dd) * 0.5 * inv; A.vx += dx * sep; A.vy += dy * sep; B.vx -= dx * sep; B.vy -= dy * sep; }
      }
    }
    for (i = 0; i < edges.length; i++) {
      A = edges[i].s; B = edges[i].t; dx = B.x - A.x; dy = B.y - A.y; d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      f = (d - LINK) * LK; var ux = dx / d * f, uy = dy / d * f; A.vx += ux; A.vy += uy; B.vx -= ux; B.vy -= uy;
    }
    for (i = 0; i < nodes.length; i++) {
      A = nodes[i];
      A.vx -= A.x * CEN; A.vy -= A.y * CEN;            // soft center pull (no degree bias)
      A.vx *= DAMP; A.vy *= DAMP;
      if (A.fx != null) { A.x = A.fx; A.y = A.fy; }
      else { A.x += A.vx * a; A.y += A.vy * a; }        // alpha-scaled motion → calm settle
      if (!isFinite(A.x) || !isFinite(A.y)) { A.x = Math.cos(A.seed) * 200; A.y = Math.sin(A.seed) * 200; A.vx = A.vy = 0; }
    }
  }
  function fit() {
    if (!nodes.length) return;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    nodes.forEach(function (n) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); });
    var w = maxX - minX || 1, h = maxY - minY || 1, LEFT = W > 760 ? 280 : 0;
    target.k = Math.min(2.2, 0.82 * Math.min((W - LEFT) / w, H / h));
    target.tx = LEFT + (W - LEFT) / 2 - (minX + maxX) / 2 * target.k; target.ty = H / 2 - (minY + maxY) / 2 * target.k;
  }
  function reheat(to) { alphaTarget = to; kick(); }

  // ---- conformance pill (from health overlay) ----
  function refreshPill() {
    var el = document.getElementById('impact'); if (!el) return;
    if (!HEALTH) { el.style.display = 'none'; return; }
    var bad = 0; for (var k in HEALTH) if (HEALTH.hasOwnProperty(k)) bad++;
    var total = nodes.length || 1, pct = Math.max(0, Math.round((1 - bad / total) * 100));
    el.style.display = 'block';
    el.innerHTML = '<span class="dot" style="background:' + (bad ? '#f59e0b' : '#22c55e') + '"></span> spec↔code ' + pct + '% in sync · ' + bad + ' drift';
  }

  // ---- render ----
  function frame() {
    var now = Date.now(), dt = Math.min(3, (now - lastFrame) / 16.67); lastFrame = now;
    var paused = !!hoverId && !dragId;                 // hover freezes the sim
    alphaTarget = dragId ? 0.3 : 0;
    alpha += (alphaTarget - alpha) * ALPHA_DECAY * (dt || 1);
    if (!paused && alpha > ALPHA_MIN) { var steps = Math.min(2, Math.ceil(dt)); for (var s = 0; s < steps; s++) tick(alpha); }
    if (fitPending && alpha < 0.08) { fitPending = false; fit(); savePos(); }
    view.k += (target.k - view.k) * 0.14; view.tx += (target.tx - view.tx) * 0.14; view.ty += (target.ty - view.ty) * 0.14;

    var T = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.translate(view.tx, view.ty); ctx.scale(view.k, view.k);
    var focus = selId ? byId[selId] : (hoverId ? byId[hoverId] : null);
    function lit(n) { return !focus || n.id === focus.id || adj[focus.id][n.id]; }

    // edges — colored by source, subtle; the web structure reads without clutter
    ctx.lineWidth = 0.7 / view.k;
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i]; if (!visible(e.s) || !visible(e.t)) continue;
      var eon = !focus || lit(e.s) || lit(e.t);
      ctx.globalAlpha = eon ? (focus ? 0.8 : 0.16) : 0.04;
      ctx.strokeStyle = nodeColor(e.s);
      ctx.beginPath(); ctx.moveTo(e.s.x, e.s.y); ctx.lineTo(e.t.x, e.t.y); ctx.stroke();
    }
    // health halo — a crisp pulsing ring (not a blob), drawn under the node
    if (HEALTH && healthOn) {
      ctx.globalCompositeOperation = 'source-over';
      for (var hh = 0; hh < nodes.length; hh++) {
        var hn = nodes[hh]; if (!visible(hn)) continue; var hv = HEALTH[hn.id]; if (!hv) continue;
        ctx.globalAlpha = 0.5 + 0.45 * Math.sin(T * 2.5 + hn.seed); ctx.strokeStyle = hv.severity === 'error' ? '#ef4444' : '#f59e0b';
        ctx.lineWidth = 2.4 / view.k; ctx.beginPath(); ctx.arc(hn.x, hn.y, hn.r + 4.5, 0, 7); ctx.stroke();
      }
    }
    // nodes — solid fill + thin bg-colored ring so touching nodes stay crisp
    var nodeStroke = getCSS('--node-stroke');
    for (var n2 = 0; n2 < nodes.length; n2++) {
      var n = nodes[n2]; if (!visible(n)) continue;
      var r = radius(n), isHit = matches(n), isSel = selId === n.id, dim = focus && !lit(n);
      ctx.globalAlpha = dim ? 0.12 : alphaOf(n); ctx.fillStyle = nodeColor(n);
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill();
      if (!dim) { ctx.globalAlpha = 0.85; ctx.lineWidth = 1.2 / view.k; ctx.strokeStyle = nodeStroke; ctx.stroke(); }
      if (isSel || n.fx != null || isHit) { ctx.lineWidth = (isSel ? 2.5 : 2) / view.k; ctx.globalAlpha = 1; ctx.strokeStyle = isHit ? getCSS('--accent') : isSel ? '#fff' : '#ffd55e'; ctx.stroke(); }
      if ((showLabels || isHit || isSel || (focus && lit(n))) && (view.k > 0.5 || isHit || isSel)) {
        ctx.globalAlpha = dim ? 0.2 : 1; ctx.fillStyle = getCSS('--fg'); ctx.font = (11 / view.k) + 'px -apple-system, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(n.label.length > 36 ? n.label.slice(0, 35) + '…' : n.label, n.x, n.y - r - 4 / view.k);
      }
    }
    ctx.restore();
    var moving = (!paused && alpha > ALPHA_MIN) || fitPending || Math.abs(target.k - view.k) > 0.001 || Math.abs(target.tx - view.tx) > 0.4 || Math.abs(target.ty - view.ty) > 0.4;
    if (moving) requestAnimationFrame(frame); else scheduled = false;
  }
  var scheduled = false;
  function kick() { if (!scheduled) { scheduled = true; requestAnimationFrame(frame); } }
  var cssCache = {};
  function getCSS(v) { if (cssCache[v] === undefined) cssCache[v] = (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim() || '#888'; return cssCache[v]; }

  function savePos() { try { var o = {}; nodes.forEach(function (n) { o[n.id] = [Math.round(n.x), Math.round(n.y)]; }); localStorage.setItem(POS_KEY, JSON.stringify(o)); } catch (e) {} }
  function loadPos() { try { var o = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (!o || !nodes.every(function (n) { return o[n.id]; })) return false; nodes.forEach(function (n) { n.x = o[n.id][0]; n.y = o[n.id][1]; }); return true; } catch (e) { return false; } }

  // ---- pointer ----
  function toWorld(ev) { var rc = canvas.getBoundingClientRect(); return {x: (ev.clientX - rc.left - view.tx) / view.k, y: (ev.clientY - rc.top - view.ty) / view.k}; }
  function pick(w) { var best = null, bd = 1e9; for (var i = 0; i < nodes.length; i++) { var n = nodes[i]; if (!visible(n)) continue; var dx = n.x - w.x, dy = n.y - w.y, d = dx * dx + dy * dy, r = radius(n) + 5; if (d < r * r && d < bd) { bd = d; best = n; } } return best; }
  function centerOn(n) { var LEFT = W > 760 ? 280 : 0; target.k = Math.max(view.k, 1.3); target.tx = LEFT + (W - LEFT) / 2 - n.x * target.k; target.ty = H / 2 - n.y * target.k; kick(); }
  var panning = false, last = null;
  canvas.addEventListener('mousedown', function (ev) { var n = pick(toWorld(ev)); dragMoved = false; if (n) { dragId = n.id; reheat(0.3); } else { panning = true; canvas.classList.add('grabbing'); } last = {x: ev.clientX, y: ev.clientY}; });
  window.addEventListener('mousemove', function (ev) {
    if (dragId) { var w = toWorld(ev), n = byId[dragId]; n.fx = n.x = w.x; n.fy = n.y = w.y; dragMoved = true; kick(); return; }
    if (panning) { target.tx = view.tx += ev.clientX - last.x; target.ty = view.ty += ev.clientY - last.y; last = {x: ev.clientX, y: ev.clientY}; kick(); return; }
    var h = pick(toWorld(ev)), id = h ? h.id : null; if (id !== hoverId) { hoverId = id; tip(h, ev); kick(); } else if (h) tipMove(ev);
  });
  window.addEventListener('mouseup', function () {
    if (dragId && !dragMoved) { selId = selId === dragId ? null : dragId; if (selId) centerOn(byId[selId]); tip(null); }
    else if (panning && !dragMoved) { selId = null; }
    if (dragId) { var n = byId[dragId]; n.fx = n.fy = null; } // release pin so it settles into the web
    dragId = null; panning = false; alphaTarget = 0; canvas.classList.remove('grabbing'); kick();
  });
  canvas.addEventListener('wheel', function (ev) { ev.preventDefault(); var rc = canvas.getBoundingClientRect(), mx = ev.clientX - rc.left, my = ev.clientY - rc.top; var f = Math.exp(-ev.deltaY * 0.0014), nk = Math.max(0.06, Math.min(7, view.k * f)); view.tx = mx - (mx - view.tx) * (nk / view.k); view.ty = my - (my - view.ty) * (nk / view.k); view.k = nk; target.k = view.k; target.tx = view.tx; target.ty = view.ty; kick(); }, {passive: false});

  // ---- tooltip ----
  var tipEl = document.getElementById('tip');
  function tip(n, ev) {
    if (!tipEl) return; if (!n) { tipEl.style.display = 'none'; return; }
    var c = nodeColor(n), tl = n.tier ? ('Tier ' + n.tier) : 'code', hv = HEALTH && HEALTH[n.id];
    tipEl.innerHTML = '<div class="t">' + esc(n.label) + '</div><div class="m"><span class="k" style="background:' + c + '">' + n.kind + ' · ' + tl + '</span>' + (n.status ? ' · ' + n.status : '') + '</div>' + (hv ? '<div class="m" style="color:' + (hv.severity === 'error' ? '#ef4444' : '#f59e0b') + '">⚠ ' + esc((hv.detectors || []).join(', ') || hv.severity) + '</div>' : '') + (n.detail && n.detail !== n.label ? '<div class="m">' + esc(n.detail) + '</div>' : '') + '<div class="m">' + esc(n.id) + '</div>';
    tipEl.style.display = 'block'; if (ev) tipMove(ev);
  }
  function tipMove(ev) { if (tipEl) { tipEl.style.left = (ev.clientX + 14) + 'px'; tipEl.style.top = (ev.clientY + 14) + 'px'; } }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]; }); }

  // ---- sidebar: filters, force sliders, toggles ----
  function kindCounts() { var c = {}; nodes.forEach(function (n) { c[n.kind] = (c[n.kind] || 0) + 1; }); return c; }
  function buildSidebar() {
    var kc = kindCounts(), kh = document.getElementById('kinds');
    if (kh) { kh.innerHTML = ''; Object.keys(enabledKind).forEach(function (k) { if (kc[k]) kh.appendChild(filterRow(k, k, KIND_COL[k] || '#9ca3af', kc[k], enabledKind)); }); }
    var th = document.getElementById('tiers'); if (th) { th.innerHTML = ''; (G.legend || []).forEach(function (L) { th.appendChild(filterRow(L.key, L.label, (TIER_COL[L.key] || L.color), L.count, enabledTier)); }); }
  }
  function filterRow(key, name, sw, count, store) {
    var row = document.createElement('label'); row.className = 'row' + (store[key] ? '' : ' off');
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!store[key];
    cb.onchange = function () { store[key] = cb.checked; row.className = 'row' + (cb.checked ? '' : ' off'); kick(); };
    var s = document.createElement('span'); s.className = 'sw'; s.style.background = sw;
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name;
    var ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = count;
    row.appendChild(cb); row.appendChild(s); row.appendChild(nm); row.appendChild(ct); return row;
  }
  var SLIDERS = [
    {key: 'center', label: '중심 장력', min: 0, max: 0.008, step: 0.0002},
    {key: 'repel', label: '반발력', min: -800, max: -40, step: 20},
    {key: 'linkForce', label: '링크 장력', min: 0, max: 0.3, step: 0.01},
    {key: 'linkDist', label: '링크 거리', min: 10, max: 200, step: 5},
  ];
  function buildForces() {
    var host = document.getElementById('forces'); if (!host) return; host.innerHTML = '';
    SLIDERS.forEach(function (sp) {
      var wrap = document.createElement('div'); wrap.className = 'slider';
      var lab = document.createElement('label'); lab.textContent = sp.label; lab.htmlFor = 'f-' + sp.key;
      var inp = document.createElement('input'); inp.type = 'range'; inp.id = 'f-' + sp.key; inp.min = sp.min; inp.max = sp.max; inp.step = sp.step; inp.value = force[sp.key];
      inp.addEventListener('input', function () { force[sp.key] = parseFloat(inp.value); saveForces(); reheat(Math.max(alpha, 0.25)); });
      wrap.appendChild(lab); wrap.appendChild(inp); host.appendChild(wrap);
    });
  }
  function saveForces() { try { localStorage.setItem(FORCE_KEY, JSON.stringify(force)); } catch (e) {} }
  function loadForces() { try { var s = JSON.parse(localStorage.getItem(FORCE_KEY) || 'null'); if (s) ['center', 'repel', 'linkForce', 'linkDist'].forEach(function (k) { if (typeof s[k] === 'number') force[k] = s[k]; }); } catch (e) {} }
  function btn(id, on, fn) { var b = document.getElementById(id); if (!b) return; if (on) b.classList.add('on'); b.onclick = function () { fn(b); }; }
  var sb = document.getElementById('search'); if (sb) sb.addEventListener('input', function (e) { searchTerm = e.target.value.trim(); if (searchTerm) { var m = nodes.filter(matches); if (m.length) { selId = m[0].id; centerOn(m[0]); } } kick(); });
  btn('labels', showLabels, function (b) { showLabels = !showLabels; b.classList.toggle('on', showLabels); kick(); });
  btn('health', healthOn, function (b) { healthOn = !healthOn; b.classList.toggle('on', healthOn); kick(); });
  btn('theme', document.documentElement.classList.contains('light'), function (b) { var lt = document.documentElement.classList.toggle('light'); b.classList.toggle('on', lt); cssCache = {}; try { localStorage.setItem('clad_graph_theme', lt ? 'light' : 'dark'); } catch (e) {} kick(); });
  var rb = document.getElementById('reset'); if (rb) rb.onclick = function () { selId = null; nodes.forEach(function (n) { n.fx = n.fy = null; }); try { localStorage.removeItem(POS_KEY); } catch (e) {} fitPending = true; alpha = 1; reheat(0); };

  // ---- live mode (clad graph serve): re-fetch on SSE refresh ----
  // Health-only changes heal SMOOTHLY (re-fetch health.json, recolor in place); a structural
  // change (node added/removed) reloads. Detected by /graph.json node count vs current.
  function applyHealth(h) { HEALTH = h && Object.keys(h).length ? h : null; refreshPill(); kick(); }
  function pullHealth() { fetch('health.json', {cache: 'no-store'}).then(function (r) { return r.ok ? r.json() : null; }).then(function (h) { applyHealth(h); }).catch(function () {}); }
  function liveWire() {
    if (typeof fetch !== 'function' || typeof EventSource !== 'function') return;
    fetch('graph.json', {cache: 'no-store'}).then(function (r) {
      if (!r.ok) return; // static export / file:// → embedded data only
      pullHealth();
      var es = new EventSource('events');
      es.onmessage = function () {
        fetch('graph.json', {cache: 'no-store'}).then(function (r2) { return r2.ok ? r2.json() : null; }).then(function (g2) {
          if (g2 && g2.nodes && g2.nodes.length !== nodes.length) { location.reload(); return; } // structural change
          pullHealth(); // health-only → smooth heal
        }).catch(function () {});
      };
    }).catch(function () {});
  }

  // ---- boot ----
  try { if (localStorage.getItem('clad_graph_theme') === 'light') document.documentElement.classList.add('light'); } catch (e) {}
  loadForces(); resize(); buildSidebar(); buildForces(); refreshPill();
  if (loadPos()) { alpha = 0.12; fit(); view.k = target.k; view.tx = target.tx; view.ty = target.ty; }
  else { fitPending = true; alpha = 1; for (var w = 0; w < 40; w++) tick(0.5); fit(); view.k = target.k; view.tx = target.tx; view.ty = target.ty; }
  liveWire(); kick();
  try { window.__CLADDING_DEBUG = {nodes: nodes, view: view, force: force, nodeColor: nodeColor, get alpha() { return alpha; }, get alphaTarget() { return alphaTarget; }, get hoverId() { return hoverId; }, setHover: function (id) { hoverId = id; }, setDrag: function (id) { dragId = id; alphaTarget = id ? 0.3 : 0; }, tick: tick, frame: frame}; } catch (e) {}
})();
