// Qahramonlarning oyoq-qo'llarini qo'lda (kod bilan) harakatlantirish.
// Masha — tayyor skeleti bor (suyaklar nomi bo'yicha topiladi). Quyon — skeleti yo'q: shakliga qarab suyaklar yaratiladi va
// tepalar (vertex) joyiga qarab oyoq/qo'llarga biriktiriladi (skinning).
// Burchaklar modelning o'z o'qlarida: x — yon tomon, y — tepa, z — oldinga.
import * as THREE from 'three';

const AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);
const qx = a => new THREE.Quaternion().setFromAxisAngle(AX, a);
const qz = a => new THREE.Quaternion().setFromAxisAngle(AZ, a);
const qy = a => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
const _a = new THREE.Quaternion(), _b = new THREE.Quaternion(), _c = new THREE.Quaternion();
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function findBone(root, re) { let f = null; root.traverse(o => { if (!f && o.isBone && re.test(o.name)) f = o; }); return f; }

export function makeRig(inner, kind) {
  inner.updateMatrixWorld(true);
  const rig = { inner, kind, rest: new Map(), b: {}, drop: 0, side: { l: 1, r: -1 } };
  if (kind === 'bones') {
    const g = (re) => findBone(inner, re);
    rig.b = {
      lArm: g(/Masha_lf_upArm/), lFore: g(/Masha_lf_elbow/), rArm: g(/Masha_rt_upArm/), rFore: g(/Masha_rt_elbow/),
      lLeg: g(/Masha_lf_upLeg/), lShin: g(/Masha_lf_knee/), rLeg: g(/Masha_rt_upLeg/), rShin: g(/Masha_rt_knee/),
      lHand: g(/Masha_lf_hand/), rHand: g(/Masha_rt_hand/), neck: g(/Masha_neck/), head: g(/Masha_head_a/), sLow: g(/Masha_spine_low/), sMid: g(/Masha_spine_mid/), sHi: g(/Masha_spine_hi/),
    };
    rig.drop = 1.38;            // T-pozadan qo'lni tushirish burchagi
    const wp = new THREE.Vector3(), cx = inner.worldToLocal(findBone(inner, /Masha_hip/).getWorldPosition(wp.clone())).x;
    // qo'l qaysi tomonda (+x yoki -x)
    const sx = b => Math.sign(inner.worldToLocal(b.getWorldPosition(new THREE.Vector3())).x - cx) || 1;
    rig.side = { l: sx(rig.b.lArm), r: sx(rig.b.rArm) };
    // ikki bo'g'inli IK uchun tinch holatdagi ma'lumotlar (inner koordinatalarida)
    const toIn = b => inner.worldToLocal(b.getWorldPosition(new THREE.Vector3())), qIn = b => { b.getWorldQuaternion(_a); inner.getWorldQuaternion(_b); return _a.clone().premultiply(_b.clone().invert()); };
    rig.ik = {};
    for (const [k, up, fore, hand] of [['l', rig.b.lArm, rig.b.lFore, rig.b.lHand], ['r', rig.b.rArm, rig.b.rFore, rig.b.rHand]]) {
      const S = toIn(up), E = toIn(fore), H = toIn(hand);
      rig.ik[k] = { up, fore, L1: S.distanceTo(E), L2: E.distanceTo(H), d1: E.clone().sub(S).normalize(), d2: H.clone().sub(E).normalize(), q1: qIn(up), q2: qIn(fore) };
    }
  } else {
    genRabbit(inner, rig);
  }
  for (const b of Object.values(rig.b)) if (b) rig.rest.set(b, b.quaternion.clone());
  if (kind === 'bones') { rig.tipL = rig.b.lHand; rig.tipR = rig.b.rHand; }
  return rig;
}

