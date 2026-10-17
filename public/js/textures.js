import * as THREE from 'three';

// Procedural canvas textures (no external image assets).
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

export function roadTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#35363a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const v = 40 + rnd() * 50 | 0;
    g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + rnd() * 0.4})`;
    g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // rubbered racing lines
  for (const u of [0.3, 0.7]) {
    const grd = g.createLinearGradient((u - 0.09) * 512, 0, (u + 0.09) * 512, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect((u - 0.09) * 512, 0, 0.18 * 512, 512);
  }
  g.fillStyle = '#eceff1';
  g.fillRect(512 * 0.035, 0, 512 * 0.012, 512);          // edge lines
  g.fillRect(512 * 0.953, 0, 512 * 0.012, 512);
  g.fillStyle = 'rgba(236,239,241,0.9)';
  for (let y = 0; y < 512; y += 128) g.fillRect(512 * 0.4965, y, 512 * 0.007, 64); // centre dashes
  return tex(c);
}

export function gravelTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#8a7a5c'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 90 + rnd() * 90 | 0;
    g.fillStyle = `rgba(${v},${v - 10},${v - 35},${0.5})`;
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return tex(c);
}

/** `ground` = { tint, lift } recolours the grass (keeps its grain): 'color' blend + a lightening wash */
export function grassTexture(ground) {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#3d6b2a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 30000; i++) {
    const r = 40 + rnd() * 40 | 0, gr = 90 + rnd() * 70 | 0, b = 25 + rnd() * 30 | 0;
    g.fillStyle = `rgba(${r},${gr},${b},0.55)`;
    g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 2 + rnd() * 4);
  }
  for (let i = 0; i < 40; i++) { // soft patches
    const x = rnd() * 512, y = rnd() * 512, r = 30 + rnd() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rnd() > 0.5 ? 'rgba(20,60,15,0.25)' : 'rgba(120,160,60,0.18)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (ground) {
    g.globalCompositeOperation = 'color'; g.fillStyle = ground.tint; g.fillRect(0, 0, 512, 512);
    g.globalCompositeOperation = 'source-over'; g.fillStyle = ground.lift; g.fillRect(0, 0, 512, 512);
  }
  return tex(c);
}

export function curbTexture() {
  const [c, g] = canvas(64, 128);
  g.fillStyle = '#d8232a'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 64, 64, 64);
  return tex(c);
}

export function barrierTexture() {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#cfd3d8'; g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e5232b' : '#f5f5f5'; g.fillRect(i * 64, 18, 64, 56); }
  g.fillStyle = '#1b1d22'; g.fillRect(0, 0, 512, 12); g.fillRect(0, 100, 512, 28);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 300; i++) g.fillRect(rnd() * 512, rnd() * 128, 2, 2);
  return tex(c);
}

export function crowdTexture() {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#2a2d36'; g.fillRect(0, 0, 512, 128);
  const cols = ['#e53935', '#fdd835', '#1e88e5', '#43a047', '#fafafa', '#fb8c00', '#8e24aa', '#212121'];
  for (let y = 4; y < 128; y += 8) for (let x = 2; x < 512; x += 6) {
    g.fillStyle = cols[rnd() * cols.length | 0]; g.fillRect(x, y, 4, 5);
    g.fillStyle = '#f2c9a0'; g.fillRect(x + 1, y - 2, 2, 2);
  }
  return tex(c);
}

export function textBanner(text, bg = '#d81921', fg = '#fff', w = 1024, h = 256, font = 'italic 900 150px Arial Black, Impact, sans-serif') {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = -h; i < w; i += 70) { g.beginPath(); g.moveTo(i, h); g.lineTo(i + 40, h); g.lineTo(i + 40 + h * 0.6, 0); g.lineTo(i + h * 0.6, 0); g.fill(); }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 8, w - 60);
  return tex(c, { repeat: false });
}

export function checkerTexture(n = 2) {
  const [c, g] = canvas(256, 64);
  const s = 32;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#fff' : '#111'; g.fillRect(x * s, y * s, s, s); }
  return tex(c);
}

export function softSprite(color = '255,255,255', hard = 0.0) {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, `rgba(${color},1)`);
  grd.addColorStop(0.35 + hard * 0.3, `rgba(${color},0.55)`);
  grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  // puffy noise
  for (let i = 0; i < 40; i++) {
    const a = rnd() * 6.28, r = rnd() * 40;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, rr = 10 + rnd() * 18;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, `rgba(${color},0.25)`); gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  return tex(c, { repeat: false });
}

export function asphaltDecal() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  return tex(c, { repeat: false });
}

export function slotTexture() {
  const [c, g] = canvas(128, 256);
  g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(10, 40); g.lineTo(10, 12); g.lineTo(118, 12); g.lineTo(118, 40); g.stroke();
  g.beginPath(); g.moveTo(10, 216); g.lineTo(10, 244); g.lineTo(118, 244); g.lineTo(118, 216); g.stroke();
  return tex(c, { repeat: false });
}

/** tower-block facade: dark glass with randomly lit windows */
export function windowTexture() {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#2a3140'; g.fillRect(0, 0, 256, 512);
  for (let y = 6; y < 512; y += 16) for (let x = 6; x < 256; x += 14) {
    const lit = rnd() > 0.55;
    g.fillStyle = lit ? `rgba(255,${200 + rnd() * 40 | 0},${130 + rnd() * 60 | 0},${0.7 + rnd() * 0.3})` : `rgba(${50 + rnd() * 30 | 0},${62 + rnd() * 30 | 0},${88 + rnd() * 30 | 0},0.9)`;
    g.fillRect(x, y, 9, 10);
  }
  const t = tex(c); t.repeat.set(1, 1);
  return t;
}
