// Xarita ma'lumotidan (decor.js) three.js sahnasini quradi.
import * as THREE from 'three';
import { Geo, hex3 } from './geo.js';
import { CELL, WALL_H } from './levels.js';
import { DOOR_W, DOOR_H, WALL_T } from './mapgen.js';
import { makeTexture } from './textures.js';
import { hash32 } from './rng.js';

const CHUNK = 14;      // m

function chunked(geo, material, parent, { cast = false, receive = true } = {}) {
  const triCount = geo.p.length / 9;
  const buckets = new Map();
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const cx = (geo.p[i] + geo.p[i + 3] + geo.p[i + 6]) / 3, cz = (geo.p[i + 2] + geo.p[i + 5] + geo.p[i + 8]) / 3;
    const key = Math.floor(cx / CHUNK) * 1000 + Math.floor(cz / CHUNK);
    let b = buckets.get(key); if (!b) buckets.set(key, b = []);
    b.push(t);
  }
  const meshes = [];
  for (const tris of buckets.values()) {
    const n = tris.length * 3;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let k = 0;
    for (const t of tris) {
      for (let v = 0; v < 3; v++, k++) {
        const s = t * 3 + v;
        pos[k * 3] = geo.p[s * 3]; pos[k * 3 + 1] = geo.p[s * 3 + 1]; pos[k * 3 + 2] = geo.p[s * 3 + 2];
        nor[k * 3] = geo.n[s * 3]; nor[k * 3 + 1] = geo.n[s * 3 + 1]; nor[k * 3 + 2] = geo.n[s * 3 + 2];
        col[k * 3] = geo.c[s * 3]; col[k * 3 + 1] = geo.c[s * 3 + 1]; col[k * 3 + 2] = geo.c[s * 3 + 2];
        uv[k * 2] = geo.uv[s * 2]; uv[k * 2 + 1] = geo.uv[s * 2 + 1];
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = cast; m.receiveShadow = receive; m.matrixAutoUpdate = false;
    parent.add(m); meshes.push(m);
  }
  return meshes;
}

export function buildWorld(map) {
  const root = new THREE.Group();
  const cfg = map.cfg;
  const tintW = hex3(cfg.tintWall), tintF = hex3(cfg.tintFloor);

  // ---------- devorlar + eshik ustlari
  const wg = new Geo();
  const wallCol = tintW;
  for (const w of map.walls) {
    wg.box((w.x0 + w.x1) / 2, WALL_H / 2, (w.z0 + w.z1) / 2, w.x1 - w.x0, WALL_H, w.z1 - w.z0, wallCol, 0, true, 1 / CELL, 63 & ~32 & ~16);
    // yuqori qirra (ko'rinmaydi, lekin ceiling bilan yopilgan)
  }
  for (const l of map.lintels) wg.box((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, (l.z0 + l.z1) / 2, l.x1 - l.x0, l.y1 - l.y0, l.z1 - l.z0, wallCol, 0, true, 1 / CELL);
  // plinth (taxta panel chizig'i)
  const wallTex = makeTexture(cfg.wall, 3 + map.level);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 0.95, metalness: 0 });

  // ---------- pol va shift
  const fg = new Geo(), cg = new Geo();
  const sc = 1 / (CELL * 1.0);
  for (let y = 0; y < map.H; y++) for (let x = 0; x < map.W; x++) {
    const rid = map.region[y * map.W + x];
    const v = 0.82 + (hash32(rid, 5) % 100) / 100 * 0.35;
    const col = [tintF[0] * v, tintF[1] * v, tintF[2] * v];
    const x0 = x * CELL, x1 = x0 + CELL, z0 = y * CELL, z1 = z0 + CELL;
    fg.quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0], col, [x0 * sc, z0 * sc, x0 * sc, z1 * sc, x1 * sc, z1 * sc, x1 * sc, z0 * sc]);
    cg.quad([x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1], [0, -1, 0], [tintW[0] * 0.55, tintW[1] * 0.55, tintW[2] * 0.55], [x0 * sc, z0 * sc, x1 * sc, z0 * sc, x1 * sc, z1 * sc, x0 * sc, z1 * sc]);
  }
  const floorTex = makeTexture(cfg.floor, 11 + map.level);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, vertexColors: true, roughness: 0.85, metalness: 0.02 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 1, metalness: 0 });

  // ---------- jihozlar
  const decorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const walls = chunked(wg, wallMat, root, { cast: true });
  chunked(fg, floorMat, root, { cast: false });
  chunked(cg, ceilMat, root, { cast: false });
  chunked(map.geo, decorMat, root, { cast: true });
  const glows = chunked(map.glow, glowMat, root, { cast: false, receive: false });
  void walls; void glows;

  const disposables = [wallMat, floorMat, ceilMat, decorMat, glowMat];
  return { root, dispose() { root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); disposables.forEach(m => m.dispose()); } };
}

