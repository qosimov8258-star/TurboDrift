import * as THREE from 'three';
import { Track, HALF, CURB_W, WALL_D } from '../public/js/track.js';
const t = new Track(); const UP = new THREE.Vector3(0,1,0);
for (const sg of [1,-1]) { const a = sg*(HALF+CURB_W), b = sg*WALL_D;
  const g = t._strip(Math.min(a,b),0.005,Math.max(a,b),0.005,8,UP,0,0.5);
  console.log(sg, 'normal y', g.attributes.normal.getY(0), 'verts', g.attributes.position.count, [g.attributes.position.getX(0), g.attributes.position.getX(1)].map(x=>x.toFixed(1)), [g.attributes.position.getZ(0), g.attributes.position.getZ(1)].map(x=>x.toFixed(1))); }
const g = t._strip(-HALF,0,HALF,0,16,UP); console.log('road normal y', g.attributes.normal.getY(0));
