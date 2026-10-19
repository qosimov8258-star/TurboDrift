// Yakka o'yinda ruh bo'lish (botlar omon qolgan): to'liq o'yin tugashi kerak.
import { Sim } from '../../public/horror/js/sim.js';
import { LocalHub } from '../../public/horror/js/localhub.js';
import { mulberry32 } from '../../public/horror/js/rng.js';
let fails = 0, win = 0, lose = 0; const N = +process.argv[2] || 30;
for (let i = 0; i < N; i++) {
  const rnd = mulberry32(i + 5), level = i % 10, seed = Math.floor(rnd() * 4e9), diff = i % 3;
  const me = { id: 'solo', name: 'G', char: 2 + (i % 3), role: 'ghost' };
  const players = [me, ...[0, 1].map(k => ({ id: 'bot' + k, name: 'b' + k, char: k, role: 'survivor', bot: true }))];
  const cfg = { seed, level, diff, players, hostId: 'solo', ghostId: 'solo' };
  let hub; const sim = new Sim({ ...cfg, me, send: m => hub.fromMe(m) }); hub = new LocalHub(cfg, sim);
  const Bot = (await import('../../public/horror/js/bot.js')).Bot; const gb = new Bot(sim, mulberry32(i));
  let t = 0;
  try { while (t < 1500 && !sim.over) { t += 0.05; sim.update(0.05, gb.step(0.05)); sim.fx.length = 0; hub.update(0.05); if (!Number.isFinite(sim.me.x)) throw new Error('NaN'); } } catch (e) { fails++; console.log('FAIL', i, e.stack); continue; }
  if (!sim.over) { fails++; console.log('FAIL tugamadi', i, level, t); continue; }
  sim.over.win ? win++ : lose++;
  if (!hub.bots.every(b => b.sim.over && b.sim.over.win === sim.over.win)) { fails++; console.log('FAIL natija farq', i); }
}
console.log(`ruh-yakka: ${N} o'yin, omon qolganlar g'alabasi ${win}, ruh ${lose}, xatolar ${fails}`); process.exit(fails ? 1 : 0);
