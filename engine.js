/* ============================================================
   DÜNYA STRATEJİSİ — Oyun motoru (arayüzden bağımsız)
   ============================================================ */
const E = (function () {
  const W = WORLD.W, H = WORLD.H;
  const G = {};            // sabit coğrafya
  let S = null;            // oyun durumu
  const PI = {};           // eyalet id -> indeks
  PROVS.forEach((p, i) => PI[p.id] = i);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const val = i => PROVS[i].pop + PROVS[i].wealth + PROVS[i].mat;

  function lonlat(lon, lat) { return [(lon + 180) * W / 360, (85 - lat) * W / 360]; }

  function hashColor(id) {
    if (COLORS[id]) return COLORS[id];
    let h = 7; for (const ch of id) h = (h * 37 + ch.charCodeAt(0) * 13) % 360;
    return 'hsl(' + h + ',48%,52%)';
  }

  function rasterize(polys) {
    const m = new Uint8Array(W * H);
    polys.forEach(flat => {
      const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push(lonlat(flat[i], flat[i + 1]));
      for (let y = 0; y < H; y++) {
        const yc = y + 0.5, xs = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
          for (let x = x0; x <= x1; x++) m[y * W + x] = 1;
        }
      }
    });
    return m;
  }

  // ---------------------------------------------------------- COĞRAFYA
  function buildGeo() {
    if (G.cell) return;
    const n = PROVS.length;
    G.n = n; G.W = W; G.H = H;
    G.px = new Float32Array(n); G.py = new Float32Array(n); G.pr = new Float32Array(n);
    PROVS.forEach((p, i) => { const [x, y] = lonlat(p.lon, p.lat); G.px[i] = x; G.py[i] = y; G.pr[i] = p.r; });
    const land = rasterize(LAND), sea = rasterize(SEAS);
    const cell = new Uint8Array(W * H).fill(255);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!land[y * W + x] || sea[y * W + x]) continue;
        const xx = x + Math.sin(x * 0.05 + y * 0.031) * 3 + Math.sin(y * 0.11 + x * 0.017) * 2;
        const yy = y + Math.sin(y * 0.047 - x * 0.029 + 1) * 3 + Math.sin(x * 0.09 + y * 0.06) * 2;
        let best = 1e9, bi = -1;
        for (let i = 0; i < n; i++) {
          const dx = xx - G.px[i], dy = yy - G.py[i];
          const d = Math.sqrt(dx * dx + dy * dy) - G.pr[i];
          if (d < best) { best = d; bi = i; }
        }
        cell[y * W + x] = bi;
      }
    }
    G.cell = cell;
    // kenarlar + komşuluk + merkez noktaları
    const edge = new Uint8Array(W * H);          // 0 yok, 1 kıyı, 2 eyalet sınırı
    const nb = new Int16Array(W * H).fill(-1);   // sınırın öteki tarafındaki eyalet
    const cnt = {}, sx = new Float64Array(n), sy = new Float64Array(n), sc = new Float64Array(n);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = cell[y * W + x];
        if (a === 255) continue;
        sx[a] += x; sy[a] += y; sc[a]++;
        const nbs = [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]];
        for (let k = 0; k < 4; k++) {
          const nx = nbs[k][0], ny = nbs[k][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) { edge[y * W + x] = 1; continue; }
          const b = cell[ny * W + nx];
          if (b === 255) { edge[y * W + x] = 1; }
          else if (b !== a) {
            if (edge[y * W + x] === 0) { edge[y * W + x] = 2; nb[y * W + x] = b; }
            if (k < 2) { const key = a < b ? a * 256 + b : b * 256 + a; cnt[key] = (cnt[key] || 0) + 1; }
          }
        }
      }
    }
    G.edge = edge; G.nb = nb; G.area = sc;
    G.cx = new Float32Array(n); G.cy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (sc[i] > 0) { G.cx[i] = sx[i] / sc[i]; G.cy[i] = sy[i] / sc[i]; } else { G.cx[i] = G.px[i]; G.cy[i] = G.py[i]; }
    }
    G.adj = Array.from({ length: n }, () => new Set());
    for (const k in cnt) {
      if (cnt[k] >= 3) { const a = k >> 8, b = k & 255; G.adj[a].add(b); G.adj[b].add(a); }
    }
    SEA_LINKS.forEach(([a, b]) => {
      const i = PI[a], j = PI[b];
      if (i !== undefined && j !== undefined) { G.adj[i].add(j); G.adj[j].add(i); }
    });
  }

  // ---------------------------------------------------------- YARDIMCI
  const stepF = () => ERAS[S.eraIdx].months / 3;
  const C = id => S.countries[id];
  function log(text, imp) { S.log.push({ t: S.turn, y: S.year, m: S.month, text, imp: !!imp }); if (S.log.length > 300) S.log.shift(); }
  const isPlayer = id => id === S.player;
  const opGet = (a, b) => (C(a).op[b] || 0);
  function opAdd(a, b, v) { C(a).op[b] = clamp(opGet(a, b) + v, -100, 100); }
  const atWar = (a, b) => C(a).wars.indexOf(b) >= 0;
  const allied = (a, b) => C(a).allies.indexOf(b) >= 0;
  const key = (a, b) => a < b ? a + '|' + b : b + '|' + a;

  function provsOf(cid) { const r = []; for (let i = 0; i < S.provs.length; i++) if (S.provs[i].o === cid) r.push(i); return r; }
  function totalTroops(cid) { let t = 0; for (const p of S.provs) if (p.o === cid) t += p.t; return t; }

  function ensureCapital(c) {
    if (S.provs[c.cap] && S.provs[c.cap].o === c.id) return;
    let best = -1, bv = -1;
    for (let i = 0; i < S.provs.length; i++) if (S.provs[i].o === c.id) { const v = val(i) + S.provs[i].lvl; if (v > bv) { bv = v; best = i; } }
    if (best >= 0) { c.cap = best; if (isPlayer(c.id)) log('Başkent ' + PROVS[best].name + ' eyaletine taşındı.', true); }
  }

  // İkmal: başkentten kendi topraklar üzerinden ulaşılabilen eyaletler
  function supplySet(cid) {
    if (S.sup[cid]) return S.sup[cid];
    const c = C(cid), res = new Map();
    ensureCapital(c);
    if (S.provs[c.cap].o !== cid) { S.sup[cid] = res; return res; }
    const q = [c.cap]; res.set(c.cap, -1);
    while (q.length) {
      const u = q.shift();
      G.adj[u].forEach(v => {
        if (!res.has(v) && S.provs[v].o === cid) { res.set(v, u); q.push(v); }
      });
    }
    S.sup[cid] = res; return res;
  }

  function recruitCost(c) {
    const e = S.eraIdx, d = 1 - c.tech.rec;
    return { g: +(2 + e * 0.7) * d, m: +(1 + e * 0.4) * d, n: 1 };
  }

  function income(cid) {
    const c = C(cid), sup = supplySet(cid), f = stepF();
    let g = 0, m = 0, n = 0, pop = 0;
    for (let i = 0; i < S.provs.length; i++) {
      const p = S.provs[i]; if (p.o !== cid) continue;
      const P = PROVS[i], mult = (0.6 + 0.2 * p.lvl) * (sup.has(i) ? 1 : 0.5);
      g += P.wealth * mult; m += P.mat * mult * 0.6; n += P.pop * 0.5 * (sup.has(i) ? 1 : 0.5); pop += P.pop;
    }
    const dm = 2.2 * ((cid !== S.player) ? [0.8, 1, 1.25][S.diff] : 1);
    g *= c.econ * (1 + c.tech.eco) * f * dm; m *= c.econ * (1 + c.tech.eco) * f * dm; n *= (1 + c.tech.man) * f * dm;
    const upkeep = totalTroops(cid) * 0.1 * (1 + S.eraIdx * 0.25) * f;
    // vassal haracı
    let tribute = 0;
    for (const id in S.countries) { const v = C(id); if (v.alive && v.vassalOf === cid) tribute += 0.25; }
    return { g, m, n, upkeep, maxMan: pop * 12 * (1 + c.tech.man), vassalShare: c.vassalOf ? 0.25 : 0 };
  }

  function power(cid) {
    const c = C(cid); let t = 0;
    for (const p of S.provs) if (p.o === cid) t += p.t;
    const inc = income(cid);
    return t * c.mil * (1 + c.tech.atk + c.tech.def) + inc.g * 2;
  }

  // ---------------------------------------------------------- YENİ OYUN
  function newGame(eraIdx, cid, diff) {
    buildGeo();
    const era = ERAS[eraIdx];
    S = { eraIdx, year: era.year, month: 1, turn: 0, diff: diff || 1, player: cid, provs: [], countries: {},
      log: [], inbox: [], won: false, lost: false, warStart: {}, sup: {}, version: 1 };
    for (let i = 0; i < G.n; i++) {
      const P = PROVS[i];
      S.provs.push({ o: null, t: Math.round(1 + P.wealth * 0.7 + P.terr), lvl: 1, fort: 0, core: null });
    }
    era.countries.forEach(([id, name, cap, provs, econ, mil]) => {
      S.countries[id] = { id, name, color: hashColor(id), cap: PI[cap], econ, mil, gold: 0, mat: 0, man: 0,
        tech: { atk: 0, def: 0, eco: 0, man: 0, rec: 0 }, done: [], res: null, wars: [], allies: [], vassalOf: null,
        truce: {}, op: {}, alive: true, ai: id !== cid };
      provs.forEach(pid => {
        const k = PI[pid]; if (k === undefined) throw new Error('Bilinmeyen eyalet: ' + pid);
        if (S.provs[k].o) throw new Error('Çift sahip: ' + pid + ' (' + era.id + ')');
        S.provs[k].o = id; S.provs[k].core = id;
        const P = PROVS[k];
        S.provs[k].t = Math.max(2, Math.round((P.pop + P.wealth) * 0.8 * mil));
      });
    });
    for (const id in S.countries) {
      const c = C(id), inc = income(id);
      c.gold = Math.round(inc.g * 5 + 30); c.mat = Math.round(inc.m * 5 + 20); c.man = Math.round(inc.n * 4 + 10);
    }
    const ids = Object.keys(S.countries);
    ids.forEach(a => ids.forEach(b => { if (a !== b) C(a).op[b] = Math.round(rnd(-12, 12)); }));
    era.alliances.forEach(grp => {
      for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) {
        const a = grp[i], b = grp[j]; if (!C(a) || !C(b)) continue;
        C(a).allies.push(b); C(b).allies.push(a); C(a).op[b] = 60; C(b).op[a] = 60;
      }
    });
    era.wars.forEach(([a, b]) => {
      if (!C(a) || !C(b)) return;
      C(a).wars.push(b); C(b).wars.push(a); S.warStart[key(a, b)] = 0;
      C(a).op[b] = -60; C(b).op[a] = -60;
    });
    log(era.name + ' başladı. ' + C(cid).name + ' yönetimini devraldınız.', true);
    E.state = S; return S;
  }

  // ---------------------------------------------------------- HAREKET & SAVAŞ
  function fail(msg, code) { return { ok: false, msg, code }; }
  function ok(msg, extra) { return Object.assign({ ok: true, msg }, extra || {}); }

  function move(cid, from, to, count) {
    const A = S.provs[from], B = S.provs[to];
    if (A.o !== cid) return fail('Bu eyalet size ait değil.');
    if (!G.adj[from].has(to)) return fail('Eyaletler komşu değil.');
    count = Math.min(count, A.t);
    if (count < 1) return fail('Hareket edecek birlik yok.');
    const c = C(cid);
    if (B.o === cid || (B.o && C(B.o).vassalOf === cid)) {
      A.t -= count; B.t += count;
      return ok(count + ' birlik ' + PROVS[to].name + ' eyaletine taşındı.');
    }
    if (B.o && !atWar(cid, B.o)) return fail('Bu ülkeyle savaşta değilsiniz.', 'needwar');
    const sup = supplySet(cid);
    const supMul = sup.has(from) ? 1 : 0.6;
    const att = count * c.mil * (1 + c.tech.atk) * supMul * rnd(0.9, 1.1);
    const dc = B.o ? C(B.o) : null;
    const dmil = dc ? dc.mil * (1 + dc.tech.def) : 0.8;
    const dsup = dc ? (supplySet(B.o).has(to) ? 1 : 0.8) : 1;
    const def = Math.max(0.5, B.t) * dmil * dsup * PROVS[to].terr * (1 + 0.15 * B.fort) * 1.15 * rnd(0.9, 1.1);
    A.t -= count;
    const prevOwner = B.o;
    if (att > def) {
      const surv = Math.max(1, Math.round(count * (1 - Math.min(0.9, def / att * 0.85))));
      capture(to, cid, surv, prevOwner);
      return ok(PROVS[to].name + ' fethedildi! (' + surv + ' birlik kaldı)', { won: true });
    } else {
      B.t = Math.max(1, Math.round(B.t * (1 - att / def * 0.85)));
      return ok('Saldırı püskürtüldü. ' + PROVS[to].name + ' savunması ' + B.t + ' birliğe düştü.', { won: false });
    }
  }

  function capture(to, cid, troops, prev) {
    const B = S.provs[to], c = C(cid);
    B.o = cid; B.t = troops; B.lvl = Math.max(1, B.lvl - 1); B.fort = 0;
    S.sup = {};
    c.gold += val(to) * 1.5;
    if (prev) {
      const dc = C(prev);
      if (isPlayer(prev)) log(PROVS[to].name + ' ' + c.name + ' tarafından fethedildi!', true);
      else if (isPlayer(cid)) log(PROVS[to].name + ' fethedildi (' + dc.name + ').', true);
      if (provsOf(prev).length === 0) destroy(prev, cid);
      else ensureCapital(dc);
    } else if (isPlayer(cid)) log(PROVS[to].name + ' bölgesi ilhak edildi.', false);
  }

  function destroy(id, by) {
    const dc = C(id); dc.alive = false; dc.wars.forEach(w => { C(w).wars = C(w).wars.filter(x => x !== id); });
    dc.wars = [];
    dc.allies.forEach(a => { C(a).allies = C(a).allies.filter(x => x !== id); }); dc.allies = [];
    for (const k in S.countries) { if (C(k).vassalOf === id) C(k).vassalOf = null; }
    S.inbox = S.inbox.filter(x => x.from !== id);
    log(dc.name + ' tarihe karıştı' + (by ? ' (' + C(by).name + ' tarafından yıkıldı)' : '') + '.', true);
    if (isPlayer(id)) { S.lost = true; }
  }

  // ---------------------------------------------------------- EKONOMİ EYLEMLERİ
  function recruit(cid, pi, n) {
    const c = C(cid), p = S.provs[pi];
    if (p.o !== cid) return fail('Bu eyalet size ait değil.');
    if (!supplySet(cid).has(pi)) return fail('İkmal hattı kopuk: birlik toplanamaz.');
    const k = recruitCost(c);
    n = Math.floor(n);
    if (n < 1) return fail('Geçersiz miktar.');
    if (c.gold < k.g * n) return fail('Yetersiz altın.');
    if (c.mat < k.m * n) return fail('Yetersiz hammadde.');
    if (c.man < n) return fail('Yetersiz insan gücü.');
    c.gold -= k.g * n; c.mat -= k.m * n; c.man -= n; p.t += n;
    return ok(n + ' birlik toplandı.');
  }
  const investCost = p => ({ g: 15 + 12 * p.lvl, m: 4 * p.lvl });
  function invest(cid, pi) {
    const c = C(cid), p = S.provs[pi];
    if (p.o !== cid) return fail('Bu eyalet size ait değil.');
    if (p.lvl >= 5) return fail('Azami kalkınma seviyesi.');
    const k = investCost(p);
    if (c.gold < k.g || c.mat < k.m) return fail('Yetersiz kaynak.');
    c.gold -= k.g; c.mat -= k.m; p.lvl++;
    return ok(PROVS[pi].name + ' kalkındı (Sv. ' + p.lvl + ').');
  }
  const fortCost = p => ({ g: 20 * (p.fort + 1), m: 10 * (p.fort + 1) });
  function fortify(cid, pi) {
    const c = C(cid), p = S.provs[pi];
    if (p.o !== cid) return fail('Bu eyalet size ait değil.');
    if (p.fort >= 3) return fail('Azami tahkimat seviyesi.');
    const k = fortCost(p);
    if (c.gold < k.g || c.mat < k.m) return fail('Yetersiz kaynak.');
    c.gold -= k.g; c.mat -= k.m; p.fort++;
    return ok(PROVS[pi].name + ' tahkim edildi (Sv. ' + p.fort + ').');
  }

  // ---------------------------------------------------------- TEKNOLOJİ
  const techCost = idx => Math.round((60 + 30 * S.eraIdx) * (idx % 2 ? 1.8 : 1));
  const techTime = idx => 3 + (idx % 2) * 2;
  function techAvailable(c, idx) {
    if (c.done.indexOf(idx) >= 0) return false;
    if (idx % 2 === 1 && c.done.indexOf(idx - 1) < 0) return false;
    return true;
  }
  function startResearch(cid, idx) {
    const c = C(cid);
    if (c.res) return fail('Zaten bir araştırma sürüyor.');
    if (!techAvailable(c, idx)) return fail('Bu teknoloji araştırılamaz.');
    const cost = techCost(idx);
    if (c.gold < cost) return fail('Yetersiz altın.');
    c.gold -= cost; c.res = { idx, left: techTime(idx) };
    return ok('Araştırma başladı: ' + ERAS[S.eraIdx].techs[idx][0]);
  }
  function finishResearch(c) {
    const idx = c.res.idx; c.res = null; c.done.push(idx);
    const e = TECH_EFFECTS[idx]; for (const k in e) c.tech[k] += e[k];
    if (isPlayer(c.id)) log('Teknoloji tamamlandı: ' + ERAS[S.eraIdx].techs[idx][0], true);
  }

  // ---------------------------------------------------------- DİPLOMASİ
  function canDeclare(a, b) {
    if (a === b) return 'Geçersiz.';
    if (!C(b).alive) return 'Ülke yok.';
    if (atWar(a, b)) return 'Zaten savaştasınız.';
    if (allied(a, b)) return 'Müttefike savaş açılamaz. Önce ittifakı bozun.';
    if (C(a).vassalOf === b || C(b).vassalOf === a) return 'Vassal ilişkisi var.';
    if (C(a).vassalOf) return 'Vassal devlet savaş ilan edemez.';
    if ((C(a).truce[b] || 0) > 0) return 'Ateşkes sürüyor (' + C(a).truce[b] + ' tur).';
    return null;
  }
  function addWar(a, b) {
    if (atWar(a, b)) return;
    C(a).wars.push(b); C(b).wars.push(a); S.warStart[key(a, b)] = S.turn;
    opAdd(a, b, -50); opAdd(b, a, -50);
  }
  function declareWar(a, b) {
    const why = canDeclare(a, b);
    if (why) return fail(why);
    addWar(a, b);
    log(C(a).name + ', ' + C(b).name + ' devletine savaş ilan etti!', true);
    // müttefikler ve vassallar
    const joinD = [], joinA = [];
    for (const id in S.countries) {
      const x = C(id); if (!x.alive || id === a || id === b) continue;
      const defSide = allied(id, b) || x.vassalOf === b;
      const attSide = allied(id, a) || x.vassalOf === a;
      if (defSide && !attSide) joinD.push(id);
      else if (attSide && !defSide && x.ai && Math.random() < 0.6) joinA.push(id);
    }
    joinD.forEach(id => { if (!allied(id, a) && !(C(id).vassalOf === a)) { addWar(id, a); log(C(id).name + ' (' + C(b).name + ' müttefiki) savaşa katıldı.', isPlayer(id) || isPlayer(a)); } });
    joinA.forEach(id => { if (!allied(id, b)) { addWar(id, b); log(C(id).name + ' (' + C(a).name + ' müttefiki) savaşa katıldı.', isPlayer(b)); } });
    if (isPlayer(b)) S.inbox.push({ type: 'war', from: a });
    return ok(C(b).name + ' devletine savaş ilan edildi.');
  }

  function warPressure(ai, enemy) {
    // ai'nin bakış açısından: pozitif = ai kaybediyor
    let loss = 0, gain = 0;
    for (let i = 0; i < S.provs.length; i++) {
      const p = S.provs[i];
      if (p.core === ai && p.o && p.o !== ai && (p.o === enemy || C(p.o).vassalOf === enemy || allied(p.o, enemy))) loss += val(i);
      if (p.core === enemy && (p.o === ai || (p.o && C(p.o).vassalOf === ai))) gain += val(i);
    }
    const len = S.turn - (S.warStart[key(ai, enemy)] || 0);
    const weary = Math.max(0, len * stepF() - 6) * 0.4;
    const tr = totalTroops(ai) + 1, te = totalTroops(enemy) + 1;
    const mil = (te / tr > 2) ? 6 : (tr / te > 2 ? -6 : 0);
    return loss - gain + weary + mil;
  }
  function totalValue(cid) { let t = 0; provsOf(cid).forEach(i => t += val(i)); return t; }

  // terms: {demand:[prov], vassal:bool, gold:n, give:[prov]} — a istiyor, b'ye teklif ediyor
  function evalPeace(a, b, terms) {
    terms = terms || {};
    const pressure = warPressure(b, a);
    let cost = 0, benefit = 0;
    (terms.demand || []).forEach(i => cost += val(i));
    if (terms.vassal) cost += totalValue(b) * 0.55;
    cost += (terms.gold || 0) / 10;
    (terms.give || []).forEach(i => benefit += val(i));
    benefit += (terms.pay || 0) / 10;
    const score = pressure + benefit - cost;
    return { accept: score >= -3, score, pressure, cost, benefit };
  }
  function applyPeace(a, b, terms) {
    terms = terms || {};
    C(a).wars = C(a).wars.filter(x => x !== b); C(b).wars = C(b).wars.filter(x => x !== a);
    C(a).truce[b] = 8; C(b).truce[a] = 8;
    (terms.demand || []).forEach(i => { if (S.provs[i].o === b) { S.provs[i].o = a; } });
    (terms.give || []).forEach(i => { if (S.provs[i].o === a) { S.provs[i].o = b; } });
    if (terms.gold) { const g = Math.min(terms.gold, C(b).gold); C(b).gold -= g; C(a).gold += g; }
    if (terms.pay) { const g = Math.min(terms.pay, C(a).gold); C(a).gold -= g; C(b).gold += g; }
    if (terms.vassal) { C(b).vassalOf = a; C(b).allies.forEach(x => { C(x).allies = C(x).allies.filter(y => y !== b); }); C(b).allies = []; }
    S.sup = {};
    [a, b].forEach(x => { if (C(x).alive) { if (provsOf(x).length === 0) destroy(x, x === a ? b : a); else ensureCapital(C(x)); } });
    opAdd(a, b, 15); opAdd(b, a, 15);
    log(C(a).name + ' ve ' + C(b).name + ' arasında barış imzalandı' + (terms.vassal ? ' (' + C(b).name + ' vassal oldu)' : '') + '.', isPlayer(a) || isPlayer(b));
  }
  function proposePeace(a, b, terms) {
    if (!atWar(a, b)) return fail('Savaşta değilsiniz.');
    const r = evalPeace(a, b, terms);
    if (!r.accept) return fail(C(b).name + ' teklifinizi reddetti' + (r.score < -10 ? ' (kendini üstün görüyor).' : '.'));
    applyPeace(a, b, terms);
    return ok('Barış anlaşması kabul edildi.');
  }

  function proposeAlliance(a, b) {
    if (a === b) return fail('Geçersiz.');
    if (atWar(a, b)) return fail('Savaş halindeyken ittifak kurulamaz.');
    if (allied(a, b)) return fail('Zaten müttefiksiniz.');
    if (C(b).vassalOf || C(a).vassalOf) return fail('Vassal devletler ittifak kuramaz.');
    let shared = 0; C(a).wars.forEach(w => { if (atWar(b, w)) shared++; });
    const pa = power(a), pb = power(b);
    const score = opGet(b, a) + shared * 25 + (pa > pb ? 8 : -4) + (isFinite(pa / pb) && pa / pb > 3 ? -10 : 0);
    if (score < 30) return fail(C(b).name + ' ittifak teklifini reddetti (ilişkiler: ' + opGet(b, a) + ').');
    C(a).allies.push(b); C(b).allies.push(a); opAdd(a, b, 15); opAdd(b, a, 15);
    log(C(a).name + ' ve ' + C(b).name + ' ittifak kurdu.', isPlayer(a) || isPlayer(b));
    return ok('İttifak kuruldu.');
  }
  function breakAlliance(a, b) {
    if (!allied(a, b)) return fail('Müttefik değilsiniz.');
    C(a).allies = C(a).allies.filter(x => x !== b); C(b).allies = C(b).allies.filter(x => x !== a);
    opAdd(b, a, -35); log(C(a).name + ', ' + C(b).name + ' ile ittifakı bozdu.', isPlayer(a) || isPlayer(b));
    return ok('İttifak bozuldu.');
  }
  function gift(a, b, amt) {
    const c = C(a);
    if (c.gold < amt) return fail('Yetersiz altın.');
    c.gold -= amt; C(b).gold += amt; opAdd(b, a, Math.round(amt / 4) + 3); opAdd(a, b, 2);
    return ok(C(b).name + ' ile ilişkiler iyileşti.');
  }
  function swap(a, b, pa, pb) {
    if (S.provs[pa].o !== a || S.provs[pb].o !== b) return fail('Geçersiz eyalet.');
    if (atWar(a, b)) return fail('Savaş halindeyken takas yapılamaz.');
    if (opGet(b, a) < -20) return fail(C(b).name + ' sizinle takas yapmak istemiyor.');
    if (val(pa) < val(pb) * 1.1) return fail(C(b).name + ' bu takası dengesiz buldu (değerinizi artırın).');
    S.provs[pa].o = b; S.provs[pb].o = a; S.sup = {};
    if (S.provs[pa].core === a) { /* core kalır */ }
    opAdd(b, a, 5); ensureCapital(C(a)); ensureCapital(C(b));
    return ok('Eyalet takası tamamlandı.');
  }
  function release(a, b) {
    if (C(b).vassalOf !== a) return fail('Vassalınız değil.');
    C(b).vassalOf = null; opAdd(b, a, 30); return ok(C(b).name + ' bağımsız bırakıldı.');
  }

  // ---------------------------------------------------------- YAPAY ZEKÂ
  function aiTurn(c) {
    const owned = provsOf(c.id); if (!owned.length) return;
    const sup = supplySet(c.id);
    // araştırma
    if (!c.res) {
      for (const idx of [0, 2, 4, 1, 3, 5]) {
        if (techAvailable(c, idx) && c.gold > techCost(idx) + 25) { startResearch(c.id, idx); break; }
      }
    }
    // cephe hatları
    const enemyAdj = (i) => { let r = []; G.adj[i].forEach(j => { const o = S.provs[j].o; if (o !== c.id && (!o || atWar(c.id, o))) r.push(j); }); return r; };
    const frontOwned = owned.filter(i => enemyAdj(i).length > 0);
    // savaş ilanı
    if (!c.vassalOf) {
      const f = stepF();
      if (c.wars.length < 2 && Math.random() < 0.022 * Math.min(1.5, Math.max(0.5, f)) * (S.diff === 2 ? 1.5 : S.diff === 0 ? 0.6 : 1)) {
        const my = power(c.id); let best = null, bs = 0;
        owned.forEach(i => G.adj[i].forEach(j => {
          const o = S.provs[j].o; if (!o || o === c.id) return;
          if (canDeclare(c.id, o)) return;
          const r = my / (power(o) + 1);
          const sc = r * (1 - opGet(c.id, o) / 200) * (o === S.player ? (S.diff === 2 ? 1.2 : 0.8) : 1);
          if (r > 1.5 && sc > bs) { bs = sc; best = o; }
        }));
        if (best) declareWar(c.id, best);
      }
    }
    // askere alma
    const k = recruitCost(c);
    const reserveG = 15, reserveM = 8;
    let budget = Math.floor(Math.min((c.gold - reserveG) / k.g, (c.mat - reserveM) / k.m, c.man));
    if (budget > 0) {
      const targets = (frontOwned.length ? frontOwned : owned).filter(i => sup.has(i));
      if (targets.length) {
        const per = Math.max(1, Math.ceil(budget / targets.length));
        for (const i of targets) { if (budget <= 0) break; const n = Math.min(per, budget); const r = recruit(c.id, i, n); if (r.ok) budget -= n; }
      }
      if (c.gold > 120 && Math.random() < 0.3) { const i = owned[Math.floor(Math.random() * owned.length)]; invest(c.id, i); }
    }
    // cepheye uzaklık (birlik kaydırma)
    const dist = new Map(); const q = [];
    frontOwned.forEach(i => { dist.set(i, 0); q.push(i); });
    while (q.length) { const u = q.shift(); G.adj[u].forEach(v => { if (S.provs[v].o === c.id && !dist.has(v)) { dist.set(v, dist.get(u) + 1); q.push(v); } }); }
    // saldırılar ve hareket
    const order = owned.slice().sort(() => Math.random() - 0.5);
    for (const i of order) {
      const p = S.provs[i]; if (p.o !== c.id || p.t < 2) continue;
      const tg = enemyAdj(i);
      if (tg.length && !c.vassalOf || (tg.length && c.vassalOf)) {
        let best = -1, br = 0;
        tg.forEach(j => {
          const B = S.provs[j]; const dc = B.o ? C(B.o) : null;
          const d = Math.max(0.5, B.t) * (dc ? dc.mil * (1 + dc.tech.def) : 0.8) * PROVS[j].terr * (1 + 0.15 * B.fort) * 1.15;
          const a = p.t * 0.85 * c.mil * (1 + c.tech.atk) * (sup.has(i) ? 1 : 0.6);
          const r = a / d;
          const pri = r * (B.o ? 1.1 : 1) * (1 + val(j) / 30);
          if (r > 1.5 && pri > br) { br = pri; best = j; }
        });
        if (best >= 0) {
          const keep = Math.ceil(p.t * 0.15);
          const o = S.provs[best].o;
          if (o === null && c.vassalOf) continue;
          move(c.id, i, best, p.t - keep);
        }
      } else if (dist.has(i) && dist.get(i) > 0) {
        let nxt = -1, nd = dist.get(i);
        G.adj[i].forEach(j => { if (S.provs[j].o === c.id && dist.has(j) && dist.get(j) < nd) { nd = dist.get(j); nxt = j; } });
        if (nxt >= 0 && p.t > 1) move(c.id, i, nxt, p.t - 1);
      }
    }
    // oyuncuya barış teklifi
    c.wars.forEach(w => {
      if (w === S.player && !S.inbox.some(x => x.type === 'peace' && x.from === c.id)) {
        const pr = warPressure(c.id, w);
        const len = (S.turn - (S.warStart[key(c.id, w)] || 0)) * stepF();
        if (pr > 5 && len > 3 && Math.random() < 0.18) S.inbox.push({ type: 'peace', from: c.id });
      }
    });
  }

  function aiDiplomacyTick() {
    const ids = Object.keys(S.countries).filter(id => C(id).alive);
    const seen = {};
    ids.forEach(a => C(a).wars.slice().forEach(b => {
      const k = key(a, b); if (seen[k]) return; seen[k] = 1;
      if (isPlayer(a) || isPlayer(b)) return;
      if (!C(a).alive || !C(b).alive) return;
      const len = (S.turn - (S.warStart[k] || 0)) * stepF();
      if (len < 4) return;
      const pa = warPressure(a, b), pb = warPressure(b, a);
      const loser = pa > pb ? a : b, winner = loser === a ? b : a;
      if (Math.max(pa, pb) > 0 && Math.random() < 0.12) {
        const lp = Math.max(pa, pb);
        if (lp > 14 && !C(loser).vassalOf && Math.random() < 0.35 && !C(winner).vassalOf && provsOf(loser).length <= 3) applyPeace(winner, loser, { vassal: true });
        else applyPeace(a, b, {});
      } else if (len > 30 && Math.random() < 0.08) applyPeace(a, b, {});
    }));
  }

  // ---------------------------------------------------------- TUR
  function endTurn() {
    S.turn++;
    S.month += ERAS[S.eraIdx].months;
    while (S.month > 12) { S.month -= 12; S.year++; }
    S.sup = {};
    const ids = Object.keys(S.countries).filter(id => C(id).alive);
    // ekonomi
    ids.forEach(id => {
      const c = C(id), inc = income(id), sh = inc.vassalShare;
      let g = inc.g, m = inc.m;
      if (c.vassalOf && C(c.vassalOf).alive) { const ov = C(c.vassalOf); ov.gold += g * sh; ov.mat += m * sh; g *= (1 - sh); m *= (1 - sh); }
      c.gold += g - inc.upkeep; c.mat += m; c.man = Math.min(inc.maxMan, c.man + inc.n);
      if (c.gold < 0) {
        c.gold = 0;
        for (const p of S.provs) if (p.o === id && p.t > 2) p.t = Math.floor(p.t * 0.9);
        if (isPlayer(id)) log('Altın yetmedi! Askerler maaş alamadığı için firar ediyor.', true);
      }
      // ikmal kesintisi
      const sup = supplySet(id);
      for (let i = 0; i < S.provs.length; i++) {
        const p = S.provs[i];
        if (p.o === id && !sup.has(i) && p.t > 1) p.t = Math.max(1, Math.floor(p.t * 0.93));
      }
      if (c.res) { c.res.left--; if (c.res.left <= 0) finishResearch(c); }
      for (const k in c.truce) if (c.truce[k] > 0) c.truce[k]--;
      // ilişki sürüklenmesi
      for (const k in c.op) { if (c.op[k] > 0 && !allied(id, k)) c.op[k] -= 0.2; else if (c.op[k] < 0 && !atWar(id, k)) c.op[k] += 0.2; }
    });
    // yapay zekâ
    ids.slice().sort(() => Math.random() - 0.5).forEach(id => { const c = C(id); if (c.alive && c.ai) aiTurn(c); });
    aiDiplomacyTick();
    // zafer / yenilgi
    const pl = C(S.player);
    if (!pl.alive || provsOf(S.player).length === 0) S.lost = true;
    else if (!S.won) {
      let mine = 0; for (const p of S.provs) if (p.o === S.player || (p.o && C(p.o).vassalOf === S.player)) mine++;
      if (mine >= Math.ceil(G.n * 0.4)) { S.won = true; S.inbox.push({ type: 'victory' }); }
    }
    return S;
  }

  // ---------------------------------------------------------- KAYIT
  function serialize() { return JSON.stringify(S, (k, v) => k === 'sup' ? undefined : v); }
  function load(json) { S = JSON.parse(json); S.sup = {}; buildGeo(); E.state = S; return S; }

  const E = {
    G, PI, state: null, buildGeo, newGame, serialize, load, endTurn, provsOf, totalTroops, income, power, supplySet,
    recruitCost, investCost, fortCost, techCost, techTime, techAvailable, startResearch,
    move, recruit, invest, fortify, declareWar, canDeclare, proposePeace, evalPeace, applyPeace, proposeAlliance,
    breakAlliance, gift, swap, release, atWar, allied, opGet, val, warPressure, ensureCapital,
    get S() { return S; }
  };
  return E;
})();

if (typeof module !== 'undefined') module.exports = E;
