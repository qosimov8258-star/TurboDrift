import sharp from 'sharp';
const D = '/private/tmp/claude-501/-Users-ismoil-Desktop-game/16ac08e7-40e7-4ae9-9244-3fbcd521e23a/scratchpad/shots/';
const kind = process.argv[2] || 'grid', W = 640, H = 360;
const tiles = [];
for (let i = 0; i < 10; i++) tiles.push({ input: await sharp(D + `t${i}_${kind}.png`).resize(W, H).toBuffer(), left: (i % 2) * W, top: Math.floor(i / 2) * H });
await sharp({ create: { width: W * 2, height: H * 5, channels: 3, background: '#000' } }).composite(tiles).png().toFile(D + `sheet_${kind}.png`);
