import { Track } from '../public/js/track.js';
import { Vehicle } from '../public/js/car.js';
import { Bot } from '../public/js/bot.js';
const t = new Track(); const v = new Vehicle(); const s = t.gridSlot(0); v.place(s.x, s.z, s.psi);
const bot = new Bot(v, t, 1);
while (v.speed * 3.6 < 120) { bot.control(1/120, bot.inp, [], 1, true); v.update(1/120, bot.inp, t); }
const x0 = v.x, z0 = v.z; const inp = { throttle: 1, brake: 1, steer: 0, handbrake: false, nitro: false };
for (let i = 0; i < 120 * 5; i++) { v.update(1/120, inp, t); if (i % 60 === 0) console.log((i/120).toFixed(1), 'kmh', (v.speed*3.6).toFixed(0), 'burnout', v.burnout, 'moved', Math.hypot(v.x-x0, v.z-z0).toFixed(0)); }
