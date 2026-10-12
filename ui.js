/* ============================================================
   DÜNYA STRATEJİSİ — Arayüz (ekranlar, harita çizimi, dokunma)
   ============================================================ */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const W = WORLD.W, H = WORLD.H;
  const SAVE_KEY = 'dunya_stratejisi_save_v1';
  const NEUTRAL = '#6b6657';

  const U = {
    era: 0, cid: null, diff: 1,
    view: { x: 0, y: 0, s: 1 },
    sel: null, mode: 'pol', speed: 0, timer: null, pct: 50, order: true,
    dirty: true, mapDirty: true, logSeen: 0, hl: null, tint: null, tintKey: '',
    inGame: false, modalOpen: false, modalStack: []
  };
  let G = null, S = null;

  // --------------------------------------------------------- yardımcılar
  const colorCache = {};
  const rgbCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  rgbCtx.canvas.width = rgbCtx.canvas.height = 1;
  function rgbOf(css) {
    if (colorCache[css]) return colorCache[css];
    rgbCtx.clearRect(0, 0, 1, 1); rgbCtx.fillStyle = css; rgbCtx.fillRect(0, 0, 1, 1);
    const d = rgbCtx.getImageData(0, 0, 1, 1).data;
    return (colorCache[css] = [d[0], d[1], d[2]]);
  }
  const fmt = n => Math.round(n).toLocaleString('tr-TR');
  const f1 = n => (Math.round(n * 10) / 10).toLocaleString('tr-TR');
  const C = id => S.countries[id];
  const me = () => S.countries[S.player];
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dot = c => '<i class="dot" style="background:' + c + '"></i>';

  function toast(msg, ms) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    const box = $('#toasts'); box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 3200);
  }

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  }

  // --------------------------------------------------------- pencere
  function openModal(title, html, big) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').hidden = false; U.modalOpen = true;
    stopTimer();
  }
  function closeModal() {
    $('#modal').hidden = true; U.modalOpen = false; U.modalStack = [];
    if (U.inGame) { refreshAll(); processInbox(); resumeTimer(); }
  }

  // --------------------------------------------------------- harita boyama
  const mapCv = document.createElement('canvas'); mapCv.width = W; mapCv.height = H;
  const mctx = mapCv.getContext('2d');
  let img = null;

  function paintMap(opts) {
    opts = opts || {};
    if (!img) img = mctx.createImageData(W, H);
    const d = img.data, cell = G.cell, edge = G.edge, nb = G.nb;
    const rgb = new Array(G.n), owner = new Array(G.n);
    const sup = (!opts.preview && U.mode === 'sup') ? E.supplySet(S.player) : null;
    for (let i = 0; i < G.n; i++) {
      const p = S.provs[i]; owner[i] = p.o;
      let c = rgbOf(p.o ? S.countries[p.o].color : NEUTRAL).slice();
      const k = 0.9 + 0.035 * p.lvl; c = [c[0] * k, c[1] * k, c[2] * k];
      if (opts.hl !== undefined && opts.hl !== null && p.o !== opts.hl) { c = [c[0] * 0.35 + 40, c[1] * 0.35 + 48, c[2] * 0.35 + 54]; }
      if (sup && p.o === S.player && !sup.has(i)) { c = [c[0] * 0.5 + 110, c[1] * 0.5 + 20, c[2] * 0.5 + 20]; }
      rgb[i] = c;
    }
    for (let idx = 0, n = W * H; idx < n; idx++) {
      const c = cell[idx], o4 = idx * 4;
      if (c === 255) { d[o4 + 3] = 0; continue; }
      const col = rgb[c]; let k = 1;
      const e = edge[idx];
      if (e === 1) k = 0.55;
      else if (e === 2) { k = (owner[nb[idx]] === owner[c]) ? 0.82 : 0.42; }
      d[o4] = col[0] * k; d[o4 + 1] = col[1] * k; d[o4 + 2] = col[2] * k; d[o4 + 3] = 255;
    }
    mctx.putImageData(img, 0, 0);
    U.mapDirty = false;
  }

  // seçim / emir vurgusu
  function makeTint(entries) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'), im = cx.createImageData(W, H), d = im.data, cell = G.cell;
    for (let idx = 0, n = W * H; idx < n; idx++) {
      const c = cell[idx]; if (c === 255) continue;
      const t = entries[c]; if (!t) continue;
      const o = idx * 4; d[o] = t[0]; d[o + 1] = t[1]; d[o + 2] = t[2]; d[o + 3] = t[3];
    }
    cx.putImageData(im, 0, 0); return cv;
  }
  function computeTint() {
    if (U.sel === null || !S) { U.tint = null; return; }
    const ent = {}; ent[U.sel] = [255, 255, 255, 80];
    const sp = S.provs[U.sel];
    if (U.order && sp.o === S.player && sp.t > 0) {
      G.adj[U.sel].forEach(j => {
        const o = S.provs[j].o;
        if (o === S.player || (o && C(o).vassalOf === S.player)) ent[j] = [90, 200, 120, 70];
        else if (o === null || E.atWar(S.player, o)) ent[j] = [230, 70, 60, 85];
        else ent[j] = [240, 170, 60, 60];
      });
    }
    U.tint = makeTint(ent);
  }

  // --------------------------------------------------------- çizim
  const cv = $('#map'), ctx = cv.getContext('2d');
  let cssW = 0, cssH = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cssW = cv.clientWidth; cssH = cv.clientHeight;
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    clampView(); U.dirty = true;
  }
  const minScale = () => Math.min(cssW / W, (cssH - 40) / H);
  function clampView() {
    const v = U.view; v.s = Math.max(minScale(), Math.min(7, v.s));
    const mw = W * v.s, mh = H * v.s;
    if (mw <= cssW) v.x = (cssW - mw) / 2; else v.x = Math.max(cssW - mw - 80, Math.min(80, v.x));
    if (mh <= cssH) v.y = (cssH - mh) / 2 + 18; else v.y = Math.max(cssH - mh - 60, Math.min(60, v.y));
  }
  function centerOn(i, s) {
    const v = U.view; v.s = s || v.s;
    v.x = cssW / 2 - G.cx[i] * v.s; v.y = cssH / 2 - G.cy[i] * v.s; clampView(); U.dirty = true;
  }
  const toWorld = (px, py) => ({ x: (px - U.view.x) / U.view.s, y: (py - U.view.y) / U.view.s });

  function provAt(wx, wy) {
    const x = Math.round(wx), y = Math.round(wy);
    for (let r = 0; r <= 5; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const c = G.cell[yy * W + xx]; if (c !== 255) return c;
      }
    }
    return null;
  }

  function render() {
    if (!U.inGame || !S) return;
    if (U.mapDirty) paintMap();
    if (U.tintKey !== U.sel + '|' + U.order + '|' + (S.turn) + '|' + U.mode) { U.tintKey = U.sel + '|' + U.order + '|' + (S.turn) + '|' + U.mode; computeTint(); }
    const v = U.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e202e'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
    // deniz
    const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#173549'); gr.addColorStop(1, '#0f2433');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1 / v.s; ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 30) { const x = (lon + 180) * W / 360; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let lat = -60; lat <= 80; lat += 20) { const y = (85 - lat) * W / 360; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mapCv, 0, 0);
    if (U.tint) ctx.drawImage(U.tint, 0, 0);
    // ikmal çizgileri
    if (U.mode === 'sup') {
      const sup = E.supplySet(S.player);
      ctx.strokeStyle = 'rgba(240,207,134,0.95)'; ctx.lineWidth = 2 / v.s; ctx.setLineDash([5 / v.s, 4 / v.s]);
      ctx.beginPath();
      sup.forEach((par, i) => { if (par >= 0) { ctx.moveTo(G.cx[par], G.cy[par]); ctx.lineTo(G.cx[i], G.cy[i]); } });
      ctx.stroke(); ctx.setLineDash([]);
    }
    // savaş okları (savaştaki komşu sınırlar)
    // rozetler
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < G.n; i++) {
      const p = S.provs[i];
      const x = G.cx[i] * v.s + v.x, y = G.cy[i] * v.s + v.y;
      if (x < -30 || y < -20 || x > cssW + 30 || y > cssH + 20) continue;
      const mine = p.o === S.player;
      if (!mine && U.sel !== i && G.area[i] * v.s * v.s < 1100) continue;
      const cap = p.o && C(p.o).cap === i;
      const txt = (cap ? '★' : '') + p.t;
      ctx.font = '700 10px system-ui,sans-serif';
      const w = Math.max(22, ctx.measureText(txt).width + 10), h = 15;
      const col = p.o ? C(p.o).color : NEUTRAL;
      ctx.fillStyle = 'rgba(8,16,24,0.88)'; roundRect(ctx, x - w / 2, y - h / 2, w, h, 5); ctx.fill();
      ctx.lineWidth = U.sel === i ? 2 : 1.4; ctx.strokeStyle = U.sel === i ? '#f0cf86' : col; ctx.stroke();
      ctx.fillStyle = '#f2efe4'; ctx.fillText(txt, x, y + 0.5);
      if (v.s > 1.7) {
        ctx.font = '600 9.5px system-ui,sans-serif';
        const nm = PROVS[i].name;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,16,24,0.85)'; ctx.strokeText(nm, x, y + 15);
        ctx.fillStyle = '#e8e4d6'; ctx.fillText(nm, x, y + 15);
      }
    }
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function loop() { if (U.dirty) { U.dirty = false; try { render(); } catch (e) { console.error(e); } } requestAnimationFrame(loop); }

  // --------------------------------------------------------- dokunma
  const ptrs = new Map(); let pinch = null, downInfo = null;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) downInfo = { x: e.clientX, y: e.clientY, t: Date.now(), moved: 0 };
    if (ptrs.size === 2) {
      const [a, b] = Array.from(ptrs.values());
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: U.view.s, w: toWorld(mx, my) };
      if (downInfo) downInfo.moved = 999;
    }
  });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      U.view.x += dx; U.view.y += dy; p.x = e.clientX; p.y = e.clientY;
      if (downInfo) downInfo.moved += Math.abs(dx) + Math.abs(dy);
      clampView(); U.dirty = true;
    } else if (ptrs.size === 2 && pinch) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = Array.from(ptrs.values());
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
      U.view.s = Math.max(minScale(), Math.min(7, pinch.s * d / pinch.d));
      U.view.x = mx - pinch.w.x * U.view.s; U.view.y = my - pinch.w.y * U.view.s;
      clampView(); U.dirty = true;
    }
  });
  function endPtr(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0 && downInfo) {
      if (downInfo.moved < 10 && Date.now() - downInfo.t < 600 && e.type === 'pointerup') onTap(e.clientX - cv.getBoundingClientRect().left, e.clientY - cv.getBoundingClientRect().top);
      downInfo = null;
    }
  }
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, w = toWorld(mx, my);
    U.view.s = Math.max(minScale(), Math.min(7, U.view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    U.view.x = mx - w.x * U.view.s; U.view.y = my - w.y * U.view.s; clampView(); U.dirty = true;
  }, { passive: false });

  function onTap(px, py) {
    if (U.modalOpen) return;
    const w = toWorld(px, py), pi = provAt(w.x, w.y);
    if (pi === null) { select(null); return; }
    if (U.sel !== null && U.order) {
      const sp = S.provs[U.sel];
      if (sp.o === S.player && sp.t > 0 && pi !== U.sel && G.adj[U.sel].has(pi)) { issueOrder(U.sel, pi); return; }
    }
    select(pi);
  }

  function select(pi) {
    U.sel = pi; U.tintKey = ''; U.dirty = true; renderPanel();
  }

  function issueOrder(from, to) {
    const A = S.provs[from], B = S.provs[to];
    const count = Math.max(1, Math.floor(A.t * U.pct / 100));
    const o = B.o;
    const friendly = o === S.player || (o && C(o).vassalOf === S.player);
    if (!friendly && o && !E.atWar(S.player, o)) {
      const why = E.canDeclare(S.player, o);
      if (why) { toast(why); return; }
      openModal('Savaş İlanı',
        '<p><b>' + esc(C(o).name) + '</b> ile savaşta değilsiniz. Savaş ilan edip ' + esc(PROVS[to].name) + ' eyaletine ' + count + ' birlikle saldırılsın mı?</p>' +
        '<p class="hint">Karşı tarafın müttefikleri de savaşa katılabilir. Barış yapılana dek ateşkes olmaz.</p>' +
        '<div class="grid2"><button class="act danger" data-act="war-attack" data-from="' + from + '" data-to="' + to + '" data-n="' + count + '">Savaş ilan et ve saldır</button>' +
        '<button class="act" data-act="close">Vazgeç</button></div>');
      return;
    }
    const r = E.move(S.player, from, to, count);
    toast(r.msg); S.sup = {}; afterAction();
  }

  function afterAction() {
    U.mapDirty = true; U.tintKey = ''; U.dirty = true; refreshHUD(); renderPanel(); flushLog();
    if (S.lost) gameOver();
  }

  // --------------------------------------------------------- HUD
  function refreshHUD() {
    if (!S) return;
    const c = me(), inc = E.income(S.player);
    $('#h-dot').style.background = c.color; $('#h-name').textContent = c.name;
    const net = inc.g * (1 - inc.vassalShare) - inc.upkeep;
    $('#h-gold').textContent = fmt(c.gold); $('#h-mat').textContent = fmt(c.mat); $('#h-man').textContent = fmt(c.man);
    setDelta('#h-gold-d', net); setDelta('#h-mat-d', inc.m * (1 - inc.vassalShare)); setDelta('#h-man-d', inc.n);
    $('#h-date').textContent = MONTHS[S.month - 1] + ' ' + S.year;
    $('#b-play').textContent = U.speed === 0 ? '▶' : '⏸';
    $('#b-speed').textContent = (U.speed || 1) + '×';
    $('#mode-lbl').textContent = U.mode === 'pol' ? 'Siyasi' : 'İkmal';
  }
  function setDelta(sel, v) {
    const el = $(sel); el.textContent = (v >= 0 ? '+' : '') + f1(v); el.className = v >= 0 ? 'pos' : 'neg';
  }
  function refreshAll() { refreshHUD(); renderPanel(); U.dirty = true; }

  // --------------------------------------------------------- yan panel
  function relTags(id) {
    let t = '';
    if (E.atWar(S.player, id)) t += '<span class="tag war">Savaşta</span>';
    if (E.allied(S.player, id)) t += '<span class="tag ally">Müttefik</span>';
    if (C(id).vassalOf === S.player) t += '<span class="tag vas">Vassalınız</span>';
    if (me().vassalOf === id) t += '<span class="tag vas">Efendiniz</span>';
    return t;
  }

  function renderPanel() {
    const pn = $('#panel');
    if (U.sel === null || !S) { pn.hidden = true; return; }
    const i = U.sel, p = S.provs[i], P = PROVS[i];
    const own = p.o === S.player, oc = p.o ? C(p.o) : null;
    const sup = p.o ? E.supplySet(p.o).has(i) : true;
    let h = '<button class="close" data-act="deselect">✕</button><h3>' + (oc && oc.cap === i ? '★ ' : '') + esc(P.name) + '</h3>';
    h += '<div class="own">' + (oc ? dot(oc.color) + esc(oc.name) : dot(NEUTRAL) + 'Sahipsiz bölge') + '</div>';
    if (oc && !own) h += '<div>' + relTags(p.o) + '</div>';
    h += '<div class="chips">' +
      '<div class="chip"><small>Birlik</small><b>' + p.t + '</b></div>' +
      '<div class="chip"><small>Arazi savunması</small><b>×' + P.terr.toFixed(1) + '</b></div>' +
      '<div class="chip"><small>Nüfus / Zenginlik</small><b>' + P.pop + ' / ' + P.wealth + '</b></div>' +
      '<div class="chip"><small>Hammadde</small><b>' + P.mat + '</b></div>' +
      '<div class="chip"><small>Kalkınma</small><b>' + p.lvl + '/5</b></div>' +
      '<div class="chip"><small>Tahkimat</small><b>' + p.fort + '/3</b></div></div>';
    if (oc) h += '<div class="hint">İkmal: ' + (sup ? '✅ bağlı' : '⚠️ kopuk (üretim yarım, birlik eriyor)') + '</div>';

    if (own) {
      const c = me(), k = E.recruitCost(c), ic = E.investCost(p), fc = E.fortCost(p);
      const can = n => c.gold >= k.g * n && c.mat >= k.m * n && c.man >= n && sup;
      h += '<div class="sec"><small>Birlik topla (' + esc(ERAS[S.eraIdx].unit) + ') — 1 birlik: ' + f1(k.g) + '💰 ' + f1(k.m) + '⛏ 1👥</small><div class="grid3">';
      [1, 5, 10].forEach(n => { h += '<button class="act" data-act="recruit" data-n="' + n + '"' + (can(n) ? '' : ' disabled') + '>+' + n + '</button>'; });
      h += '</div></div>';
      h += '<div class="sec"><div class="grid2">' +
        '<button class="act" data-act="invest"' + (p.lvl >= 5 || c.gold < ic.g || c.mat < ic.m ? ' disabled' : '') + '>Kalkındır<small>' + (p.lvl >= 5 ? 'azami' : ic.g + '💰 ' + ic.m + '⛏') + '</small></button>' +
        '<button class="act" data-act="fortify"' + (p.fort >= 3 || c.gold < fc.g || c.mat < fc.m ? ' disabled' : '') + '>Tahkim et<small>' + (p.fort >= 3 ? 'azami' : fc.g + '💰 ' + fc.m + '⛏') + '</small></button></div></div>';
      h += '<div class="sec"><small>Hareket / saldırı emri</small><div class="grid2">' +
        '<button class="act wide ' + (U.order ? 'on' : '') + '" data-act="order">' + (U.order ? 'Emir modu AÇIK' : 'Emir modu kapalı') + '<small>' + (U.order ? 'Renkli komşuya dokun' : 'Dokunmak sadece inceler') + '</small></button></div>' +
        '<div class="grid3" style="margin-top:5px">' + [25, 50, 75].map(v => '<button class="act ' + (U.pct === v ? 'on' : '') + '" data-act="pct" data-v="' + v + '">%' + v + '</button>').join('') + '</div>' +
        '<div class="grid2" style="margin-top:5px"><button class="act wide ' + (U.pct === 100 ? 'on' : '') + '" data-act="pct" data-v="100">Tümü (%100)</button></div>' +
        '<div class="hint" style="margin-top:6px">🟢 taşı · 🔴 saldır · 🟠 savaş ilanı gerekir</div></div>';
    } else if (oc) {
      h += '<div class="sec"><div class="grid2">';
      h += '<button class="act wide" data-act="diplo-with" data-id="' + p.o + '">Diplomasi: ' + esc(oc.name) + '</button>';
      h += '</div></div>';
      h += '<div class="hint" style="margin-top:6px">Saldırmak için komşu eyaletinizi seçip bu eyalete dokunun.</div>';
    } else {
      h += '<div class="hint" style="margin-top:8px">Sahipsiz bölge. Komşu eyaletinizden birlik göndererek ilhak edebilirsiniz.</div>';
    }
    pn.innerHTML = h; pn.hidden = false;
  }

  // --------------------------------------------------------- tur akışı
  function stopTimer() { if (U.timer) { clearTimeout(U.timer); U.timer = null; } }
  const DELAY = [0, 1700, 800, 330];
  function resumeTimer() {
    stopTimer();
    if (!U.inGame || U.speed === 0 || U.modalOpen || !S || S.lost) return;
    U.timer = setTimeout(() => { U.timer = null; doTurn(); resumeTimer(); }, DELAY[U.speed]);
  }
  function doTurn() {
    E.endTurn(); S = E.state; S.sup = {};
    U.mapDirty = true; U.tintKey = ''; U.dirty = true;
    refreshHUD(); renderPanel(); flushLog();
    if (S.turn % 8 === 0) save(true);
    if (S.lost) { gameOver(); return; }
    processInbox();
  }
  function flushLog() {
    for (; U.logSeen < S.log.length; U.logSeen++) { const l = S.log[U.logSeen]; if (l.imp) toast(l.text, 3800); }
  }

  function processInbox() {
    if (!S || U.modalOpen) return;
    while (S.inbox.length) {
      const it = S.inbox.shift();
      if (it.type === 'war') { if (C(it.from).alive) toast('⚔ ' + C(it.from).name + ' size savaş ilan etti!', 4500); continue; }
      if (it.type === 'peace') {
        if (!C(it.from).alive || !E.atWar(S.player, it.from)) continue;
        openModal('Barış Teklifi',
          '<p><b>' + esc(C(it.from).name) + '</b> savaştan yorgun düştü ve size <b>beyaz barış</b> (kimse bir şey almaz) teklif ediyor.</p>' +
          '<div class="grid2"><button class="act" data-act="accept-peace" data-id="' + it.from + '">Kabul et</button><button class="act" data-act="close">Reddet</button></div>');
        return;
      }
      if (it.type === 'victory') {
        openModal('🏆 ZAFER!',
          '<p>Kendi toprağınız ve vassallarınızla dünyanın <b>%40</b>\'ını kontrol ediyorsunuz. Hükmünüz tarihe geçti.</p>' +
          '<div class="grid2"><button class="act" data-act="close">Oynamaya devam et</button><button class="act" data-act="to-title">Ana menü</button></div>');
        return;
      }
    }
  }
  function gameOver() {
    stopTimer(); U.speed = 0;
    openModal('Yenilgi', '<p>Son eyaletinizi de kaybettiniz. Devletiniz tarihe karıştı.</p><div class="grid2"><button class="act" data-act="to-era">Yeni senaryo</button><button class="act" data-act="to-title">Ana menü</button></div>');
  }

  // --------------------------------------------------------- kayıt
  function save(auto) {
    try { localStorage.setItem(SAVE_KEY, E.serialize()); if (!auto) toast('Oyun kaydedildi.'); updateContinue(); } catch (e) { toast('Kaydedilemedi.'); }
  }
  function updateContinue() { $('#btn-continue').style.display = localStorage.getItem(SAVE_KEY) ? '' : 'none'; }
  function loadSave() {
    const j = localStorage.getItem(SAVE_KEY); if (!j) return;
    try { E.load(j); S = E.state; enterGame(false); } catch (e) { toast('Kayıt okunamadı.'); }
  }

  // --------------------------------------------------------- oyun girişi
  function enterGame(fresh) {
    S = E.state; U.inGame = true; U.sel = null; U.logSeen = fresh ? 0 : S.log.length;
    U.speed = 0; U.mode = 'pol'; U.mapDirty = true; U.tintKey = '';
    showScreen('s-game'); resize();
    U.view.s = Math.max(1.5, minScale());
    centerOn(me().cap, U.view.s);
    refreshAll(); flushLog();
    toast(ERAS[S.eraIdx].name + ' — ' + me().name);
    $('#panel').hidden = true;
    U.dirty = true;
  }

  // --------------------------------------------------------- Çağ / ülke seçimi
  function buildEraScreen() {
    $('#era-list').innerHTML = ERAS.map((e, i) =>
      '<button class="era" data-act="pick-era" data-i="' + i + '"><span class="ic">' + e.icon + '</span><h3>' + esc(e.name) + '</h3>' +
      '<span class="yr">' + e.year + '</span><p>' + esc(e.desc) + '</p><small>' + e.countries.length + ' ülke · 1 tur = ' + e.months + ' ay</small></button>').join('');
  }
  function buildCountryScreen() {
    const era = ERAS[U.era];
    E.newGame(U.era, era.countries[0][0], U.diff); S = E.state;
    $('#country-title').textContent = era.name + ' · ' + era.year;
    const rows = era.countries.map(c => ({ c, pw: E.power(c[0]), n: c[3].length }));
    rows.sort((a, b) => b.pw - a.pw);
    $('#country-list').innerHTML = rows.map(r =>
      '<button class="row" data-act="pick-country" data-id="' + r.c[0] + '">' + dot(S.countries[r.c[0]].color) +
      '<span class="nm"><b>' + esc(r.c[1]) + '</b><small>' + r.n + ' eyalet · ×' + r.c[4].toFixed(1) + ' eko · ×' + r.c[5].toFixed(1) + ' ask</small></span></button>').join('');
    U.cid = rows[0].c[0]; showCountryDetail();
  }
  function showCountryDetail() {
    const era = ERAS[U.era], d = era.countries.find(c => c[0] === U.cid), c = S.countries[U.cid];
    $$('#country-list .row').forEach(r => r.classList.toggle('sel', r.dataset.id === U.cid));
    const inc = E.income(U.cid);
    const allies = c.allies.map(a => S.countries[a].name), wars = c.wars.map(a => S.countries[a].name);
    $('#country-detail').innerHTML =
      '<h3>' + esc(d[1]) + '</h3>' +
      '<canvas id="prev" width="500" height="205"></canvas>' +
      '<div class="stats">' +
      '<div class="stat"><small>Eyalet</small><b>' + d[3].length + '</b></div>' +
      '<div class="stat"><small>Ekonomi çarpanı</small><b>×' + d[4].toFixed(1) + '</b></div>' +
      '<div class="stat"><small>Askeri çarpan</small><b>×' + d[5].toFixed(1) + '</b></div>' +
      '<div class="stat"><small>Gelir / tur</small><b>' + f1(inc.g) + '💰</b></div>' +
      '<div class="stat"><small>Birlik</small><b>' + fmt(E.totalTroops(U.cid)) + '</b></div>' +
      '<div class="stat"><small>Güç sırası</small><b>#' + (Object.keys(S.countries).filter(k => E.power(k) > E.power(U.cid)).length + 1) + '</b></div></div>' +
      '<div class="hint">' + (allies.length ? 'İttifak: ' + esc(allies.join(', ')) + '. ' : '') + (wars.length ? 'Savaşta: ' + esc(wars.join(', ')) + '.' : 'Başlangıçta savaşta değil.') + '</div>' +
      '<div class="hint" style="margin-top:6px">Zorluk (yapay zekâ kaynak çarpanı)</div>' +
      '<div class="seg">' + ['Kolay', 'Normal', 'Zor'].map((n, i) => '<button data-act="diff" data-i="' + i + '" class="' + (U.diff === i ? 'on' : '') + '">' + n + '</button>').join('') + '</div>' +
      '<button class="btn primary" style="width:100%" data-act="start">Bu ülkeyle başla</button>';
    drawPreview();
  }
  function drawPreview() {
    paintMap({ hl: U.cid, preview: true });
    const pc = $('#prev'); if (!pc) return;
    const x = pc.getContext('2d'); x.fillStyle = '#12293a'; x.fillRect(0, 0, pc.width, pc.height);
    x.imageSmoothingEnabled = true; x.drawImage(mapCv, 0, 0, pc.width, pc.height);
  }

  // --------------------------------------------------------- Teknoloji penceresi
  function techModal() {
    const c = me(), era = ERAS[S.eraIdx];
    let h = '<p class="hint">Her dalda iki seviye vardır; ikinci seviye için birincisini tamamlayın. Aynı anda tek araştırma yapılır.</p>';
    if (c.res) {
      const total = E.techTime(c.res.idx);
      h += '<p><b>Araştırılıyor:</b> ' + esc(era.techs[c.res.idx][0]) + ' — ' + c.res.left + ' tur kaldı</p><div class="bar2"><i style="width:' + Math.round((total - c.res.left) / total * 100) + '%"></i></div>';
    }
    h += '<div class="techs">';
    [['Askeri', [0, 1]], ['Ekonomi', [2, 3]], ['Toplum', [4, 5]]].forEach(([nm, ids]) => {
      h += '<div class="tcol"><h4>' + nm + '</h4>';
      ids.forEach(idx => {
        const done = c.done.indexOf(idx) >= 0, cur = c.res && c.res.idx === idx, av = E.techAvailable(c, idx);
        const eff = TECH_EFFECTS[idx], parts = [];
        if (eff.atk) parts.push('Saldırı +%' + Math.round(eff.atk * 100));
        if (eff.def) parts.push('Savunma +%' + Math.round(eff.def * 100));
        if (eff.eco) parts.push('Gelir +%' + Math.round(eff.eco * 100));
        if (eff.rec) parts.push('Asker maliyeti −%' + Math.round(eff.rec * 100));
        if (eff.man) parts.push('İnsan gücü +%' + Math.round(eff.man * 100));
        h += '<div class="tech ' + (done ? 'done' : cur ? 'cur' : '') + '"><b>' + esc(era.techs[idx][0]) + '</b><small>' + esc(era.techs[idx][1]) + '<br>' + parts.join(' · ') + '</small>';
        if (done) h += '<span class="tag ally">Tamamlandı</span>';
        else if (cur) h += '<span class="tag vas">Araştırılıyor</span>';
        else h += '<button class="act wide" style="width:100%" data-act="research" data-i="' + idx + '"' + (!av || c.res || c.gold < E.techCost(idx) ? ' disabled' : '') + '>' + (av ? E.techCost(idx) + '💰 · ' + E.techTime(idx) + ' tur' : 'Önce önceki seviye') + '</button>';
        h += '</div>';
      });
      h += '</div>';
    });
    h += '</div>';
    openModal('Teknoloji — ' + era.name, h);
  }

  // --------------------------------------------------------- Diplomasi
  function neighborSet() {
    const set = new Set();
    E.provsOf(S.player).forEach(i => G.adj[i].forEach(j => { const o = S.provs[j].o; if (o && o !== S.player) set.add(o); }));
    return set;
  }
  function diploList() {
    const nbs = neighborSet(), myP = E.power(S.player) + 1;
    const ids = Object.keys(S.countries).filter(id => id !== S.player && C(id).alive);
    ids.sort((a, b) => {
      const sa = (E.atWar(S.player, a) ? 1000 : 0) + (nbs.has(a) ? 500 : 0) + E.power(a);
      const sb = (E.atWar(S.player, b) ? 1000 : 0) + (nbs.has(b) ? 500 : 0) + E.power(b);
      return sb - sa;
    });
    let h = '<p class="hint">Komşular ve savaştakiler üstte. Ülkeye dokunarak diplomasi seçeneklerini açın.</p><div class="plist">';
    ids.forEach(id => {
      const c = C(id), op = Math.round(E.opGet(id, S.player)), pr = E.power(id) / myP;
      h += '<button class="row" data-act="diplo-with" data-id="' + id + '">' + dot(c.color) + '<span class="nm"><b>' + esc(c.name) + '</b><small>' + E.provsOf(id).length + ' eyalet · güç ' + (pr >= 1 ? '▲' : '▼') + ' ' + f1(pr) + '× · ilişki ' + op + (nbs.has(id) ? ' · komşu' : '') + '</small></span><span>' + relTags(id) + '</span></button>';
    });
    h += '</div>';
    openModal('Diplomasi', h);
  }

  function diploWith(id) {
    const c = C(id), war = E.atWar(S.player, id), al = E.allied(S.player, id), vas = c.vassalOf === S.player;
    const pw = E.power(id) / (E.power(S.player) + 1);
    let h = '<div class="own">' + dot(c.color) + '<b>' + esc(c.name) + '</b>&nbsp;' + relTags(id) + '</div>' +
      '<div class="stats"><div class="stat"><small>Eyalet</small><b>' + E.provsOf(id).length + '</b></div><div class="stat"><small>Birlik</small><b>' + fmt(E.totalTroops(id)) + '</b></div><div class="stat"><small>İlişki</small><b>' + Math.round(E.opGet(id, S.player)) + '</b></div>' +
      '<div class="stat"><small>Göreli güç</small><b>' + f1(pw) + '×</b></div><div class="stat"><small>Çarpanlar</small><b>' + c.econ.toFixed(1) + ' / ' + c.mil.toFixed(1) + '</b></div><div class="stat"><small>Teknoloji</small><b>' + c.done.length + '/6</b></div></div>';
    if (c.vassalOf && !vas) h += '<p class="hint">Bu ülke ' + esc(C(c.vassalOf).name) + ' devletinin vassalı.</p>';
    h += '<div class="grid2">';
    if (war) {
      h += '<button class="act wide" data-act="peace-ui" data-id="' + id + '">🕊 Barış görüşmesi</button>';
    } else {
      const why = E.canDeclare(S.player, id);
      h += '<button class="act danger" data-act="declare" data-id="' + id + '"' + (why ? ' disabled' : '') + '>⚔ Savaş ilan et<small>' + (why ? esc(why) : 'Müttefikler katılabilir') + '</small></button>';
      if (al) h += '<button class="act" data-act="breakally" data-id="' + id + '">İttifakı boz</button>';
      else h += '<button class="act" data-act="ally" data-id="' + id + '">🤝 İttifak öner</button>';
      h += '<button class="act" data-act="swap-ui" data-id="' + id + '">🔁 Eyalet takası</button>';
    }
    if (vas) h += '<button class="act" data-act="release" data-id="' + id + '">Vassalı serbest bırak</button>';
    h += '</div>';
    if (!war) {
      h += '<h4>Hediye gönder (ilişkileri artırır)</h4><div class="grid3">' + [20, 50, 100].map(v => '<button class="act" data-act="gift" data-id="' + id + '" data-v="' + v + '"' + (me().gold < v ? ' disabled' : '') + '>' + v + '💰</button>').join('') + '</div>';
    }
    h += '<div style="margin-top:12px"><button class="btn sm" data-act="diplo">‹ Ülke listesi</button></div>';
    openModal('Diplomasi — ' + c.name, h);
  }

  function peaceUI(id) {
    const c = C(id);
    const theirs = E.provsOf(id), mine = E.provsOf(S.player);
    let h = '<p>' + esc(c.name) + ' ile barış şartlarını belirleyin. <span id="peace-chance" class="tag"></span></p>' +
      '<label class="chk"><input type="checkbox" id="pc-vas"> <span>Vassal yap (gelirinin %25\'i size akar)</span></label>' +
      '<label class="chk"><input type="checkbox" id="pc-gold"> <span>Tazminat iste: <b>' + fmt(Math.min(c.gold, 9999)) + '💰</b> (kasasındakinin tamamı)</span></label>' +
      '<h4>Talep edilen eyaletler</h4><div>' + (theirs.map(i => '<label class="chk"><input type="checkbox" class="pc-d" value="' + i + '"> <span>' + esc(PROVS[i].name) + ' <small class="hint">(' + S.provs[i].t + ' birlik)</small></span></label>').join('') || '<span class="hint">Yok</span>') + '</div>' +
      '<h4>Verilecek eyaletler</h4><div>' + (mine.map(i => '<label class="chk"><input type="checkbox" class="pc-g" value="' + i + '"> <span>' + esc(PROVS[i].name) + '</span></label>').join('') || '<span class="hint">Yok</span>') + '</div>' +
      '<div class="grid2" style="margin-top:10px"><button class="act" data-act="peace-send" data-id="' + id + '">Teklifi gönder</button><button class="act" data-act="diplo-with" data-id="' + id + '">Geri</button></div>' +
      '<p class="hint" style="margin-top:8px">Hiçbir şey seçmezseniz beyaz barış teklif edersiniz. Savaşı kazanıyorsanız (fethettiğiniz eyaletler çoksa) şartlarınız kabul edilir.</p>';
    openModal('Barış — ' + c.name, h);
    updatePeaceChance(id);
  }
  function peaceTerms() {
    const t = { demand: [], give: [], vassal: !!($('#pc-vas') && $('#pc-vas').checked) };
    $$('.pc-d').forEach(x => { if (x.checked) t.demand.push(+x.value); });
    $$('.pc-g').forEach(x => { if (x.checked) t.give.push(+x.value); });
    return t;
  }
  function updatePeaceChance(id) {
    const t = peaceTerms(); if ($('#pc-gold') && $('#pc-gold').checked) t.gold = Math.min(C(id).gold, 9999);
    const r = E.evalPeace(S.player, id, t), el = $('#peace-chance'); if (!el) return;
    el.textContent = r.accept ? 'Kabul edebilir' : (r.score < -10 ? 'Çok zor' : 'Zor');
    el.className = 'tag ' + (r.accept ? 'ally' : 'war');
  }

  function swapUI(id) {
    const theirs = E.provsOf(id), mine = E.provsOf(S.player);
    let h = '<p>Değer = nüfus + zenginlik + hammadde. Karşı taraf, aldığı eyaletin değeri verdiğinden en az %10 yüksekse takas yapar.</p>' +
      '<h4>Vereceğiniz eyalet</h4><select id="sw-a">' + mine.map(i => '<option value="' + i + '">' + esc(PROVS[i].name) + ' (değer ' + E.val(i) + ')</option>').join('') + '</select>' +
      '<h4>İstediğiniz eyalet</h4><select id="sw-b">' + theirs.map(i => '<option value="' + i + '">' + esc(PROVS[i].name) + ' (değer ' + E.val(i) + ')</option>').join('') + '</select>' +
      '<div class="grid2" style="margin-top:12px"><button class="act" data-act="swap-send" data-id="' + id + '">Takas öner</button><button class="act" data-act="diplo-with" data-id="' + id + '">Geri</button></div>';
    openModal('Eyalet Takası — ' + C(id).name, h);
  }

  // --------------------------------------------------------- Ülkem, olaylar, menü, yardım
  function myCountryModal() {
    const c = me(), inc = E.income(S.player), prs = E.provsOf(S.player);
    const rank = Object.keys(S.countries).filter(k => C(k).alive).sort((a, b) => E.power(b) - E.power(a));
    const allies = c.allies.map(a => C(a).name).join(', ') || '—', wars = c.wars.map(a => C(a).name).join(', ') || '—';
    const vas = Object.keys(S.countries).filter(k => C(k).alive && C(k).vassalOf === S.player).map(k => C(k).name).join(', ') || '—';
    const sup = E.supplySet(S.player);
    let h = '<div class="kv"><span>Eyalet</span><span>' + prs.length + ' / ' + G.n + '</span>' +
      '<span>Ekonomi · Askeri çarpan</span><span>×' + c.econ.toFixed(1) + ' · ×' + c.mil.toFixed(1) + '</span>' +
      '<span>Altın (net / tur)</span><span>' + fmt(c.gold) + ' (' + (inc.g * (1 - inc.vassalShare) - inc.upkeep >= 0 ? '+' : '') + f1(inc.g * (1 - inc.vassalShare) - inc.upkeep) + ')</span>' +
      '<span>Hammadde (tur)</span><span>' + fmt(c.mat) + ' (+' + f1(inc.m * (1 - inc.vassalShare)) + ')</span>' +
      '<span>İnsan gücü (tur)</span><span>' + fmt(c.man) + ' (+' + f1(inc.n) + ')</span>' +
      '<span>Birlik · bakım gideri</span><span>' + fmt(E.totalTroops(S.player)) + ' · ' + f1(inc.upkeep) + '💰</span>' +
      '<span>İkmale bağlı eyalet</span><span>' + sup.size + ' / ' + prs.length + '</span>' +
      '<span>Saldırı · Savunma bonusu</span><span>+%' + Math.round(c.tech.atk * 100) + ' · +%' + Math.round(c.tech.def * 100) + '</span>' +
      '<span>Gelir · İnsan gücü bonusu</span><span>+%' + Math.round(c.tech.eco * 100) + ' · +%' + Math.round(c.tech.man * 100) + '</span>' +
      '<span>Müttefikler</span><span>' + esc(allies) + '</span><span>Savaşlar</span><span>' + esc(wars) + '</span><span>Vassallar</span><span>' + esc(vas) + '</span></div>';
    h += '<h4>Güç sıralaması</h4><div class="plist">' + rank.slice(0, 10).map((id, i) => '<div class="row">' + dot(C(id).color) + '<span class="nm"><b>' + (i + 1) + '. ' + esc(C(id).name) + (id === S.player ? ' (siz)' : '') + '</b><small>' + E.provsOf(id).length + ' eyalet · ' + fmt(E.totalTroops(id)) + ' birlik</small></span></div>').join('') + '</div>';
    h += '<p class="hint" style="margin-top:8px">Zafer: kendi eyaletleriniz + vassallarınızla dünyanın %40\'ını kontrol edin.</p>';
    openModal(c.name, h);
  }
  function logModal() {
    const rows = S.log.slice(-60).reverse().map(l => '<div class="logrow"><small>' + MONTHS[l.m - 1] + ' ' + l.y + '</small>' + esc(l.text) + '</div>').join('');
    openModal('Olaylar', rows || '<p class="hint">Henüz olay yok.</p>');
  }
  function menuModal() {
    openModal('Menü',
      '<div class="grid2"><button class="act" data-act="save">💾 Kaydet</button><button class="act" data-act="mycountry">📊 Ülkem</button>' +
      '<button class="act" data-act="help">❓ Nasıl oynanır</button><button class="act danger" data-act="to-title">🏠 Ana menü</button></div>' +
      '<p class="hint" style="margin-top:10px">Oyun her 8 turda bir kendiliğinden kaydedilir.</p>');
  }
  function helpModal() {
    openModal('Nasıl Oynanır',
      '<h4>Amaç</h4><p>Kendi eyaletlerinizle ve vassallarınızla dünyanın %40\'ını kontrol edin. Tüm eyaletlerinizi kaybederseniz oyun biter.</p>' +
      '<h4>Harita</h4><p>Tek parmakla kaydırın, iki parmakla yakınlaştırın. Bir eyalete dokunarak bilgi alın. Rozetteki sayı o eyaletteki birlik sayısıdır, ★ başkenti gösterir.</p>' +
      '<h4>Ordu</h4><p>Kendi eyaletinizi seçin, <b>Birlik topla</b> ile asker alın (altın, hammadde ve insan gücü harcar). Emir modu açıkken renkli komşu eyalete dokunun: yeşil = birlik taşı, kırmızı = saldır, turuncu = önce savaş ilan et. Yüzde düğmeleriyle ne kadar birlik göndereceğinizi seçin.</p>' +
      '<h4>İkmal ve cephe</h4><p>Eyaletler başkente kendi toprağınız üzerinden bağlı kalmalıdır. Bağlantısı kopan eyaletlerde üretim yarıya iner, birlikler erir, saldırı gücü düşer ve asker toplanamaz. 🗺 düğmesiyle İkmal haritasını açıp yolları görün. Tahkimat ve arazi savunmayı güçlendirir.</p>' +
      '<h4>Kaynaklar</h4><p>Altın askerlerin bakımını ve yatırımları karşılar; hammadde askere alma ve kalkınma içindir; insan gücü nüfustan yenilenir. Kalkındırarak üretimi artırın.</p>' +
      '<h4>Teknoloji</h4><p>Her çağın kendi 6 teknolojisi vardır: askeri, ekonomi ve toplum dalları.</p>' +
      '<h4>Diplomasi</h4><p>Savaş ilan edin, ittifak kurun, hediye gönderin, eyalet takas edin. Savaşta rakibi yeterince ezdiyseniz barışta eyalet talep edebilir veya onu vassal yapabilirsiniz. Vassallar gelirlerinin %25\'ini efendilerine öder.</p>' +
      '<h4>Zaman</h4><p>▶ oyunu başlatır, 1×/2×/3× hızı değiştirir, ⏭ tek tur ilerletir. Bir tur çağa göre 1–6 aydır.</p>');
  }

  // --------------------------------------------------------- olay yönlendirme
  function act(name, el) {
    const d = el ? el.dataset : {};
    switch (name) {
      case 'new': buildEraScreen(); showScreen('s-era'); break;
      case 'continue': loadSave(); break;
      case 'help': helpModal(); break;
      case 'to-title': U.inGame = false; stopTimer(); $('#modal').hidden = true; U.modalOpen = false; updateContinue(); showScreen('s-title'); break;
      case 'to-era': U.inGame = false; stopTimer(); $('#modal').hidden = true; U.modalOpen = false; buildEraScreen(); showScreen('s-era'); break;
      case 'pick-era': U.era = +d.i; buildCountryScreen(); showScreen('s-country'); break;
      case 'pick-country': U.cid = d.id; showCountryDetail(); break;
      case 'diff': U.diff = +d.i; showCountryDetail(); break;
      case 'start': E.newGame(U.era, U.cid, U.diff); enterGame(true); break;
      case 'close': closeModal(); break;
      case 'deselect': select(null); break;
      case 'playpause': U.speed = U.speed === 0 ? 1 : 0; refreshHUD(); resumeTimer(); break;
      case 'speed': U.speed = U.speed >= 3 ? 1 : U.speed + 1; refreshHUD(); resumeTimer(); break;
      case 'next': if (U.speed === 0) doTurn(); break;
      case 'menu': menuModal(); break;
      case 'save': save(false); break;
      case 'mycountry': myCountryModal(); break;
      case 'tech': techModal(); break;
      case 'diplo': diploList(); break;
      case 'diplo-with': diploWith(d.id); break;
      case 'log': logModal(); break;
      case 'mapmode': U.mode = U.mode === 'pol' ? 'sup' : 'pol'; U.mapDirty = true; U.tintKey = ''; refreshHUD(); U.dirty = true;
        toast(U.mode === 'sup' ? 'İkmal haritası: kırmızı eyaletlerin bağlantısı kopuk' : 'Siyasi harita'); break;
      case 'gocap': centerOn(me().cap, Math.max(U.view.s, 1.6)); break;
      case 'order': U.order = !U.order; U.tintKey = ''; renderPanel(); U.dirty = true; break;
      case 'pct': U.pct = +d.v; renderPanel(); break;
      case 'recruit': { const r = E.recruit(S.player, U.sel, +d.n); if (!r.ok) toast(r.msg); afterAction(); break; }
      case 'invest': { const r = E.invest(S.player, U.sel); toast(r.msg); afterAction(); break; }
      case 'fortify': { const r = E.fortify(S.player, U.sel); toast(r.msg); afterAction(); break; }
      case 'war-attack': {
        const o = S.provs[+d.to].o; const w = E.declareWar(S.player, o);
        $('#modal').hidden = true; U.modalOpen = false;
        if (!w.ok) { toast(w.msg); } else { const r = E.move(S.player, +d.from, +d.to, +d.n); toast(r.msg); }
        S.sup = {}; afterAction(); resumeTimer(); break;
      }
      case 'research': { const r = E.startResearch(S.player, +d.i); toast(r.msg); refreshHUD(); techModal(); break; }
      case 'declare': { const r = E.declareWar(S.player, d.id); toast(r.msg); refreshHUD(); diploWith(d.id); flushLog(); U.mapDirty = true; U.dirty = true; break; }
      case 'ally': { const r = E.proposeAlliance(S.player, d.id); toast(r.msg); diploWith(d.id); flushLog(); break; }
      case 'breakally': { const r = E.breakAlliance(S.player, d.id); toast(r.msg); diploWith(d.id); break; }
      case 'release': { const r = E.release(S.player, d.id); toast(r.msg); diploWith(d.id); break; }
      case 'gift': { const r = E.gift(S.player, d.id, +d.v); toast(r.msg); refreshHUD(); diploWith(d.id); break; }
      case 'peace-ui': peaceUI(d.id); break;
      case 'peace-send': {
        const t = peaceTerms(); if ($('#pc-gold').checked) t.gold = Math.min(C(d.id).gold, 9999);
        const r = E.proposePeace(S.player, d.id, t); toast(r.msg);
        if (r.ok) { U.mapDirty = true; U.tintKey = ''; U.dirty = true; refreshHUD(); flushLog(); diploWith(d.id); } break;
      }
      case 'swap-ui': swapUI(d.id); break;
      case 'swap-send': {
        const r = E.swap(S.player, d.id, +$('#sw-a').value, +$('#sw-b').value); toast(r.msg);
        if (r.ok) { U.mapDirty = true; U.tintKey = ''; U.dirty = true; diploWith(d.id); } break;
      }
      case 'accept-peace': { const r = E.proposePeace(S.player, d.id, {}); /* AI teklif etti: bedelsiz kabul */
        if (!r.ok) { E.applyPeace(S.player, d.id, {}); }
        toast('Barış imzalandı.'); closeModal(); U.mapDirty = true; U.dirty = true; flushLog(); break; }
    }
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    act(el.dataset.act, el);
  });
  document.addEventListener('change', e => {
    if (e.target.closest('#modal-body') && ($('#peace-chance'))) {
      const b = document.querySelector('[data-act="peace-send"]'); if (b) updatePeaceChance(b.dataset.id);
    }
  });

  // --------------------------------------------------------- başlangıç
  function paintTitleBg() {
    const bg = $('#bg'); bg.width = W; bg.height = H;
    const x = bg.getContext('2d'), im = x.createImageData(W, H), d = im.data;
    for (let i = 0, n = W * H; i < n; i++) {
      const c = G.cell[i], o = i * 4;
      if (c === 255) { d[o] = 14; d[o + 1] = 32; d[o + 2] = 46; d[o + 3] = 255; }
      else { const e = G.edge[i] === 2 ? 0.7 : 1; d[o] = 120 * e; d[o + 1] = 140 * e; d[o + 2] = 150 * e; d[o + 3] = 255; }
    }
    x.putImageData(im, 0, 0);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTimer(); if (U.inGame && S && !S.lost) save(true); U.speed = 0; if (U.inGame) refreshHUD(); } });
  document.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('load', () => {
    setTimeout(() => {
      E.buildGeo(); G = E.G;
      paintTitleBg(); updateContinue();
      $('#loading').style.display = 'none';
      showScreen('s-title');
      requestAnimationFrame(loop);
    }, 40);
  });
})();
