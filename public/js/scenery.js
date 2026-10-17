import * as THREE from 'three';
import { WALL_D } from './track.js';
import * as TX from './textures.js';

// Theme specific roadside decor. Everything is instanced -> a handful of draw calls per track.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

/** pick `count` spots at least `minOff` metres away from the road; calls put(pos, r, side, i) */
function scatter(track, count, seed, minOff, spread, put) {
  const { N, P } = track, r = rng(seed), pp = V3(0, 0, 0);
  const lim = (WALL_D + minOff - 2) ** 2;
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 40) {
    tries++;
    const i = Math.floor(r() * N), sg = r() > 0.5 ? 1 : -1, off = WALL_D + minOff + r() * spread;
    track.at(i, sg * off, pp);
    let ok = true;
    for (let k = 0; k < N; k += 3) { const dx = P[k].x - pp.x, dz = P[k].z - pp.z; if (dx * dx + dz * dz < lim) { ok = false; break; } }
    if (!ok) continue;
    put(pp, r, sg, placed++, i);
  }
  return placed;
}

function inst(geo, mat, n, shadow) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
  return m;
}

function merge(parts) {            // [[geometry, matrix]] -> single non-indexed geometry
  const pos = [], nor = [];
  for (const [g0, mx] of parts) {
    const g = g0.toNonIndexed(); g.applyMatrix4(mx);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
const T = (x, y, z, ry = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), V3(1, 1, 1));

export function decorate(track, root, th, quality) {
  const shadow = quality === 'high' || quality === 'ultra';
  const light = quality === 'low' || quality === 'medium';
  const fn = { desert, city, coast, arena }[th.decor];
  if (fn) fn(track, root, th, shadow, light);
  lampPosts(track, root, th, light);
}

// ------------------------------------------------------------------ desert: cacti + rocks + dunes
function desert(track, root, th, shadow, light) {
  const n = light ? 140 : 320;
  const cactus = merge([
    [new THREE.CylinderGeometry(0.35, 0.42, 4.2, 8).translate(0, 2.1, 0), T(0, 0, 0)],
    [new THREE.CylinderGeometry(0.22, 0.26, 1.7, 7).translate(0, 0.85, 0), T(0.75, 1.5, 0)],
    [new THREE.CylinderGeometry(0.22, 0.22, 1.2, 7).translate(0, 0.6, 0), T(0.7, 0.95, 0, 0, Math.PI / 2)],
    [new THREE.CylinderGeometry(0.2, 0.24, 1.4, 7).translate(0, 0.7, 0), T(-0.7, 2.0, 0)],
    [new THREE.CylinderGeometry(0.2, 0.2, 1.0, 7).translate(0, 0.5, 0), T(-0.65, 1.45, 0, 0, Math.PI / 2)],
  ]);
  const cac = inst(cactus, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), n, shadow);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V3(1, 1, 1), col = new THREE.Color();
  const got = scatter(track, n, 4242, 9, 120, (p, r, sg, i) => {
    const s = 0.8 + r() * 1.1; q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0)); sc.set(s, s * (0.8 + r() * 0.5), s);
    m4.compose(p, q, sc); cac.setMatrixAt(i, m4); col.setHSL(0.27 + r() * 0.05, 0.4, 0.25 + r() * 0.1); cac.setColorAt(i, col);
  });
  cac.count = got; root.add(cac);

  const rocks = inst(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), n, shadow);
  const got2 = scatter(track, n, 777, 8, 160, (p, r, sg, i) => {
    const s = 0.8 + r() * 3.2; q.setFromEuler(new THREE.Euler(r() * 3, r() * 6, r() * 3)); sc.set(s * 1.3, s * 0.7, s);
    m4.compose(V3(p.x, s * 0.25, p.z), q, sc); rocks.setMatrixAt(i, m4); col.setHSL(0.07 + r() * 0.03, 0.35, 0.35 + r() * 0.15); rocks.setColorAt(i, col);
  });
  rocks.count = got2; root.add(rocks);

  // soft dunes
  const dune = new THREE.MeshStandardMaterial({ color: th.ground ? th.ground.tint : 0xd8b26a, roughness: 1 });
  for (let k = 0; k < 40; k++) {
    const a = k * 2.399, d = 700 + (k % 7) * 160, w = 160 + (k % 5) * 50;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), dune);
    m.scale.set(w, 18 + (k % 4) * 9, w * 0.7); m.position.set(track.centre.x + Math.cos(a) * d, -1, track.centre.z + Math.sin(a) * d); m.rotation.y = a; root.add(m);
  }
}

