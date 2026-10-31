(function () {
  'use strict';

  const D = window.UBS_DATA;
  const KEY = 'ubs-socialista-v1';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const HOUSE_TYPES = ['Não informado', 'Casa', 'Comércio', 'Igreja', 'Escola', 'Terreno', 'Outro'];
  const LAYERS = [['areas', 'Áreas dos agentes'], ['houses', 'Casas'], ['streets', 'Ruas do Socialista'], ['bairros', 'Bairros de Porto Velho'], ['health', 'Unidades de saúde'], ['schools', 'Escolas'], ['labels', 'Nomes no mapa']];
  const UNASSIGNED = '#8d949c';
  const NEAR_AREA_M = 18; // casas na rua, entre duas quadras pintadas, ainda pertencem à área vizinha
  const M_PER_WORLD = 40075016.7 * Math.cos(-8.76 * Math.PI / 180);

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (k in e && k !== 'list') e[k] = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of kids.flat()) if (c != null) e.append(c);
    return e;
  }

  // Projeção Web Mercator em coordenadas de mundo (0..1)
  const mx = (lng) => (lng + 180) / 360;
  const my = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
  const unmy = (y) => (2 * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - Math.PI / 2) * 180 / Math.PI;

  function geomOf(latlngs) {
    const n = latlngs.length, xs = new Float64Array(n), ys = new Float64Array(n);
    let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
    for (let i = 0; i < n; i++) {
      const x = mx(latlngs[i][1]), y = my(latlngs[i][0]);
      xs[i] = x; ys[i] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { xs, ys, x0, y0, x1, y1 };
  }
  function pip(g, x, y) {
    if (x < g.x0 || x > g.x1 || y < g.y0 || y > g.y1) return false;
    let c = false;
    for (let i = 0, j = g.xs.length - 1; i < g.xs.length; j = i++) {
      if ((g.ys[i] > y) !== (g.ys[j] > y) && x < (g.xs[j] - g.xs[i]) * (y - g.ys[i]) / (g.ys[j] - g.ys[i]) + g.xs[i]) c = !c;
    }
    return c;
  }
  function segDist(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  }
  function ringDist(g, x, y, closed) {
    let best = Infinity;
    const n = g.xs.length;
    for (let i = closed ? 0 : 1; i < n; i++) {
      const j = i === 0 ? n - 1 : i - 1;
      const d = segDist(x, y, g.xs[j], g.ys[j], g.xs[i], g.ys[i]);
      if (d < best) best = d;
    }
    return best;
  }
  function ringArea(g) {
    let a = 0;
    for (let i = 0, j = g.xs.length - 1; i < g.xs.length; j = i++) a += (g.xs[j] + g.xs[i]) * (g.ys[j] - g.ys[i]);
    return Math.abs(a / 2);
  }
  function labelPoint(g) {
    let cx = 0, cy = 0;
    for (let i = 0; i < g.xs.length; i++) { cx += g.xs[i]; cy += g.ys[i]; }
    cx /= g.xs.length; cy /= g.xs.length;
    if (pip(g, cx, cy)) return [cx, cy];
    // centro fora do polígono (forma em L): usa o meio do trecho interno mais longo na horizontal do centro
    const hits = [];
    for (let i = 0, j = g.xs.length - 1; i < g.xs.length; j = i++) {
      if ((g.ys[i] > cy) !== (g.ys[j] > cy)) hits.push((g.xs[j] - g.xs[i]) * (cy - g.ys[i]) / (g.ys[j] - g.ys[i]) + g.xs[i]);
    }
    hits.sort((a, b) => a - b);
    let best = [cx, cy], w = 0;
    for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1] - hits[i] > w) { w = hits[i + 1] - hits[i]; best = [(hits[i] + hits[i + 1]) / 2, cy]; }
    return best;
  }

  /* ---------- Geometria fixa ---------- */
  const bairros = D.bairros.map((b) => ({ n: b.n, rings: b.r.map(geomOf), ll: b.r }));
  const socB = bairros.find((b) => b.n === 'Socialista');
  bairros.forEach((b) => { const main = b.rings.reduce((a, r) => (ringArea(r) > ringArea(a) ? r : a)); b.label = labelPoint(main); });
  const streets = D.streets.map((s) => {
    const g = geomOf(s.c);
    let len = 0;
    for (let i = 1; i < g.xs.length; i++) len += Math.hypot(g.xs[i] - g.xs[i - 1], g.ys[i] - g.ys[i - 1]);
    return Object.assign(g, { n: s.n, p: s.p, h: s.h, c: s.c, len });
  });
  const blocks = D.blocks.map(geomOf);
  const baseHouses = D.houses.map((h, i) => {
    const n = (h.length - 1) / 2, xs = new Float64Array(n), ys = new Float64Array(n);
    let cx = 0, cy = 0;
    for (let k = 0; k < n; k++) {
      const x = mx(h[1 + 2 * k] / 1e6 - 63.8), y = my(h[2 + 2 * k] / 1e6 - 8.7);
      xs[k] = x; ys[k] = y; cx += x; cy += y;
    }
    return { id: 'b' + i, xs, ys, cx: cx / n, cy: cy / n, street: h[0] >= 0 ? streets[h[0]].n : '' };
  });
  const markers = [
    ...D.schools.map((s) => Object.assign({ kind: 'school', x: mx(s.lo), y: my(s.la), soc: s.b === 'Socialista' }, s)),
    ...D.health.map((s) => Object.assign({ kind: 'health', x: mx(s.lo), y: my(s.la), soc: s.b === 'Socialista' }, s)),
  ];

  /* ---------- Estado persistente ---------- */
  function seedState() {
    return {
      v: 1,
      title: 'Mapa de Atuação dos Agentes – USF Socialista',
      subtitle: 'Porto Velho – RO',
      agents: D.agents.map((a) => Object.assign({}, a)),
      areas: D.areas.map((a) => ({ id: a.id, agent: a.agent, ring: a.ring })),
      houseEdits: {},
      houseDeleted: [],
      houseAdded: [],
      ui: { base: 'street', opacity: 0.45, layers: { areas: true, houses: true, streets: true, bairros: true, health: true, schools: true, labels: true } },
    };
  }
  function isHexColor(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }
  function sanitize(s) {
    if (!s || !Array.isArray(s.agents) || !Array.isArray(s.areas)) throw new Error('arquivo inválido');
    const seed = seedState();
    const agents = s.agents.filter((a) => a && typeof a.id === 'string' && isHexColor(a.color)).map((a) => ({ id: a.id, name: String(a.name || 'Sem nome'), color: a.color, team: String(a.team || 'Sem equipe'), visible: a.visible !== false }));
    const areas = s.areas.filter((a) => a && Array.isArray(a.ring) && a.ring.length >= 3 && a.ring.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])))
      .map((a) => ({ id: String(a.id), agent: a.agent == null ? null : String(a.agent), ring: a.ring.map((p) => [p[0], p[1]]) }));
    const ui = Object.assign({}, seed.ui, s.ui && typeof s.ui === 'object' ? s.ui : {});
    ui.layers = Object.assign({}, seed.ui.layers, ui.layers);
    return {
      v: 1, title: String(s.title || seed.title), subtitle: String(s.subtitle == null ? seed.subtitle : s.subtitle), agents, areas,
      houseEdits: s.houseEdits && typeof s.houseEdits === 'object' ? s.houseEdits : {},
      houseDeleted: Array.isArray(s.houseDeleted) ? s.houseDeleted.map(String) : [],
      houseAdded: Array.isArray(s.houseAdded) ? s.houseAdded.filter((h) => h && Number.isFinite(h.lat) && Number.isFinite(h.lng)) : [],
      ui,
    };
  }
  let state;
  let loadFailed = false;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? sanitize(JSON.parse(raw)) : seedState();
  } catch (e) { loadFailed = true; state = seedState(); }

  let saveOk = true;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveOk = true; }
    catch (e) { saveOk = false; toast('Não foi possível salvar neste navegador. Baixe um backup para não perder as alterações.'); }
    updateStorageInfo();
  }

  const undoStack = [];
  function snapshot() {
    undoStack.push(JSON.stringify({ agents: state.agents, areas: state.areas, houseEdits: state.houseEdits, houseDeleted: state.houseDeleted, houseAdded: state.houseAdded }));
    if (undoStack.length > 40) undoStack.shift();
    $('#btnUndo').disabled = false;
  }
  function undo() {
    if (!undoStack.length) return;
    Object.assign(state, JSON.parse(undoStack.pop()));
    $('#btnUndo').disabled = !undoStack.length;
    map.closePopup();
    if (!state.agents.some((a) => a.id === activeAgent)) activeAgent = state.agents[0] && state.agents[0].id;
    save(); refresh();
  }
  /* mutate: desfazível, salva e redesenha. opts.keepPanel evita recriar o painel enquanto se digita nele. */
  function mutate(fn, opts) {
    snapshot();
    fn();
    save();
    refresh(opts);
  }

  /* ---------- Derivados ---------- */
  let areaGeoms = [];
  let houses = [];
  const counts = { byAgent: {}, byStreet: {}, unassigned: 0 };
  const agentById = (id) => state.agents.find((a) => a.id === id);

  function rebuild() {
    areaGeoms = state.areas.map((a) => {
      const g = geomOf(a.ring);
      g.area = a; g.m2 = ringArea(g) * M_PER_WORLD * M_PER_WORLD;
      g.lp = labelPoint(g);
      return g;
    });
    const deleted = new Set(state.houseDeleted);
    houses = baseHouses.filter((h) => !deleted.has(h.id));
    for (const h of state.houseAdded) houses.push(addedHouseGeom(h));
    const lim = NEAR_AREA_M / M_PER_WORLD;
    counts.byAgent = {}; counts.byStreet = {}; counts.unassigned = 0;
    const ids = new Set(state.agents.map((a) => a.id));
    for (const h of houses) {
      const ed = state.houseEdits[h.id] || {};
      let owner = ed.owner && ids.has(ed.owner) ? ed.owner : null;
      if (!owner) {
        // a última área desenhada fica por cima
        for (let i = areaGeoms.length - 1; i >= 0 && !owner; i--) if (pip(areaGeoms[i], h.cx, h.cy)) owner = areaGeoms[i].area.agent;
        if (!owner) {
          let best = lim;
          for (const g of areaGeoms) {
            if (h.cx < g.x0 - lim || h.cx > g.x1 + lim || h.cy < g.y0 - lim || h.cy > g.y1 + lim) continue;
            const d = ringDist(g, h.cx, h.cy, true);
            if (d < best) { best = d; owner = g.area.agent; }
          }
        }
      }
      h.owner = owner && ids.has(owner) ? owner : null;
      h.num = ed.num || '';
      h.streetName = ed.street != null ? ed.street : h.street;
      if (h.owner) counts.byAgent[h.owner] = (counts.byAgent[h.owner] || 0) + 1; else counts.unassigned++;
      if (h.streetName) (counts.byStreet[h.streetName] = counts.byStreet[h.streetName] || { n: 0, owners: {} }).n++;
      if (h.streetName && h.owner) counts.byStreet[h.streetName].owners[h.owner] = 1;
    }
  }
  function addedHouseGeom(h) {
    const x = mx(h.lng), y = my(h.lat), r = 5 / M_PER_WORLD;
    return { id: h.id, xs: Float64Array.of(x - r, x + r, x + r, x - r), ys: Float64Array.of(y - r, y - r, y + r, y + r), cx: x, cy: y, street: h.street || '', added: true };
  }
  function nearestStreet(x, y) {
    let best = 90 / M_PER_WORLD, name = '';
    for (const s of streets) {
      const d = ringDist(s, x, y, false);
      if (d < best) { best = d; name = s.n; }
    }
    return name;
  }

  /* ---------- Desenho (mesmo código na tela e na exportação) ---------- */
  function hexAlpha(hex, a) {
    return 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' + parseInt(hex.slice(5, 7), 16) + ',' + a + ')';
  }
  function darker(hex) {
    const f = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.6);
    return 'rgb(' + f(1) + ',' + f(3) + ',' + f(5) + ')';
  }
  function tracePath(ctx, g, v, close) {
    const n = g.xs.length;
    ctx.moveTo(g.xs[0] * v.k - v.ox, g.ys[0] * v.k - v.oy);
    for (let i = 1; i < n; i++) ctx.lineTo(g.xs[i] * v.k - v.ox, g.ys[i] * v.k - v.oy);
    if (close) ctx.closePath();
  }
  function culled(g, v, m) {
    return g.x1 * v.k - v.ox < -m || g.x0 * v.k - v.ox > v.w + m || g.y1 * v.k - v.oy < -m || g.y0 * v.k - v.oy > v.h + m;
  }
  function placeLabel(occ, x, y, w, h) {
    const r = [x - w / 2 - 2, y - h / 2 - 1, x + w / 2 + 2, y + h / 2 + 1];
    for (const o of occ) if (r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]) return false;
    occ.push(r);
    return true;
  }
  function haloText(ctx, t, x, y, fill, halo, lw) {
    ctx.lineWidth = lw; ctx.strokeStyle = halo; ctx.lineJoin = 'round';
    ctx.strokeText(t, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(t, x, y);
  }
  function drawMarker(ctx, m, x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
    ctx.fillStyle = m.kind === 'health' ? '#d93025' : '#1a56c4'; ctx.fill();
    ctx.lineWidth = Math.max(1.2, r * 0.18); ctx.strokeStyle = '#fff'; ctx.stroke();
    if (r < 5.5) return;
    ctx.fillStyle = '#fff';
    if (m.kind === 'health') {
      const a = r * 0.58, b = r * 0.19;
      ctx.fillRect(x - a, y - b, 2 * a, 2 * b);
      ctx.fillRect(x - b, y - a, 2 * b, 2 * a);
    } else {
      // capelo
      const a = r * 0.68;
      ctx.beginPath(); ctx.moveTo(x - a, y - a * 0.2); ctx.lineTo(x, y - a * 0.72); ctx.lineTo(x + a, y - a * 0.2); ctx.lineTo(x, y + a * 0.3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - a * 0.55, y + a * 0.15); ctx.lineTo(x - a * 0.55, y + a * 0.62); ctx.quadraticCurveTo(x, y + a * 0.95, x + a * 0.55, y + a * 0.62); ctx.lineTo(x + a * 0.55, y + a * 0.15); ctx.lineTo(x, y + a * 0.45); ctx.closePath(); ctx.fill();
    }
  }

  function drawScene(ctx, v) {
    const L_ = state.ui.layers, z = v.z, sat = state.ui.base === 'sat', occ = [];
    const agentMap = {};
    state.agents.forEach((a) => { agentMap[a.id] = a; });
    const FONT = '"Segoe UI", system-ui, Arial, sans-serif';

    if (L_.bairros) {
      ctx.lineWidth = 1; ctx.strokeStyle = sat ? 'rgba(255,255,255,.75)' : 'rgba(60,70,85,.6)'; ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (const b of bairros) if (b !== socB) for (const r of b.rings) if (!culled(r, v, 5)) tracePath(ctx, r, v, true);
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (L_.areas) {
      for (const g of areaGeoms) {
        if (g.area.id === editingId || culled(g, v, 5)) continue;
        const a = agentMap[g.area.agent];
        if (a && !a.visible) continue;
        const col = a ? a.color : UNASSIGNED;
        ctx.beginPath(); tracePath(ctx, g, v, true);
        ctx.fillStyle = hexAlpha(col, state.ui.opacity); ctx.fill();
        ctx.lineWidth = g.area.id === selectedAreaId ? 3 : 1.2; ctx.strokeStyle = g.area.id === selectedAreaId ? '#111' : darker(col); ctx.stroke();
      }
    }
    if (L_.streets) {
      const w = z >= 17 ? 2.4 : z >= 15 ? 1.6 : 1;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = w; ctx.strokeStyle = sat ? 'rgba(255,255,255,.85)' : 'rgba(40,50,70,.72)';
      ctx.beginPath();
      for (const s of streets) if (!culled(s, v, 5)) tracePath(ctx, s, v, false);
      ctx.stroke();
      if (selectedStreet) {
        ctx.lineWidth = w + 3; ctx.strokeStyle = '#ff9800';
        ctx.beginPath();
        for (const s of streets) if (s.n === selectedStreet && !culled(s, v, 5)) tracePath(ctx, s, v, false);
        ctx.stroke();
      }
    }
    // Contorno do bairro Socialista: sempre marcado
    ctx.beginPath(); socB.rings.forEach((r) => tracePath(ctx, r, v, true));
    ctx.lineJoin = 'round'; ctx.lineWidth = 5.5; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    ctx.lineWidth = 2.8; ctx.strokeStyle = '#c2185b'; ctx.stroke();

    if (L_.houses && z >= 14.5) {
      const groups = new Map();
      const m = 4, x0 = -m, x1 = v.w + m, y0 = -m, y1 = v.h + m;
      for (const h of houses) {
        const px = h.cx * v.k - v.ox, py = h.cy * v.k - v.oy;
        if (px < x0 || px > x1 || py < y0 || py > y1) continue;
        const a = h.owner ? agentMap[h.owner] : null;
        if (a && !a.visible) continue;
        const key = a ? a.color : UNASSIGNED;
        let arr = groups.get(key);
        if (!arr) groups.set(key, arr = []);
        arr.push(h);
      }
      ctx.lineWidth = z >= 17 ? 0.9 : 0.5;
      for (const [col, arr] of groups) {
        ctx.beginPath();
        for (const h of arr) tracePath(ctx, h, v, true);
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = sat ? 'rgba(255,255,255,.9)' : 'rgba(20,25,35,.7)'; ctx.stroke();
      }
      if (selectedStreet) {
        ctx.beginPath();
        for (const h of houses) if (h.streetName === selectedStreet) tracePath(ctx, h, v, true);
        ctx.lineWidth = 1.8; ctx.strokeStyle = '#ff9800'; ctx.stroke();
      }
      if (selectedHouseId) {
        const h = houses.find((x) => x.id === selectedHouseId);
        if (h) { ctx.beginPath(); tracePath(ctx, h, v, true); ctx.lineWidth = 2.6; ctx.strokeStyle = '#111'; ctx.stroke(); }
      }
      if (L_.labels && z >= 18.5) {
        ctx.font = '600 10.5px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const h of houses) {
          if (!h.num) continue;
          const px = h.cx * v.k - v.ox, py = h.cy * v.k - v.oy;
          if (px < 0 || px > v.w || py < 0 || py > v.h) continue;
          haloText(ctx, h.num, px, py, '#111', 'rgba(255,255,255,.9)', 2.6);
        }
      }
    }

    // Marcadores primeiro entram no mapa de colisão, para os rótulos não os cobrirem
    const visM = markers.filter((m) => L_[m.kind === 'health' ? 'health' : 'schools']);
    const pR = (m) => (z >= 16 ? (m.soc ? 13 : 10) : z >= 14 ? (m.soc ? 10 : 7) : z >= 12.5 ? (m.soc ? 7 : 4.5) : (m.soc ? 5 : 2.8));
    for (const m of visM) {
      const x = m.x * v.k - v.ox, y = m.y * v.k - v.oy;
      if (x < -20 || x > v.w + 20 || y < -20 || y > v.h + 20) continue;
      const r = pR(m); occ.push([x - r, y - r, x + r, y + r]);
    }

    if (L_.labels) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (L_.bairros && z < 15.5) {
        ctx.font = '600 11.5px ' + FONT;
        for (const b of bairros) {
          if (b === socB) continue;
          const x = b.label[0] * v.k - v.ox, y = b.label[1] * v.k - v.oy;
          if (x < 0 || x > v.w || y < 0 || y > v.h || z < 11.5) continue;
          if (placeLabel(occ, x, y, ctx.measureText(b.n).width, 14)) haloText(ctx, b.n, x, y, '#3b4654', 'rgba(255,255,255,.85)', 3);
        }
      }
      if (z < 15) {
        ctx.font = '700 ' + (z < 13 ? 13 : 15) + 'px ' + FONT;
        const x = socB.label[0] * v.k - v.ox, y = socB.label[1] * v.k - v.oy - (L_.areas && z >= 14 ? 40 : 0);
        placeLabel(occ, x, y, ctx.measureText('Socialista').width, 18);
        haloText(ctx, 'Socialista', x, y, '#ad1457', '#fff', 3.5);
      }
      if (L_.areas && z >= 14.5) {
        // nome do agente na maior área dele
        const biggest = {};
        for (const g of areaGeoms) if (g.area.agent && (!biggest[g.area.agent] || g.m2 > biggest[g.area.agent].m2)) biggest[g.area.agent] = g;
        ctx.font = '700 12px ' + FONT;
        for (const id of Object.keys(biggest).sort((p, q) => biggest[q].m2 - biggest[p].m2)) {
          const a = agentMap[id], g = biggest[id];
          if (!a || !a.visible || g.area.id === editingId) continue;
          const x = g.lp[0] * v.k - v.ox, y = g.lp[1] * v.k - v.oy;
          if (x < 0 || x > v.w || y < 0 || y > v.h) continue;
          const t = a.name.replace(/^ACS\s+/i, '');
          if (placeLabel(occ, x, y, ctx.measureText(t).width, 15)) haloText(ctx, t, x, y, '#111', 'rgba(255,255,255,.92)', 3.4);
        }
      }
      if (L_.streets && z >= 15.8) {
        ctx.font = '600 ' + (z >= 17 ? 11.5 : 10) + 'px ' + FONT;
        const fill = '#17202b', halo = 'rgba(255,255,255,.92)';
        const seen = {};
        for (const s of [...streets].sort((p, q) => q.len - p.len)) {
          if (culled(s, v, 0) || /sem denomina/i.test(s.n)) continue;
          const pxLen = s.len * v.k, t = s.n.replace(/^Rua\s+/, 'R. ').replace(/^Avenida\s+/, 'Av. ').replace(/^Travessa\s+/, 'Tv. '), tw = ctx.measureText(t).width;
          if (pxLen < tw * 1.05 || (seen[s.n] && z < 17)) continue;
          // ponto médio do trecho
          let acc = 0, i = 1;
          for (; i < s.xs.length; i++) {
            const d = Math.hypot(s.xs[i] - s.xs[i - 1], s.ys[i] - s.ys[i - 1]);
            if (acc + d >= s.len / 2) break;
            acc += d;
          }
          i = Math.min(i, s.xs.length - 1);
          const dd = Math.hypot(s.xs[i] - s.xs[i - 1], s.ys[i] - s.ys[i - 1]) || 1, f = (s.len / 2 - acc) / dd;
          const x = (s.xs[i - 1] + (s.xs[i] - s.xs[i - 1]) * f) * v.k - v.ox, y = (s.ys[i - 1] + (s.ys[i] - s.ys[i - 1]) * f) * v.k - v.oy;
          if (x < 0 || x > v.w || y < 0 || y > v.h) continue;
          let ang = Math.atan2(s.ys[i] - s.ys[i - 1], s.xs[i] - s.xs[i - 1]);
          if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
          const bw = Math.abs(Math.cos(ang)) * tw + Math.abs(Math.sin(ang)) * 12, bh = Math.abs(Math.sin(ang)) * tw + Math.abs(Math.cos(ang)) * 12;
          if (!placeLabel(occ, x, y, bw, bh)) continue;
          seen[s.n] = 1;
          ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
          haloText(ctx, t, 0, 0, fill, halo, 3);
          ctx.restore();
        }
      }
    }
    for (const m of visM) {
      const x = m.x * v.k - v.ox, y = m.y * v.k - v.oy;
      if (x < -20 || x > v.w + 20 || y < -20 || y > v.h + 20) continue;
      drawMarker(ctx, m, x, y, pR(m));
    }
    if (L_.labels) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const m of visM) {
        if (!(z >= 17 || (m.soc && z >= 15))) continue;
        const r = pR(m), x = m.x * v.k - v.ox + r + 3, y = m.y * v.k - v.oy;
        if (x > v.w || x < -200 || y < 0 || y > v.h) continue;
        ctx.font = '700 11.5px ' + FONT;
        const w = ctx.measureText(m.n).width;
        const col = m.kind === 'health' ? '#a3120b' : '#123e96';
        if (placeLabel(occ, x + w / 2, y, w, 14)) haloText(ctx, m.n, x, y, col, 'rgba(255,255,255,.95)', 3.2);
        else {
          const xl = x - 2 * r - 6 - w; // sem espaço à direita: tenta à esquerda do marcador
          if (placeLabel(occ, xl + w / 2, y, w, 14)) haloText(ctx, m.n, xl, y, col, 'rgba(255,255,255,.95)', 3.2);
        }
      }
    }
  }

  /* ---------- Mapa ---------- */
  const map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 20, minZoom: 10, zoomSnap: 0.5, wheelPxPerZoomLevel: 90 });
  window.ubsMap = map;
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix('Leaflet');
  const BASES = {
    // Esri porque CARTO e OSM recusam ou marcam blocos pedidos de uma página aberta direto do disco (sem Referer)
    street: { layers: [{ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', native: 19 }], attr: 'Mapa © Esri, HERE, Garmin, OpenStreetMap' },
    sat: { layers: [
      { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', native: 19 },
      { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', native: 19 },
    ], attr: 'Imagens © Esri, Maxar, Earthstar Geographics' },
  };
  const DATA_ATTR = 'Edificações: Overture Maps (Google, Microsoft, OSM)';
  let baseLayers = [];
  function setBase(name) {
    baseLayers.forEach((l) => l.remove());
    const b = BASES[name];
    baseLayers = b.layers.map((l, i) => L.tileLayer(l.url, { subdomains: l.sub || 'abc', maxZoom: 20, maxNativeZoom: l.native, crossOrigin: true, attribution: i === 0 ? b.attr + ' · ' + DATA_ATTR : '', zIndex: i + 1 }).addTo(map));
    state.ui.base = name;
    $$('#baseSwitch button').forEach((x) => x.classList.toggle('active', x.dataset.base === name));
    scene.redraw();
  }

  const scenePane = map.createPane('scene');
  scenePane.classList.add('scene-pane');
  scenePane.style.zIndex = 350;
  scenePane.style.pointerEvents = 'none';
  const PAD = 0.3;
  const SceneLayer = L.Layer.extend({
    onAdd() {
      this._c = L.DomUtil.create('canvas', 'leaflet-zoom-animated', scenePane);
      this._ctx = this._c.getContext('2d');
      this._update();
    },
    getEvents() { return { moveend: this._update, resize: this._update, zoomanim: this._anim }; },
    _anim(e) {
      const m = this._map, s = m.getZoomScale(e.zoom, this._zoom), half = m.getSize().multiplyBy(0.5 + PAD);
      const off = m.project(e.center, e.zoom).subtract(m.project(this._center, e.zoom));
      L.DomUtil.setTransform(this._c, half.multiplyBy(-s).add(this._pos).add(half).subtract(off), s);
    },
    _update() {
      const m = this._map; if (!m) return;
      const size = m.getSize(), dpr = window.devicePixelRatio || 1;
      const min = m.containerPointToLayerPoint(size.multiplyBy(-PAD)).round();
      const w = Math.round(size.x * (1 + 2 * PAD)), h = Math.round(size.y * (1 + 2 * PAD));
      this._pos = min; this._zoom = m.getZoom(); this._center = m.getCenter();
      L.DomUtil.setPosition(this._c, min);
      this._c.width = w * dpr; this._c.height = h * dpr;
      this._c.style.width = w + 'px'; this._c.style.height = h + 'px';
      const ctx = this._ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const org = m.getPixelOrigin(), k = 256 * Math.pow(2, this._zoom);
      drawScene(ctx, { k, ox: min.x + org.x, oy: min.y + org.y, w, h, z: this._zoom });
    },
    redraw() { if (this._map) this._update(); },
  });
  const scene = new SceneLayer();

  /* ---------- Ferramentas e cliques ---------- */
  let tool = 'select', paintTarget = 'area', activeAgent = state.agents[0] && state.agents[0].id;
  let selectedStreet = null, selectedAreaId = null, selectedHouseId = null, editingId = null, editing = null;

  function setTool(t) {
    if (editing) finishEdit(false);
    if (map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
    tool = t;
    $$('#tools .tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    $('#map').className = $('#map').className.replace(/\bc-\w+/g, '').trim();
    if (t !== 'select') $('#map').classList.add('c-' + t);
    map.closePopup();
    if (t === 'draw') {
      map.doubleClickZoom.disable();
      startDraw();
    } else map.doubleClickZoom.enable();
    updateHint();
    closePanelMobile();
  }
  function startDraw() {
    const a = agentById(activeAgent), col = a ? a.color : UNASSIGNED;
    map.pm.enableDraw('Polygon', { snappable: false, allowSelfIntersection: false, templineStyle: { color: col }, hintlineStyle: { color: col, dashArray: [5, 5] }, pathOptions: { color: col, fillColor: col, fillOpacity: 0.4 } });
  }
  function updateHint() {
    const h = $('#hint');
    h.replaceChildren();
    if (tool === 'select') { h.hidden = true; return; }
    const a = agentById(activeAgent);
    const sw = el('span', { class: 'sw' }); sw.style.background = a ? a.color : UNASSIGNED;
    const nm = a ? a.name : 'nenhum agente';
    if (tool === 'paint') {
      h.append(sw, 'Pintando para ' + nm + ': clique em ');
      const seg = el('span', { class: 'paint-target' },
        el('button', { class: paintTarget === 'area' ? 'on' : '', onclick: () => { paintTarget = 'area'; updateHint(); } }, 'uma área ou quadra'),
        el('button', { class: paintTarget === 'house' ? 'on' : '', onclick: () => { paintTarget = 'house'; updateHint(); if (map.getZoom() < 16) toast('Aproxime o mapa para clicar nas casas.'); } }, 'uma casa'));
      h.append(seg);
    } else if (tool === 'draw') {
      h.append(sw, 'Nova área de ' + nm + ': clique ponto a ponto e feche no primeiro ponto.');
    } else if (tool === 'house') {
      h.append('Clique no mapa onde fica a casa.');
    }
    h.append(el('button', { class: 'link', style: 'color:#7fe0e6', onclick: () => setTool('select') }, 'Sair'));
    h.hidden = false;
  }

  function hitMarker(p, z) {
    const k = 256 * Math.pow(2, z), L_ = state.ui.layers;
    let best = null, bd = 16;
    for (const m of markers) {
      if (!L_[m.kind === 'health' ? 'health' : 'schools']) continue;
      const d = Math.hypot((m.x - p[0]) * k, (m.y - p[1]) * k);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  function hitHouse(p, z) {
    if (!state.ui.layers.houses || z < 14.5) return null;
    const k = 256 * Math.pow(2, z);
    let best = null, bd = Infinity;
    for (const h of houses) {
      const d = Math.hypot(h.cx - p[0], h.cy - p[1]);
      if (d * k > 60 || d >= bd) continue;
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (let i = 0; i < h.xs.length; i++) { x0 = Math.min(x0, h.xs[i]); x1 = Math.max(x1, h.xs[i]); y0 = Math.min(y0, h.ys[i]); y1 = Math.max(y1, h.ys[i]); }
      if (pip({ xs: h.xs, ys: h.ys, x0, y0, x1, y1 }, p[0], p[1]) || d * k < 4) { best = h; bd = d; }
    }
    return best;
  }
  function hitArea(p) {
    if (!state.ui.layers.areas) return null;
    for (let i = areaGeoms.length - 1; i >= 0; i--) {
      const a = agentById(areaGeoms[i].area.agent);
      if (a && !a.visible) continue;
      if (pip(areaGeoms[i], p[0], p[1])) return areaGeoms[i];
    }
    return null;
  }
  function hitStreet(p, z) {
    if (!state.ui.layers.streets) return null;
    const k = 256 * Math.pow(2, z);
    let best = null, bd = 6 / k;
    for (const s of streets) {
      if (p[0] < s.x0 - bd || p[0] > s.x1 + bd || p[1] < s.y0 - bd || p[1] > s.y1 + bd) continue;
      const d = ringDist(s, p[0], p[1], false);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  map.on('click', (e) => {
    if (editing || tool === 'draw') return;
    const p = [mx(e.latlng.lng), my(e.latlng.lat)], z = map.getZoom();
    if (tool === 'paint') return paintAt(p, z);
    if (tool === 'house') return addHouseAt(e.latlng, p);
    const m = hitMarker(p, z);
    if (m) return openMarkerPopup(m);
    const h = hitHouse(p, z);
    if (h) return openHousePopup(h, e.latlng);
    const s = hitStreet(p, z);
    if (s) return openStreetPopup(s, e.latlng);
    const a = hitArea(p);
    if (a) return openAreaPopup(a.area, e.latlng);
  });
  function paintAt(p, z) {
    if (!activeAgent) return toast('Adicione um agente primeiro.');
    if (paintTarget === 'house') {
      const h = hitHouse(p, z);
      if (!h) return toast('Nenhuma casa neste ponto. Aproxime o mapa e clique em cima da casa.');
      return mutate(() => { editHouse(h.id).owner = activeAgent; });
    }
    const a = hitArea(p);
    if (a) return mutate(() => { a.area.agent = activeAgent; });
    const b = blocks.find((g) => pip(g, p[0], p[1]));
    if (!b) return toast('Fora das quadras do Socialista. Use Desenhar área aqui.');
    const ring = Array.from(b.xs, (x, i) => [unmy(b.ys[i]), x * 360 - 180]).map((c) => [+c[0].toFixed(6), +c[1].toFixed(6)]);
    mutate(() => { state.areas.push({ id: 'a' + Date.now().toString(36), agent: activeAgent, ring }); });
  }
  function addHouseAt(latlng, p) {
    const id = 'n' + Date.now().toString(36);
    const street = nearestStreet(p[0], p[1]);
    mutate(() => { state.houseAdded.push({ id, lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6), street }); });
    const h = houses.find((x) => x.id === id);
    if (h) openHousePopup(h, latlng);
  }
  map.on('pm:create', (e) => {
    const ring = e.layer.getLatLngs()[0].map((c) => [+c.lat.toFixed(6), +c.lng.toFixed(6)]);
    e.layer.remove();
    if (ring.length >= 3) mutate(() => { state.areas.push({ id: 'a' + Date.now().toString(36), agent: activeAgent || null, ring }); });
    if (tool === 'draw') startDraw();
  });
  map.on('popupclose', () => {
    if (selectedAreaId || selectedHouseId) { selectedAreaId = null; selectedHouseId = null; scene.redraw(); }
  });

  function agentSelect(value, onchange, extra) {
    const sel = el('select', { class: 'field', onchange: (e) => onchange(e.target.value) });
    if (extra) sel.append(el('option', { value: extra[0] }, extra[1]));
    const teams = {};
    state.agents.forEach((a) => (teams[a.team] = teams[a.team] || []).push(a));
    for (const t of Object.keys(teams)) sel.append(el('optgroup', { label: t }, teams[t].map((a) => el('option', { value: a.id }, a.name))));
    sel.value = value == null ? (extra ? extra[0] : '') : value;
    return sel;
  }
  function openMarkerPopup(m) {
    const kids = [el('h3', {}, m.n), el('div', { class: 'meta' }, m.kind === 'health' ? (m.c || 'Unidade de saúde') : (m.c || 'Escola municipal'))];
    if (m.a) kids.push(el('div', {}, m.a));
    if (m.b) kids.push(el('div', {}, 'Bairro: ' + m.b));
    if (m.t) kids.push(el('div', {}, 'Telefone: ' + m.t));
    if (m.cn) kids.push(el('div', {}, 'CNES: ' + m.cn));
    if (m.al) kids.push(el('div', {}, 'Alunos: ' + m.al));
    L.popup({ offset: [0, -8] }).setLatLng([unmy(m.y), m.x * 360 - 180]).setContent(el('div', { class: 'pop' }, kids)).openOn(map);
  }
  function openStreetPopup(s, latlng) {
    const c = counts.byStreet[s.n];
    const kids = [el('h3', {}, s.n), el('div', { class: 'meta' }, (c ? c.n : 0) + ' casas nesta rua (no bairro)')];
    if (s.p) kids.push(el('div', {}, 'Pavimentada: ' + s.p));
    if (s.h) kids.push(el('div', {}, s.h));
    kids.push(el('div', { class: 'row' }, el('button', { class: 'link', onclick: () => { selectStreet(s.n); map.closePopup(); } }, 'Destacar as casas desta rua')));
    L.popup().setLatLng(latlng).setContent(el('div', { class: 'pop' }, kids)).openOn(map);
  }
  function openAreaPopup(area, latlng) {
    selectedAreaId = area.id; selectedHouseId = null; scene.redraw();
    const g = areaGeoms.find((x) => x.area === area);
    const n = houses.filter((h) => pip(g, h.cx, h.cy)).length;
    const root = el('div', { class: 'pop' },
      el('h3', {}, 'Área de atuação'),
      el('div', { class: 'meta' }, n + ' casas no bairro · ' + (g.m2 / 10000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' ha'),
      el('label', {}, 'Agente', agentSelect(area.agent, (v) => mutate(() => { area.agent = v; }))),
      el('div', { class: 'row' },
        el('button', { class: 'link', onclick: () => startEdit(area) }, 'Ajustar forma'),
        el('button', { class: 'link danger', onclick: () => { map.closePopup(); mutate(() => { state.areas = state.areas.filter((a) => a !== area); }); toast('Área excluída.', undo); } }, 'Excluir área')));
    L.popup().setLatLng(latlng).setContent(root).openOn(map);
  }
  function editHouse(id) { return state.houseEdits[id] = state.houseEdits[id] || {}; }
  function openHousePopup(h, latlng) {
    selectedHouseId = h.id; selectedAreaId = null; scene.redraw();
    const ed = state.houseEdits[h.id] || {};
    const set = (k) => (e) => {
      const val = e.target.value.trim();
      mutate(() => { const r = editHouse(h.id); if (val) r[k] = val; else delete r[k]; if (!Object.keys(r).length) delete state.houseEdits[h.id]; });
    };
    const tipo = el('select', { class: 'field', onchange: (e) => mutate(() => { const r = editHouse(h.id); if (e.target.value === HOUSE_TYPES[0]) delete r.tipo; else r.tipo = e.target.value; }) }, HOUSE_TYPES.map((t) => el('option', { value: t }, t)));
    tipo.value = ed.tipo || HOUSE_TYPES[0];
    const owner = agentSelect(ed.owner, (v) => mutate(() => { const r = editHouse(h.id); if (v === 'auto') delete r.owner; else r.owner = v; }), ['auto', 'Automático (pela área)']);
    const root = el('div', { class: 'pop' },
      el('h3', {}, h.num ? 'Casa nº ' + h.num : 'Casa'),
      el('div', { class: 'meta' }, h.streetName || 'Rua não identificada'),
      el('div', { class: 'row' },
        el('label', {}, 'Número', el('input', { class: 'field', value: ed.num || '', maxLength: 12, onchange: set('num') })),
        el('label', {}, 'Tipo', tipo)),
      el('label', {}, 'Agente responsável', owner),
      el('label', {}, 'Observação', el('input', { class: 'field', value: ed.note || '', maxLength: 200, onchange: set('note') })),
      el('button', { class: 'link danger', style: 'justify-self:start', onclick: () => {
        map.closePopup();
        mutate(() => {
          if (h.added) state.houseAdded = state.houseAdded.filter((x) => x.id !== h.id); else state.houseDeleted.push(h.id);
          delete state.houseEdits[h.id];
        });
        toast('Casa removida.', undo);
      } }, 'Remover do mapa'));
    L.popup().setLatLng(latlng).setContent(root).openOn(map);
  }

  /* Edição da forma */
  function startEdit(area) {
    map.closePopup();
    const a = agentById(area.agent), col = a ? a.color : UNASSIGNED;
    const layer = L.polygon(area.ring, { color: col, fillColor: col, fillOpacity: 0.35, weight: 2 }).addTo(map);
    layer.pm.enable({ allowSelfIntersection: false, snappable: false });
    editing = { area, layer };
    editingId = area.id;
    $('#editBar').hidden = false; $('#hint').hidden = true;
    scene.redraw();
  }
  function finishEdit(apply) {
    if (!editing) return;
    const { area, layer } = editing;
    const ring = layer.getLatLngs()[0].map((c) => [+c.lat.toFixed(6), +c.lng.toFixed(6)]);
    layer.pm.disable(); layer.remove();
    editing = null; editingId = null;
    $('#editBar').hidden = true;
    if (apply && ring.length >= 3) mutate(() => { area.ring = ring; }); else scene.redraw();
    updateHint();
  }

  /* ---------- Painéis ---------- */
  const fmt = (n) => n.toLocaleString('pt-BR');
  function teamsOf() {
    const t = [];
    state.agents.forEach((a) => { if (!t.includes(a.team)) t.push(a.team); });
    return t;
  }
  function selectAgent(id) {
    activeAgent = id;
    $$('.agent').forEach((x) => x.classList.toggle('active', x.dataset.id === id));
    updateHint();
    if (map.pm.globalDrawModeEnabled()) { map.pm.disableDraw(); startDraw(); }
  }
  const openRows = new Set();
  function renderAgents() {
    const list = $('#agentList');
    const top = list.parentElement.scrollTop;
    list.replaceChildren();
    const dl = el('datalist', { id: 'teamOptions' }, teamsOf().map((t) => el('option', { value: t })));
    list.append(dl);
    for (const team of teamsOf()) {
      list.append(el('div', { class: 'team-title' }, team));
      for (const a of state.agents.filter((x) => x.team === team)) list.append(agentRow(a));
    }
    list.parentElement.scrollTop = top;
  }
  function agentRow(a) {
    let snap = false;
    const nAreas = state.areas.filter((x) => x.agent === a.id).length;
    const color = el('input', { type: 'color', class: 'ag-color', value: a.color, title: 'Mudar a cor', 'aria-label': 'Cor de ' + a.name,
      onclick: (e) => e.stopPropagation(),
      oninput: (e) => { if (!snap) { snapshot(); snap = true; } a.color = e.target.value; scene.redraw(); if (tool !== 'select') updateHint(); },
      onchange: () => { snap = false; save(); refreshLegend(); } });
    const name = el('input', { class: 'ag-name', value: a.name, 'aria-label': 'Nome do agente', maxLength: 60,
      onfocus: () => selectAgent(a.id),
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      onchange: (e) => { const v = e.target.value.trim(); if (!v) { e.target.value = a.name; return; } mutate(() => { a.name = v; }, { keepPanel: true }); } });
    const more = el('div', { class: 'ag-more' },
      el('label', {}, 'Equipe ', el('input', { class: 'field', value: a.team, list: 'teamOptions', maxLength: 40, onchange: (e) => { const v = e.target.value.trim(); if (v) mutate(() => { a.team = v; }); } })),
      el('div', {}, nAreas + (nAreas === 1 ? ' área' : ' áreas') + ' · ' + fmt(counts.byAgent[a.id] || 0) + ' casas'),
      el('div', { class: 'links' },
        nAreas ? el('button', { class: 'link', onclick: () => zoomAgent(a.id) }, 'Ver no mapa') : null,
        el('button', { class: 'link danger', onclick: () => removeAgent(a) }, 'Remover agente')));
    more.hidden = !openRows.has(a.id);
    const row = el('div', { class: 'agent' + (a.id === activeAgent ? ' active' : '') + (a.visible ? '' : ' off') },
      el('div', { class: 'ag-row', onclick: () => selectAgent(a.id) },
        color, name,
        el('span', { class: 'ag-count', title: 'Casas' }, fmt(counts.byAgent[a.id] || 0)),
        el('button', { class: 'ag-btn', title: a.visible ? 'Ocultar no mapa' : 'Mostrar no mapa', 'aria-label': 'Mostrar ou ocultar', onclick: (e) => { e.stopPropagation(); mutate(() => { a.visible = !a.visible; }); } }, a.visible ? '◉' : '○'),
        el('button', { class: 'ag-btn', title: 'Mais opções', 'aria-label': 'Mais opções', onclick: (e) => { e.stopPropagation(); if (openRows.has(a.id)) openRows.delete(a.id); else openRows.add(a.id); more.hidden = !openRows.has(a.id); } }, '⋯')),
      more);
    row.dataset.id = a.id;
    return row;
  }
  function removeAgent(a) {
    const n = state.areas.filter((x) => x.agent === a.id).length;
    mutate(() => {
      state.agents = state.agents.filter((x) => x !== a);
      state.areas.forEach((x) => { if (x.agent === a.id) x.agent = null; });
      for (const id in state.houseEdits) if (state.houseEdits[id].owner === a.id) delete state.houseEdits[id].owner;
      if (activeAgent === a.id) activeAgent = state.agents[0] && state.agents[0].id;
    });
    toast(a.name + ' removido' + (n ? '. As áreas ficaram sem agente (cinza).' : '.'), undo);
  }
  function addAgent() {
    const used = state.agents.length;
    const color = hslHex((used * 137.5) % 360, 70, 48);
    const team = (agentById(activeAgent) || {}).team || 'Socialista I';
    const id = 'g' + Date.now().toString(36);
    mutate(() => { state.agents.push({ id, name: 'Novo agente', color, team, visible: true }); });
    selectAgent(id);
    const row = $$('.agent').find((r) => r.dataset.id === id);
    if (row) { row.scrollIntoView({ block: 'center' }); const i = row.querySelector('.ag-name'); i.focus(); i.select(); }
  }
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const f = (n) => { const k = (n + h / 30) % 12, c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  }
  function fitWorld(x0, y0, x1, y1, opts) {
    map.fitBounds([[unmy(y1), x0 * 360 - 180], [unmy(y0), x1 * 360 - 180]], Object.assign({ padding: [24, 24], maxZoom: 18 }, opts));
  }
  function zoomAgent(id) {
    let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
    for (const g of areaGeoms) if (g.area.agent === id) { x0 = Math.min(x0, g.x0); y0 = Math.min(y0, g.y0); x1 = Math.max(x1, g.x1); y1 = Math.max(y1, g.y1); }
    if (x1 > x0) fitWorld(x0, y0, x1, y1);
    closePanelMobile();
  }
  function fitSoc() { const g = socB.rings[0]; fitWorld(g.x0, g.y0, g.x1, g.y1); }
  function territoryBox() {
    let x0 = socB.rings[0].x0, y0 = socB.rings[0].y0, x1 = socB.rings[0].x1, y1 = socB.rings[0].y1;
    for (const g of areaGeoms) { x0 = Math.min(x0, g.x0); y0 = Math.min(y0, g.y0); x1 = Math.max(x1, g.x1); y1 = Math.max(y1, g.y1); }
    return [x0, y0, x1, y1];
  }
  function fitCity() {
    let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
    for (const b of bairros) for (const r of b.rings) { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1); }
    fitWorld(x0, y0, x1, y1);
  }

  let streetFilter = '';
  const streetNames = [...new Set(streets.map((s) => s.n))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function renderStreets() {
    const list = $('#streetList');
    list.replaceChildren();
    const q = fold(streetFilter);
    for (const n of streetNames) {
      if (q && !fold(n).includes(q)) continue;
      const c = counts.byStreet[n] || { n: 0, owners: {} };
      const dots = Object.keys(c.owners).slice(0, 6).map((id) => { const a = agentById(id); const d = el('span', { class: 'dot', title: a ? a.name : '' }); if (a) d.style.background = a.color; return d; });
      list.append(el('button', { class: 'street' + (selectedStreet === n ? ' active' : ''), onclick: () => selectStreet(selectedStreet === n ? null : n, true) },
        el('span', { class: 'nm' }, n), el('span', { class: 'dots' }, dots), el('span', { class: 'ct' }, fmt(c.n))));
    }
  }
  function selectStreet(n, zoom) {
    selectedStreet = n;
    renderStreets();
    if (n && zoom) {
      let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
      for (const s of streets) if (s.n === n) { x0 = Math.min(x0, s.x0); y0 = Math.min(y0, s.y0); x1 = Math.max(x1, s.x1); y1 = Math.max(y1, s.y1); }
      fitWorld(x0, y0, x1, y1, { maxZoom: 18, padding: [80, 80] });
      closePanelMobile();
    }
    scene.redraw();
  }
  function renderSummary() {
    $('#summary').replaceChildren(
      el('span', {}, el('b', {}, fmt(state.agents.length)), ' agentes'),
      el('span', {}, el('b', {}, fmt(houses.length)), ' casas'),
      el('span', {}, el('b', {}, fmt(counts.unassigned)), ' sem agente'));
  }
  function refreshLegend() {
    if (!document.body.classList.contains('clean')) return;
    const box = $('#cleanLegend');
    box.replaceChildren();
    for (const row of legendRows()) {
      if (row.team) box.append(el('div', { class: 't' }, row.team));
      else {
        const s = el('span', { class: 's' }); s.style.background = row.color;
        if (row.round) s.style.borderRadius = '50%';
        box.append(el('div', { class: 'i' }, s, el('span', {}, row.label)));
      }
    }
  }
  function legendRows() {
    const rows = [];
    for (const t of teamsOf()) {
      const ags = state.agents.filter((a) => a.team === t && a.visible && (state.areas.some((x) => x.agent === a.id) || counts.byAgent[a.id]));
      if (!ags.length) continue;
      rows.push({ team: t });
      ags.forEach((a) => rows.push({ color: a.color, label: a.name, n: counts.byAgent[a.id] || 0 }));
    }
    rows.push({ team: 'Mapa' });
    const L_ = state.ui.layers;
    if (L_.health) rows.push({ color: '#d93025', label: 'Unidade de saúde', round: true, kind: 'health' });
    if (L_.schools) rows.push({ color: '#1a56c4', label: 'Escola municipal', round: true, kind: 'school' });
    rows.push({ color: '#c2185b', label: 'Limite do bairro Socialista', line: true });
    if (L_.houses && counts.unassigned) rows.push({ color: UNASSIGNED, label: 'Casa sem agente', n: counts.unassigned });
    return rows;
  }
  function updateStorageInfo() {
    let size = 0;
    try { size = (localStorage.getItem(KEY) || '').length; } catch (e) { /* armazenamento bloqueado */ }
    $('#storageInfo').textContent = (saveOk ? 'Tudo é salvo automaticamente' : 'Atenção: o último salvamento falhou') + ' neste navegador (' + fmt(Math.ceil(size / 1024)) + ' KB). Limpar os dados do navegador apaga o mapa, então baixe um backup de vez em quando.';
  }
  function refresh(opts) {
    rebuild();
    scene.redraw();
    renderSummary();
    if (!opts || !opts.keepPanel) renderAgents();
    renderStreets();
    refreshLegend();
    if (tool !== 'select') updateHint();
  }

  /* ---------- Exportação ---------- */
  function loadTile(url) {
    return new Promise((res) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const t = setTimeout(() => { img.src = ''; res(null); }, 20000);
      img.onload = () => { clearTimeout(t); res(img); };
      img.onerror = () => { clearTimeout(t); res(null); };
      img.src = url;
    });
  }
  async function drawTiles(ctx, v, q) {
    let failed = 0, total = 0;
    for (const l of BASES[state.ui.base].layers) {
      const tz = Math.min(l.native, Math.max(0, Math.ceil(v.z + Math.log2(q) - 0.01)));
      const n = Math.pow(2, tz), size = v.k / n;
      const tx0 = Math.floor(v.ox / size), tx1 = Math.floor((v.ox + v.w) / size);
      const ty0 = Math.floor(v.oy / size), ty1 = Math.floor((v.oy + v.h) / size);
      const jobs = [];
      for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) jobs.push([x, y]);
      let idx = 0;
      const subs = l.sub || '';
      const work = async () => {
        while (idx < jobs.length) {
          const [x, y] = jobs[idx++];
          const url = l.url.replace('{s}', subs ? subs[Math.abs(x + y) % subs.length] : '').replace('{z}', tz).replace('{x}', x).replace('{y}', y).replace('{r}', l.retina && q > 1 ? '@2x' : '');
          total++;
          const img = await loadTile(url);
          if (!img) { failed++; continue; }
          ctx.drawImage(img, x * size - v.ox, y * size - v.oy, size + 0.6, size + 0.6);
        }
      };
      await Promise.all(Array.from({ length: 8 }, work));
    }
    return { failed, total };
  }
  function truncate(ctx, t, w) {
    if (ctx.measureText(t).width <= w) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1);
    return t + '…';
  }
  let exporting = 0;
  async function runExport() {
    const my_ = ++exporting;
    const q = +$('#expQ').value, port = $('#expLayout').value === 'port', legend = $('#expLegend').checked;
    const W = port ? 1131 : 1600, H = port ? 1600 : 1131;
    const headH = 86, footH = 26, sideW = legend && !port ? 300 : 0;
    const rows = legend ? legendRows() : [];
    const cols = 3, colW = (W - 40) / cols, rowH = 21;
    const botH = legend && port ? Math.ceil(rows.length / cols) * rowH + 22 : 0;
    const MW = W - sideW, MH = H - headH - footH - botH;
    const c = $('#expCanvas');
    c.width = W * q; c.height = H * q;
    const ctx = c.getContext('2d');
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

    const frame = $('#expFrame').value;
    let box;
    if (frame === 'view') {
      const b = map.getBounds();
      box = [mx(b.getWest()), my(b.getNorth()), mx(b.getEast()), my(b.getSouth())];
    } else if (frame === 'terr') box = territoryBox();
    else { const g = socB.rings[0]; box = [g.x0, g.y0, g.x1, g.y1]; }
    const padF = frame === 'view' ? 1 : 1.06;
    const k = Math.min(Math.pow(2, 20) * 256, Math.min(MW / ((box[2] - box[0]) * padF), MH / ((box[3] - box[1]) * padF)));
    const v = { k, ox: (box[0] + box[2]) / 2 * k - MW / 2, oy: (box[1] + box[3]) / 2 * k - MH / 2, w: MW, h: MH, z: Math.log2(k / 256) };

    ctx.save();
    ctx.translate(0, headH);
    ctx.beginPath(); ctx.rect(0, 0, MW, MH); ctx.clip();
    ctx.fillStyle = '#e9ecef'; ctx.fillRect(0, 0, MW, MH);
    $('#expMsg').textContent = 'Baixando o mapa de fundo…';
    $('#expPng').disabled = true; $('#expPrint').disabled = true;
    const res = await drawTiles(ctx, v, q);
    if (my_ !== exporting) { ctx.restore(); return; }
    drawScene(ctx, v);
    // escala e norte
    const mPerPx = 40075016.7 * Math.cos(unmy((box[1] + box[3]) / 2) * Math.PI / 180) / k;
    const nice = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((m) => m / mPerPx > 90) || 10000;
    const sbW = nice / mPerPx, sx = 16, sy = MH - 20;
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(sx - 8, sy - 22, sbW + 58, 34);
    ctx.fillStyle = '#111'; ctx.fillRect(sx, sy, sbW, 4);
    ctx.font = '600 12px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(nice >= 1000 ? (nice / 1000) + ' km' : nice + ' m', sx, sy - 6);
    const nx = MW - 34, ny = 44;
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(nx, ny - 8, 22, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(nx, ny - 26); ctx.lineTo(nx + 8, ny - 2); ctx.lineTo(nx, ny - 8); ctx.lineTo(nx - 8, ny - 2); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '700 11px "Segoe UI", Arial, sans-serif'; ctx.fillText('N', nx, ny + 9);
    ctx.restore();

    // cabeçalho
    ctx.fillStyle = '#0b6e75'; ctx.fillRect(0, 0, W, headH);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '700 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText(truncate(ctx, $('#expTitle').value, W - 48), 24, 32);
    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillText(truncate(ctx, $('#expSub').value, W - 48), 24, 63);

    // legenda
    const drawRow = (r, x, y, w) => {
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      if (r.team) {
        ctx.fillStyle = '#5f6c7b'; ctx.font = '700 12px "Segoe UI", Arial, sans-serif';
        ctx.fillText(r.team.toUpperCase(), x, y);
        return;
      }
      if (r.kind) drawMarker(ctx, { kind: r.kind }, x + 9, y, 8);
      else if (r.line) { ctx.strokeStyle = r.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 18, y); ctx.stroke(); }
      else { ctx.fillStyle = r.color; ctx.fillRect(x, y - 7, 18, 14); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.strokeRect(x, y - 7, 18, 14); }
      ctx.fillStyle = '#1f2933'; ctx.font = '13px "Segoe UI", Arial, sans-serif';
      let nw = 0;
      if (r.n != null) {
        const n = fmt(r.n); nw = ctx.measureText(n).width + 8;
        ctx.textAlign = 'right'; ctx.fillStyle = '#5f6c7b'; ctx.fillText(n, x + w, y);
        ctx.textAlign = 'left'; ctx.fillStyle = '#1f2933';
      }
      ctx.fillText(truncate(ctx, r.label, w - 26 - nw), x + 26, y);
    };
    if (legend && !port) {
      const x = MW + 18, w = sideW - 36;
      ctx.fillStyle = '#1f2933'; ctx.font = '700 16px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('Legenda', x, headH + 22);
      ctx.fillStyle = '#5f6c7b'; ctx.font = '12px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('casas no bairro', x + w, headH + 22);
      const avail = MH - 44;
      const step = Math.min(23, avail / (rows.length + rows.filter((r) => r.team).length * 0.3));
      let y = headH + 48;
      for (const r of rows) {
        if (r.team) y += step * 0.3;
        drawRow(r, x, y, w);
        y += step;
      }
    } else if (legend) {
      const top = headH + MH + 16;
      rows.forEach((r, i) => {
        const col = Math.floor(i / Math.ceil(rows.length / cols)), ri = i % Math.ceil(rows.length / cols);
        drawRow(r, 20 + col * colW, top + ri * rowH, colW - 20);
      });
    }

    // rodapé
    ctx.fillStyle = '#5f6c7b'; ctx.font = '11px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const today = new Date().toLocaleDateString('pt-BR');
    ctx.fillText(truncate(ctx, 'Gerado em ' + today + ' · ' + BASES[state.ui.base].attr + ' · ' + DATA_ATTR + ' · Áreas aproximadas', W - 40), 20, H - footH / 2);

    try {
      c.toDataURL('image/png').length; // falha aqui se o canvas ficar contaminado
      $('#expPng').disabled = false; $('#expPrint').disabled = false;
      $('#expMsg').textContent = res.failed ? `${res.failed} de ${res.total} blocos do mapa de fundo não carregaram (sem internet?). O restante foi gerado.` : 'Prévia pronta.';
    } catch (e) {
      $('#expMsg').textContent = 'O navegador bloqueou a exportação do mapa de fundo. Use o Modo print e tire um print da tela.';
    }
  }
  function download(blob, name) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  function printCanvas() {
    const c = $('#expCanvas');
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const port = c.height > c.width;
      const f = el('iframe', { style: 'position:fixed;width:0;height:0;border:0;right:0;bottom:0' });
      document.body.append(f);
      const doc = f.contentDocument;
      doc.open();
      doc.write('<!doctype html><html><head><title>Mapa</title><style>@page{size:A4 ' + (port ? 'portrait' : 'landscape') + ';margin:8mm}html,body{margin:0;height:100%}img{max-width:100%;max-height:100%;display:block;margin:auto}</style></head><body></body></html>');
      doc.close();
      const img = doc.createElement('img');
      img.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); window.focus(); $('#expPrint').focus(); setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000); };
      img.src = url;
      doc.body.append(img);
    }, 'image/png');
  }

  /* ---------- Avisos ---------- */
  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast');
    t.replaceChildren(el('span', {}, msg));
    if (action) t.append(el('button', { onclick: () => { t.hidden = true; action(); } }, 'Desfazer'));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 7000 : 4500);
  }
  function closePanelMobile() { $('#panel').classList.remove('open'); }

  /* ---------- Modo print ---------- */
  function setClean(on) {
    document.body.classList.toggle('clean', on);
    $('#cleanTitle').hidden = !on; $('#cleanLegend').hidden = !on; $('#btnCleanExit').hidden = !on;
    if (on) {
      setTool('select');
      $('#cleanTitle').replaceChildren(el('b', {}, state.title), el('span', {}, state.subtitle));
      refreshLegend();
      toast('Controles ocultos. Tire o print da tela (Win + Shift + S).');
    }
    setTimeout(() => map.invalidateSize(), 0);
  }

  /* ---------- Ligações da interface ---------- */
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  }));
  $$('#tools .tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $$('#baseSwitch button').forEach((b) => b.addEventListener('click', () => { setBase(b.dataset.base); save(); }));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnFitSoc').addEventListener('click', fitSoc);
  $('#btnFitCity').addEventListener('click', fitCity);
  $('#btnFitTerr').addEventListener('click', () => { const b = territoryBox(); fitWorld(b[0], b[1], b[2], b[3]); });
  $('#btnAddAgent').addEventListener('click', addAgent);
  $('#btnOpenPanel').addEventListener('click', () => $('#panel').classList.add('open'));
  $('#btnClosePanel').addEventListener('click', closePanelMobile);
  $('#btnEditDone').addEventListener('click', () => finishEdit(true));
  $('#btnEditCancel').addEventListener('click', () => finishEdit(false));
  $('#btnClean').addEventListener('click', () => setClean(true));
  $('#btnCleanExit').addEventListener('click', () => setClean(false));
  $('#streetSearch').addEventListener('input', (e) => { streetFilter = e.target.value; renderStreets(); });
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
    if (e.key === 'Escape') {
      if (document.body.classList.contains('clean')) setClean(false);
      else if (editing) finishEdit(false);
      else if (tool !== 'select') setTool('select');
    }
  });

  const tog = $('#layerToggles');
  for (const [k, label] of LAYERS) {
    tog.append(el('label', {}, el('input', { type: 'checkbox', checked: state.ui.layers[k], onchange: (e) => { state.ui.layers[k] = e.target.checked; save(); scene.redraw(); refreshLegend(); } }), label));
  }
  $('#opacity').value = state.ui.opacity;
  $('#opacity').addEventListener('input', (e) => { state.ui.opacity = +e.target.value; scene.redraw(); });
  $('#opacity').addEventListener('change', save);

  $('#btnBackup').addEventListener('click', () => download(new Blob([JSON.stringify(state)], { type: 'application/json' }), 'mapa-socialista-backup-' + stamp() + '.json'));
  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const next = sanitize(JSON.parse(await f.text()));
      snapshot();
      state = next;
      activeAgent = state.agents[0] && state.agents[0].id;
      save(); refresh(); setBase(state.ui.base);
      toast('Backup restaurado.', undo);
    } catch (err) { toast('Não foi possível ler este arquivo. Escolha um backup .json gerado por este sistema.'); }
  });
  $('#btnGeoJSON').addEventListener('click', () => {
    const name = (id) => { const a = agentById(id); return a ? a.name : null; };
    const features = [
      ...state.areas.map((a) => ({ type: 'Feature', properties: { camada: 'area', agente: name(a.agent), equipe: (agentById(a.agent) || {}).team || null, cor: (agentById(a.agent) || {}).color || null }, geometry: { type: 'Polygon', coordinates: [[...a.ring, a.ring[0]].map((c) => [c[1], c[0]])] } })),
      ...houses.map((h) => { const ed = state.houseEdits[h.id] || {}; return { type: 'Feature', properties: { camada: 'casa', id: h.id, numero: ed.num || null, tipo: ed.tipo || null, rua: h.streetName || null, agente: name(h.owner), obs: ed.note || null }, geometry: { type: 'Point', coordinates: [+(h.cx * 360 - 180).toFixed(6), +unmy(h.cy).toFixed(6)] } }; }),
    ];
    download(new Blob([JSON.stringify({ type: 'FeatureCollection', features })], { type: 'application/geo+json' }), 'mapa-socialista-' + stamp() + '.geojson');
  });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('Apagar todas as alterações e voltar aos dados iniciais?')) return;
    snapshot();
    const ui = state.ui;
    state = seedState(); state.ui = ui;
    activeAgent = state.agents[0].id;
    save(); refresh();
    toast('Dados iniciais restaurados.', undo);
  });

  const dlg = $('#exportDlg');
  $('#btnExport').addEventListener('click', () => {
    $('#expTitle').value = state.title; $('#expSub').value = state.subtitle;
    dlg.showModal();
    runExport();
  });
  $('#expRun').addEventListener('click', runExport);
  ['#expFrame', '#expLayout', '#expQ', '#expLegend'].forEach((s) => $(s).addEventListener('change', runExport));
  ['#expTitle', '#expSub'].forEach((s) => $(s).addEventListener('change', () => { state.title = $('#expTitle').value; state.subtitle = $('#expSub').value; save(); runExport(); }));
  $('#expPng').addEventListener('click', () => $('#expCanvas').toBlob((b) => download(b, 'mapa-socialista-' + stamp() + '.png'), 'image/png'));
  $('#expPrint').addEventListener('click', printCanvas);

  /* ---------- Início ---------- */
  rebuild();
  scene.addTo(map);
  map.pm.setLang('pt_br');
  fitSoc();
  setBase(state.ui.base === 'sat' ? 'sat' : 'street');
  renderSummary(); renderAgents(); renderStreets(); updateStorageInfo();
  if (loadFailed) toast('Os dados salvos neste navegador não puderam ser lidos. O mapa inicial foi carregado.');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.addEventListener('resize', () => map.invalidateSize());
})();
