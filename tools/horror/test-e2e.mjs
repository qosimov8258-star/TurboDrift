// Brauzerdagi to'liq sinov (Playwright): yakka va ko'p o'yinchili rejim, botlar o'ynaydi, xatolar yig'iladi.
// node tools/horror/test-e2e.mjs <solo-soni> <multi-soni> [parallel]
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(+v) ? d : +v);
const NS = num(process.argv[2], 6), NM = num(process.argv[3], 2), PAR = num(process.argv[4], 3);
const PORT = 3295;
const srv = createStatic(PORT); attachGameServer(srv); await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const errors = []; let done = 0, passed = 0;
const _push = errors.push.bind(errors); errors.push = (m) => { console.log('\n  ✗', m); return _push(m); };
const base = `http://localhost:${PORT}`;
const IGNORE = /GL Driver|ERR_ABORTED|favicon|GPU stall|WebGL.*(deprecated|performance)|Automatic fallback to software WebGL/i;
async function mkPage(tag) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 225 } });
  const p = await ctx.newPage();
  p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !IGNORE.test(m.text())) errors.push(`[${tag}] console.${m.type()}: ${m.text().slice(0, 250)}`); });
  p.on('pageerror', e => errors.push(`[${tag}] pageerror: ${e.message}`));
  p.on('requestfailed', r => { if (!IGNORE.test(r.failure()?.errorText || '') && !/\.(mp3|m4a)$/.test(r.url())) errors.push(`[${tag}] reqfail ${r.url()}`); });
  return { p, ctx };
}
const sanity = () => { const g = window.__hz; if (!g || !g.sim) return { ok: false, why: 'game yo\'q' }; const s = g.sim, m = s.me; const fin = [m.x, m.z, s.ghost.x, s.ghost.z, s.fear].every(Number.isFinite); return { ok: fin, frames: g.frameCount, t: s.t, keys: s.keysFound.size, hearts: m.hearts, over: !!s.over, alive: m.alive, esc: m.escaped, fear: s.fear }; };
const scareTest = async p => {
  // ruhni o'yinchining oldida paydo qilamiz: jumpscare (baqiriq) ishlashi kerak
  return p.evaluate(() => new Promise(res => {
    const g = window.__hz, s = g.sim, m = s.me; g.bot = null; let screams = 0; const orig = g.audio.scream.bind(g.audio); g.audio.scream = o => { screams++; return orig(o); };
    // xarita ichida va ko'rinish chizig'i bor yo'nalishni qidiramiz (start xonasi chetda bo'lsa 9 m tashqariga tushib qolmasin)
    let ax = 0, az = 0, found = false;
    for (let k = 0; k < 24 && !found; k++) {
      const y = g.lookYaw + k * (Math.PI / 12); ax = m.x - Math.sin(y) * 9; az = m.z - Math.cos(y) * 9;
      if (ax > 1.5 && az > 1.5 && ax < s.map.sizeX - 1.5 && az < s.map.sizeZ - 1.5 && s.col.los(m.x, m.z, ax, az, true)) { g.lookYaw = y; found = true; }
    }
    s.lastSeenAt = -99; s.scareCd = 0;
    s.ghost.x = ax; s.ghost.z = az; s.ghost.tx = ax; s.ghost.tz = az; s.ghost.visible = true; s.ghost.appearT = s.t;
    if (s.ai) { s.ai.x = ax; s.ai.z = az; s.ai.visible = true; s.ai.mode = 'stare'; s.ai.stareT = 1.5; }
    const t0 = performance.now(), f0 = g.frameCount;
    const iv = setInterval(() => { if (screams > 0 || (g.frameCount - f0 >= 12 && performance.now() - t0 > 1500) || performance.now() - t0 > 12000) { clearInterval(iv); res({ screams, los: found, fear: s.fear, frames: g.frameCount - f0 }); } }, 100);
  }));
};

