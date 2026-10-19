import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skelClone } from 'three/addons/utils/SkeletonUtils.js';
import { prepareCar } from './carmodel.js';
import { CAR_DEFS } from './car.js';

// Vehicles / people of the Police mission that are not in the garage: the police SUV and the robot police unit.
export const SUV_INDEX = 7;                 // car index of the police SUV in mission lobbies (garage cars are 0..6)
export const SUV_DEF = { id: 'police_suv', name: 'Politsiya SUV', front: '+z', paint: [], color: '#f4f4f4', exh: [[0.55, 0.42, -2.3], [-0.55, 0.42, -2.3]] };

/** the police fleet: every unit picks one kind (cycled) */
export const FLEET_KINDS = ['gt300', 'suv', 'mk4', 'suv'];

export class Fleet {
  constructor() { this.suv = null; this.robot = null; this.clips = []; this.robotH = 1; }

  async load(onProgress = () => {}) {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const get = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));
    const [suv, robot] = await Promise.all([get('/models/police_suv.glb'), get('/models/robot.glb')]);
    onProgress(0.6);
    // the SUV's pivot sits 3 m off to the side: centre it so wheel detection (which assumes a car around x = 0) works
    const w = new THREE.Group(); suv.scene.position.set(-3.002, -0.004, 0.083); w.add(suv.scene);
    const res = prepareCar(w, { front: '+z' });
    this.suv = res.root; this.suvOk = res.ok;
    // the nose already points to +z, but the wheels came out labelled the other way round: swap front <-> back so steering turns the right axle
    res.root.updateMatrixWorld(true);
    const zOf = n => { const o = res.root.getObjectByName(n); return o ? o.getWorldPosition(new THREE.Vector3()).z : 0; };
    if (zOf('steer_LF') < 0) for (const side of ['L', 'R']) for (const pre of ['steer_', 'spin_']) {
      const a = res.root.getObjectByName(pre + side + 'F'), b = res.root.getObjectByName(pre + side + 'B');
      if (a && b) { a.name = pre + side + 'B'; b.name = pre + side + 'F'; }
    }
    // robot: normalise to 1.95 m tall, standing on the ground
    robot.scene.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(robot.scene);
    this.robotScale = 1.95 / Math.max(0.1, bb.max.y - bb.min.y);
    this.robotGround = bb.min.y;
    robot.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material) { o.material.side = THREE.FrontSide; } } });
    this.robot = robot.scene; this.clips = robot.animations;
  }

  /** {def, proto} of a police kind ('gt300' | 'mk4' | 'suv') given the garage prototypes */
  kind(kind, protos) {
    if (kind === 'suv') return { def: SUV_DEF, proto: this.suv };
    const i = kind === 'gt300' ? 5 : 6;
    return { def: CAR_DEFS[i], proto: protos[i], paint: kind === 'mk4' ? 3 : -1 };
  }

  /** a fresh animated robot: { group, mixer } (group origin = feet) */
  makeRobot() {
    const inner = skelClone(this.robot);
    inner.scale.setScalar(this.robotScale); inner.position.y = -this.robotGround * this.robotScale;
    const group = new THREE.Group(); group.add(inner);
    const mixer = new THREE.AnimationMixer(inner);
    if (this.clips.length) { const a = mixer.clipAction(this.clips[0]); a.play(); a.time = Math.random() * a.getClip().duration; }
    return { group, inner, mixer };
  }
}
