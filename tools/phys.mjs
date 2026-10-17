import { Track } from '../public/js/track.js';
import { Vehicle } from '../public/js/car.js';
const t = new Track();
const v = new Vehicle(); const s = t.gridSlot(0);
console.log('slot', s, 'tangent0', t.T[0]);
v.place(s.x, s.z, s.psi);
const inp = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false };
for (let i = 0; i < 120 * 12; i++) {
  v.update(1 / 120, inp, t);
  if (v.rpmRaw > 0.93 && v.gear < 3) v.shift(1);
  if (i % 120 === 0) console.log((i / 120) + 's', 'x', v.x.toFixed(1), 'z', v.z.toFixed(1), 'psi', v.psi.toFixed(3), 'kmh', (v.speed * 3.6).toFixed(0), 'g', v.gear, 'd', v.nearest.d.toFixed(2), 'yaw', v.yaw.toFixed(4));
}
