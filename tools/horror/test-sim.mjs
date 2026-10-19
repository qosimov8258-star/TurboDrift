// To'liq o'yin simulyatsiyasi: N ta o'yin, har birida 1-4 bot + (AI yoki odam-ruh), tarmoq kechikishi bilan.
// Tekshiriladi: xato yo'q, pozitsiyalar to'g'ri, hamma klientda holat bir xil, o'yin tugaydi.
import { Sim } from '../../public/horror/js/sim.js';
import { Bot } from '../../public/horror/js/bot.js';
import { LEVELS } from '../../public/horror/js/levels.js';
import { mulberry32 } from '../../public/horror/js/rng.js';

const N = +process.argv[2] || 20;
const ONLY = process.argv[3] != null ? +process.argv[3] : null;
const cover = {};
let fails = 0, wins = 0, losses = 0, timeouts = 0, totalT = 0;
const fail = (m) => { fails++; if (fails <= 40) console.log('FAIL', m); };

function runGame(i) {
  const rnd = mulberry32(i * 7919 + 13);
  const level = ONLY != null ? ONLY : i % LEVELS.length;
  const seed = Math.floor(rnd() * 4e9);
  const nP = 1 + Math.floor(rnd() * 4);
  const mode = i % 5 === 0 ? 'human' : 'ai';
  const diff = Math.floor(rnd() * 3);
  const tag = `#${i} L${level + 1} seed=${seed} P=${nP} ${mode} d${diff}`;
  const ids = []; for (let k = 0; k < nP + (mode === 'human' ? 1 : 0); k++) ids.push('p' + k);
  const players = ids.map((id, k) => ({ id, name: 'B' + k, char: k % 4, role: (mode === 'human' && k === ids.length - 1) ? 'ghost' : 'survivor' }));
  const hostId = ids[Math.floor(rnd() * ids.length)];
  const ghostId = mode === 'human' ? ids[ids.length - 1] : null;
  const queues = new Map(ids.map(id => [id, []]));
  const sims = new Map();
  let frame = 0;
  for (const id of ids) {
    const send = (m) => {
      for (const [oid, q] of queues) { if (oid === id) continue; if (m.t === 'ev' || m.t === 'end' || m.t === 'st' || m.t === 'gs') q.push({ at: frame + Math.floor(rnd() * 4), m: { ...m, id } }); }
    };
    const sm = new Sim({ seed, level, diff, me: players.find(p => p.id === id), players, hostId, ghostId, send });
    const ae = sm.applyEvent.bind(sm); sm.applyEvent = (e, f) => { cover[e.k] = (cover[e.k] || 0) + 1; return ae(e, f); };
    sims.set(id, sm);
  }
  const bots = new Map(); for (const id of ids) bots.set(id, new Bot(sims.get(id), mulberry32(seed ^ id.charCodeAt(1) * 31 + 1)));
  const DT = 1 / 20, MAXT = 1500;
  let t = 0;
  try {
    while (t < MAXT) {
      frame++; t += DT;
      for (const id of ids) {
        const q = queues.get(id), sim = sims.get(id);
        for (let k = 0; k < q.length;) { if (q[k].at <= frame) { sim.handleNet(q[k].m); q.splice(k, 1); } else k++; }
        const inp = bots.get(id).step(DT);
        sim.update(DT, inp);
        sim.fx.length = 0;
        // invariantlar
        const me = sim.me;
        if (!Number.isFinite(me.x) || !Number.isFinite(me.z) || !Number.isFinite(me.yaw)) { fail(`${tag} NaN pozitsiya`); return; }
        if (me.role === 'survivor' && me.alive && !me.escaped) {
          const r = sim.col.resolve(me.x, me.z, 0.3);
          if (Math.hypot(r.x - me.x, r.z - me.z) > 0.12) {
            const hits = [...sim.col.dynamic.entries()].filter(([k, c]) => c.on && me.x > c.x0 - 0.3 && me.x < c.x1 + 0.3 && me.z > c.z0 - 0.3 && me.z < c.z1 + 0.3).map(([k]) => k);
            if (hits.length && !process.env.STRICT) continue;      // eshik yopilayotganda — keyingi kadrda itarib chiqariladi
            fail(`${tag} ${id} devor ichida (${me.x.toFixed(2)},${me.z.toFixed(2)}) t=${t.toFixed(0)} push=${(r.x - me.x).toFixed(2)},${(r.z - me.z).toFixed(2)}`); return; }
        }
        if (me.hearts < 0) fail(`${tag} yurak < 0`);
        if (sim.keysFound.size > sim.need) fail(`${tag} kalit ortiqcha`);
        for (const o of sim.objs) if (!Number.isFinite(o.x + o.y + o.z)) { fail(`${tag} obyekt NaN`); return; }
      }
      if ([...sims.values()].every(s => s.over)) break;
    }
  } catch (e) { fail(`${tag} EXCEPTION ${e.stack}`); return; }
  // drenaj: oxirgi xabarlar
  for (let k = 0; k < 10; k++) { frame += 5; for (const id of ids) { const q = queues.get(id), sim = sims.get(id); while (q.length) sim.handleNet(q.shift().m); } }
  totalT += t;
  const all = [...sims.values()];
  if (!all.every(s => s.over)) { timeouts++; fail(`${tag} o'yin tugamadi (t=${t.toFixed(0)}s) keys=${all[0].keysFound.size}/${all[0].need} alive=${all[0].aliveSurvivors().length}`); return; }
  const w = all[0].over.win;
  if (!all.every(s => s.over.win === w)) fail(`${tag} natija farq qiladi`);
  w ? wins++ : losses++;
  // holat bir xilligi
  const ref = all[0];
  for (const s of all) {
    if (s.keysFound.size !== ref.keysFound.size) fail(`${tag} kalitlar farq ${s.keysFound.size}/${ref.keysFound.size}`);
    if (s.exit.isOpen !== ref.exit.isOpen) fail(`${tag} chiqish holati farq`);
    for (const c of s.cabs) if (c.open !== ref.cabs[c.id].open) { fail(`${tag} shkaf #${c.id} holati farq`); break; }
  }
  // g'alaba bo'lsa kamida bitta o'yinchi qochgan va hamma kalit topilgan bo'lishi kerak
  if (w && !(ref.survivors().some(p => p.escaped) && ref.exit.isOpen)) fail(`${tag} g'alaba noto'g'ri`);
  if (w && ref.keysFound.size < ref.need) fail(`${tag} kalitsiz g'alaba`);
}
const t0 = Date.now();
for (let i = 0; i < N; i++) runGame(i);
console.log('hodisalar qamrovi:', JSON.stringify(cover));
console.log(`\n${N} o'yin: g'alaba ${wins}, mag'lubiyat ${losses}, tugamagan ${timeouts}, xatolar ${fails}, o'rtacha o'yin vaqti ${(totalT / N).toFixed(0)}s, haqiqiy vaqt ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(fails ? 1 : 0);
