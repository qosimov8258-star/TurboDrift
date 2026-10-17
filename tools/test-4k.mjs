// 4K check: 'Ultra' must render at >= 3840 px wide even on a 1080p window.
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../server.js';
const srv = createStatic(3226); attachGameServer(srv); await new Promise(r => srv.listen(3226, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('http://localhost:3226/?manual');
await p.waitForSelector('#menu.on', { timeout: 240000 });
const cv = () => p.evaluate(() => { const c = document.getElementById('c'); return [c.width, c.height, document.getElementById('qLabelMenu').textContent]; });
const seen = [];
for (let i = 0; i < 5; i++) { seen.push(await cv()); await p.evaluate(() => document.getElementById('btnQualityMenu').click()); }
console.log(seen.map(s => s.join(' ')).join('\n'));
const ultra = seen.find(s => /4K/.test(s[2]));
console.log(ultra && ultra[0] >= 3840 ? '4K OK ' + ultra[0] + 'x' + ultra[1] : '4K FAIL');
process.exit(ultra && ultra[0] >= 3840 ? 0 : 1);
