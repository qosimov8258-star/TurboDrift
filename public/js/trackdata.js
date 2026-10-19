// All circuits. Every track is a closed loop of control points (x, z) in metres; the first point is the
// start/finish line. `scale` stretches the points, `theme` drives the scenery (sky, ground, trees, ...).

const ring = (n, f, phase = 0) => Array.from({ length: n }, (_, i) => f((i / n) * Math.PI * 2 + phase));
const r1 = v => Math.round(v * 10) / 10;

/** Round the corners of a closed polygon: every vertex gets an arc of radius `r` (number or per-vertex array).
 *  Long straights get extra points so the spline stays straight. */
function fillet(poly, radius) {
  const n = poly.length, out = [];
  const R = i => (Array.isArray(radius) ? radius[i] : radius);
  const unit = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [dx / l, dz / l, l]; };
  for (let i = 0; i < n; i++) {
    const p = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const d1 = unit(a, p), d2 = unit(p, b);
    const cross = d1[0] * d2[1] - d1[1] * d2[0], dot = d1[0] * d2[0] + d1[1] * d2[1];
    const ang = Math.atan2(Math.abs(cross), dot);
    if (ang < 1e-3 || R(i) === 0) { out.push({ p, straight: true }); continue; }
    const r = R(i), t = r * Math.tan(ang / 2), sg = Math.sign(cross);
    const s0 = [p[0] - d1[0] * t, p[1] - d1[1] * t];               // arc start
    const c = [s0[0] - d1[1] * r * sg, s0[1] + d1[0] * r * sg];        // arc centre
    const a0 = Math.atan2(s0[1] - c[1], s0[0] - c[0]);
    const steps = Math.max(4, Math.ceil(ang / (Math.PI / 12)));
    for (let k = 0; k <= steps; k++) { const th = a0 + sg * ang * (k / steps); out.push({ p: [c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)] }); }
  }
  // densify the straights between consecutive points
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i].p, b = out[(i + 1) % out.length].p;
    res.push([r1(a[0]), r1(a[1])]);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > 90) { const m = Math.ceil(l / 80); for (let k = 1; k < m; k++) res.push([r1(a[0] + (b[0] - a[0]) * k / m), r1(a[1] + (b[1] - a[1]) * k / m)]); }
  }
  return res;
}

