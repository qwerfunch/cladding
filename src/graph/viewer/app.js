/* Cladding · knowledge-graph viewer — client app (read as text, inlined into the export).
 * Zero dependencies. A compact canvas force-directed renderer over window.__CLADDING_GRAPH.
 * Physics runs in bursts (visible "settle" on first open, re-layout on reset); "Live" mode adds
 * cheap O(n) breathing + O(edges) directional particles so it feels alive without an O(n^2) loop. */
(function () {
  'use strict';
  var G = window.__CLADDING_GRAPH || { nodes: [], edges: [], legend: [], tierMeta: {}, codeColor: '#9ca3af' };
  var TIER = G.tierMeta || {};
  var CODE = G.codeColor || '#9ca3af';
  var STATUS_ALPHA = { done: 0.85, in_progress: 1, planned: 0.55, blocked: 0.45, archived: 0.32 };

  // ---- structure fingerprint (for stable cached positions) ----
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var FP = hashStr(G.nodes.map(function (n) { return n.id; }).join('|') + '#' + G.edges.length);
  var POS_KEY = 'clad_graph_pos_' + FP;

  // ---- node + edge model ----
  var byId = {};
  var nodes = G.nodes.map(function (n, i) {
    var a = (hashStr(n.id) % 1000) / 1000 * Math.PI * 2; // deterministic seed angle
    var r = 60 + (hashStr(n.id + 'r') % 600);
    var nd = { id: n.id, kind: n.kind, label: n.label, tier: n.tier, status: n.status, detail: n.detail,
      x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, fx: null, fy: null, deg: 0, seed: (hashStr(n.id) % 628) / 100 };
    byId[n.id] = nd; return nd;
  });
  var edges = G.edges.map(function (e) { return { s: byId[e.from], t: byId[e.to], kind: e.kind }; })
    .filter(function (e) { return e.s && e.t; });
  var adj = {};
  nodes.forEach(function (n) { adj[n.id] = {}; });
  edges.forEach(function (e) { e.s.deg++; e.t.deg++; adj[e.s.id][e.t.id] = 1; adj[e.t.id][e.s.id] = 1; });
  function color(n) { return n.tier ? (TIER[n.tier] ? TIER[n.tier].color : CODE) : CODE; }
  function radius(n) { return Math.min(26, 4 + Math.sqrt(n.deg) * 2.4); }
  function alpha(n) { return n.status && STATUS_ALPHA[n.status] != null ? STATUS_ALPHA[n.status] : 0.9; }

  // ---- view state ----
  var view = { k: 1, tx: 0, ty: 0 };
  var heat = 0;                 // >0 = run physics ticks this frame (settle/reheat bursts)
  var fitPending = false;       // re-frame once when a settle burst finishes
  var live = nodes.length < 300; // small graphs animate by default; large open calm + legible
  var showLabels = nodes.length < 160;
  var hoverId = null, dragId = null, dragMoved = false;
  var enabledKind = {}, enabledTier = {}; // filters
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

  // ---- canvas ----
  var canvas = document.getElementById('g'), ctx = canvas.getContext('2d'), DPR = 1, W = 0, H = 0;
  function resize() {
    DPR = window.devicePixelRatio || 1; W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * DPR; canvas.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);

  // ---- physics (burst) ----
  function tick() {
    var i, j, a, b, dx, dy, d2, d, f;
    var K = 9000, SPRING = 0.02, LINK = 90, GRAV = 0.015;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j]; dx = a.x - b.x; dy = a.y - b.y; d2 = dx * dx + dy * dy || 0.01;
        f = K / d2; var inv = 1 / Math.sqrt(d2); var fx = dx * inv * f, fy = dy * inv * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    for (i = 0; i < edges.length; i++) {
      a = edges[i].s; b = edges[i].t; dx = b.x - a.x; dy = b.y - a.y; d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      f = (d - LINK) * SPRING; var ux = dx / d * f, uy = dy / d * f;
      a.vx += ux; a.vy += uy; b.vx -= ux; b.vy -= uy;
    }
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i]; a.vx -= a.x * GRAV; a.vy -= a.y * GRAV; a.vx *= 0.82; a.vy *= 0.82;
      if (a.fx != null) { a.x = a.fx; a.y = a.fy; } else { a.x += a.vx; a.y += a.vy; }
    }
  }
  function fit() {
    if (!nodes.length) return;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(function (n) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); });
    var w = maxX - minX || 1, h = maxY - minY || 1;
    view.k = Math.min(2, 0.86 * Math.min(W / w, H / h));
    view.tx = W / 2 - (minX + maxX) / 2 * view.k; view.ty = H / 2 - (minY + maxY) / 2 * view.k;
  }
  function settle(n) { heat = n; }

  // ---- render ----
  var t0 = Date.now();
  function frame() {
    if (heat > 0) { var steps = Math.min(6, heat); for (var s = 0; s < steps; s++) tick(); heat -= steps; if (heat <= 0) { savePos(); if (fitPending) { fitPending = false; fit(); } } }
    var now = Date.now(), T = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.translate(view.tx, view.ty); ctx.scale(view.k, view.k);
    var breathe = live && heat <= 0;
    function px(n) { return n.x + (breathe ? Math.sin(T * 0.7 + n.seed) * 2.0 : 0); }
    function py(n) { return n.y + (breathe ? Math.cos(T * 0.6 + n.seed) * 2.0 : 0); }
    var hov = hoverId ? byId[hoverId] : null;
    function lit(n) { return !hov || n.id === hov.id || adj[hov.id][n.id]; }

    // edges
    ctx.lineWidth = 1 / view.k;
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i]; if (!visible(e.s) || !visible(e.t)) continue;
      var on = !hov || lit(e.s) || lit(e.t);
      ctx.strokeStyle = getCSS('--edge'); ctx.globalAlpha = on ? 1 : 0.25;
      ctx.beginPath(); ctx.moveTo(px(e.s), py(e.s)); ctx.lineTo(px(e.t), py(e.t)); ctx.stroke();
      // directional particle (live)
      if (live && on && view.k > 0.5) {
        var fp = ((T * 0.35 + (i % 7) / 7) % 1);
        ctx.globalAlpha = 0.5; ctx.fillStyle = color(e.t);
        ctx.beginPath(); ctx.arc(px(e.s) + (px(e.t) - px(e.s)) * fp, py(e.s) + (py(e.t) - py(e.s)) * fp, 1.6 / view.k, 0, 7); ctx.fill();
      }
    }
    // nodes
    ctx.globalAlpha = 1;
    for (var n2 = 0; n2 < nodes.length; n2++) {
      var n = nodes[n2]; if (!visible(n)) continue;
      var x = px(n), y = py(n), r = radius(n), isHit = matches(n), dim = hov && !lit(n);
      ctx.globalAlpha = dim ? 0.12 : alpha(n);
      ctx.fillStyle = color(n);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if (n.fx != null || isHit) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = isHit ? getCSS('--accent') : '#ffd55e'; ctx.globalAlpha = 1; ctx.stroke(); }
      if ((showLabels || isHit || (hov && lit(n))) && (view.k > 0.55 || isHit)) {
        ctx.globalAlpha = dim ? 0.2 : 1; ctx.fillStyle = getCSS('--fg');
        ctx.font = (11 / view.k) + 'px -apple-system, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(n.label.length > 34 ? n.label.slice(0, 33) + '…' : n.label, x, y - r - 3 / view.k);
      }
    }
    ctx.restore();
    if (live || heat > 0) requestAnimationFrame(frame); else scheduled = false;
  }
  var scheduled = false;
  function kick() { if (!scheduled) { scheduled = true; requestAnimationFrame(frame); } }

  var cssCache = {};
  function getCSS(v) { if (cssCache[v] === undefined) cssCache[v] = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return cssCache[v]; }

  // ---- positions persistence ----
  function savePos() { try { var o = {}; nodes.forEach(function (n) { o[n.id] = [Math.round(n.x), Math.round(n.y)]; }); localStorage.setItem(POS_KEY, JSON.stringify(o)); } catch (e) {} }
  function loadPos() {
    try { var o = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (!o) return false;
      var ok = nodes.every(function (n) { return o[n.id]; }); if (!ok) return false;
      nodes.forEach(function (n) { n.x = o[n.id][0]; n.y = o[n.id][1]; }); return true;
    } catch (e) { return false; }
  }

  // ---- pointer ----
  function toWorld(ev) { var rc = canvas.getBoundingClientRect(); return { x: (ev.clientX - rc.left - view.tx) / view.k, y: (ev.clientY - rc.top - view.ty) / view.k }; }
  function pick(w) { var best = null, bd = Infinity; for (var i = 0; i < nodes.length; i++) { var n = nodes[i]; if (!visible(n)) continue; var dx = n.x - w.x, dy = n.y - w.y, d = dx * dx + dy * dy, r = radius(n) + 4; if (d < r * r && d < bd) { bd = d; best = n; } } return best; }
  var panning = false, last = null;
  canvas.addEventListener('mousedown', function (ev) {
    var w = toWorld(ev), n = pick(w); dragMoved = false;
    if (n) { dragId = n.id; n.fx = n.x; n.fy = n.y; } else { panning = true; canvas.classList.add('grabbing'); }
    last = { x: ev.clientX, y: ev.clientY };
  });
  window.addEventListener('mousemove', function (ev) {
    if (dragId) { var w = toWorld(ev), n = byId[dragId]; n.fx = n.x = w.x; n.fy = n.y = w.y; dragMoved = true; settle(Math.max(heat, 12)); kick(); return; }
    if (panning) { view.tx += ev.clientX - last.x; view.ty += ev.clientY - last.y; last = { x: ev.clientX, y: ev.clientY }; kick(); return; }
    var w2 = toWorld(ev), h = pick(w2), id = h ? h.id : null;
    if (id !== hoverId) { hoverId = id; tip(h, ev); kick(); } else if (h) tipMove(ev);
  });
  window.addEventListener('mouseup', function () {
    if (dragId && !dragMoved) { var n = byId[dragId]; n.fx = n.fy = null; } // click = unpin
    dragId = null; panning = false; canvas.classList.remove('grabbing');
  });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault(); var rc = canvas.getBoundingClientRect(), mx = ev.clientX - rc.left, my = ev.clientY - rc.top;
    var f = Math.exp(-ev.deltaY * 0.0014), nk = Math.max(0.08, Math.min(6, view.k * f));
    view.tx = mx - (mx - view.tx) * (nk / view.k); view.ty = my - (my - view.ty) * (nk / view.k); view.k = nk; kick();
  }, { passive: false });

  // ---- tooltip ----
  var tipEl = document.getElementById('tip');
  function tip(n, ev) {
    if (!n) { tipEl.style.display = 'none'; return; }
    var c = color(n), tl = n.tier ? ('Tier ' + n.tier) : 'code';
    tipEl.innerHTML = '<div class="t">' + esc(n.label) + '</div>' +
      '<div class="m"><span class="k" style="background:' + c + '">' + n.kind + ' · ' + tl + '</span>' +
      (n.status ? ' · ' + n.status : '') + '</div>' +
      (n.detail && n.detail !== n.label ? '<div class="m">' + esc(n.detail) + '</div>' : '') +
      '<div class="m">' + esc(n.id) + '</div>';
    tipEl.style.display = 'block'; tipMove(ev);
  }
  function tipMove(ev) { tipEl.style.left = (ev.clientX + 14) + 'px'; tipEl.style.top = (ev.clientY + 14) + 'px'; }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ---- sidebar ----
  function kindCounts() { var c = {}; nodes.forEach(function (n) { c[n.kind] = (c[n.kind] || 0) + 1; }); return c; }
  function buildSidebar() {
    var kc = kindCounts();
    var kh = document.getElementById('kinds'); kh.innerHTML = '';
    Object.keys(enabledKind).forEach(function (k) {
      if (!kc[k]) return;
      kh.appendChild(filterRow('kind', k, k, '#9ca3af', kc[k], enabledKind));
    });
    var th = document.getElementById('tiers'); th.innerHTML = '';
    (G.legend || []).forEach(function (L) { th.appendChild(filterRow('tier', L.key, L.label, L.color, L.count, enabledTier)); });
  }
  function filterRow(type, key, name, sw, count, store) {
    var row = document.createElement('label'); row.className = 'row' + (store[key] ? '' : ' off');
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!store[key];
    cb.onchange = function () { store[key] = cb.checked; row.className = 'row' + (cb.checked ? '' : ' off'); kick(); };
    var s = document.createElement('span'); s.className = 'sw'; s.style.background = sw;
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name;
    var ct = document.createElement('span'); ct.className = 'ct'; ct.textContent = count;
    row.appendChild(cb); row.appendChild(s); row.appendChild(nm); row.appendChild(ct); return row;
  }
  document.getElementById('search').addEventListener('input', function (e) {
    searchTerm = e.target.value.trim();
    if (searchTerm) { var m = nodes.filter(matches); if (m.length) { centerOn(m[0]); } }
    kick();
  });
  function centerOn(n) { view.k = Math.max(view.k, 1.1); view.tx = W / 2 - n.x * view.k; view.ty = H / 2 - n.y * view.k; }
  function btn(id, on, fn) { var b = document.getElementById(id); if (on) b.classList.add('on'); b.onclick = function () { fn(b); }; }
  btn('mode', live, function (b) { live = !live; b.classList.toggle('on', live); b.textContent = live ? '✦ Live' : '◦ Calm'; if (live) kick(); });
  document.getElementById('mode').textContent = live ? '✦ Live' : '◦ Calm';
  btn('labels', showLabels, function (b) { showLabels = !showLabels; b.classList.toggle('on', showLabels); kick(); });
  btn('theme', document.documentElement.classList.contains('light'), function (b) {
    var lt = document.documentElement.classList.toggle('light'); b.classList.toggle('on', lt);
    cssCache = {}; try { localStorage.setItem('clad_graph_theme', lt ? 'light' : 'dark'); } catch (e) {} kick();
  });
  document.getElementById('reset').onclick = function () { nodes.forEach(function (n) { n.fx = n.fy = null; }); try { localStorage.removeItem(POS_KEY); } catch (e) {} settle(260); fit(); kick(); setTimeout(fit, 600); };
  var burger = document.getElementById('burger'); if (burger) burger.onclick = function () { document.getElementById('side').classList.toggle('show'); };

  // ---- boot ----
  try { if (localStorage.getItem('clad_graph_theme') === 'light') document.documentElement.classList.add('light'); } catch (e) {}
  resize(); buildSidebar();
  if (loadPos()) { settle(0); fit(); } else { fitPending = true; settle(260); for (var w = 0; w < 60; w++) tick(); fit(); } // warm a little, re-fit when settled
  kick();
})();