// ----------------------------------------------------------------- eshiklar
export function buildDoors(map) {
  const group = new THREE.Group();
  const tone = new THREE.Color(map.cfg.tintFloor).multiplyScalar(0.9);
  const mat = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.8, map: makeTexture('planks', 21) });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.6 });
  const geo = new THREE.BoxGeometry(DOOR_W - 0.04, DOOR_H - 0.02, 0.07); geo.translate((DOOR_W - 0.04) / 2, (DOOR_H - 0.02) / 2, 0);
  const knobGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const doors = [];
  for (const d of map.doors) {
    const pivot = new THREE.Group();
    const panel = new THREE.Mesh(geo, mat); panel.castShadow = true; panel.receiveShadow = true;
    const knob = new THREE.Mesh(knobGeo, matDark); knob.position.set(DOOR_W - 0.2, 1.05, 0.07); panel.add(knob);
    const knob2 = knob.clone(); knob2.position.z = -0.07; panel.add(knob2);
    pivot.add(panel);
    let base, px, pz, box;
    if (d.d === 0) { base = -Math.PI / 2; px = d.x; pz = d.z - DOOR_W / 2; box = { x0: d.x - 0.05, x1: d.x + 0.05, z0: d.z - DOOR_W / 2, z1: d.z + DOOR_W / 2 }; }
    else { base = 0; px = d.x - DOOR_W / 2; pz = d.z; box = { x0: d.x - DOOR_W / 2, x1: d.x + DOOR_W / 2, z0: d.z - 0.05, z1: d.z + 0.05 }; }
    pivot.position.set(px, 0, pz); pivot.rotation.y = base;
    group.add(pivot);
    doors.push({ id: d.id, d: d.d, x: d.x, z: d.z, pivot, base, open: 0, target: 0, lockUntil: 0, closeAt: 0, box: { ...box, on: true, blocksSight: true }, side: 1, creak: 0, slam: 0 });
  }
  return { group, doors, dispose() { geo.dispose(); knobGeo.dispose(); mat.dispose(); matDark.dispose(); } };
}

// ----------------------------------------------------------------- chiqish eshigi (panjara)
export function buildExit(map) {
  const ex = map.exit;
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2f2c, roughness: 0.45, metalness: 0.8 });
  const gate = new THREE.Group();
  const w = DOOR_W + 0.5, h = DOOR_H + 0.4;
  const bars = new THREE.Group();
  for (let i = -5; i <= 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), metal); b.position.set(i * (w / 11), h / 2, 0); bars.add(b); }
  for (const y of [0.05, h / 2, h - 0.05]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.06), metal); b.position.set(0, y, 0); bars.add(b); }
  // qulf
  const lockMat = new THREE.MeshStandardMaterial({ color: 0xb08a2a, roughness: 0.4, metalness: 0.9, emissive: 0x332200, emissiveIntensity: 0.6 });
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.1), lockMat); lock.position.set(0, 1.1, 0.06); bars.add(lock);
  gate.add(bars);
  // kenglik: devor bo'ylab
  gate.position.set(ex.x, 0, ex.z);
  gate.rotation.y = ex.vertical ? Math.PI / 2 : 0;
  group.add(gate);
  // tashqi nur (eshik ochilganda): yassi yorqin tekislik
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const light = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), lightMat);
  light.position.set(ex.x + ex.nx * 3.2, 3, ex.z + ex.nz * 3.2);
  light.rotation.y = ex.vertical ? Math.PI / 2 : 0;
  group.add(light);
  const box = ex.vertical
    ? { x0: ex.x - 0.12, x1: ex.x + 0.12, z0: ex.z - w / 2, z1: ex.z + w / 2, on: true }
    : { x0: ex.x - w / 2, x1: ex.x + w / 2, z0: ex.z - 0.12, z1: ex.z + 0.12, on: true };
  return { group, gate, bars, lockMat, lightMat, box, open: 0, openTarget: 0, dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); metal.dispose(); lockMat.dispose(); lightMat.dispose(); } };
}

