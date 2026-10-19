import * as THREE from 'three';
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtT = t => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const RADAR_M = 150, MPP = 2;                  // radar radius in metres, metres per pixel of the baked map

/** Mission HUD: timer, objective, arrest meter, rotating radar, floating markers and the result card */
export class MissionHUD {
  constructor() {
    this.el = {
      root: $('mhud'), timer: $('mTimer'), timerBox: $('mTimerBox'), obj: $('mObj'), sub: $('mObjSub'), role: $('mRole'), police: $('mPolice'), policeChip: $('mPoliceChip'),
      loot: $('mLoot'), lootChip: $('mLootChip'), bust: $('mBust'), bustFill: $('mBustFill'), bustPct: $('mBustPct'), bustLbl: $('mBustLbl'), marks: $('mMarks'), radar: $('mRadar'),
    };
    this.rg = this.el.radar.getContext('2d');
    this.base = null; this.baseWorld = null; this.marks = new Map(); this.cache = {}; this._v = new THREE.Vector3();
  }

  /** build the pre-rendered map (1 px = 2 m) the first time a world is used */
  buildBase(world) {
    if (this.baseWorld === world) return;
    const sc = MPP / world.cell, W = Math.ceil(world.W / sc), H = Math.ceil(world.H / sc);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = world.dist(world.x0 + (x + 0.5) * MPP, world.z0 + (y + 0.5) * MPP), o = (y * W + x) * 4;
      let c;
      if (v < 0) c = [30, 36, 52]; else if (v < 1.6) c = [78, 90, 118]; else if (v < 3.6) c = [128, 144, 176]; else c = [160, 176, 208];
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.base = cv; this.baseWorld = world;
  }

  begin(cfg, m) {
    const e = this.el, thief = m.role === 'thief';
    this.buildBase(m.world);
    this.cache = {};
    $('hud').classList.add('mission');
    e.root.classList.toggle('thief', thief); e.root.classList.toggle('police', !thief);
    e.role.innerHTML = thief ? icon('mask') + "<b>O'G'RI</b>" : icon('badge') + '<b>POLITSIYA</b>';
    e.lootChip.classList.toggle('hidden', cfg.role !== 'thief');
    e.bustLbl.textContent = thief ? 'QISILDINGIZ — QIMIRLANG!' : "O'G'RINI TO'XTATIB TURING";
    for (const mk of this.marks.values()) mk.el.remove();
    this.marks.clear();
    this.sizeRadar();
  }

  end() { $('hud').classList.remove('mission'); }

  sizeRadar() {
    const ui = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const S = Math.round(190 * ui * dpr / 10) * 10, cv = this.el.radar;
    if (cv.width !== S) { cv.width = cv.height = S; }
  }

  set(k, el, v, prop = 'textContent') { if (this.cache[k] !== v) { this.cache[k] = v; el[prop] = v; } }