const THEMES = {
  forest: {
    decor: 'forest', sky: [0x2f6fd0, 0x8ec1f0, 0xdfeaf4], fog: 0xcfe0ee, fogNear: 260, fogFar: 2600,
    grass: 0xffffff, leaf: [0.27, 0.08, 0.45, 0.2], mount: 0x66788a, sun: [-0.45, 0.55, 0.7], sunColor: 0xfff1d6, sunI: 3.1,
    hemi: [0xcfe6ff, 0x4a5a3a, 0.85],
  },
  mountain: {
    decor: 'forest', sky: [0x1d4f9c, 0x74a9e0, 0xcfe0ee], fog: 0xbfd2e4, fogNear: 200, fogFar: 2100,
    grass: 0xffffff, ground: { tint: '#9fb58a', lift: 'rgba(200,215,190,0.10)' }, leaf: [0.38, 0.06, 0.38, 0.17], mount: 0x7d8796, mountSnow: true, sun: [0.5, 0.45, 0.6], sunColor: 0xfff4e0, sunI: 3.0,
    hemi: [0xc7dcff, 0x3c4a35, 0.8],
  },
  desert: {
    decor: 'desert', sky: [0x3b7fd8, 0xa7cdf0, 0xf6e4c4], fog: 0xecd9b4, fogNear: 320, fogFar: 3000,
    grass: 0xffffff, ground: { tint: '#d8b26a', lift: 'rgba(255,225,170,0.30)' }, leaf: [0.1, 0.4, 0.5, 0.3], mount: 0xb98b5e, sun: [-0.2, 0.7, 0.55], sunColor: 0xfff0cf, sunI: 3.5,
    hemi: [0xffe9c4, 0x8a6a3e, 0.8],
  },
  city: {
    decor: 'city', sky: [0x31497c, 0xe0906a, 0xffc99a], fog: 0xf0b890, fogNear: 180, fogFar: 1800,
    grass: 0xffffff, ground: { tint: '#7d848c', lift: 'rgba(200,205,210,0.14)' }, leaf: [0.3, 0.1, 0.35, 0.2], mount: 0x6b6f86, sun: [-0.7, 0.22, 0.55], sunColor: 0xffb877, sunI: 3.4,
    hemi: [0xffd1a8, 0x3a3f52, 0.75],
  },
  police: {
    decor: 'city', sky: [0x2a64c4, 0x86b9ec, 0xdbe8f3], fog: 0xcdd9e4, fogNear: 240, fogFar: 2600,
    grass: 0xffffff, ground: { tint: '#6f7b63', lift: 'rgba(190,200,175,0.10)' }, leaf: [0.3, 0.1, 0.35, 0.2], mount: 0x6b6f86, sun: [-0.5, 0.62, 0.6], sunColor: 0xfff2dc, sunI: 3.3,
    hemi: [0xcfe3ff, 0x59606a, 0.95],
  },
  snow: {
    decor: 'snow', sky: [0x5f86b3, 0xb5cde4, 0xeef4fa], fog: 0xe3ecf4, fogNear: 150, fogFar: 1700,
    grass: 0xffffff, ground: { tint: '#e8f0f8', lift: 'rgba(255,255,255,0.74)' }, leaf: [0.47, 0.08, 0.16, 0.6], mount: 0xdfe8f2, mountSnow: true, sun: [0.3, 0.38, 0.8], sunColor: 0xeaf2ff, sunI: 2.7,
    hemi: [0xe3efff, 0x9fb0c4, 0.95],
  },
  coast: {
    decor: 'coast', sky: [0x1976d8, 0x5fb4f2, 0xcdeaf8], fog: 0xbfe0f2, fogNear: 300, fogFar: 3000,
    grass: 0xffffff, ground: { tint: '#e0cf9a', lift: 'rgba(255,240,200,0.32)' }, leaf: [0.3, 0.6, 0.5, 0.3], mount: 0x5f8f9c, sun: [0.1, 0.6, 0.7], sunColor: 0xfff6dd, sunI: 3.3,
    hemi: [0xd6f0ff, 0x6a7a55, 0.9],
  },
  arena: {
    decor: 'arena', sky: [0x0b1230, 0x2a2f6a, 0x7a5a9a], fog: 0x2a2850, fogNear: 120, fogFar: 1500,
    grass: 0xffffff, ground: { tint: '#3d4866', lift: 'rgba(80,100,160,0.10)' }, leaf: [0.6, 0.2, 0.3, 0.15], mount: 0x232846, sun: [-0.5, 0.35, -0.6], sunColor: 0xb7c4ff, sunI: 1.5,
    hemi: [0x8a9bff, 0x1c2036, 0.7], night: true,
  },
  sunset: {
    decor: 'arena', sky: [0x2a2158, 0xd8605a, 0xffc07a], fog: 0xf0a878, fogNear: 200, fogFar: 2200,
    grass: 0xffffff, ground: { tint: '#8d9a6e', lift: 'rgba(255,170,110,0.14)' }, leaf: [0.3, 0.1, 0.3, 0.2], mount: 0x7a4e6a, sun: [0.8, 0.14, 0.4], sunColor: 0xffa060, sunI: 3.6,
    hemi: [0xffc9a0, 0x3c3050, 0.7],
  },
};

