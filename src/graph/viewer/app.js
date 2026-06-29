/* Cladding · knowledge-graph viewer — client app (read as text, inlined into the export).
 * Zero dependencies. A compact canvas force-directed renderer over window.__CLADDING_GRAPH.
 *
 * Layout: a degree-weighted RADIAL galaxy — high-degree hubs are pulled toward the centre,
 * low-degree leaves toward the rim, charge spreads them angularly, springs cluster the
 * connected. The settled graph reads as one circular galaxy with a bright, load-bearing core.
 * Physics runs in bursts (a visible "settle" on open / reset). At rest the viewer stays ALIVE:
 * a slow global rotation + node breathing + edge particles + hub glow pulse (all O(n)/O(edges)
 * DRAW only — rotation is a free transform). The "Calm" toggle freezes everything for reading. */
(function () {
  'use strict';
  var G = window.__CLADDING_GRAPH || {nodes: [], edges: [], legend: [], tierMeta: {}, codeColor: '#9ca3af'};
  var TIER = G.tierMeta || {};
  var CODE = G.codeColor || '#9ca3af';
  var STATUS_ALPHA = {done: 0.92, in_progress: 1, planned: 0.6, blocked: 0.5, archived: 0.35};

  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var FP = hashStr(G.nodes.map(function (n) { return n.id; }).join('|') + '#' + G.edges.length);
  var POS_KEY = 'clad_graph_pos_' + FP;

  var byId = {};
  var nodes = G.nodes.map(function (n) {
    var a = (hashStr(n.id) % 1000) / 1000 * Math.PI * 2, r = 40 + (hashStr(n.id + 'r') % 520);
    var nd = {id: n.id, kind: n.kind, label: n.label, tier: n.tier, status: n.status, detail: n.detail,
      x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, fx: null, fy: null, deg: 0, norm: 0,
      seed: (hashStr(n.id) % 628) / 100};
    byId[n.id] = nd; return nd;
  });
  var edges = G.edges.map(function (e) { return {s: byId[e.from], t: byId[e.to], kind: e.kind}; })
    .filter(function (e) { return e.s && e.t; });
  var adj = {};
  nodes.forEach(function (n) { adj[n.id] = {}; });
  edges.forEach(function (e) { e.s.deg++; e.t.deg++; adj[e.s.id][e.t.id] = 1; adj[e.t.id][e.s.id] = 1; });
  var maxDeg = nodes.reduce(function (m, n) { return Math.max(m, n.deg); }, 1);
  nodes.forEach(function (n) { n.norm = n.deg / maxDeg; }); // 0..1 (hub = 1)
  var BASE = Math.max(240, Math.sqrt(nodes.length) * 42); // galaxy radius scale

  function color(n) { return n.tier ? (TIER[n.tier] ? TIER[n.tier].color : CODE) : CODE; }
  function radius(n) { return Math.min(30, 4 + Math.sqrt(n.deg) * 2.6); }
  function alpha(n) { return n.status && STATUS_ALPHA[n.status] != null ? STATUS_ALPHA[n.status] : 0.92; }

  // view (with a smooth target it lerps toward) + global rotation
  var view = {k: 1, tx: 0, ty: 0};
  var target = {k: 1, tx: 0, ty: 0};
  var rot = 0, heat = 0, fitPending = false;
  var ambient = true;            // idle animates by default; Calm freezes
  var showLabels = nodes.length < 150;
  var hoverId = null, selId = null, dragId = null, dragMoved = false, lastInteract = 0;
  var enabledKind = {}, enabledTier = {};
  ['feature', 'module', 'test', 'scenario', 'capability', 'doc'].forEach(function (k) { enabledKind[k] = true; });
  ['A', 'B', 'C', 'D', 'code'].forEach(function (t) { enabledTier[t] = true; });
  var searchTerm = '';
  function tierKey(n) { return n.tier || 'code'; }
  function visible(n) { return enabledKind[n.kind] && enabledTier[tierKey(n)]; }
  function matches(n) {
    if (!searchTerm) return false;
    var q = searchTerm.toLowerCase();
    return n.label.toLowerCase().indexOf(q) >= 0 || n.id.toLowerCase().indexOf(q) >= 0 ||
      (n.detail && n.detail.toLowerCase().indexOf(q) >= 0);
  }

  var canvas = document.getElementById('g'), ctx = canvas.getContext('2d'), DPR = 1, W = 0, H = 0;
  function resize() {
    DPR = window.devicePixelRatio || 1; W = canvas.clientWidth || 800; H = canvas.clientHeight || 600;
    canvas.width = W * DPR; canvas.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  if (window.addEventListener) window.addEventListener('resize', function () { resize(); kick(); });

  // ---- galaxy physics (burst) ----
  function tick() {
    var i, j, a, b, dx, dy, d2, d, f, inv;
    var K = 6000, FMAX = 700, SPRING = 0.014, LINK = 72, RADIAL = 0.055, GRAV = 0.002, DAMP = 0.85;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j]; dx = a.x - b.x; dy = a.y - b.y; d2 = dx * dx + dy * dy || 0.01;
        f = K / d2; if (f > FMAX) f = FMAX; inv = 1 / Math.sqrt(d2);
        var fx = dx * inv * f, fy = dy * inv * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    for (i = 0; i < edges.length; i++) {
      a = edges[i].s; b = edges[i].t; dx = b.x - a.x; dy = b.y - a.y; d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      f = (d - LINK) * SPRING; var ux = dx / d * f, uy = dy / d * f;
      a.vx += ux; a.vy += uy; b.vx -= ux; b.vy -= uy;
    }
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      var r = Math.sqrt(a.x * a.x + a.y * a.y) || 0.01;
      var targetR = BASE * (1 - 0.82 * a.norm);          // hub → centre, leaf → rim
      var pull = (r - targetR) * RADIAL;
      a.vx -= (a.x / r) * pull + a.x * GRAV;
      a.vy -= (a.y / r) * pull + a.y * GRAV;
      a.vx *= DAMP; a.vy *= DAMP;
      if (a.fx != null) { a.x = a.fx; a.y = a.fy; } else { a.x += a.vx; a.y += a.vy; }
      if (!isFinite(a.x) || !isFinite(a.y)) { a.x = Math.cos(a.seed) * targetR; a.y = Math.sin(a.seed) * targetR; a.vx = a.vy = 0; }
    }
  }
  function fit() {
    if (!nodes.length) return;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(function (n) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); });
    var w = maxX - minX || 1, h = maxY - minY || 1;
    var LEFT = W > 760 ? 280 : 0;
    target.k = Math.min(2.2, 0.82 * Math.min((W - LEFT) / w, H / h));
    target.tx = LEFT + (W - LEFT) / 2 - (minX + maxX) / 2 * target.k;
    target.ty = H / 2 - (minY + maxY) / 2 * target.k;
  }
  function settle(n) { heat = n; }

  // ---- render ----
  var t0 = Date.now();
  function frame() {
    if (heat > 0) { var st = Math.min(6, heat); for (var s = 0; s < st; s++) tick(); heat -= st; if (heat <= 0) { savePos(); if (fitPending) { fitPending = false; fit(); } } }
    // smooth view toward target
    view.k += (target.k - view.k) * 0.12; view.tx += (target.tx - view.tx) * 0.12; view.ty += (target.ty - view.ty) * 0.12;
    var now = Date.now(), T = (now - t0) / 1000, idle = now - lastInteract > 1200;
    var anim = ambient && idle && heat <= 0;
    if (anim) rot += 0.0010;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(view.tx, view.ty); ctx.scale(view.k, view.k); ctx.rotate(rot);
    function bx(n) { return n.x + (anim ? Math.sin(T * 0.6 + n.seed) * 2.2 : 0); }
    function by(n) { return n.y + (anim ? Math.cos(T * 0.55 + n.seed) * 2.2 : 0); }
    var focus = selId ? byId[selId] : (hoverId ? byId[hoverId] : null);
    function lit(n) { return !focus || n.id === focus.id || adj[focus.id][n.id]; }

    // edges
    ctx.lineWidth = 1 / view.k; ctx.strokeStyle = getCSS('--edge');
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i]; if (!visible(e.s) || !visible(e.t)) continue;
      var on = !focus || lit(e.s) || lit(e.t);
      ctx.globalAlpha = on ? (focus ? 0.85 : 1) : 0.12;
      ctx.beginPath(); ctx.moveTo(bx(e.s), by(e.s)); ctx.lineTo(bx(e.t), by(e.t)); ctx.stroke();
      if (anim && on && view.k > 0.45) {
        var fp = (T * 0.32 + (i % 9) / 9) % 1;
        ctx.globalAlpha = 0.6; ctx.fillStyle = color(e.t);
        ctx.beginPath(); ctx.arc(bx(e.s) + (bx(e.t) - bx(e.s)) * fp, by(e.s) + (by(e.t) - by(e.s)) * fp, 1.7 / view.k, 0, 7); ctx.fill();
      }
    }
    // bloom pass (additive) — overlapping hubs build a bright core
    ctx.globalCompositeOperation = 'lighter';
    for (var b1 = 0; b1 < nodes.length; b1++) {
      var nb = nodes[b1]; if (!visible(nb) || (focus && !lit(nb))) continue;
      var pulse = anim ? 0.6 + 0.4 * Math.sin(T * 1.6 + nb.seed) : 1;
      ctx.globalAlpha = (0.05 + 0.16 * nb.norm) * pulse; ctx.fillStyle = color(nb);
      ctx.beginPath(); ctx.arc(bx(nb), by(nb), radius(nb) * (2.2 + 1.4 * nb.norm), 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // solid nodes
    for (var n2 = 0; n2 < nodes.length; n2++) {
      var n = nodes[n2]; if (!visible(n)) continue;
      var x = bx(n), y = by(n), r = radius(n), isHit = matches(n), isSel = selId === n.id, dim = focus && !lit(n);
      ctx.globalAlpha = dim ? 0.14 : alpha(n); ctx.fillStyle = color(n);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if (isSel || n.fx != null || isHit) {
        ctx.lineWidth = (isSel ? 2.5 : 2) / view.k; ctx.globalAlpha = 1;
        ctx.strokeStyle = isHit ? getCSS('--accent') : isSel ? '#ffffff' : '#ffd55e'; ctx.stroke();
      }
      if ((showLabels || isHit || isSel || (focus && lit(n))) && (view.k > 0.5 || isHit || isSel)) {
        ctx.save(); ctx.translate(x, y - r - 4 / view.k); ctx.rotate(-rot); // keep labels upright
        ctx.globalAlpha = dim ? 0.2 : 1; ctx.fillStyle = getCSS('--fg');
        ctx.font = (11 / view.k) + 'px -apple-system, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(n.label.length > 36 ? n.label.slice(0, 35) + '…' : n.label, 0, 0); ctx.restore();
      }
    }
    ctx.restore();
    var moving = anim || heat > 0 || Math.abs(target.k - view.k) > 0.001 || Math.abs(target.tx - view.tx) > 0.4 || Math.abs(target.ty - view.ty) > 0.4;
    if (moving) requestAnimationFrame(frame); else scheduled = false;
  }
  var scheduled = false;
  function kick() { if (!scheduled) { scheduled = true; requestAnimationFrame(frame); } }

  var cssCache = {};
  function getCSS(v) { if (cssCache[v] === undefined) cssCache[v] = (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim() || '#888'; return cssCache[v]; }
  function touch() { lastInteract = Date.now(); kick(); }

  function savePos() { try { var o = {}; nodes.forEach(function (n) { o[n.id] = [Math.round(n.x), Math.round(n.y)]; }); localStorage.setItem(POS_KEY, JSON.stringify(o)); } catch (e) {} }
  function loadPos() {
    try { var o = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (!o) return false;
      if (!nodes.every(function (n) { return o[n.id]; })) return false;
      nodes.forEach(function (n) { n.x = o[n.id][0]; n.y = o[n.id][1]; }); return true;
    } catch (e) { return false; }
  }

  // ---- pointer (rotation-aware world coords) ----
  function toWorld(ev) {
    var rc = canvas.getBoundingClientRect();
    var sx = (ev.clientX - rc.left - view.tx) / view.k, sy = (ev.clientY - rc.top - view.ty) / view.k;
    var c = Math.cos(-rot), s = Math.sin(-rot);
    return {x: sx * c - sy * s, y: sx * s + sy * c};
  }
  function pick(w) { var best = null, bd = Infinity; for (var i = 0; i < nodes.length; i++) { var n = nodes[i]; if (!visible(n)) continue; var dx = n.x - w.x, dy = n.y - w.y, d = dx * dx + dy * dy, r = radius(n) + 5; if (d < r * r && d < bd) { bd = d; best = n; } } return best; }
  function centerOn(n) { var LEFT = W > 760 ? 280 : 0; target.k = Math.max(view.k, 1.3); target.tx = LEFT + (W - LEFT) / 2; target.ty = H / 2; /* rotate so node lands at centre */ var c = Math.cos(rot), s = Math.sin(rot); target.tx -= (n.x * c - n.y * s) * target.k; target.ty -= (n.x * s + n.y * c) * target.k; }
  var panning = false, last = null;
  canvas.addEventListener('mousedown', function (ev) { var n = pick(toWorld(ev)); dragMoved = false; if (n) { dragId = n.id; } else { panning = true; canvas.classList.add('grabbing'); } last = {x: ev.clientX, y: ev.clientY}; touch(); });
  window.addEventListener('mousemove', function (ev) {
    if (dragId) { var w = toWorld(ev), n = byId[dragId]; n.fx = n.x = w.x; n.fy = n.y = w.y; dragMoved = true; touch(); return; }
    if (panning) { target.tx = view.tx += ev.clientX - last.x; target.ty = view.ty += ev.clientY - last.y; last = {x: ev.clientX, y: ev.clientY}; touch(); return; }
    var h = pick(toWorld(ev)), id = h ? h.id : null;
    if (id !== hoverId) { hoverId = id; tip(h, ev); kick(); } else if (h) tipMove(ev);
  });
  window.addEventListener('mouseup', function (ev) {
    if (dragId && !dragMoved) { selId = selId === dragId ? null : dragId; if (selId) centerOn(byId[selId]); tip(null); }
    else if (panning && !dragMoved) { selId = null; }
    dragId = null; panning = false; canvas.classList.remove('grabbing'); kick();
  });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault(); var rc = canvas.getBoundingClientRect(), mx = ev.clientX - rc.left, my = ev.clientY - rc.top;
    var f = Math.exp(-ev.deltaY * 0.0014), nk = Math.max(0.06, Math.min(7, view.k * f));
    view.tx = mx - (mx - view.tx) * (nk / view.k); view.ty = my - (my - view.ty) * (nk / view.k); view.k = nk;
    target.k = view.k; target.tx = view.tx; target.ty = view.ty; touch();
  }, {passive: false});

  // ---- tooltip ----
  var tipEl = document.getElementById('tip');
  function tip(n, ev) {
    if (!tipEl) return;
    if (!n) { tipEl.style.display = 'none'; return; }
    var c = color(n), tl = n.tier ? ('Tier ' + n.tier) : 'code';
    tipEl.innerHTML = '<div class="t">' + esc(n.label) + '</div><div class="m"><span class="k" style="background:' + c + '">' + n.kind + ' · ' + tl + '</span>' + (n.status ? ' · ' + n.status : '') + '</div>' + (n.detail && n.detail !== n.label ? '<div class="m">' + esc(n.detail) + '</div>' : '') + '<div class="m">' + esc(n.id) + '</div>';
    tipEl.style.display = 'block'; if (ev) tipMove(ev);
  }
  function tipMove(ev) { if (tipEl) { tipEl.style.left = (ev.clientX + 14) + 'px'; tipEl.style.top = (ev.clientY + 14) + 'px'; } }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]; }); }

  // ---- sidebar ----
  function kindCounts() { var c = {}; nodes.forEach(function (n) { c[n.kind] = (c[n.kind] || 0) + 1; }); return c; }
  function buildSidebar() {
    var kc = kindCounts(), kh = document.getElementById('kinds'); if (kh) { kh.innerHTML = ''; Object.keys(enabledKind).forEach(function (k) { if (kc[k]) kh.appendChild(filterRow(k, k, CODE, kc[k], enabledKind)); }); }
    var th = document.getElementById('tiers'); if (th) { th.innerHTML = ''; (G.legend || []).forEach(function (L) { th.appendChild(filterRow(L.key, L.label, L.color, L.count, enabledTier)); }); }
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
  var searchEl = document.getElementById('search');
  if (searchEl) searchEl.addEventListener('input', function (e) { searchTerm = e.target.value.trim(); if (searchTerm) { var m = nodes.filter(matches); if (m.length) { selId = m[0].id; centerOn(m[0]); } } touch(); });
  function btn(id, on, fn) { var b = document.getElementById(id); if (!b) return; if (on) b.classList.add('on'); b.onclick = function () { fn(b); }; }
  btn('mode', ambient, function (b) { ambient = !ambient; b.classList.toggle('on', ambient); b.textContent = ambient ? '✦ Live' : '◦ Calm'; lastInteract = 0; kick(); });
  var mb = document.getElementById('mode'); if (mb) mb.textContent = ambient ? '✦ Live' : '◦ Calm';
  btn('labels', showLabels, function (b) { showLabels = !showLabels; b.classList.toggle('on', showLabels); kick(); });
  btn('theme', document.documentElement.classList.contains('light'), function (b) { var lt = document.documentElement.classList.toggle('light'); b.classList.toggle('on', lt); cssCache = {}; try { localStorage.setItem('clad_graph_theme', lt ? 'light' : 'dark'); } catch (e) {} kick(); });
  var rb = document.getElementById('reset'); if (rb) rb.onclick = function () { selId = null; nodes.forEach(function (n) { n.fx = n.fy = null; }); rot = 0; try { localStorage.removeItem(POS_KEY); } catch (e) {} fitPending = true; settle(280); kick(); };
  var burger = document.getElementById('burger'); if (burger) burger.onclick = function () { var sd = document.getElementById('side'); if (sd) sd.classList.toggle('show'); };

  // ---- boot ----
  try { if (localStorage.getItem('clad_graph_theme') === 'light') document.documentElement.classList.add('light'); } catch (e) {}
  resize(); buildSidebar();
  if (loadPos()) { settle(0); fit(); view.k = target.k; view.tx = target.tx; view.ty = target.ty; }
  else { fitPending = true; settle(280); for (var w = 0; w < 70; w++) tick(); fit(); view.k = target.k; view.tx = target.tx; view.ty = target.ty; }
  kick();
  // test/debug seam (harmless in a browser; lets a headless harness inspect the layout)
  try { window.__CLADDING_DEBUG = {nodes: nodes, view: view, settle: settle, tick: tick, frame: frame}; } catch (e) {}
})();
