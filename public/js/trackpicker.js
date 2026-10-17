import { Track } from './track.js';
import { TRACKS, GROUPS } from './trackdata.js';
import { icon } from './icons.js';

// Lightweight track metadata + 2D previews for the picker (no 3D scene needed).
const cache = TRACKS.map(def => {
  const t = new Track(def);
  let corners = 0, inTurn = false;
  for (let i = 0; i < t.N; i++) {
    const hard = Math.abs(t.K[i]) > 1 / 130;
    if (hard && !inTurn) corners++;
    inTurn = hard;
  }
  return { def, track: t, km: t.length / 1000, corners };
});
export const trackInfo = i => cache[i];
export const LEVELS = ['', 'Oson', "O'rtacha", 'Qiyin', 'Juda qiyin'];
const stars = n => '★'.repeat(n) + '☆'.repeat(4 - n);

/** draw the centre line, glowing, onto a canvas (top-down) */
export function drawPreview(cv, index, { color = '#34c8ff', glow = true } = {}) {
  const { track } = cache[index], g = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 14;
  g.clearRect(0, 0, W, H);
  const xs = track.P.map(p => p.x), zs = track.P.map(p => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const s = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (z1 - z0));
  const ox = (W - (x1 - x0) * s) / 2, oz = (H - (z1 - z0) * s) / 2;
  const map = (x, z) => [W - (ox + (x - x0) * s), H - (oz + (z - z0) * s)];
  const path = () => { g.beginPath(); track.P.forEach((p, i) => { const [x, y] = map(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
  g.lineJoin = 'round'; g.lineCap = 'round';
  path(); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 11; g.stroke();
  if (glow) { g.save(); g.shadowColor = color; g.shadowBlur = 16; path(); g.strokeStyle = color; g.lineWidth = 6; g.stroke(); g.restore(); }
  path(); g.strokeStyle = '#e9eef7'; g.lineWidth = 6; g.stroke();
  path(); g.strokeStyle = '#272c37'; g.lineWidth = 3.6; g.stroke();
  const [sx, sy] = map(track.P[0].x, track.P[0].z);
  g.fillStyle = '#fff'; g.fillRect(sx - 6, sy - 2, 12, 4);
  g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(sx, sy, 3, 0, 7); g.fill();
}

export class TrackPicker {
  /** opts: { onPick(index), canChange() } */
  constructor(opts) {
    this.opts = opts; this.sel = 0; this.cur = 0; this.group = 'all';
    this.el = { root: document.getElementById('tracks'), body: document.getElementById('tpBody'), tabs: document.getElementById('tpTabs'), pick: document.getElementById('tpPick'), ok: document.getElementById('tpConfirm'), sub: document.getElementById('tpSub') };
    this.el.tabs.querySelectorAll('button').forEach(b => { b.onclick = () => { this.group = b.dataset.g; this.render(); }; });
    this.el.ok.onclick = () => this.confirm();
    document.getElementById('tpClose').onclick = () => this.close();
    this.el.root.addEventListener('pointerdown', e => { if (e.target === this.el.root) this.close(); });
  }

  get isOpen() { return this.el.root.classList.contains('on'); }
  open(current) {
    this.cur = this.sel = current;
    this.el.root.classList.add('on');
    this.render();
  }
  close() { this.el.root.classList.remove('on'); }
  confirm() {
    if (!this.opts.canChange()) { this.close(); return; }
    this.opts.onPick(this.sel); this.cur = this.sel; this.close();
  }

  render() {
    const can = this.opts.canChange();
    this.el.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === this.group));
    this.el.sub.textContent = can ? "10 ta trassa — o'zingizga yoqqanini tanlang" : "Yo'lni faqat xona egasi tanlaydi — siz ko'rib chiqishingiz mumkin";
    const groups = GROUPS.filter(g => this.group === 'all' || g.id === this.group);
    this.el.body.innerHTML = groups.map(g => `
      <section class="tp-sec">
        <div class="tp-sec-h"><b>${icon(g.id === 'road' ? 'road' : 'refresh')}${g.title}</b><span>${g.sub}</span></div>
        <div class="tp-grid">${cache.map((c, i) => c.def.group !== g.id ? '' : this.card(c, i)).join('')}</div>
      </section>`).join('');
    this.el.body.querySelectorAll('.tp-card').forEach(card => {
      const i = +card.dataset.i;
      drawPreview(card.querySelector('canvas'), i, { color: this.themeColor(i) });
      card.onclick = () => this.select(i);
      card.ondblclick = () => { this.select(i); this.confirm(); };
      card.addEventListener('pointermove', e => {                // 3D tilt
        const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--rx', (-y * 10).toFixed(1) + 'deg'); card.style.setProperty('--ry', (x * 12).toFixed(1) + 'deg');
      });
      card.addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
    });
    this.foot();
    const first = this.el.body.querySelector('.tp-card.sel'); if (first) first.scrollIntoView({ block: 'nearest' });
  }

  select(i) {
    this.sel = i;
    this.el.body.querySelectorAll('.tp-card').forEach(c => c.classList.toggle('sel', +c.dataset.i === i));
    this.foot();
  }

  foot() {
    const s = cache[this.sel], can = this.opts.canChange();
    this.el.pick.innerHTML = `<b>${s.def.name}</b><span>${s.km.toFixed(1)} km · ${s.corners} burilish · ${s.def.laps} aylana tavsiya</span>`;
    this.el.ok.innerHTML = !can ? icon('x') + 'YOPISH' : this.sel === this.cur ? icon('check') + 'TANLANGAN — DAVOM ETISH' : icon('check') + "SHU YO'LNI TANLASH";
  }

  themeColor(i) {
    return { forest: '#4ade80', mountain: '#7fb6ff', desert: '#ffb74d', city: '#ff8a65', snow: '#b3e5fc', coast: '#26c6da', arena: '#c084fc', sunset: '#ff7a59' }[cache[i].def.theme] || '#34c8ff';
  }

  card(c, i) {
    const d = c.def;
    return `<button class="tp-card${i === this.sel ? ' sel' : ''}${i === this.cur ? ' cur' : ''}" data-i="${i}" style="--accent:${this.themeColor(i)}">
      <div class="tp-stage"><canvas width="340" height="250"></canvas><span class="tp-no">${String(i + 1).padStart(2, '0')}</span>${i === this.cur ? '<span class="tp-badge">HOZIRGI</span>' : ''}</div>
      <div class="tp-info">
        <b>${d.name}</b>
        <small>${d.desc}</small>
        <div class="tp-stats"><span>${c.km.toFixed(1)} km</span><span>${c.corners} burilish</span><span class="lv l${d.level}" title="${LEVELS[d.level]}">${stars(d.level)}</span></div>
      </div>
    </button>`;
  }
}