// ----------------------------------------------------------------- shkaflar
export function buildCabinets(map) {
  const group = new THREE.Group();
  const out = [];
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xffd04a, emissive: 0xffa000, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.9 });
  const keyGeo = (() => { const g = new THREE.Group(); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 12), keyMat); ring.position.y = 0.09; const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), keyMat); const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.02), keyMat); t1.position.set(0.04, -0.07, 0); const t2 = t1.clone(); t2.position.y = -0.03; t2.scale.x = 0.7; g.add(ring, shaft, t1, t2); return g; })();
  const mats = {
    wardrobe: new THREE.MeshStandardMaterial({ color: 0x4a2f20, roughness: 0.8, map: makeTexture('planks', 31) }),
    dresser: new THREE.MeshStandardMaterial({ color: 0x5a3b28, roughness: 0.8, map: makeTexture('planks', 32) }),
    locker: new THREE.MeshStandardMaterial({ color: 0x5b6a68, roughness: 0.5, metalness: 0.6 }),
  };
  const inside = new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 1 });
  const handle = new THREE.MeshStandardMaterial({ color: 0xa08a50, roughness: 0.4, metalness: 0.9 });
  for (const c of map.cabinets) {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z); g.rotation.y = c.rot;
    const mat = mats[c.kind];
    const body = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d - 0.04), mat); body.position.set(0, c.h / 2, (c.d - 0.04) / 2); body.castShadow = true; body.receiveShadow = true; g.add(body);
    // ichki qorong'u panel (eshik ochilganda ko'rinadi)
    const hole = new THREE.Mesh(new THREE.BoxGeometry(c.w - 0.14, c.h - 0.16, 0.02), inside); hole.position.set(0, c.h / 2, c.d - 0.035); g.add(hole);
    for (let i = 1; i <= 2; i++) { const sh = new THREE.Mesh(new THREE.BoxGeometry(c.w - 0.14, 0.03, 0.2), mat); sh.position.set(0, (c.h * i) / 3, c.d - 0.15); g.add(sh); }
    const nDoors = c.kind === 'locker' ? 1 : 2;
    const doors = [];
    for (let i = 0; i < nDoors; i++) {
      const dw = (c.w - 0.04) / nDoors;
      const geo = new THREE.BoxGeometry(dw, c.h - 0.06, 0.04);
      const pivot = new THREE.Group();
      const hinge = nDoors === 1 ? -c.w / 2 + 0.02 : (i === 0 ? -c.w / 2 + 0.02 : c.w / 2 - 0.02);
      pivot.position.set(hinge, c.h / 2, c.d - 0.01);
      const door = new THREE.Mesh(geo, mat); door.position.x = nDoors === 1 ? dw / 2 : (i === 0 ? dw / 2 : -dw / 2); door.castShadow = true;
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), handle); h.position.set(nDoors === 1 ? dw - 0.07 : (i === 0 ? dw - 0.07 : -dw + 0.07), 0, 0.04); door.add(h);
      pivot.add(door); g.add(pivot);
      doors.push({ pivot, sign: nDoors === 1 ? -1 : (i === 0 ? -1 : 1) });
    }
    let key = null;
    if (c.hasKey) { key = keyGeo.clone(true); key.position.set(0, c.kind === 'dresser' ? 0.6 : 1.1, c.d - 0.25); key.visible = false; g.add(key); }
    group.add(g);
    out.push({ ...c, group: g, doors, key, openAmt: 0, openTarget: 0, searching: 0 });
  }
  return { group, list: out, dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); Object.values(mats).forEach(m => m.dispose()); inside.dispose(); handle.dispose(); keyMat.dispose(); } };
}

// ----------------------------------------------------------------- lampalar
export function buildLamps(map) {
  const group = new THREE.Group();
  const lamps = [];
  const cordMat = new THREE.MeshBasicMaterial({ color: 0x15151a });
  for (const r of map.rooms) {
    if (!r.lamp) continue;
    const L = r.lamp;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(L.kind === 'chandelier' ? 0.07 : 0.1, 8, 6), mat);
    bulb.position.set(L.x, L.y, L.z); group.add(bulb);
    if (L.kind === 'bulb') { const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, WALL_H - L.y, 4), cordMat); cord.position.set(L.x, (WALL_H + L.y) / 2, L.z); group.add(cord); }
    lamps.push({ room: r.id, x: L.x, y: L.y, z: L.z, mode: L.mode, seed: L.seed, mat, bulb, level: 0, hue: 0 });
  }
  return { group, lamps, dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); }); } };
}

