// Canvas'da chiziladigan tekstura: eski oboy, g'isht, kafel, beton, taxta, tosh. Fayl yuklanmaydi.
import * as THREE from 'three';

function noise(ctx, S, amount, seed = 1) {
  const img = ctx.getImageData(0, 0, S, S), d = img.data;
  let s = seed * 9301 + 49297;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 9301 + 49297) % 233280;
    const n = (s / 233280 - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}
function stains(ctx, S, n, rnd, col = '0,0,0') {
  for (let i = 0; i < n; i++) {
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${col},${0.12 + rnd() * 0.18})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function drips(ctx, S, n, rnd) {
  ctx.strokeStyle = 'rgba(70,0,0,.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < n; i++) { const x = rnd() * S, y = rnd() * S * 0.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 4, y + 20 + rnd() * 90); ctx.stroke(); }
}
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

const GEN = {
  wallpaper(ctx, S, r) {
    ctx.fillStyle = '#9a8a7a'; ctx.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 32) { ctx.fillStyle = (x / 32) % 2 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.07)'; ctx.fillRect(x, 0, 16, S); }
    ctx.fillStyle = 'rgba(40,20,20,.28)';
    for (let y = 16; y < S; y += 48) for (let x = 16; x < S; x += 32) { ctx.beginPath(); ctx.ellipse(x, y, 5, 9, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(x, y, 9, 4, 0, 0, 7); ctx.fill(); }
    stains(ctx, S, 9, r); drips(ctx, S, 3, r); noise(ctx, S, 22);
    // pastki taxta panel
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, S * 0.8, S, S * 0.2);
  },
  brick(ctx, S, r) {
    ctx.fillStyle = '#5a4a44'; ctx.fillRect(0, 0, S, S);
    const bh = 24, bw = 64;
    for (let y = 0; y < S; y += bh) for (let x = -(y / bh % 2) * bw / 2; x < S; x += bw) {
      const k = 0.7 + r() * 0.5; ctx.fillStyle = `rgb(${130 * k},${72 * k},${58 * k})`; ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
    }
    stains(ctx, S, 12, r); drips(ctx, S, 2, r); noise(ctx, S, 28);
  },
  tile(ctx, S, r) {
    ctx.fillStyle = '#8e978f'; ctx.fillRect(0, 0, S, S);
    const t = 64;
    for (let y = 0; y < S; y += t) for (let x = 0; x < S; x += t) { const k = 0.85 + r() * 0.25; ctx.fillStyle = `rgb(${190 * k},${200 * k},${195 * k})`; ctx.fillRect(x + 2, y + 2, t - 4, t - 4); }
    stains(ctx, S, 10, r, '40,30,10'); drips(ctx, S, 4, r); noise(ctx, S, 20);
  },
  concrete(ctx, S, r) {
    ctx.fillStyle = '#85857f'; ctx.fillRect(0, 0, S, S);
    stains(ctx, S, 26, r); stains(ctx, S, 6, r, '60,20,10'); drips(ctx, S, 3, r); noise(ctx, S, 40);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { ctx.beginPath(); let x = r() * S, y = r() * S; ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += r() * 30; ctx.lineTo(x, y); } ctx.stroke(); }
  },
  planks(ctx, S, r) {
    ctx.fillStyle = '#6b4a30'; ctx.fillRect(0, 0, S, S);
    const w = 32;
    for (let x = 0; x < S; x += w) { const k = 0.7 + r() * 0.5; ctx.fillStyle = `rgb(${110 * k},${74 * k},${46 * k})`; ctx.fillRect(x + 1, 0, w - 2, S);
      ctx.strokeStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < S; y += 6 + r() * 14) { ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + w - 2, y + (r() - 0.5) * 3); ctx.stroke(); }
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 1, ((r() * 7) | 0) * 36, w - 2, 2); }
    stains(ctx, S, 12, r); noise(ctx, S, 26);
  },
  stone(ctx, S, r) {
    ctx.fillStyle = '#6e6a66'; ctx.fillRect(0, 0, S, S);
    const t = 85;
    for (let y = 0; y < S; y += t) for (let x = 0; x < S; x += t) { const k = 0.8 + r() * 0.35; ctx.fillStyle = `rgb(${120 * k},${116 * k},${112 * k})`; ctx.fillRect(x + 3, y + 3, t - 6, t - 6); }
    stains(ctx, S, 14, r); noise(ctx, S, 34);
  },
  carpet(ctx, S, r) {
    ctx.fillStyle = '#6a2a30'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(210,170,90,.5)'; ctx.lineWidth = 3; ctx.strokeRect(10, 10, S - 20, S - 20);
    for (let y = 40; y < S - 20; y += 44) for (let x = 40; x < S - 20; x += 44) { ctx.fillStyle = 'rgba(200,150,80,.25)'; ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x + 10, y); ctx.lineTo(x, y + 10); ctx.lineTo(x - 10, y); ctx.fill(); }
    stains(ctx, S, 10, r); noise(ctx, S, 32);
  },
};

const cache = new Map();
export function makeTexture(kind, seed = 1, S = 256) {
  const key = kind + seed;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  (GEN[kind] || GEN.concrete)(ctx, S, rng(seed * 7919 + 13));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}