// ------------------------------------------------------------------ city: tower blocks with lit windows
function city(track, root, th, shadow, light) {
  const n = light ? 90 : 220;
  const tex = TX.windowTexture();
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.55, metalness: 0.25, emissiveMap: tex, emissive: 0xffd9a0, emissiveIntensity: 0.55 });
  const b = inst(geo, mat, n, shadow);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V3(1, 1, 1), col = new THREE.Color();
  const got = scatter(track, n, 99, 22, 150, (p, r, sg, i, ti) => {
    const w = 18 + r() * 26, d = 18 + r() * 26, h = 25 + Math.pow(r(), 1.6) * 150;
    const hd = track.heading(ti);
    q.setFromEuler(new THREE.Euler(0, hd, 0)); sc.set(w, h, d); m4.compose(p, q, sc); b.setMatrixAt(i, m4);
    col.setHSL(0.58 + r() * 0.08, 0.15 + r() * 0.2, 0.4 + r() * 0.3); b.setColorAt(i, col);
  });
  b.count = got; root.add(b);
}

// ------------------------------------------------------------------ coast: palms + sea + sand
function coast(track, root, th, shadow, light) {
  const n = light ? 120 : 280;
  const trunk = merge([[new THREE.CylinderGeometry(0.22, 0.38, 7, 7).translate(0, 3.5, 0), T(0, 0, 0)]]);
  const fronds = [];
  for (let k = 0; k < 7; k++) {
    const g = new THREE.ConeGeometry(0.7, 5.2, 4).rotateZ(Math.PI / 2 + 0.35).translate(2.4, 0, 0);
    fronds.push([g, new THREE.Matrix4().makeRotationY((k / 7) * Math.PI * 2).setPosition(0, 7.1, 0)]);
  }
  const leaf = merge(fronds);
  const trunks = inst(trunk, new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 }), n, shadow);
  const leaves = inst(leaf, new THREE.MeshStandardMaterial({ color: 0x3e9a46, roughness: 0.8, side: THREE.DoubleSide }), n, shadow);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V3(1, 1, 1);
  const got = scatter(track, n, 31337, 10, 90, (p, r, sg, i) => {
    const s = 0.8 + r() * 0.8; q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0)); sc.set(s, s, s);
    m4.compose(p, q, sc); trunks.setMatrixAt(i, m4); leaves.setMatrixAt(i, m4);
  });
  trunks.count = leaves.count = got; root.add(trunks, leaves);

  // sea on the far side of the map: a big glossy plane well below the sand
  const po = (m, k) => { m.polygonOffset = true; m.polygonOffsetFactor = -k; m.polygonOffsetUnits = -k; return m; };
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), po(new THREE.MeshPhysicalMaterial({ color: 0x1493c9, roughness: 0.08, metalness: 0.1, clearcoat: 1 }), 4));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.079, 0);
  // carve it: sand over the middle, sea only outside a ring around the track
  const c = track.centre;
  let far = 0; for (const p of track.P) far = Math.max(far, Math.hypot(p.x - c.x, p.z - c.z));
  far += 240;                    // sand reaches 240 m past the outermost wall, then the sea starts
  const sandTex = TX.grassTexture(th.ground); sandTex.repeat.set(120, 120);
  const sand = new THREE.Mesh(new THREE.CircleGeometry(far, 96), po(new THREE.MeshStandardMaterial({ map: sandTex, color: th.grass, roughness: 1 }), 8));
  sand.rotation.x = -Math.PI / 2; sand.position.set(c.x, -0.07, c.z); sand.receiveShadow = true;
  const shore = new THREE.Mesh(new THREE.RingGeometry(far - 6, far + 40, 96), po(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }), 10));
  shore.rotation.x = -Math.PI / 2; shore.position.set(c.x, -0.069, c.z);
  root.add(sea, sand, shore);
}