async function runSolo(i) {
  const level = i % 10, seed = 1000 + i * 37;
  const { p, ctx } = await mkPage('solo' + i);
  try {
    await p.goto(`${base}/horror?solo=${level}&seed=${seed}&bot&nopause`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p.waitForFunction('window.__hz && window.__hz.frameCount > 8', null, { timeout: 90000 });
    await p.waitForTimeout(4000);
    const s1 = await p.evaluate(sanity);
    const sc = await scareTest(p);
    const s2 = await p.evaluate(sanity);
    let bad = [];
    if (!s1.ok || !s2.ok) bad.push('NaN/yo\'q holat ' + JSON.stringify(s2));
    if (s2.frames <= s1.frames) bad.push('kadrlar to\'xtab qolgan');
    if (sc.los && sc.screams < 1) bad.push(`jumpscare baqiriq ishlamadi (los=${sc.los})`);
    const audioErr = await p.evaluate(() => { const a = window.__hz.audio, errs = []; const T = (n, f) => { try { f(); } catch (e) { errs.push(n + ': ' + e.message); } };
      if (!a.ready) return ['audio tayyor emas'];
      T('scream', () => a.scream({ pitch: 1, vol: 1 })); T('scream3d', () => a.scream({ x: 10, z: 10, pitch: 0.7 })); T('stinger', () => a.stinger()); T('creak', () => a.creak(5, 5)); T('slam', () => a.slam(5, 5)); T('thud', () => a.thud(5, 5)); T('glass', () => a.glass(5, 5)); T('step', () => a.step(null, null)); T('step3d', () => a.step(4, 4, 0.3, true)); T('bell', () => a.bell(5, 5)); T('whisper', () => a.whisperNoise(5, 5)); T('growl', () => a.growl(5, 5)); T('chime', () => { a.chime('key'); a.chime('win'); a.chime('lose'); }); T('click', () => a.uiClick()); T('heart', () => { a.heart.next = 0; a.heartbeat(0.9, 0.016); }); T('speak', () => a.speak('Orqangga qarama', { dist: 3 })); T('clank', () => a.clank(3, 3)); T('mute', () => { a.setMuted(true); a.setMuted(false); });
      return errs; });
    if (audioErr.length) bad.push('audio: ' + audioErr.join(' | '));
    const perf = await p.evaluate(() => { const g = window.__hz, a = g.audio, inf = g.renderer.info; return { calls: inf.render.calls, tris: inf.render.triangles, roomActive: a.roomPool.filter(s => s.room >= 0).length, rooms: a.rooms ? a.rooms.length : 0, allLoaded: a.allLoaded, tex: inf.memory.textures, geo: inf.memory.geometries }; });
    if (perf.calls > 900) bad.push('draw call ko\'p: ' + perf.calls);
    if (!perf.rooms) bad.push('xona musiqalari sozlanmagan');
    // "all" ovozlari: slotni oldinga suramiz — bir xil seed bilan hamma xonaga tayinlanishi kerak
    const allT = await p.evaluate(() => new Promise(res => { const g = window.__hz, a = g.audio; g.clockOffset += 20000 * 3 + 100; setTimeout(() => res({ slot: a.lastSlot, fired: a.slotFired ? a.slotFired.size : -1, assign: a.slotAssign ? a.slotAssign.length : -1 }), 1500); }));
    if (allT.assign !== perf.rooms) bad.push(`all-tayinlash xonalar soniga teng emas ${allT.assign}/${perf.rooms}`);
    // g'alaba -> natija ekrani -> keyingi daraja
    await p.evaluate(() => window.__hz.sim.finish(true, 'test'));
    await p.waitForSelector('#hzEnd.on', { timeout: 15000 });
    if (level < 9) {
      await p.click('#hzNext');
      await p.waitForFunction(`window.__hz && window.__hz.sim && window.__hz.sim.level === ${level + 1} && window.__hz.frameCount > 5`, null, { timeout: 60000 });
      await p.waitForTimeout(1500);
      const s3 = await p.evaluate(sanity); if (!s3.ok) bad.push('keyingi darajada holat buzuq');
    } else { await p.click('#hzAgain'); await p.waitForFunction('window.__hz && window.__hz.sim && window.__hz.frameCount > 5', null, { timeout: 60000 }); }
    if (bad.length) errors.push(`[solo${i} L${level + 1}] ${bad.join('; ')}`); else passed++;
  } catch (e) { errors.push(`[solo${i} L${level + 1}] ${e.message.slice(0, 200)}`); }
  await ctx.close(); done++;
}

async function runMulti(i) {
  const level = (i * 3) % 10;
  const A = await mkPage('mA' + i), B = await mkPage('mB' + i), C = await mkPage('mC' + i);
  try {
    // A xona yaratadi (host), B qo'shiladi, C ruh bo'ladi
    await A.p.goto(`${base}/horror?bot&nopause`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await A.p.waitForSelector('#hzFriends', { state: 'visible', timeout: 60000 });
    await A.p.fill('#hzName', 'Alisher'); await A.p.click('#hzFriends'); await A.p.click('#hzCreate');
    await A.p.waitForFunction('document.getElementById("hzCode").textContent.length===4 && document.getElementById("hzCode").textContent!=="----"', null, { timeout: 15000 });
    const code = await A.p.textContent('#hzCode');
    for (const [P, nm] of [[B, 'Bobur'], [C, 'Sardor']]) {
      await P.p.goto(`${base}/horror?bot&nopause&room=${code}`, { waitUntil: 'domcontentloaded', timeout: 90000 }); await P.p.waitForSelector('#hzRoomIn', { state: 'visible', timeout: 60000 });
      await P.p.fill('#hzName', nm); await P.p.click('#hzJoin');
      await P.p.waitForFunction(`document.getElementById("hzCode").textContent==="${code}"`, null, { timeout: 15000 });
    }
    await C.p.click('#hzRole');            // C — ruh
    await A.p.waitForFunction('document.querySelectorAll("#hzPlist .prow").length===3', null, { timeout: 10000 });
    await A.p.evaluate(l => { window.__hzMain.S.level = l; }, level);
    await A.p.click('#hzLobbyPick'); await A.p.click(`#hzLevelGrid .lcard:nth-child(${level + 1})`); await A.p.click('#hzLevelGo');
    await A.p.click('#hzStart');
    for (const P of [A, B, C]) await P.p.waitForFunction('window.__hz && window.__hz.frameCount > 8', null, { timeout: 90000 });
    await A.p.waitForTimeout(6000);
    const st = [];
    for (const P of [A, B, C]) st.push(await P.p.evaluate(() => { const g = window.__hz, s = g.sim; return { ...(() => { const m = s.me; return { role: m.role, x: m.x, z: m.z, fin: Number.isFinite(m.x + m.z) }; })(), players: s.players.size, ghostOwner: s.ghostOwner, ai: !!s.ai, level: s.level, seed: s.seed, frames: g.frameCount, remote: [...s.players.values()].filter(p => !p.local).map(p => Math.hypot(p.x - s.me.x, p.z - s.me.z) > 0 || true).length }; }));
    const bad = [];
    if (!st.every(s => s.fin)) bad.push('NaN');
    if (!st.every(s => s.players === 3)) bad.push('o\'yinchilar soni ' + st.map(s => s.players));
    if (st[2].role !== 'ghost') bad.push('C ruh emas');
    if (new Set(st.map(s => s.seed)).size !== 1) bad.push('seed farq');
    if (st.some(s => s.ai)) bad.push('odam-ruh bor, lekin AI ham ishlayapti');
    // ruh (C) A ga to'satdan ko'rinsin va E, 1, R tugmalari ishlasin
    await C.p.evaluate(() => { const g = window.__hz; g.bot = null; g.sim.me.inv = false; });
    await C.p.keyboard.press('Digit1'); await C.p.keyboard.press('KeyR'); await C.p.waitForTimeout(2500);
    const after = await A.p.evaluate(() => { const g = window.__hz, s = g.sim; return { ghostVisible: s.ghost.visible, frames: g.frameCount, msgs: document.getElementById('hzSub').textContent }; });
    if (!after.ghostVisible) bad.push('A da ruh ko\'rinmadi');
    const marks = await C.p.evaluate(() => window.__hz.hud.markPool.length);
    if (marks < 2) bad.push('ruh uchun o\'yinchi belgilari yo\'q: ' + marks);
    // o'yin tugaydi -> hamma natija ekranini ko'radi -> host lobbiga qaytaradi -> qayta boshlanadi
    await A.p.evaluate(() => window.__hz.sim.finish(false, 'sinov'));
    for (const P of [A, B, C]) await P.p.waitForSelector('#hzEnd.on', { timeout: 15000 });
    await A.p.click('#hzAgain');
    for (const P of [A, B, C]) await P.p.waitForSelector('#hzLobby.on', { timeout: 15000 });
    await A.p.click('#hzStart');
    for (const P of [A, B, C]) await P.p.waitForFunction('window.__hz && window.__hz.sim && !window.__hz.sim.over && window.__hz.frameCount > 5', null, { timeout: 90000 });
    await A.p.waitForTimeout(1500);
    const st2 = [];
    for (const P of [A, B, C]) st2.push(await P.p.evaluate(() => { const s = window.__hz.sim; return { seed: s.seed, fin: Number.isFinite(s.me.x), t: s.t }; }));
    if (new Set(st2.map(x => x.seed)).size !== 1 || !st2.every(x => x.fin)) bad.push('qayta boshlashdan keyin holat farq');
    if (st2[0].seed === st[0].seed) bad.push('qayta boshlashda yangi seed kerak');
    // bitta o'yinchi chiqib ketadi: boshqalar davom etadi
    await B.ctx.close();
    await A.p.waitForTimeout(1200);
    const left = await A.p.evaluate(() => window.__hz.sim.players.size);
    if (left !== 2) bad.push('chiqib ketgan o\'yinchi o\'chirilmadi: ' + left);
    if (bad.length) errors.push(`[multi${i} L${level + 1}] ${bad.join('; ')}`); else passed++;
  } catch (e) { errors.push(`[multi${i} L${level + 1}] ${e.message.slice(0, 250)}`); }
  for (const P of [A, B, C]) { try { await P.ctx.close(); } catch {} } done++;
}

const jobs = []; for (let i = 0; i < NS; i++) jobs.push(() => runSolo(i)); for (let i = 0; i < NM; i++) jobs.push(() => runMulti(i));
let ji = 0;
await Promise.all(Array.from({ length: PAR }, async () => { while (ji < jobs.length) { const j = jobs[ji++]; await j(); process.stdout.write(`\r${done}/${jobs.length} (o'tgan ${passed})   `); } }));
console.log(`\n\n${jobs.length} ta brauzer sinovi: o'tdi ${passed}, xatolar ${errors.length}`);
for (const e of errors.slice(0, 40)) console.log(' -', e);
await browser.close(); srv.close(); process.exit(errors.length ? 1 : 0);