// Skeletsiz model (quyon): geometriya -> suyaklar. Oyoqlar pastda (x ishorasi bo'yicha chap/o'ng), qo'llar yon tomonda.
function genRabbit(inner, rig) {
  const meshes = []; inner.traverse(o => { if (o.isMesh) meshes.push(o); });
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  for (const m of meshes) {          // tepalarni inner koordinatalariga "pishirib" qo'yamiz
    const g = m.geometry.clone();
    for (const name of ['position', 'normal']) {       // siqilgan (quantize) butun sonli atributlarni oddiy float ga o'tkazamiz, aks holda matritsa qo'llanganda qirqiladi
      const at = g.attributes[name]; if (!at || at.array instanceof Float32Array) continue;
      const f = new Float32Array(at.count * 3); for (let i = 0; i < at.count; i++) { f[i * 3] = at.getX(i); f[i * 3 + 1] = at.getY(i); f[i * 3 + 2] = at.getZ(i); }
      g.setAttribute(name, new THREE.Float32BufferAttribute(f, 3));
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); m.userData.g = g; g.computeBoundingBox(); box.union(g.boundingBox);
  }
  const H = box.max.y - box.min.y, y0 = box.min.y, cx = (box.min.x + box.max.x) / 2;
  const mkBone = (x, y, z, parent) => { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); return b; };
  const root = new THREE.Bone(); root.position.set(0, 0, 0); inner.add(root);
  const hipY = y0 + H * 0.17, shY = y0 + H * 0.285, legX = H * 0.05, armX = H * 0.12;
  const bones = [root,
    mkBone(cx + legX, hipY, 0, root), mkBone(cx - legX, hipY, 0, root),      // 1: +x oyoq, 2: -x oyoq
    mkBone(cx + armX, shY, 0, root), mkBone(cx - armX, shY, 0, root)];       // 3: +x qo'l, 4: -x qo'l
  // qo'l uchi (chiroq/to'pponcha ushlanadigan joy)
  const tip = (bone, sx) => { const t = new THREE.Object3D(); t.position.set(sx * H * 0.06, -(shY - (y0 + H * 0.145)), 0); bone.add(t); return t; };
  const t3 = tip(bones[3], 1), t4 = tip(bones[4], -1);
  inner.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones);
  for (const m of meshes) {
    const g = m.userData.g, pos = g.attributes.position, n = pos.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i) - cx, y = pos.getY(i) - y0;
      const ax = Math.abs(x);
      // oyoq: pastki qism; markazga yaqinda ikkala oyoq aralashadi
      const leg = (1 - sstep(0.125 * H, 0.18 * H, y)) * (1 - 0 * ax);
      const lw = sstep(-0.02 * H, 0.02 * H, x);                          // +x tomonga og'irlik
      // qo'l: yon tomondagi o'rta qism (tanadan tashqarida)
      const arm = sstep(0.115 * H, 0.15 * H, ax) * (1 - sstep(0.29 * H, 0.33 * H, y)) * sstep(0.10 * H, 0.14 * H, y) * (1 - leg);
      const w1 = leg * lw, w2 = leg * (1 - lw), w3 = arm, wr = Math.max(0, 1 - w1 - w2 - w3);
      si.set([0, 1, 2, x > 0 ? 3 : 4], i * 4); sw.set([wr, w1, w2, w3], i * 4);      // yig'indi har doim 1 (ildiz suyak — qolgani)
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const sm = new THREE.SkinnedMesh(g, m.material); sm.name = m.name; sm.castShadow = m.castShadow; sm.frustumCulled = false;
    m.parent.remove(m); inner.add(sm);        // tepalar inner koordinatalarida, shuning uchun to'g'ridan-to'g'ri inner ostiga
    sm.bind(skel, new THREE.Matrix4());
  }
  rig.b = { root, lLeg: bones[1], rLeg: bones[2], lArm: bones[3], rArm: bones[4] };
  rig.side = { l: 1, r: -1 };
  rig.tipL = t3; rig.tipR = t4; rig.noFore = true; rig.drop = 0;
}

// yordamchi: suyakka "inner" koordinatalarida delta burilish (ota-suyakning joriy holatini hisobga olib)
function applyDelta(rig, bone, Rd) {
  const rest = rig.rest.get(bone), par = bone.parent;
  par.updateWorldMatrix(true, false); rig.inner.updateWorldMatrix(true, false);
  par.getWorldQuaternion(_a); rig.inner.getWorldQuaternion(_b); _a.premultiply(_b.invert());          // ota: inner koordinatalarida
  _c.copy(_a).invert().multiply(Rd).multiply(_a).multiply(rest);
  bone.quaternion.copy(_c);
}