// lampa yorqinligi (0..1): holatga qarab chaqnaydi. ghostNear 0..1 => ko'proq chaqnaydi
export function lampLevel(l, t, ghostNear = 0, blackout = false) {
  if (blackout) return 0;
  const s = l.seed;
  let v;
  switch (l.mode) {
    case 'flicker': { const a = Math.sin(t * 17 + s) * Math.sin(t * 5.3 + s * 2) + Math.sin(t * 31 + s * 3) * 0.5; v = a > 0.35 ? 1 : a > -0.4 ? 0.5 : 0.08; break; }
    case 'strobe': { const p = (t * 1.3 + s) % 4; v = p < 0.12 ? 0.05 : p < 0.3 ? 1 : p < 2.6 ? 0.75 : (Math.sin(t * 40) > 0 ? 0.9 : 0.1); break; }
    case 'dying': { const p = (t * 0.45 + s) % 7; v = p < 5 ? 0.3 + 0.1 * Math.sin(t * 3 + s) : (Math.sin(t * 25) > 0.1 ? 0.9 : 0); break; }
    default: v = 0.55 + 0.08 * Math.sin(t * 2 + s);
  }
  if (ghostNear > 0) { const j = Math.sin(t * 43 + s * 5) > 0 - ghostNear ? 1 : 0.05; v *= ghostNear > 0.5 ? j : (0.4 + 0.6 * j); }
  return v;
}

// ----------------------------------------------------------------- otiladigan narsalar
export const THROW_R = 0.16;
const TM = {};
function tmat(c, o = {}) { const k = c + JSON.stringify(o); return TM[k] || (TM[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o })); }
export function makeThrowable(type) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  switch (type) {
    case 'bottle': add(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), tmat(0x2f6a3a, { transparent: true, opacity: 0.85 })); add(new THREE.CylinderGeometry(0.02, 0.025, 0.1, 6), tmat(0x2f6a3a, { transparent: true, opacity: 0.85 }), 0, 0.15); break;
    case 'skull': add(new THREE.SphereGeometry(0.1, 8, 6), tmat(0xd9d3bd)); add(new THREE.BoxGeometry(0.08, 0.05, 0.08), tmat(0xd9d3bd), 0, -0.08, 0.02); add(new THREE.SphereGeometry(0.025, 5, 4), tmat(0x000000), -0.035, 0.01, 0.085); add(new THREE.SphereGeometry(0.025, 5, 4), tmat(0x000000), 0.035, 0.01, 0.085); break;
    case 'book': add(new THREE.BoxGeometry(0.2, 0.05, 0.28), tmat(0x5a2226)); add(new THREE.BoxGeometry(0.19, 0.04, 0.27), tmat(0xcbbf99), 0.01, 0, 0); break;
    case 'doll': add(new THREE.SphereGeometry(0.08, 8, 6), tmat(0xc79a82)); add(new THREE.BoxGeometry(0.12, 0.2, 0.07), tmat(0x7a4a7a), 0, -0.16); add(new THREE.SphereGeometry(0.018, 4, 4), tmat(0xaa0000, { emissive: 0x880000 }), -0.03, 0.01, 0.07); add(new THREE.SphereGeometry(0.018, 4, 4), tmat(0xaa0000, { emissive: 0x880000 }), 0.03, 0.01, 0.07); break;
    case 'pot': add(new THREE.CylinderGeometry(0.1, 0.07, 0.14, 8), tmat(0x6a3a22)); break;
    case 'brick': add(new THREE.BoxGeometry(0.22, 0.07, 0.1), tmat(0x8a4a3a)); break;
    case 'teddy': add(new THREE.SphereGeometry(0.1, 8, 6), tmat(0x6a4a30)); add(new THREE.SphereGeometry(0.065, 8, 6), tmat(0x6a4a30), 0, 0.12); add(new THREE.SphereGeometry(0.025, 5, 4), tmat(0x6a4a30), -0.05, 0.18); add(new THREE.SphereGeometry(0.025, 5, 4), tmat(0x6a4a30), 0.05, 0.18); break;
    default: add(new THREE.CylinderGeometry(0.06, 0.08, 0.16, 8), tmat(0x555a5e, { metalness: 0.7 })); add(new THREE.SphereGeometry(0.04, 6, 4), tmat(0xffc060, { emissive: 0xffa030 }), 0, 0.02);
  }
  return g;
}
