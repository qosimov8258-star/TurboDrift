// Haqiqiy foydalanuvchi yo'li (bot'siz): START -> video -> menyu -> yakka (omon qolgan / ruh) -> do'stlar bilan xona.
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const PORT = 3303; const srv = createStatic(PORT); attachGameServer(srv); await new Promise(r => srv.listen(PORT, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const errs = []; let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const mk = async tag => { const c = await b.newContext({ viewport: { width: 700, height: 420 } }); const p = await c.newPage(); p.on('pageerror', e => errs.push(tag + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/GL Driver|ERR_|favicon/.test(m.text())) errs.push(tag + ' ' + m.text().slice(0, 200)); }); return p; };
const frames = p => p.waitForFunction('window.__hz && window.__hz.sim && window.__hz.frameCount>8', null, { timeout: 90000 });
const U = `http://localhost:${PORT}/horror`;
// 1) yakka, omon qolgan, to'liq yo'l
{
  const p = await mk('solo'); await p.goto(U + '?nopause'); await p.waitForSelector('#hzSplash.on', { timeout: 60000 });
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('hzStartBtn')).opacity) === '0', 'START dastlab yashirin');
  await p.waitForTimeout(3300); ok(await p.evaluate(() => getComputedStyle(document.getElementById('hzStartBtn')).opacity) !== '0', '3 soniyadan keyin START chiqdi');
  await p.click('#hzStartBtn'); await p.waitForSelector('#hzMenu.on', { timeout: 30000 }); ok(true, 'video -> menyu');
  await p.fill('#hzName', 'Test'); await p.click('#hzRoleG'); ok(await p.locator('#hzChars .ch').count() === 5, 'ruh: 5 ta personaj');
  await p.click('#hzRoleS'); ok(await p.locator('#hzChars .ch').count() === 2, 'omon qolgan: 2 ta personaj');
  await p.click('#hzSolo'); await p.click('#hzLevelGrid .lcard:nth-child(2)'); await p.click('#hzLevelGo');
  await frames(p); ok(await p.evaluate(() => __hz.sim.level === 1 && __hz.sim.me.role === 'survivor'), 'yakka omon qolgan boshlandi');
  await p.waitForSelector('#hzPause.on', { timeout: 5000 }).catch(() => {}); // pointer lock headless'da yo'q -> pauza
  await p.click('#hzResume').catch(() => {}); await p.waitForTimeout(1500);
  await p.evaluate(() => __hz.sim.finish(true, 'x')); await p.waitForSelector('#hzEnd.on', { timeout: 15000 }); ok(true, 'natija ekrani');
  await p.click('#hzNext'); await frames(p); ok(await p.evaluate(() => __hz.sim.level === 2), 'keyingi daraja');
  await p.evaluate(() => __hzMain.toMenu()); await p.waitForSelector('#hzMenu.on'); ok(true, 'menyuga qaytish');
  // yakka ruh
  await p.click('#hzRoleG'); await p.click('.chars .ch:nth-child(4)'); await p.click('#hzSolo'); await p.click('#hzLevelGo');
  await frames(p); await p.waitForTimeout(3000);
  const g = await p.evaluate(() => ({ role: __hz.sim.me.role, ch: __hz.sim.me.char, bots: __hz.hub?.bots.length, map: !document.getElementById('hzMap').classList.contains('hidden') }));
  ok(g.role === 'ghost' && g.ch === 3 && g.bots === 2 && g.map, 'yakka ruh + karta: ' + JSON.stringify(g));
  await p.close();
}
// 2) do'stlar: A host (omon qolgan), B ruh (Tabassum)
{
  const A = await mk('A'), B = await mk('B');
  await A.goto(U + '?nostart&nopause'); await A.waitForSelector('#hzMenu.on', { timeout: 60000 }); await A.fill('#hzName', 'Ali'); await A.click('#hzFriends'); await A.click('#hzCreate');
  await A.waitForFunction('document.getElementById("hzCode").textContent.length===4 && document.getElementById("hzCode").textContent!=="----"'); const code = await A.textContent('#hzCode');
  await B.goto(U + '?nostart&nopause&room=' + code); await B.waitForSelector('#hzRoomIn', { state: 'visible', timeout: 60000 }); await B.fill('#hzName', 'Bob'); await B.click('#hzJoin');
  await B.waitForFunction(`document.getElementById("hzCode").textContent==="${code}"`);
  await B.click('#hzRole'); await B.waitForTimeout(400); ok(await B.locator('#hzLobbyChars .ch').count() === 5, 'lobbi: ruh 5 personaj');
  await B.click('#hzLobbyChars .ch:nth-child(5)'); await A.waitForTimeout(500);
  ok(await A.evaluate(() => document.querySelectorAll('#hzPlist .rl.ghost').length) === 1, 'host ruhni ko\'rdi');
  ok(await A.locator('#hzRole').isDisabled(), 'ikkinchi ruh bloklangan');
  await A.click('#hzStart'); await frames(A); await frames(B);
  await A.waitForTimeout(3000);
  const r = await Promise.all([A, B].map(P => P.evaluate(() => ({ role: __hz.sim.me.role, n: __hz.sim.players.size, gc: __hz.sim.players.get(__hz.sim.ghostOwner)?.char, fin: Number.isFinite(__hz.sim.me.x) }))));
  ok(r[0].role === 'survivor' && r[1].role === 'ghost' && r[0].n === 2 && r[1].n === 2 && r[0].gc === 4 && r[0].fin && r[1].fin, 'do\'stlar o\'yini: ' + JSON.stringify(r));
  await B.keyboard.press('KeyE'); await B.keyboard.press('Digit2'); await B.waitForTimeout(1500);
  ok(await A.evaluate(() => __hz.sim.ghost.visible), 'ruh E bilan ko\'rindi (A da)');
  ok(await B.evaluate(() => !document.getElementById('hzMap').classList.contains('hidden')), 'ruhda karta bor');
  await A.close(); await B.waitForTimeout(1500); ok(await B.evaluate(() => !!__hz.sim), 'host chiqsa ham ruh o\'yini buzilmadi');
  await B.close();
}
console.log('xatolar:', errs); await b.close(); srv.close(); process.exit(fails || errs.length ? 1 : 0);