  update(d) {
    const e = this.el, thief = d.role === 'thief', low = d.timeLeft <= 30;
    this.set('t', e.timer, fmtT(d.timeLeft));
    if (this.cache.low !== low) { this.cache.low = low; e.timerBox.classList.toggle('low', low); }
    this.set('pol', e.police, String(d.alive));
    if (thief && !d.lootMode) {
      this.set('obj', e.obj, 'Politsiyadan qoching');
      this.set('sub', e.sub, `Omon qoling: ${fmtT(d.timeLeft)} · to'xtab qolmang!`);
    } else if (thief) {
      this.set('loot', e.loot, `${d.lootGot}/${d.lootN}`);
      const all = d.lootGot >= d.lootN;
      this.set('obj', e.obj, all ? 'Yashirin uyga yeting' : "Pul xaltalarini yig'ing");
      this.set('sub', e.sub, all ? 'Yashil belgi — yashirin uy' : `Qolgan: ${d.lootN - d.lootGot} ta xalta`);
    } else {
      this.set('obj', e.obj, "O'g'rini ushlang");
      const ths = (d.thieves || []).filter(u => !u.dead); let th = null, bd = 1e12;
      for (const u of ths) { const q = (u.state.x - d.me.state.x) ** 2 + (u.state.z - d.me.state.z) ** 2; if (q < bd) { bd = q; th = u; } }
      const dist = th ? Math.round(Math.sqrt(bd)) : 0, many = (d.thieves || []).length > 1;
      this.set('obj', e.obj, many ? `O'g'rilarni ushlang (${ths.length} ta qoldi)` : "O'g'rini ushlang");
      this.set('sub', e.sub, th ? `${many ? 'Eng yaqin o\'g\'ri' : "O'g'ri"} ${dist} m uzoqlikda · uni qisib ${d.pinTime} soniya to'xtatib turing` : "O'g'ri to'xtatildi");
    }
    // arrest meter
    const pct = Math.round(d.bust * 100);
    e.bustFill.style.transform = `scaleX(${d.bust.toFixed(3)})`;
    this.set('bp', e.bustPct, (d.pinTime * (1 - d.bust)).toFixed(1) + ' s');
    const hot = d.bust > 0.55;
    if (this.cache.hot !== hot) { this.cache.hot = hot; e.bust.classList.toggle('hot', hot); }
    const showB = d.bust > 0.02; if (this.cache.sb !== showB) { this.cache.sb = showB; e.bust.classList.toggle('on', showB); }
    this.drawRadar(d);
    this.drawMarks(d);
  }

