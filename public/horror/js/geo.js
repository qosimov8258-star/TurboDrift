// Oddiy uchburchak geometriya yig'uvchi (three.js'siz — Node'da ham ishlaydi).
// Hamma narsa bitta katta BufferGeometry'ga yig'iladi => bitta draw call.
export function hex3(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }
const tint = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

export class Geo {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.ox = 0; this.oz = 0; this.cs = 1; this.sn = 0; this.shade = 1; }
  // lokal koordinata sistemasi (devorga orqa tomoni bilan): x — devor bo'ylab, z — xonaga qarab
  local(x, z, rot = 0) { this.ox = x; this.oz = z; this.sn = Math.sin(rot); this.cs = Math.cos(rot); return this; }
  reset() { return this.local(0, 0, 0); }
  tx(x, z) { return this.ox + x * this.cs + z * this.sn; }
  tz(x, z) { return this.oz - x * this.sn + z * this.cs; }
  _v(x, y, z) { this.p.push(this.tx(x, z), y, this.tz(x, z)); }
  _n(nx, ny, nz) { const X = nx * this.cs + nz * this.sn, Z = -nx * this.sn + nz * this.cs; this.n.push(X, ny, Z); }
  tri(a, b, c, nrm, col, uvs) {
    // sirt tomoni (soat miliga teskari) normalga qarab ketishi uchun: kerak bo'lsa b va c almashtiriladi
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * nrm[0] + gy * nrm[1] + gz * nrm[2] < 0) {
      [b, c] = [c, b];
      if (uvs) uvs = [uvs[0], uvs[1], uvs[4], uvs[5], uvs[2], uvs[3]];
    }
    for (const v of [a, b, c]) this._v(v[0], v[1], v[2]);
    for (let i = 0; i < 3; i++) { this._n(nrm[0], nrm[1], nrm[2]); this.c.push(col[0] * this.shade, col[1] * this.shade, col[2] * this.shade); }
    if (uvs) this.uv.push(...uvs); else this.uv.push(0, 0, 0, 0, 0, 0);
  }
  quad(a, b, c, d, nrm, col, uvs) {      // a,b,c,d soat miliga teskari
    const u = uvs || [0, 0, 1, 0, 1, 1, 0, 1];
    this.tri(a, b, c, nrm, col, [u[0], u[1], u[2], u[3], u[4], u[5]]);
    this.tri(a, c, d, nrm, col, [u[0], u[1], u[4], u[5], u[6], u[7]]);
  }
  // markazi (cx,cy,cz), o'lchami (sx,sy,sz), lokal Y atrofida ry burilgan quti. uvw=true => dunyo bo'yicha tekstura koordinatasi
  box(cx, cy, cz, sx, sy, sz, color, ry = 0, uvw = false, uvs = 1 / 2.5, faces = 63) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, cr = Math.cos(ry), sr = Math.sin(ry);
    const P = (x, y, z) => [cx + x * cr + z * sr, cy + y, cz - x * sr + z * cr];
    const N = (x, y, z) => [x * cr + z * sr, y, -x * sr + z * cr];
    const col = Array.isArray(color) ? color : hex3(color);
    const W = (p, ax) => (ax === 'x' ? [this.tx(p[0], p[2]), p[1]] : ax === 'z' ? [this.tz(p[0], p[2]), p[1]] : [this.tx(p[0], p[2]), this.tz(p[0], p[2])]);
    const face = (bit, a, b, c, d, nrm, ax, shade) => {
      if (!(faces & bit)) return;
      let uvv;
      if (uvw) {
        const pts = [a, b, c, d].map(p => { const w = ax === 'x' ? [this.tz(p[0], p[2]), p[1]] : ax === 'z' ? [this.tx(p[0], p[2]), p[1]] : [this.tx(p[0], p[2]), this.tz(p[0], p[2])]; return [w[0] * uvs, w[1] * uvs]; });
        uvv = [pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]];
      }
      this.quad(a, b, c, d, nrm, shade ? tint(col, shade) : col, uvv);
    };
    // +z, -z, +x, -x, +y, -y
    face(1, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 0, 1), 'z', 1);
    face(2, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N(0, 0, -1), 'z', 0.94);
    face(4, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), N(1, 0, 0), 'x', 0.9);
    face(8, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N(-1, 0, 0), 'x', 0.88);
    face(16, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), N(0, 1, 0), 'y', 1.08);
    face(32, P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), N(0, -1, 0), 'y', 0.6);
  }
  // tik silindr (yoki konus: rTop). segment soni kam — "low poly" ko'rinish
  cyl(cx, cy, cz, r, h, color, seg = 10, rTop = r, rBot = r) {
    const col = Array.isArray(color) ? color : hex3(color);
    const y0 = cy - h / 2, y1 = cy + h / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const nrm = [Math.cos(am), 0, Math.sin(am)], sh = 0.85 + 0.15 * Math.cos(am - 0.8);
      this.quad([cx + c0 * rBot, y0, cz + s0 * rBot], [cx + c1 * rBot, y0, cz + s1 * rBot], [cx + c1 * rTop, y1, cz + s1 * rTop], [cx + c0 * rTop, y1, cz + s0 * rTop], nrm, tint(col, sh));
      if (rTop > 0) this.tri([cx, y1, cz], [cx + c0 * rTop, y1, cz + s0 * rTop], [cx + c1 * rTop, y1, cz + s1 * rTop], [0, 1, 0], tint(col, 1.1));
      if (rBot > 0) this.tri([cx, y0, cz], [cx + c1 * rBot, y0, cz + s1 * rBot], [cx + c0 * rBot, y0, cz + s0 * rBot], [0, -1, 0], tint(col, 0.6));
    }
  }
  sphere(cx, cy, cz, r, color, seg = 8, sy = 1) {
    const col = Array.isArray(color) ? color : hex3(color), rings = Math.max(3, seg >> 1);
    const pt = (i, j) => { const th = (i / rings) * Math.PI, ph = (j / seg) * Math.PI * 2; return [cx + r * Math.sin(th) * Math.cos(ph), cy + r * sy * Math.cos(th), cz + r * Math.sin(th) * Math.sin(ph)]; };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      const nm = [(a[0] + c[0]) / 2 - cx, ((a[1] + c[1]) / 2 - cy) / sy, (a[2] + c[2]) / 2 - cz], l = Math.hypot(nm[0], nm[1], nm[2]) || 1;
      const nn = [nm[0] / l, nm[1] / l, nm[2] / l], sh = 0.8 + 0.3 * Math.max(0, nn[1]);
      this.quad(a, b, c, d, nn, tint(col, sh));
    }
  }
  // yerga yotgan yassi dumaloq (qon dog'i, ritual doirasi)
  disc(cx, cy, cz, r, color, seg = 12) {
    const col = Array.isArray(color) ? color : hex3(color);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri([cx, cy, cz], [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], [0, 1, 0], col);
    }
  }
  ring(cx, cy, cz, r0, r1, color, seg = 24) {
    const col = Array.isArray(color) ? color : hex3(color);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad([cx + c0 * r0, cy, cz + s0 * r0], [cx + c1 * r0, cy, cz + s1 * r0], [cx + c1 * r1, cy, cz + s1 * r1], [cx + c0 * r1, cy, cz + s0 * r1], [0, 1, 0], col);
    }
  }
  get vertexCount() { return this.p.length / 3; }
}
