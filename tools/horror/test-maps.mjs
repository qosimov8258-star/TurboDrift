// Xarita generatori testi: ko'p seed × barcha darajalar. Har birida:
//  - eshiklar grafi bog'langan, kalit soni to'g'ri, kalitlar start xonasida emas
//  - o'yinchi (r=0.32) start nuqtasidan hamma shkaf, chiqish eshigi, eshiklar, otiladigan narsalarga yura oladi (haqiqiy to'qnashuv bilan)
import { buildLevel } from '../../public/horror/js/decor.js';
import { Collision } from '../../public/horror/js/nav.js';
import { LEVELS } from '../../public/horror/js/levels.js';
const N = +process.argv[2] || 20;
const R = 0.32, STEP = 0.25;
let fails = 0, total = 0, maxMs = 0;
const fail = (m) => { fails++; if (fails < 40) console.log('FAIL', m); };
for (let li = 0; li < LEVELS.length; li++) {
  for (let s = 0; s < N; s++) {
    const seed = 1000 + s * 7919 + li;
    total++;
    const t = Date.now();
    const m = buildLevel(seed, li);
    const tag = `L${li + 1}/s${seed}`;
    if (s < 3) {
      const m2 = buildLevel(seed, li);
      if (m2.geo.p.length !== m.geo.p.length || m2.cabinets.length !== m.cabinets.length || m2.exit.x !== m.exit.x) fail(tag + ' deterministik emas');
      else for (let i = 0; i < m.geo.p.length; i += 997) if (m.geo.p[i] !== m2.geo.p[i]) { fail(tag + ' geometriya farq'); break; }
    }
    const keys = m.cabinets.filter(c => c.hasKey).length;
    if (keys !== LEVELS[li].keys) fail(`${tag} kalit ${keys}/${LEVELS[li].keys}`);
    if (m.cabinets.length < keys + 2) fail(`${tag} shkaf kam ${m.cabinets.length}`);
    for (const c of m.cabinets) if (c.hasKey && c.room === m.start) fail(`${tag} kalit start xonada`);
    const seen = new Set([m.start]); const q = [m.start];
    for (let i = 0; i < q.length; i++) for (const d of m.doors) { const o = d.a === q[i] ? d.b : d.b === q[i] ? d.a : -1; if (o >= 0 && !seen.has(o)) { seen.add(o); q.push(o); } }
    if (seen.size !== m.rooms.length) fail(`${tag} graf bog'lanmagan ${seen.size}/${m.rooms.length}`);
    const col = new Collision(m);
    const gw = Math.ceil(m.sizeX / STEP) + 1, gh = Math.ceil(m.sizeZ / STEP) + 1;
    const vis = new Uint8Array(gw * gh);
    const sp = m.spawn[0];
    const sx = Math.round(sp.x / STEP), sz = Math.round(sp.z / STEP);
    const stack = [[sx, sz]]; vis[sz * gw + sx] = 1;
    const ok = (x, z) => { if (x < 0 || z < 0 || x >= gw || z >= gh) return false; const r = col.resolve(x * STEP, z * STEP, R); return Math.abs(r.x - x * STEP) < 0.02 && Math.abs(r.z - z * STEP) < 0.02; };
    if (!ok(sx, sz)) fail(`${tag} spawn devor ichida`);
    while (stack.length) {
      const [x, z] = stack.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= gw || nz >= gh) continue;
        const i = nz * gw + nx; if (vis[i]) continue;
        if (ok(nx, nz)) { vis[i] = 1; stack.push([nx, nz]); }
      }
    }
    const reach = (x, z, r = 0.45) => { for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const gx = Math.round(x / STEP) + dx, gz = Math.round(z / STEP) + dz; if (gx >= 0 && gz >= 0 && gx < gw && gz < gh && vis[gz * gw + gx] && Math.hypot(gx * STEP - x, gz * STEP - z) <= r + 0.3) return true; } return false; };
    for (const c of m.cabinets) {
      const fx = c.x + Math.sin(c.rot) * (c.d + 0.5), fz = c.z + Math.cos(c.rot) * (c.d + 0.5);
      if (!reach(fx, fz)) fail(`${tag} shkaf #${c.id} (${c.kind}) yetib bo'lmaydi @${fx.toFixed(1)},${fz.toFixed(1)}`);
    }
    const ex = m.exit; if (!reach(ex.x - ex.nx * 0.9, ex.z - ex.nz * 0.9)) fail(`${tag} chiqish eshigi yetib bo'lmaydi`);
    for (const d of m.doors) if (!reach(d.x, d.z)) fail(`${tag} eshik #${d.id} yetib bo'lmaydi`);
    let nt = 0; for (const th of m.throwables) if (!reach(th.x, th.z, 0.2)) nt++;
    if (nt > 0) fail(`${tag} ${nt} narsa yetib bo'lmaydi`);
    for (const p of m.spawn) if (!reach(p.x, p.z, 0.2)) { fail(`${tag} spawn nuqtasi bandligi`); break; }
    maxMs = Math.max(maxMs, Date.now() - t);
  }
  console.log(`daraja ${li + 1} (${LEVELS[li].name}) tekshirildi`);
}
console.log(`\n${total} ta xarita, xatolar: ${fails}, eng sekin: ${maxMs}ms`);
process.exit(fails ? 1 : 0);