  // ------------------------------------------------------------------ radar
  drawRadar(d) {
    this.sizeRadar();
    const cv = this.el.radar, g = this.rg, S = cv.width, c = S / 2, R = c - 3, kk = R / RADAR_M, w = d.m.world;
    const me = d.me.state, ang = me.psi - Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(8,11,18,0.9)'; g.fillRect(0, 0, S, S);
    g.translate(c, c); g.rotate(ang); g.scale(kk * MPP, kk * MPP); g.translate(-(me.x - w.x0) / MPP, -(me.z - w.z0) / MPP);
    g.imageSmoothingEnabled = true; g.drawImage(this.base, 0, 0);
    g.restore();
    const px = (x, z) => { const dx = x - me.x, dz = z - me.z; return [c + kk * (ca * dx - sa * dz), c + kk * (sa * dx + ca * dz)]; };
    const dot = (x, z, r, fill, stroke, clampEdge = true) => {
      let [sx, sy] = px(x, z); const dx = sx - c, dy = sy - c, dd = Math.hypot(dx, dy), out = dd > R - r - 2;
      if (out) { if (!clampEdge) return; const k = (R - r - 2) / dd; sx = c + dx * k; sy = c + dy * k; }
      g.beginPath(); g.arc(sx, sy, out ? r * 0.75 : r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
      if (stroke) { g.lineWidth = Math.max(1.5, S / 110); g.strokeStyle = stroke; g.stroke(); }
    };
    const u = S / 190;
    if (d.loot) for (const l of d.loot) if (!l.got) dot(l.x, l.z, 5 * u, '#ffc233', '#000');
    if (d.hide && d.hide.on) dot(d.hide.x, d.hide.z, 6.5 * u, '#4ade80', '#fff');
    if (d.posts) for (const p of d.posts) {
      const [sx, sy] = px(p.x, p.z), dd = Math.hypot(sx - c, sy - c); if (dd > R - 8) continue;
      g.fillStyle = '#ff9f0a'; g.strokeStyle = '#000'; g.lineWidth = Math.max(1.5, S / 120); g.beginPath(); g.rect(sx - 5 * u, sy - 5 * u, 10 * u, 10 * u); g.fill(); g.stroke();
      g.strokeStyle = '#000'; g.beginPath(); g.moveTo(sx - 3 * u, sy - 3 * u); g.lineTo(sx + 3 * u, sy + 3 * u); g.moveTo(sx + 3 * u, sy - 3 * u); g.lineTo(sx - 3 * u, sy + 3 * u); g.stroke();
    }
    const flash = Math.floor(performance.now() / 160) % 2;
    for (const o of d.units) {
      if (o === d.me || o.dead) continue;
      if (o.isThief) dot(o.state.x, o.state.z, 6 * u, '#ff9f0a', '#fff');
      else if (o.isHuman) dot(o.state.x, o.state.z, 5.2 * u, '#35e07a', '#fff');                      // friends are green
      else dot(o.state.x, o.state.z, 4.2 * u, flash ? '#ff3b30' : '#3a7bff', '#fff');
    }
    // me: arrow, always in the middle pointing up
    g.save(); g.translate(c, c); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = Math.max(1.5, S / 120);
    g.beginPath(); g.moveTo(0, -8 * u); g.lineTo(6 * u, 7 * u); g.lineTo(0, 3.5 * u); g.lineTo(-6 * u, 7 * u); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.lineWidth = Math.max(2, S / 70); g.strokeStyle = 'rgba(255,255,255,0.32)'; g.stroke();
  }

  // ------------------------------------------------------------------ floating markers (loot, hideout, thief)
  mark(id, ic, cls) {
    let m = this.marks.get(id);
    if (!m) {
      const el = document.createElement('div'); el.className = 'mk ' + cls; el.innerHTML = icon(ic) + '<b></b>';
      this.el.marks.appendChild(el); m = { el, b: el.querySelector('b') }; this.marks.set(id, m);
    }
    return m;
  }
  /** edge = keep the marker (clamped to the screen border) when the target is off screen */
  place(m, d, x, y, z, label, edge = true) {
    const v = this._v.set(x, y, z).project(d.camera), W = d.w, H = d.h, ui = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;
    let nx = v.x, ny = v.y;
    const behind = v.z > 1;
    if (behind) { nx = -nx; ny = -ny; }
    const mx = 46 * ui / W * 2, my = 60 * ui / H * 2;
    const off = behind || Math.abs(nx) > 1 - mx || Math.abs(ny) > 1 - my;
    if (off && !edge) { m.el.style.display = 'none'; return; }
    if (off) { const k = Math.max(Math.abs(nx) / (1 - mx), Math.abs(ny) / (1 - my)) || 1; nx /= k; ny /= k; }
    m.el.style.display = '';
    m.el.style.transform = `translate(${((nx * 0.5 + 0.5) * W).toFixed(0)}px, ${((-ny * 0.5 + 0.5) * H).toFixed(0)}px) translate(-50%, -50%) scale(${ui.toFixed(2)})`;
    m.el.classList.toggle('off', off);
    if (m.label !== label) { m.label = label; m.b.textContent = label; }
  }
  drawMarks(d) {
    const me = d.me.state, hide = id => { const m = this.marks.get(id); if (m) m.el.style.display = 'none'; };
    const dist = (x, z) => Math.round(Math.hypot(x - me.x, z - me.z));
    if (d.loot) {
      let near = -1, nd = 1e9;                                   // only the nearest bag gets an arrow at the screen edge, the others show when in view
      d.loot.forEach((l, i) => { if (!l.got) { const q = dist(l.x, l.z); if (q < nd) { nd = q; near = i; } } });
      d.loot.forEach((l, i) => { if (l.got) { hide('l' + i); return; } this.place(this.mark('l' + i, 'coin', 'loot'), d, l.x, 7, l.z, dist(l.x, l.z) + ' m', i === near && !(d.hide && d.hide.on)); });
    }
    if (d.hide && d.hide.on) this.place(this.mark('hide', 'home', 'hide'), d, d.hide.x, 9, d.hide.z, dist(d.hide.x, d.hide.z) + ' m'); else hide('hide');
    if (d.posts) d.posts.forEach(p => { const q = dist(p.x, p.z); if (q < 260) this.place(this.mark('post' + p.id, 'warn', 'post'), d, p.x, 4.5, p.z, "TO'SIQ " + q + ' m', false); else hide('post' + p.id); });
    for (const [id, m] of this.marks) if (id.startsWith('post') && !(d.posts || []).some(p => 'post' + p.id === id)) m.el.style.display = 'none';
    if (d.role === 'police') {
      const ths = d.thieves || (d.thief ? [d.thief] : []), many = ths.length > 1;
      for (const th of ths) {
        const id = 'thief' + th.id;
        if (th.dead) { hide(id); continue; }
        this.place(this.mark(id, 'mask', 'thief'), d, th.state.x, 3.6, th.state.z, (many ? th.name.toUpperCase() : "O'G'RI") + ' ' + dist(th.state.x, th.state.z) + ' m');
      }
    }
    for (const o of d.units) {                                                  // friends: a marker with the name + distance (an arrow on the screen edge when they are out of view)
      if (o === d.me || !o.isHuman) continue;
      const id = 'f' + o.id;
      if (o.dead) { hide(id); continue; }
      this.place(this.mark(id, 'users', 'friend'), d, o.state.x, 3.3, o.state.z, o.name + ' ' + dist(o.state.x, o.state.z) + ' m');
    }
    if (d.role === 'thief') for (const o of d.units) {
      if (!o.isPolice) continue;
      const dd = dist(o.state.x, o.state.z), id = 'p' + o.id;
      if (o.dead || dd > 130 || dd < 14) { hide(id); continue; }
      this.place(this.mark(id, 'siren', 'cop'), d, o.state.x, 2.7, o.state.z, dd + ' m');
      const mk = this.marks.get(id); if (mk.el.classList.contains('off')) mk.el.style.display = 'none';
    }
  }

  // ------------------------------------------------------------------ result card
  result(res) {
    const win = res.win, thief = res.role === 'thief', friends = res.friends > 1, loot = res.lootMode !== false && thief;
    const title = win ? (thief ? 'QOCHIB QUTULDINGIZ!' : "O'G'RI USHLANDI!") : (res.reason === 'busted' ? 'USHLANDINGIZ!' : res.reason === 'time' ? 'VAQT TUGADI' : res.reason === 'left' ? "O'G'RI CHIQIB KETDI" : res.reason === 'nopolice' ? 'POLITSIYA TUGADI' : 'MASHINA PORTLADI');
    const sub = win ? (thief ? (res.reason === 'nopolice' ? "Barcha politsiya mashinalari yo'q qilindi — siz qutuldingiz!" : loot ? "Siz politsiyadan qutuldingiz va o'ljani saqladingiz." : res.reason === 'time' ? 'Vaqt tugaguncha politsiyadan qochib qoldingiz!' : "Siz politsiyadan qutuldingiz.") : "Siz o'g'rini qo'lga oldingiz — jinoyatchi hibsda.") :
      res.reason === 'busted' ? "Politsiya sizni o'rab oldi." : res.reason === 'nopolice' ? "Barcha politsiya mashinalari yo'q qilindi — o'g'ri qochib ketdi." : res.reason === 'time' ? (thief ? "Vaqt tugadi — o'lja yetkazilmadi." : "O'g'ri qochib ketdi.") : 'Mashinangiz butunlay ishdan chiqdi.';
    const star = '<svg viewBox="0 0 24 24"><path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.600l-5.800 3.100 1.100-6.500L2.600 9.600l6.500-.9z" fill="currentColor" stroke="currentColor" stroke-width="1.400" stroke-linejoin="round"/></svg>';
    const stars = [1, 2, 3].map(i => `<i class="${i <= res.stars ? 'on' : ''}">${star}</i>`).join('');
    const rows = [
      ['Rol', thief ? "O'g'ri" : friends ? `Politsiya (${res.friends} do'st)` : 'Politsiya'],
      ['Politsiya soni', res.police],
      ['Qiyinlik', res.diff],
      ['Sarflangan vaqt', fmtT(res.time)],
      loot ? ["Yig'ilgan xaltalar", `${res.loot}/${res.lootN}`] : null,
      loot ? ["Yo'q qilingan politsiya", res.wrecked] : null,
      res.posts ? ["Robot to'siqlari", res.posts] : null,
      ['Mashina holati', Math.round(res.hp) + '%'],
      ['Eng yuqori tezlik', res.topKmh + ' km/s'],
    ].filter(Boolean).map(r => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
    $('mresBody').innerHTML = `<div class="mres-badge ${win ? 'win' : 'lose'}">${icon(win ? 'trophy' : 'warn')}</div><h2>${title}</h2><p>${sub}</p><div class="mres-stars ${win ? '' : 'dim'}">${stars}</div><div class="mres-grid">${rows}</div>`;
  }
}
