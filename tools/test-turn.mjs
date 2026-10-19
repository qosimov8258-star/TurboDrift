// How fast does the car turn? (degrees turned in 0.5 s of full right steer, from standstill / rolling / fast)
import { Track } from '../public/js/track.js';
import { Vehicle } from '../public/js/car.js';
const t = new Track(); const s = t.gridSlot(0);
const run = (label, speed, thr, steer = 1) => {
  const v = new Vehicle(); v.place(s.x, s.z, s.psi);
  const f = [Math.sin(s.psi), Math.cos(s.psi)]; v.vx = f[0] * speed; v.vz = f[1] * speed; v.gear = speed > 40 ? 3 : speed > 18 ? 2 : 1;
  const inp = { throttle: thr, brake: 0, steer: 0, handbrake: false, nitro: false };
  for (let i = 0; i < 12; i++) v.update(1 / 120, inp, t);          // settle
  const p0 = v.psi; inp.steer = steer;
  for (let i = 0; i < 60; i++) v.update(1 / 120, inp, t);
  console.log(label.padEnd(34), 'turned', (Math.abs(v.psi - p0) * 57.3).toFixed(0).padStart(3), 'deg in 0.5 s, speed now', (v.speed * 3.6).toFixed(0), 'km/h');
};
run('standing, gas + right', 0, 1);
run('standing, right only (no gas)', 0, 0);
run('slow 20 km/h, gas', 5.5, 1);
run('50 km/h', 14, 0.6);
run('100 km/h', 28, 0.6);
run('180 km/h', 50, 0.6);
