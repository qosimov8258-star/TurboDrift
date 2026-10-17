import * as THREE from 'three';
import { icon, iconize } from './icons.js';
import { ABILITIES } from './abilities.js';

const $ = id => document.getElementById(id);
const fmt = t => {
  if (t == null) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
const ordinal = n => n + (n === 1 ? '-o\'rin' : '-o\'rin');

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      pos: $('hudPos'), posTotal: $('hudPosTotal'), lap: $('hudLap'), clock: $('hudClock'), best: $('hudBest'), last: $('hudLast'),
      board: $('hudBoard'), banner: $('hudBanner'), count: $('hudCount'), nitroFill: $('nitroFill'), nitroBox: $('nitroBox'),
      drift: $('hudDrift'), driftPts: $('hudDriftPts'), driftMul: $('hudDriftMul'), shift: $('hudShift'), wrong: $('hudWrong'), mode: $('hudMode'), labels: $('hudLabels'),
      gauge: $('gauge'), mini: $('mini'), fps: $('hudFps'), ping: $('hudPing'),
      hp: $('hudHp'), hpFill: $('hpFill'), hpGhost: $('hpGhost'), hpNum: $('hpNum'), hpDmg: $('hpDmg'), hit: $('hudHit'), alive: $('hudAliveLbl'),
    };
    this.cache = {};
    this.gctx = this.el.gauge.getContext('2d');
    this.mctx = this.el.mini.getContext('2d');
    this.labels = new Map();
    this.bannerT = null; this.countT = null;
    this.miniBase = null;
    this._v = new THREE.Vector3();
    this.rows = [];
    this.ui = 1; this.gAcc = 0;
    this.onAbility = null; this.abSlots = [];
  }

  /** battle: one slot per chosen ability on keys 1 2 3 (click / tap works too) */
  setLoadout(list) {
    const bar = $('hudAb'); if (!bar) return;
    bar.textContent = '';
    this.abSlots = list.map((ai, slot) => {
      const a = ABILITIES[ai], el = document.createElement('div');
      el.className = 'ab ' + a.kind; el.title = `${slot + 1} — ${a.name}: ${a.desc}`;
      el.innerHTML = `<kbd>${slot + 1}</kbd><span class="ico">${a.ico}</span><small>${a.name}</small><i class="cdv"></i><b class="cdn"></b>`;
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (this.onAbility) this.onAbility(slot); });
      el.addEventListener('contextmenu', e => e.preventDefault());
      bar.appendChild(el);
      return { el, cdv: el.querySelector('.cdv'), cdn: el.querySelector('.cdn'), key: '', was: 0 };
    });
  }
  drawAbilities(ab) {
    if (!this.abSlots || !ab) return;
    for (let i = 0; i < this.abSlots.length; i++) {
      const sl = this.abSlots[i], a = ab[i], left = a.left;
      const key = Math.ceil(left * 10) + (a.on ? 'o' : '');
      if (key === sl.key) continue;
      sl.key = key;
      sl.el.classList.toggle('cool', left > 0);
      sl.el.classList.toggle('on', a.on);
      sl.cdv.style.transform = `scaleY(${(left / a.cd).toFixed(3)})`;
      sl.cdn.textContent = left > 0 ? (left >= 10 ? String(Math.ceil(left)) : left.toFixed(1)) : '';
      if (left <= 0 && sl.was > 0) { sl.el.classList.remove('rdy'); void sl.el.offsetWidth; sl.el.classList.add('rdy'); }
      sl.was = left;
    }
  }

  /** UI zoom factor (big screens): keep the canvases sharp by rendering them at the final on-screen pixel size */
  setScale(ui) {
    this.ui = ui;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5) * ui;
    const gs = Math.min(1800, Math.round(300 * dpr / 50) * 50);
    if (this.el.gauge.width !== gs) { this.el.gauge.width = this.el.gauge.height = gs; }
    const mw = Math.round(220 * Math.max(1, dpr)), mh = Math.round(340 * Math.max(1, dpr));
    if (this.el.mini.width !== mw) { this.el.mini.width = mw; this.el.mini.height = mh; this.miniBase = null; }
  }

  show(b) { this.root.classList.toggle('on', b); if (b) { this.miniBase = null; this.cache = {}; } }
  setFinished(b) { this.root.classList.toggle('finished', b); }

  set(key, el, val, prop = 'textContent') { if (this.cache[key] !== val) { this.cache[key] = val; el[prop] = val; } }

  message(text, ms = 2000, kind = '') {
    const b = this.el.banner;
    b.className = 'banner ' + kind; b.innerHTML = iconize(text); void b.offsetWidth; b.classList.add('show');
    clearTimeout(this.bannerT); this.bannerT = setTimeout(() => b.classList.remove('show'), ms);
  }

  countdown(text, go = false) {
    const c = this.el.count;
    c.className = 'count' + (go ? ' go' : ''); c.textContent = text; void c.offsetWidth; c.classList.add('show');
    clearTimeout(this.countT); this.countT = setTimeout(() => c.classList.remove('show'), go ? 900 : 800);
  }

  addLabel(id, name, color) {
    if (this.labels.has(id)) return;
    const d = document.createElement('div'); d.className = 'tag';
    d.innerHTML = `<i style="background:${color}"></i><b></b><span></span><div class="hpb"><q></q><u></u></div>`;
    d.querySelector('span').textContent = name;
    this.el.labels.appendChild(d); this.labels.set(id, d);
  }
  removeLabel(id) { const d = this.labels.get(id); if (d) { d.remove(); this.labels.delete(id); } }
  clearLabels() { for (const id of [...this.labels.keys()]) this.removeLabel(id); }

  update(d) {
    const e = this.el;
    const bt = !!d.battle;
    if (this.cache.bt !== bt) { this.cache.bt = bt; this.root.classList.toggle('battle', bt); this.cache.board = null; }
    this.set('pos', e.pos, String(bt ? d.alive : d.rank)); this.set('tot', e.posTotal, '/' + d.total);
    this.set('lap', e.lap, `${d.lap}/${d.laps}`);
    this.set('albl', e.alive, bt ? 'TIRIK' : 'AYLANA');
    if (bt) { this.drawHealth(d); this.drawAbilities(d.ab); }
    this.set('clock', e.clock, fmt(d.clock));
    this.set('best', e.best, fmt(d.best)); this.set('last', e.last, fmt(d.last));
    this.set('lt', e.lapNow || (e.lapNow = $('hudLapNow')), fmt(d.lapTime));
    this.set('mode', e.mode, d.manual ? 'QO\'LDA  (T — avto)' : 'AVTO  (T — qo\'lda)');
    // nitro
    e.nitroFill.style.transform = `scaleX(${d.nitro.toFixed(3)})`;
    e.nitroBox.classList.toggle('on', d.nitroOn);
    // drift
    const showDrift = d.drift > 40;
    e.drift.classList.toggle('on', showDrift);
    if (showDrift) { this.set('dp', e.driftPts, String(Math.round(d.drift))); this.set('dm', e.driftMul, 'x' + d.mult.toFixed(1)); }
    e.shift.classList.toggle('on', d.hint);
    e.wrong.classList.toggle('on', d.wrong);

    // leaderboard
    const key = d.order.map(o => o.id + o.rank + (o.finish != null ? 'f' : '') + (bt ? Math.ceil(o.hp) : '')).join('|');
    if (this.cache.board !== key) {
      this.cache.board = key;
      if (bt) e.board.innerHTML = d.order.map(o => `<li class="${o.me ? 'me' : ''}${o.dead ? ' dead' : ''}"><em>${o.rank}</em><i style="background:${o.color}"></i><span>${escapeHtml(o.name)}</span><b class="hpmini"><u style="width:${o.dead ? 0 : Math.max(2, Math.ceil(o.hp))}%;background:${hpColor(o.hp)}"></u></b></li>`).join('');
      else e.board.innerHTML = d.order.map(o => `<li class="${o.me ? 'me' : ''}${o.finish != null ? ' fin' : ''}"><em>${o.rank}</em><i style="background:${o.color}"></i><span>${escapeHtml(o.name)}</span>${o.finish != null ? '<b>' + icon('flag') + '</b>' : ''}</li>`).join('');
    }
    const now = performance.now();           // the gauge is the most expensive canvas: ~30 fps is plenty and frees the main thread at high speed
    if (now - (this.gT || 0) > 32 || this.cache.gear !== d.gear) { this.gT = now; this.cache.gear = d.gear; this.drawGauge(d); }
    this.drawMini(d);
    this.drawLabels(d);
  }

  /** battle: big health bar (fast fill + slowly draining ghost), damage number and red hit flash */
  drawHealth(d) {
    const e = this.el, hp = Math.max(0, d.hp), mx = 100;
    e.hpFill.style.transform = `scaleX(${(hp / mx).toFixed(3)})`;
    e.hpGhost.style.transform = `scaleX(${(Math.max(hp, d.ghost) / mx).toFixed(3)})`;
    const col = hpColor(hp);
    if (this.cache.hpc !== col) { this.cache.hpc = col; e.hpFill.style.background = col; e.hp.classList.toggle('low', hp < 30); }
    this.set('hpn', e.hpNum, String(Math.ceil(d.hpReal)));
    const low = d.hpReal > 0 && d.hpReal < 30;
    if (this.cache.low !== low) { this.cache.low = low; e.hp.classList.toggle('low', low); }
    const showDmg = d.dmg > 0.5 && d.dmgAge < 1.3;
    this.set('dmg', e.hpDmg, showDmg ? '−' + Math.round(d.dmg) : '');
    e.hpDmg.classList.toggle('on', showDmg);
    const f = Math.min(0.85, d.hitFlash);
    if (this.cache.hf !== f.toFixed(2)) { this.cache.hf = f.toFixed(2); e.hit.style.opacity = f.toFixed(2); }
  }

  drawGauge(d) {
    const cv = this.el.gauge, g = this.gctx, dpr = cv.width / 300;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, 300, 300);
    const cx = 150, cy = 150, R = 138;
    const grd = g.createRadialGradient(cx, cy, 20, cx, cy, R);
    grd.addColorStop(0, 'rgba(18,22,32,0.78)'); grd.addColorStop(1, 'rgba(6,8,12,0.88)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.14)'; g.stroke();
    const a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI, ang = v => a0 + v * (a1 - a0);
    // redline
    g.lineWidth = 7; g.strokeStyle = 'rgba(255,40,40,0.85)'; g.beginPath(); g.arc(cx, cy, 118, ang(0.86), ang(1)); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.arc(cx, cy, 118, ang(0), ang(0.86)); g.stroke();
    // ticks
    for (let i = 0; i <= 16; i++) {
      const v = i / 16, a = ang(v), major = i % 2 === 0;
      const r1 = 124, r2 = major ? 106 : 114;
      g.lineWidth = major ? 3 : 1.5; g.strokeStyle = v > 0.86 ? '#ff4040' : '#e8edf5';
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
      if (major) {
        g.fillStyle = v > 0.86 ? '#ff6a6a' : '#cfd6e2'; g.font = 'italic 700 15px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i / 2), cx + Math.cos(a) * 90, cy + Math.sin(a) * 90);
      }
    }
    g.fillStyle = '#8fa0b8'; g.font = '600 10px system-ui'; g.textAlign = 'center'; g.fillText('x1000 rpm', cx, cy - 58);
    // rpm value arc glow
    const rv = Math.max(0, Math.min(1.02, (d.rpm - 0.12) / 0.9));
    const hot = rv > 0.86;
    g.lineWidth = 9; g.lineCap = 'round';
    g.strokeStyle = hot ? '#ff3b30' : d.nitroOn ? '#3aa0ff' : '#ffb020';
    g.shadowColor = g.strokeStyle; g.shadowBlur = 14;
    g.beginPath(); g.arc(cx, cy, 129, ang(0), ang(Math.max(0.005, rv))); g.stroke();
    g.shadowBlur = 0; g.lineCap = 'butt';
    // needle
    const na = ang(rv);
    g.strokeStyle = '#ff3b30'; g.lineWidth = 3.5; g.shadowColor = '#ff3b30'; g.shadowBlur = 8;
    g.beginPath(); g.moveTo(cx - Math.cos(na) * 14, cy - Math.sin(na) * 14); g.lineTo(cx + Math.cos(na) * 112, cy + Math.sin(na) * 112); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = '#10141c'; g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#ff3b30'; g.lineWidth = 2; g.stroke();
    // speed
    g.fillStyle = '#fff'; g.font = 'italic 800 60px system-ui, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(String(d.kmh), cx, cy + 34);
    g.fillStyle = '#9fb0c8'; g.font = '700 13px system-ui'; g.fillText('KM/H', cx, cy + 54);
    // gear
    g.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(g, cx - 28, cy + 66, 56, 52, 10); g.fill();
    g.fillStyle = d.gearLimit ? '#ff4040' : (d.gear === 'R' ? '#ff9f43' : '#34e0ff'); g.font = 'italic 800 42px system-ui'; g.textBaseline = 'middle';
    g.fillText(d.gear, cx, cy + 94);
    g.fillStyle = '#7d8ba3'; g.font = '700 9px system-ui'; g.fillText('UZATMA', cx, cy + 126);
    // shift lights
    const th = [0.72, 0.77, 0.82, 0.86, 0.9, 0.94, 0.98];
    for (let i = 0; i < 7; i++) {
      const on = d.limiter ? (Math.floor(performance.now() / 70) % 2 === 0) : d.rpmRaw >= th[i];
      const col = d.limiter ? '#4aa8ff' : i < 3 ? '#38e06a' : i < 5 ? '#ffc233' : '#ff3b30';
      g.fillStyle = on ? col : 'rgba(255,255,255,0.1)';
      if (on) { g.shadowColor = col; g.shadowBlur = 10; }
      g.beginPath(); g.arc(cx - 54 + i * 18, 24, 6, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    }
  }

  resetMini() { this.miniBase = null; }

  buildMini(track) {
    const cv = this.el.mini, W = cv.width, H = cv.height, k = W / 220, pad = 18 * k;
    const xs = track.P.map(p => p.x), zs = track.P.map(p => p.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const s = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (z1 - z0));
    const ox = (W - (x1 - x0) * s) / 2, oz = (H - (z1 - z0) * s) / 2;
    const map = (x, z) => [W - (ox + (x - x0) * s), H - (oz + (z - z0) * s)];   // +x is the left side when looking along +z
    const base = document.createElement('canvas'); base.width = W; base.height = H;
    const g = base.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    track.P.forEach((p, i) => { const [x, y] = map(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath();
    g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 11 * k; g.stroke();
    g.strokeStyle = '#d7dde8'; g.lineWidth = 6.5 * k; g.stroke();
    g.strokeStyle = '#2a2f3a'; g.lineWidth = 3.5 * k; g.stroke();
    const [sx, sy] = map(track.P[0].x, track.P[0].z);
    g.fillStyle = '#fff'; g.fillRect(sx - 7 * k, sy - 2 * k, 14 * k, 4 * k);
    this.miniBase = base; this.miniMap = map;
  }

  drawMini(d) {
    if (!this.miniBase) this.buildMini(d.track);
    const g = this.mctx, cv = this.el.mini, k = cv.width / 220;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this.miniBase, 0, 0);
    const list = d.mini.slice().sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0));
    for (const m of list) {
      const [x, y] = this.miniMap(m.x, m.z);
      g.beginPath(); g.arc(x, y, (m.me ? 7 : 5) * k, 0, Math.PI * 2);
      g.fillStyle = m.color; g.fill(); g.lineWidth = (m.me ? 3 : 1.5) * k; g.strokeStyle = m.me ? '#ffd400' : '#000'; g.stroke();
    }
  }

  drawLabels(d) {
    const v = this._v, w = d.w, h = d.h;
    for (const l of d.labels) {
      const el = this.labels.get(l.id); if (!el) continue;
      v.set(l.x, l.y, l.z).project(d.camera);
      if (v.z > 1 || v.z < -1 || l.dist > 120 || d.phase === 'idle') { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(0)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(0)}px) translate(-50%, -100%) scale(${(Math.max(0.6, 1 - l.dist / 260) * this.ui).toFixed(2)})`;
      const b = el.querySelector('b'); const rk = l.hp != null ? String(Math.ceil(l.hp)) : String(l.rank); if (b.textContent !== rk) b.textContent = rk;
      if (l.hp != null) {
        const bar = el.querySelector('.hpb');
        bar.children[0].style.transform = `scaleX(${(Math.max(l.hp, l.ghost) / 100).toFixed(3)})`;
        const u = bar.children[1]; u.style.transform = `scaleX(${(l.hp / 100).toFixed(3)})`; u.style.background = hpColor(l.hp);
        if (!el.classList.contains('bt')) el.classList.add('bt');
      } else if (el.classList.contains('bt')) el.classList.remove('bt');
    }
  }
}

/** green -> yellow -> red by remaining HP (0..100) */
function hpColor(hp) { const k = Math.max(0, Math.min(1, hp / 100)); return `hsl(${Math.round(Math.pow(k, 0.8) * 125)} 85% 50%)`; }

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