// ------------------------------------------------------------------ arena: night stadium, floodlights, stands, tyre stacks
function arena(track, root, th, shadow, light) {
  const c = track.centre;
  // floodlight towers around the loop (visible emissive heads + glow)
  const pole = new THREE.CylinderGeometry(0.4, 0.6, 38, 8).translate(0, 19, 0);
  const head = new THREE.BoxGeometry(7, 2.4, 1.2).translate(0, 39, 0);
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.7 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });
  const towers = 14;
  const poles = inst(pole, steel, towers, shadow), heads = inst(head, lampMat, towers, false);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V3(1, 1, 1);
  for (let k = 0; k < towers; k++) {
    const i = Math.floor((k + 0.25) * track.N / towers), p = track.at(i, (track.open ? track.outerSg : k % 2 ? 1 : -1) * (WALL_D + 9));
    q.setFromEuler(new THREE.Euler(0, track.heading(i) + Math.PI / 2, 0)); m4.compose(p, q, sc);
    poles.setMatrixAt(k, m4); heads.setMatrixAt(k, m4);
    if (!light && k % 2 === 0) {
      const sp = new THREE.PointLight(0xfff0d0, 900, 220, 1.6); sp.position.set(p.x, 36, p.z); root.add(sp);
    }
  }
  root.add(poles, heads);

  // tyre stacks along both walls (colourful chicane feel)
  const tyreG = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 14);
  const tyres = inst(tyreG, new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.9 }), 900, false);
  const stripe = inst(new THREE.TorusGeometry(0.58, 0.05, 6, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), 900, false);
  let tn = 0;
  const step = Math.round(46 / track.step);
  for (let i = 0; i < track.N && tn < 880; i += step) for (const sg of (track.open ? [track.outerSg] : [1, -1])) {
    const p = track.at(i, sg * (WALL_D + 1.6));
    for (let h = 0; h < 3; h++) { m4.makeTranslation(p.x, 0.21 + h * 0.42, p.z); tyres.setMatrixAt(tn, m4); stripe.setMatrixAt(tn, m4); tn++; }
  }
  tyres.count = stripe.count = tn; root.add(tyres, stripe);

  // neon ring on the horizon
  const neon = new THREE.Mesh(new THREE.TorusGeometry(1500, 3, 8, 160), new THREE.MeshBasicMaterial({ color: 0x35c8ff }));
  neon.rotation.x = Math.PI / 2; neon.position.set(c.x, 160, c.z); root.add(neon);
  const neon2 = neon.clone(); neon2.material = new THREE.MeshBasicMaterial({ color: 0xff3b8d }); neon2.scale.setScalar(0.96); neon2.position.y = 110; root.add(neon2);
}

// ------------------------------------------------------------------ lamp posts along the right-hand wall (cities / arenas / dusk)
function lampPosts(track, root, th, light) {
  if (th.decor !== 'city' && !th.night && th.decor !== 'arena') return;
  const n = Math.min(120, Math.floor(track.length / 38));
  const poleG = merge([
    [new THREE.CylinderGeometry(0.12, 0.16, 8, 6).translate(0, 4, 0), T(0, 0, 0)],
    [new THREE.BoxGeometry(2.4, 0.18, 0.4).translate(-1.1, 8, 0), T(0, 0, 0)],
  ]);
  const poles = inst(poleG, new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.6 }), n, false);
  const bulbs = inst(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), n, false);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V3(1, 1, 1);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(k * track.N / n), sg = track.open ? track.outerSg : k % 2 ? 1 : -1, p = track.at(i, sg * (WALL_D + 2.8));
    const ry = Math.atan2(-sg * track.L[i].x, -sg * track.L[i].z) - Math.PI / 2 + Math.PI;
    q.setFromEuler(new THREE.Euler(0, ry, 0)); m4.compose(p, q, sc); poles.setMatrixAt(k, m4);
    const bp = V3(-1.9, 7.9, 0).applyQuaternion(q).add(p); m4.makeTranslation(bp.x, bp.y, bp.z); bulbs.setMatrixAt(k, m4);
  }
  root.add(poles, bulbs);
}
