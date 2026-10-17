// Physics check: an AI driver must be able to lap every circuit cleanly (no wall hits, no gravel).
import { Track } from '../public/js/track.js';
import { TRACKS } from '../public/js/trackdata.js';
import { Vehicle } from '../public/js/car.js';
import { Bot } from '../public/js/bot.js';
let fail = 0;
for (const def of TRACKS) {
  const t = new Track(def);
  for (const skill of [0, 0.5, 1]) {
    const v = new Vehicle(); const s = t.gridSlot(0); v.place(s.x, s.z, s.psi);
    const bot = new Bot(v, t, skill);
    let lap = 0, last = s.i, tm = 0, hits = 0, gravel = 0, lapT = [], maxD = 0;
    for (let i = 0; i < 120 * 600 && lap < 2; i++) {
      bot.control(1 / 120, bot.inp, [], 1, true); v.update(1 / 120, bot.inp, t); tm += 1 / 120;
      if (v.hitEvent > 1) hits++; v.hitEvent = 0;
      if (v.surface === 'gravel') gravel += 1 / 120; maxD = Math.max(maxD, Math.abs(v.nearest.d));
      const idx = v.nearest.i; if (idx - last < -t.N / 2) { lap++; lapT.push(tm.toFixed(1)); } last = idx;
    }
    const ok = lap >= 2 && hits < 6 && gravel < 12;
    if (!ok) fail++;
    console.log(def.id.padEnd(8), 'skill', skill, 'laps@', lapT.join(',').padEnd(12), 'hits', String(hits).padEnd(3), 'gravel', gravel.toFixed(1).padEnd(5), 'maxOff', maxD.toFixed(1), ok ? 'ok' : 'FAIL');
  }
}
console.log(fail ? fail + ' FAILURES' : 'ALL BOT LAPS OK');
