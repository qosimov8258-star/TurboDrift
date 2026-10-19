import { chromium } from 'playwright';
import { createStatic } from '../../server.js';
import fs from 'fs';
const OUT = '/private/tmp/claude-501/-Users-ismoil-Desktop-game/60b90354-d033-477f-866c-49b2a7c6e66d/scratchpad/shots/';
const srv = createStatic(3501); await new Promise(r => srv.listen(3501, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', e.message));
for (const [m, f] of [['police_suv', '-z'], ['police_suv', '+z']]) {
  await p.goto(`http://localhost:3501/tools/inspect.html?m=${m}&f=${f}`);
  await p.waitForFunction('window.RESULT', null, { timeout: 120000 });
  const R = await p.evaluate('window.RESULT');
  console.log(m, f, JSON.stringify(R.out || R.err));
  if (R.imgs) R.imgs.forEach((d, i) => fs.writeFileSync(`${OUT}i_${m}_${f.replace('+', 'p').replace('-', 'm')}_${i}.jpg`, Buffer.from(d.split(',')[1], 'base64')));
}
await b.close(); srv.close();