// p: { lLeg, lKnee, rLeg, rKnee, lArm, lElbow, rArm, rElbow, lOut, rOut, head }  (radian; oldinga musbat)
export function poseRig(rig, p) {
  const b = rig.b, S = rig.side;
  const arm = (bone, fore, swing, elbow, out, side) => {
    if (!bone) return;
    // oldin tushirish (T-poza), keyin oldinga ko'tarish; "out" — yon tomonga ochish
    const drop = qz(-side * (rig.drop - (out || 0)));
    applyDelta(rig, bone, qx(-swing).multiply(drop));
    if (fore && !rig.noFore) applyDelta(rig, fore, qx(-elbow));
  };
  // tana va bosh: burilish, engashish, nafas, qarash
  if (b.sLow) {
    const tw = (p.twist || 0) / 3, pt = ((p.spinePitch || 0) + (p.breath || 0)) / 3;
    for (const sb of [b.sLow, b.sMid, b.sHi]) applyDelta(rig, sb, qy(tw).multiply(qx(-pt)));
    if (b.neck) applyDelta(rig, b.neck, qy((p.headYaw || 0) * 0.45).multiply(qx(-((p.headPitch || 0) * 0.45 + (p.head || 0) * 0.5))));
    if (b.head) applyDelta(rig, b.head, qy((p.headYaw || 0) * 0.55).multiply(qx(-((p.headPitch || 0) * 0.55 + (p.head || 0) * 0.5))));
  }
  arm(b.lArm, b.lFore, p.lArm || 0, p.lElbow || 0, p.lOut, S.l);
  arm(b.rArm, b.rFore, p.rArm || 0, p.rElbow || 0, p.rOut, S.r);
  if (b.lLeg) { applyDelta(rig, b.lLeg, qx(-(p.lLeg || 0))); if (b.lShin) applyDelta(rig, b.lShin, qx(p.lKnee || 0)); }
  if (b.rLeg) { applyDelta(rig, b.rLeg, qx(-(p.rLeg || 0))); if (b.rShin) applyDelta(rig, b.rShin, qx(p.rKnee || 0)); }
}

// qo'l uchi (chiroq/to'pponcha ushlanadigan joy) dunyo koordinatasida
export function handPos(rig, side, out) {
  const t = side === 'l' ? rig.tipL : rig.tipR;
  return t.getWorldPosition(out);
}

// ---------------------------------------------------------------------------------------------------- IK: qo'l nishonga qarab cho'ziladi
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const qInner = (rig, b, out) => { b.getWorldQuaternion(out); rig.inner.getWorldQuaternion(_q3); return out.premultiply(_q3.invert()); };
const posInner = (rig, b, out) => rig.inner.worldToLocal(b.getWorldPosition(out));

// side: 'l' | 'r'; targetWorld — qo'l uchi yetib borishi kerak bo'lgan nuqta (dunyo koordinatalarida), w — 0..1 (FK dan IK ga o'tish)
export function ikArm(rig, side, targetWorld, w, reachK = 0.97) {
  if (w <= 0.001) return;
  rig.inner.updateWorldMatrix(true, true);
  const T = rig.inner.worldToLocal(_v1.copy(targetWorld));
  if (rig.kind === 'bones') {
    const k = rig.ik[side], up = k.up, fore = k.fore, sx = rig.side[side];
    const S = posInner(rig, up, _v2).clone(), reach = k.L1 + k.L2;
    const d = T.clone().sub(S), dist = Math.max(d.length(), 1e-4), dd = THREE.MathUtils.clamp(dist, reach * 0.35, reach * reachK), dir = d.divideScalar(dist);
    const cosA = THREE.MathUtils.clamp((k.L1 * k.L1 + dd * dd - k.L2 * k.L2) / (2 * k.L1 * dd), -1, 1), a = Math.acos(cosA);
    const pole = new THREE.Vector3(sx * 0.5, -1, 0.1); const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E = S.clone().addScaledVector(dir, Math.cos(a) * k.L1).addScaledVector(perp, Math.sin(a) * k.L1), H = S.clone().addScaledVector(dir, dd);
    const q1w = new THREE.Quaternion().setFromUnitVectors(k.d1, E.clone().sub(S).normalize()).multiply(k.q1);
    const pq = qInner(rig, up.parent, new THREE.Quaternion());
    up.quaternion.slerp(pq.clone().invert().multiply(q1w), w); up.updateWorldMatrix(true, false);
    const q1b = qInner(rig, up, new THREE.Quaternion());
    const q2w = new THREE.Quaternion().setFromUnitVectors(k.d2, H.clone().sub(E).normalize()).multiply(k.q2);
    fore.quaternion.slerp(q1b.invert().multiply(q2w), w); fore.updateWorldMatrix(true, false);
  } else {
    const up = side === 'l' ? rig.b.lArm : rig.b.rArm;
    const S = posInner(rig, up, _v2).clone(), dir = T.clone().sub(S).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    const pq = qInner(rig, up.parent, new THREE.Quaternion());
    up.quaternion.slerp(pq.invert().multiply(q), w); up.updateWorldMatrix(true, false);
  }
}
