import * as THREE from 'three';
import { Track, HALF } from '../public/js/track.js';
import { TRACKS } from '../public/js/trackdata.js';
const UP = new THREE.Vector3(0, 1, 0);
for (const d of TRACKS) {
  const t = new Track(d);
  const g = t._strip(-HALF, 0, HALF, 0, 16, UP);
  const pos = g.attributes.position, idx = g.index.array; let up = 0, down = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, idx[i]), b = new THREE.Vector3().fromBufferAttribute(pos, idx[i + 1]), c = new THREE.Vector3().fromBufferAttribute(pos, idx[i + 2]);
    const n = b.sub(a).cross(c.sub(a)); n.y > 0 ? up++ : down++;
  }
  console.log(d.id, 'up', up, 'down', down);
}
