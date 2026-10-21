// Personajlar (GLB): o'yinchi qahramonlari va ruh. Balandlikka normallashtiriladi, oyoqlari y=0 da.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeRig } from './rig.js';

const BASE = '/horror/models/';
export const CHARS = [
  { id: 'masha', role: 'survivor', name: 'Masha', file: 'masha.glb', rig: 'bones', h: 1.45, yaw: 0, color: '#ff8fb3', pitch: 1.35 },
  { id: 'rabbit', role: 'survivor', name: 'Quyon', file: 'rabbit.glb', rig: 'gen', h: 1.55, yaw: 0, color: '#ff6fae', pitch: 1.15 },
  { id: 'ghost', role: 'ghost', name: 'Qonli ruh', file: 'ghost.glb', h: 2.1, yaw: -Math.PI / 2, color: '#b9d6ff', pitch: 0.6 },
  { id: 'scarecrow', role: 'ghost', name: "Qo'rqoq", file: 'scarecrow.glb', h: 1.85, yaw: 0, color: '#d6b25a', pitch: 0.85 },
  { id: 'monster', role: 'ghost', name: 'Tabassum', file: 'monster.glb', h: 1.6, yaw: 0, color: '#7fe08a', pitch: 0.7 },
];
export const DEFAULT_CHAR = { survivor: 0, ghost: 2 };
export const KILLER_DEF = { id: 'killer', file: 'killer.glb', h: 2.55, yaw: Math.PI };       // killer (kadrda): asl modelning old tomoni -z, shuning uchun 180° burilgan
export const GHOST_DEF = { id: 'ghost', file: 'ghost.glb', h: 2.1, yaw: -Math.PI / 2 };

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
function load(file) {
  if (!cache.has(file)) cache.set(file, new Promise((res, rej) => loader.load(BASE + file, res, undefined, rej)));
  return cache.get(file);
}
export const loadedFiles = () => [...cache.keys()];

// def -> { root, mixer, actions, height }
export async function createActor(def, opts = {}) {
  const gltf = await load(def.file);
  const inner = SkeletonUtils.clone(gltf.scene);
  const wrap = new THREE.Group(); wrap.add(inner);
  inner.rotation.y = def.yaw || 0;
  const rig = opts.rig && def.rig ? makeRig(inner, def.rig) : null;       // oyoq-qo'llarni kod bilan harakatlantirish (kadr uchun)
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  const k = def.h / (size.y || 1);
  inner.scale.multiplyScalar(k);
  wrap.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(wrap), c = b2.getCenter(new THREE.Vector3());
  inner.position.x -= c.x; inner.position.z -= c.z; inner.position.y -= b2.min.y;
  const root = new THREE.Group(); root.add(wrap);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; const m = o.material; if (m) { m.side = THREE.DoubleSide; } } });
  let mixer = null, actions = [];
  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(inner);
    actions = gltf.animations.map(a => { const ac = mixer.clipAction(a); ac.play(); ac.paused = true; return ac; });
  }
  return { root, wrap, inner, mixer, actions, height: def.h, rig };
}
// ilon: skinli model + slither animatsiyasi. Uzunligi ~2 m (model birligida ~6.6), bosh +x tomonga qaraydi
export async function createSnake(scale = 0.32) {
  const gltf = await load('snake.glb');
  const inner = SkeletonUtils.clone(gltf.scene); inner.scale.setScalar(scale);
  const root = new THREE.Group(); root.add(inner);
  root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; if (o.material) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0x1c2420); o.material.emissiveIntensity = 0.5; o.material.side = THREE.DoubleSide; } } });
  const mixer = new THREE.AnimationMixer(inner), action = mixer.clipAction(gltf.animations[0]); action.play(); action.paused = true;
  return { root, mixer, action, duration: gltf.animations[0].duration };
}
export function preloadActors(defs) { return Promise.all(defs.map(d => load(d.file).catch(() => null))); }