export const TRACKS = [
  // ------------------------------------------------------------------ ROADS
  {
    id: 'classic', group: 'road', name: 'Klassik Speedway', desc: "Uzun to'g'ri yo'llar va tez burilishlar", theme: 'forest', laps: 3, level: 2, scale: 0.85,
    points: [
      [0, -320], [0, -80], [0, 160], [0, 400],
      [-50, 520], [-160, 580], [-300, 570], [-400, 500],
      [-430, 380], [-360, 290], [-250, 260], [-170, 200],
      [-190, 100], [-290, 40], [-400, -20], [-470, -130],
      [-450, -260], [-360, -340], [-240, -330], [-170, -420],
      [-190, -540], [-300, -600], [-430, -640], [-500, -740],
      [-430, -840], [-270, -850], [-120, -800], [-20, -700],
      [40, -560],
    ],
  },
  {
    id: 'alps', group: 'road', name: "Tog' serpantini", desc: "Qor cho'qqilari orasida egri-bugri yo'l", theme: 'mountain', laps: 3, level: 4, scale: 1,
    points: [
      [0, -60], [0, 140], [10, 300], [70, 400], [190, 440], [300, 400], [340, 300],
      [270, 210], [150, 170], [80, 90], [120, -20], [240, -60], [350, -130], [380, -250],
      [320, -360], [200, -400], [110, -470], [120, -590], [210, -670], [210, -790],
      [110, -860], [-40, -850], [-150, -790], [-190, -690], [-130, -590], [-110, -470], [-120, -380], [0, -260],
    ],
  },
  {
    id: 'desert', group: 'road', name: "Cho'l avtobani", desc: "Cheksiz tezlik: juda uzun to'g'ri yo'llar", theme: 'desert', laps: 2, level: 1, scale: 1,
    points: fillet([[0, -150], [0, 700], [550, 700], [550, 100], [950, 100], [950, -500], [0, -500]], [0, 170, 170, 130, 130, 170, 170]),
  },
  {
    id: 'city', group: 'road', name: "Shahar ko'chalari", desc: "Burchak-burchak texnik shahar trassasi", theme: 'city', laps: 3, level: 4, scale: 1,
    points: fillet([[0, -200], [0, 300], [260, 300], [260, 150], [520, 150], [520, -250], [330, -250], [330, -100], [130, -100], [130, -350], [0, -350]], 50),
  },
  {
    id: 'coast', group: 'road', name: 'Sohil yo\'li', desc: "Dengiz bo'yida silliq S-shaklli burilishlar", theme: 'coast', laps: 3, level: 3, scale: 1,
    points: [
      [0, -300], [0, -100], [0, 100], [10, 280], [60, 400], [160, 470], [280, 480], [380, 430],
      [440, 340], [430, 230], [360, 150], [270, 100], [230, 20], [270, -60], [370, -100], [460, -160],
      [500, -260], [470, -370], [380, -440], [260, -470], [160, -540], [130, -650], [190, -740],
      [180, -840], [100, -900], [-20, -880], [-100, -800], [-130, -690], [-100, -580], [-40, -460],
    ],
  },

  // ------------------------------------------------------------------ ROUND TRACKS
  {
    id: 'circle', group: 'ring', name: 'Katta Aylana', desc: 'Mukammal doira — drift uchun ideal', theme: 'sunset', laps: 5, level: 1, scale: 1,
    points: ring(32, a => [r1(Math.sin(a) * -260), r1(-Math.cos(a) * -260)]),
  },
  {
    id: 'oval', group: 'ring', name: 'Oval Superspeedway', desc: "Ikki uzun to'g'ri va ikki tik burilish", theme: 'forest', laps: 4, level: 2, scale: 1,
    points: (() => {
      // stadium: two 360 m straights joined by half-circles of radius 190 m; the line sits mid-straight
      const R = 190, S = 180, pts = [[R, 0], [R, -S]];
      for (let d = 20; d < 180; d += 20) pts.push([r1(R * Math.cos(d * Math.PI / 180)), r1(-S - R * Math.sin(d * Math.PI / 180))]);
      pts.push([-R, -S], [-R, 0], [-R, S]);
      for (let d = 20; d < 180; d += 20) pts.push([r1(-R * Math.cos(d * Math.PI / 180)), r1(S + R * Math.sin(d * Math.PI / 180))]);
      pts.push([R, S]);
      return pts;
    })(),
  },
  {
    id: 'tri', group: 'ring', name: 'Uchburchak Ring', desc: 'Yumaloqlangan uchburchak — 3 ta tez burilish', theme: 'desert', laps: 4, level: 3, scale: 1,
    points: ring(36, a => {
      const k = 1 + 0.17 * Math.cos(3 * a);
      return [r1(Math.sin(a) * 300 * k), r1(Math.cos(a) * 300 * k)];
    }, Math.PI / 3),
  },
  {
    id: 'flower', group: 'ring', name: 'Gul Arena', desc: "Gulbarg shaklidagi egri halqa — tinimsiz burilish", theme: 'arena', laps: 4, level: 4, scale: 1,
    points: ring(48, a => {
      const k = 1 + 0.14 * Math.cos(5 * a);
      return [r1(Math.sin(a) * 300 * k), r1(Math.cos(a) * 300 * k)];
    }, Math.PI / 10),
  },
  {
    id: 'peanut', group: 'ring', name: "Yong'oq Ring", desc: "Ikki katta yoy va o'rtada tor bo'g'iz", theme: 'snow', laps: 4, level: 3, scale: 1,
    points: ring(44, a => {
      const s = Math.sin(a), c = Math.cos(a);
      const r = 1 - 0.28 * s * s;          // pinch the waist
      return [r1(s * 190 * r), r1(c * 360)];
    }, Math.PI / 2),
  },

  // ------------------------------------------------------------------ BATTLE ARENA (hidden from the track picker: group 'arena' is not listed in GROUPS)
  {
    id: 'arena', group: 'arena', name: 'Jang Arena', desc: "Mashinalar to'qnashadigan ichi ochiq doira", theme: 'arena', laps: 1, level: 1, scale: 1, open: true,
    points: ring(40, a => [r1(Math.sin(a) * -110), r1(-Math.cos(a) * -110)]),
  },
];

export const THEME = id => THEMES[id] || THEMES.forest;
export const GROUPS = [
  { id: 'road', title: "Yo'llar", sub: 'Klassik poyga trassalari' },
  { id: 'ring', title: 'Aylana yo\'llar', sub: 'Yumaloq, tezkor halqalar' },
];
