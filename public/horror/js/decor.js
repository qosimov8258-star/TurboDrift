// Xonalarni jihozlash: g'alati, qadimiy, qo'rqinchli buyumlar; shkaflar; otiladigan narsalar; qon dog'lari.
// Sof JS: faqat Geo (massivlar) bilan ishlaydi.
import { Geo, hex3 } from './geo.js';
import { generate, roomAt } from './mapgen.js';
import { CELL, WALL_H } from './levels.js';

const COL = {
  wood: 0x5b3c27, dwood: 0x36231a, lwood: 0x7a553a, cloth: 0x6b2226, cloth2: 0x3a4a5a, white: 0xcfcdc4, metal: 0x4d5357, dmetal: 0x2c3034,
  bone: 0xd9d3bd, blood: 0x5c0b0b, gold: 0x9c8238, green: 0x2f4a38, paper: 0xb9ae90, rust: 0x6b3a22, black: 0x111113, stone: 0x66625f,
  skin: 0xc79a82, pink: 0xc47b95, brown: 0x4a3322, fabric: 0x55503f, tile: 0xb8bfb8,
};

export const THROW_TYPES = ['bottle', 'skull', 'book', 'doll', 'pot', 'brick', 'teddy', 'lantern'];

// ---------------------------------------------------------------- buyum quruvchilari
// Lokal sistema: x — devor bo'ylab, z — devordan xonaga, y — yuqoriga. g.local(...) allaqachon qo'yilgan.
function makeKit(g, C) {
  const B = (x, y, z, sx, sy, sz, col, ry = 0) => g.box(x, y, z, sx, sy, sz, col, ry);
  const solid = (x0, z0, x1, z1) => C.solidLocal(g, x0, z0, x1, z1);
  const I = {};

  I.bed = () => {
    B(0, 0.28, 1.15, 1.5, 0.3, 2.2, COL.dwood);                 // karkas
    B(0, 0.5, 1.2, 1.4, 0.22, 2.05, COL.fabric);                // matras
    B(0, 0.56, 1.95, 0.7, 0.14, 0.35, COL.white);               // yostiq
    B(0, 0.85, 0.06, 1.55, 0.95, 0.1, COL.dwood);               // bosh tomon
    B(0.3, 0.62, 0.9, 0.5, 0.05, 0.7, COL.blood);               // qon dog'i
    solid(-0.8, 0, 0.8, 2.3);
  };
  I.crib = () => {
    B(0, 0.3, 0.6, 1.0, 0.1, 1.2, COL.lwood);
    for (let i = -4; i <= 4; i++) { B(i * 0.11, 0.65, 0.04, 0.03, 0.6, 0.03, COL.lwood); B(i * 0.11, 0.65, 1.16, 0.03, 0.6, 0.03, COL.lwood); }
    for (let i = 0; i <= 5; i++) { B(-0.5, 0.65, 0.04 + i * 0.22, 0.03, 0.6, 0.03, COL.lwood); B(0.5, 0.65, 0.04 + i * 0.22, 0.03, 0.6, 0.03, COL.lwood); }
    B(0, 0.95, 0.6, 1.04, 0.04, 1.24, COL.lwood);
    B(0, 0.4, 0.6, 0.85, 0.12, 1.0, COL.white);
    g.sphere(0, 0.55, 0.85, 0.15, COL.pink, 6);                 // qo'g'irchoq
    solid(-0.55, 0, 0.55, 1.25);
  };
  I.bookshelf = () => {
    B(0, 1.1, 0.2, 1.9, 2.2, 0.38, COL.dwood);
    for (let r = 0; r < 5; r++) {
      const y = 0.25 + r * 0.42;
      B(0, y - 0.18, 0.2, 1.8, 0.04, 0.36, COL.wood);
      let x = -0.85;
      while (x < 0.8) { const w = 0.05 + C.rng.next() * 0.06, h = 0.22 + C.rng.next() * 0.16; const colr = [0x6b2226, 0x2f4a38, 0x3a4a5a, 0x7a6a3a, 0x4a2c20, 0x2b2b30][Math.floor(C.rng.next() * 6)]; if (C.rng.next() < 0.9) B(x + w / 2, y + h / 2 - 0.16, 0.2, w, h, 0.24, colr); x += w + 0.01; }
    }
    solid(-0.95, 0, 0.95, 0.4);
  };
  I.sofa = () => {
    B(0, 0.25, 0.45, 2.0, 0.5, 0.9, COL.cloth);
    B(0, 0.7, 0.12, 2.0, 0.6, 0.24, COL.cloth);
    B(-0.95, 0.5, 0.45, 0.14, 0.4, 0.9, COL.cloth); B(0.95, 0.5, 0.45, 0.14, 0.4, 0.9, COL.cloth);
    B(0.4, 0.55, 0.5, 0.7, 0.08, 0.7, 0x4a1a1c);
    solid(-1.05, 0, 1.05, 0.95);
  };
  I.tv = () => {                                                  // eski tutunli televizor, statik shovqin
    B(0, 0.35, 0.3, 1.0, 0.7, 0.55, COL.dwood);
    B(0, 0.95, 0.3, 0.85, 0.7, 0.6, COL.dmetal);
    C.glow.box(0, 0.97, 0.61, 0.62, 0.48, 0.02, 0x8aa6b0);
    solid(-0.5, 0, 0.5, 0.6);
  };
  I.fridge = () => { B(0, 0.95, 0.35, 0.8, 1.9, 0.7, COL.white); B(0.25, 1.3, 0.72, 0.05, 0.5, 0.05, COL.dmetal); B(0, 1.45, 0.71, 0.78, 0.02, 0.02, COL.dmetal); B(0.1, 0.6, 0.72, 0.5, 0.35, 0.02, COL.blood); solid(-0.4, 0, 0.4, 0.7); };
  I.stove = () => { B(0, 0.45, 0.35, 0.8, 0.9, 0.7, COL.dmetal); B(0, 0.92, 0.35, 0.8, 0.04, 0.7, COL.black); for (const [a, b] of [[-0.2, 0.2], [0.2, 0.2], [-0.2, 0.5], [0.2, 0.5]]) g.cyl(a, 0.95, b, 0.1, 0.02, COL.rust, 8); solid(-0.4, 0, 0.4, 0.7); };
  I.counter = () => { B(0, 0.45, 0.3, 1.6, 0.9, 0.6, COL.lwood); B(0, 0.92, 0.3, 1.64, 0.05, 0.64, COL.stone); B(0.3, 0.97, 0.3, 0.25, 0.07, 0.2, COL.metal); solid(-0.82, 0, 0.82, 0.62); };
  I.bathtub = () => { B(0, 0.3, 0.45, 1.8, 0.6, 0.9, COL.white); B(0, 0.62, 0.45, 1.5, 0.02, 0.6, COL.blood); B(-0.75, 0.75, 0.1, 0.1, 0.25, 0.1, COL.metal); solid(-0.92, 0, 0.92, 0.95); };
  I.sink = () => { B(0, 0.8, 0.25, 0.6, 0.12, 0.45, COL.white); B(0, 0.4, 0.14, 0.12, 0.8, 0.12, COL.white); B(0, 1.35, 0.03, 0.55, 0.8, 0.04, 0xb8c4c8); B(0, 1.35, 0.055, 0.5, 0.74, 0.01, 0x1a2024); solid(-0.32, 0, 0.32, 0.5); };
  I.toilet = () => { B(0, 0.22, 0.35, 0.4, 0.44, 0.55, COL.white); B(0, 0.6, 0.1, 0.42, 0.5, 0.2, COL.white); solid(-0.22, 0, 0.22, 0.65); };
  I.toybox = () => { B(0, 0.25, 0.3, 0.9, 0.5, 0.55, 0x7a3a2a); B(0, 0.52, 0.3, 0.94, 0.04, 0.6, 0x2a4a6a); g.sphere(0.2, 0.7, 0.3, 0.12, COL.pink, 6); solid(-0.47, 0, 0.47, 0.6); };
  I.altar = () => { B(0, 0.5, 0.45, 1.8, 1.0, 0.8, COL.stone); B(0, 1.02, 0.45, 1.9, 0.06, 0.9, COL.dwood); B(0, 1.9, 0.1, 0.12, 1.4, 0.08, COL.bone); B(0, 2.15, 0.1, 0.7, 0.12, 0.08, COL.bone); B(0.7, 1.15, 0.45, 0.06, 0.2, 0.06, COL.bone); B(-0.7, 1.15, 0.45, 0.06, 0.2, 0.06, COL.bone); C.glow.box(0.7, 1.28, 0.45, 0.04, 0.06, 0.04, 0xffb040); C.glow.box(-0.7, 1.28, 0.45, 0.04, 0.06, 0.04, 0xffb040); B(0, 1.06, 0.45, 0.5, 0.01, 0.4, COL.blood); solid(-0.95, 0, 0.95, 0.9); };
  I.blackboard = () => { B(0, 1.6, 0.03, 2.4, 1.1, 0.05, 0x1c2a22); B(0, 1.6, 0.05, 2.5, 1.2, 0.02, COL.lwood); B(0.2, 1.65, 0.07, 1.4, 0.04, 0.01, 0xcfcfc0); B(-0.3, 1.5, 0.07, 0.9, 0.04, 0.01, COL.bone); B(0.9, 1.4, 0.07, 0.4, 0.5, 0.01, 0x7a1010); };
  I.hospBed = () => { B(0, 0.4, 1.0, 0.95, 0.12, 2.0, COL.metal); B(0, 0.6, 1.0, 0.85, 0.2, 1.9, COL.white); B(0, 0.72, 1.5, 0.82, 0.04, 0.7, 0x7a8f8f); B(0, 0.8, 0.12, 0.95, 0.5, 0.08, COL.metal); for (const [a, b] of [[-0.42, 0.1], [0.42, 0.1], [-0.42, 1.9], [0.42, 1.9]]) B(a, 0.2, b, 0.05, 0.4, 0.05, COL.dmetal); B(0.1, 0.74, 0.9, 0.5, 0.02, 0.5, COL.blood); solid(-0.5, 0, 0.5, 2.05); };
  I.iv = () => { B(0, 0.9, 0.3, 0.04, 1.8, 0.04, COL.metal); B(0, 1.85, 0.3, 0.5, 0.04, 0.04, COL.metal); B(0.2, 1.65, 0.3, 0.1, 0.22, 0.06, 0x8a2020); B(0, 0.03, 0.3, 0.45, 0.04, 0.04, COL.metal); B(0, 0.03, 0.3, 0.04, 0.04, 0.45, COL.metal); solid(-0.2, 0.1, 0.2, 0.5); };
  I.bunk = () => { B(0, 0.3, 1.0, 0.9, 0.08, 2.0, COL.dmetal); B(0, 0.4, 1.0, 0.8, 0.1, 1.9, COL.fabric); B(0, 1.3, 1.0, 0.9, 0.08, 2.0, COL.dmetal); B(0, 1.4, 1.0, 0.8, 0.1, 1.9, COL.fabric); for (const [a, b] of [[-0.43, 0.05], [0.43, 0.05], [-0.43, 1.95], [0.43, 1.95]]) B(a, 0.85, b, 0.05, 1.7, 0.05, COL.dmetal); solid(-0.47, 0, 0.47, 2.0); };
  I.barrels = () => { g.cyl(-0.4, 0.45, 0.4, 0.33, 0.9, COL.wood, 9); g.cyl(0.3, 0.45, 0.35, 0.33, 0.9, COL.rust, 9); g.cyl(0.0, 1.0, 0.4, 0.3, 0.9, COL.dwood, 9); B(-0.4, 0.4, 0.4, 0.68, 0.04, 0.68, COL.dmetal, 0.4); solid(-0.75, 0, 0.65, 0.8); };
  I.crates = () => { B(-0.35, 0.3, 0.4, 0.6, 0.6, 0.6, COL.lwood, 0.15); B(0.35, 0.25, 0.4, 0.5, 0.5, 0.5, COL.wood, -0.2); B(-0.2, 0.85, 0.4, 0.5, 0.5, 0.5, COL.dwood, 0.5); solid(-0.7, 0, 0.65, 0.75); };
  I.clock = () => { B(0, 1.0, 0.2, 0.55, 2.0, 0.4, COL.dwood); B(0, 1.55, 0.41, 0.4, 0.4, 0.02, COL.bone); B(0, 1.55, 0.42, 0.02, 0.15, 0.01, COL.black); B(0.05, 1.58, 0.42, 0.1, 0.02, 0.01, COL.black); B(0, 0.75, 0.41, 0.12, 0.6, 0.02, COL.gold); solid(-0.3, 0, 0.3, 0.42); };
  I.mirror = () => { B(0, 1.5, 0.03, 0.9, 1.5, 0.05, COL.gold); B(0, 1.5, 0.06, 0.78, 1.38, 0.01, 0x2a3236); };       // devorda osilgan
  I.portrait = () => {                                              // ko'zi porlaydigan eski portret
    B(0, 1.7, 0.03, 0.75, 0.95, 0.05, COL.gold); B(0, 1.7, 0.06, 0.62, 0.82, 0.01, 0x1a1512);
    g.sphere(0, 1.82, 0.075, 0.1, 0x6a5a48, 6, 1.2); B(0, 1.55, 0.07, 0.3, 0.3, 0.015, 0x2a2018);
    C.glow.box(-0.045, 1.83, 0.085, 0.03, 0.015, 0.01, 0xd8c070); C.glow.box(0.045, 1.83, 0.085, 0.03, 0.015, 0.01, 0xd8c070);
  };
  I.cross = () => { B(0, 1.9, 0.04, 0.1, 1.0, 0.06, COL.wood); B(0, 2.05, 0.04, 0.55, 0.1, 0.06, COL.wood); B(0, 1.9, 0.07, 0.04, 0.9, 0.01, COL.blood); };
  I.mask = () => { g.sphere(0, 1.7, 0.1, 0.17, COL.bone, 6, 1.3); C.glow.box(-0.06, 1.74, 0.23, 0.04, 0.02, 0.01, 0x000000); B(-0.06, 1.74, 0.245, 0.05, 0.03, 0.01, COL.black); B(0.06, 1.74, 0.245, 0.05, 0.03, 0.01, COL.black); B(0, 1.6, 0.245, 0.1, 0.02, 0.01, COL.blood); };
  I.deer = () => { B(0, 1.9, 0.1, 0.12, 0.12, 0.12, COL.brown); g.sphere(0, 1.65, 0.28, 0.15, COL.brown, 6, 1.4); B(-0.14, 2.05, 0.15, 0.03, 0.4, 0.03, COL.bone, 0.4); B(0.14, 2.05, 0.15, 0.03, 0.4, 0.03, COL.bone, -0.4); C.glow.box(-0.06, 1.7, 0.42, 0.03, 0.03, 0.01, 0xe0e0a0); C.glow.box(0.06, 1.7, 0.42, 0.03, 0.03, 0.01, 0xe0e0a0); };
  I.handprints = () => { for (let i = 0; i < 5; i++) { const x = -0.6 + i * 0.3 + (C.rng.next() - 0.5) * 0.1, y = 1.1 + C.rng.next() * 0.8; B(x, y, 0.015, 0.14, 0.2, 0.01, COL.blood); B(x, y - 0.18, 0.015, 0.05, 0.3, 0.01, COL.blood); } };
  I.shelfJars = () => { B(0, 1.2, 0.15, 1.2, 0.05, 0.3, COL.dwood); B(0, 1.8, 0.15, 1.2, 0.05, 0.3, COL.dwood); for (let i = 0; i < 5; i++) { g.cyl(-0.5 + i * 0.25, 1.32, 0.15, 0.07, 0.2, [0x7a9a6a, 0x9a7a4a, 0x6a8a9a][i % 3], 7); g.cyl(-0.5 + i * 0.25, 1.92, 0.15, 0.06, 0.18, 0x8a4a4a, 7); } };
  I.rocking = () => { B(0, 0.5, 0.0, 0.5, 0.06, 0.5, COL.wood); B(0, 0.85, -0.22, 0.5, 0.7, 0.05, COL.wood); B(-0.25, 0.1, 0, 0.04, 0.06, 0.9, COL.dwood); B(0.25, 0.1, 0, 0.04, 0.06, 0.9, COL.dwood); for (const [a, b] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) B(a, 0.28, b, 0.04, 0.4, 0.04, COL.wood); };
  I.dollChair = () => { B(0, 0.45, 0, 0.5, 0.05, 0.5, COL.wood); B(0, 0.85, -0.23, 0.5, 0.8, 0.05, COL.wood); for (const [a, b] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) B(a, 0.22, b, 0.05, 0.44, 0.05, COL.wood); B(0, 0.7, 0, 0.22, 0.4, 0.14, 0x8a6a8a); g.sphere(0, 1.02, 0, 0.12, COL.skin, 6); C.glow.box(-0.04, 1.03, 0.11, 0.02, 0.02, 0.01, 0xaa1010); C.glow.box(0.04, 1.03, 0.11, 0.02, 0.02, 0.01, 0xaa1010); };
  I.piano = () => { B(0, 0.7, 0.35, 1.5, 1.2, 0.7, COL.black); B(0, 0.78, 0.8, 1.45, 0.06, 0.2, COL.white); for (let i = -6; i <= 6; i++) B(i * 0.105, 0.82, 0.82, 0.015, 0.02, 0.16, COL.black); B(0, 0.4, 1.0, 0.5, 0.08, 0.35, COL.dwood); solid(-0.78, 0, 0.78, 1.05); };
  I.desk = () => { B(0, 0.72, 0.35, 1.3, 0.05, 0.7, COL.wood); B(-0.58, 0.36, 0.35, 0.06, 0.72, 0.6, COL.dwood); B(0.58, 0.36, 0.35, 0.06, 0.72, 0.6, COL.dwood); B(0.3, 0.8, 0.3, 0.3, 0.07, 0.22, COL.paper); B(-0.3, 0.8, 0.4, 0.14, 0.12, 0.14, COL.black); solid(-0.65, 0, 0.65, 0.72); };
  I.lockerDeco = () => { for (let i = -1; i <= 1; i++) { B(i * 0.45, 0.95, 0.25, 0.42, 1.9, 0.5, COL.metal); B(i * 0.45 + 0.12, 1.2, 0.51, 0.04, 0.12, 0.02, COL.dmetal); B(i * 0.45, 1.6, 0.51, 0.3, 0.04, 0.01, COL.dmetal); B(i * 0.45, 1.65, 0.51, 0.3, 0.04, 0.01, COL.dmetal); } solid(-0.7, 0, 0.7, 0.52); };
  I.statue = () => { B(0, 0.25, 0.4, 0.7, 0.5, 0.7, COL.stone); B(0, 1.0, 0.4, 0.35, 1.0, 0.25, COL.stone); g.sphere(0, 1.7, 0.4, 0.2, COL.stone, 6); B(0.3, 1.2, 0.4, 0.1, 0.6, 0.1, COL.stone, 0.4); C.glow.box(-0.07, 1.72, 0.58, 0.04, 0.03, 0.01, 0xb02020); C.glow.box(0.07, 1.72, 0.58, 0.04, 0.03, 0.01, 0xb02020); solid(-0.4, 0.05, 0.4, 0.75); };
  I.coffin = () => { B(0, 0.4, 1.0, 0.85, 0.5, 2.1, COL.dwood); B(0, 0.67, 1.0, 0.7, 0.05, 1.95, COL.lwood); B(0, 0.7, 1.4, 0.04, 0.02, 0.6, COL.gold); B(0, 0.7, 1.4, 0.3, 0.02, 0.04, COL.gold); solid(-0.45, 0, 0.45, 2.05); };
  I.skullPile = () => { for (let i = 0; i < 7; i++) { const a = i * 1.1, rr = 0.15 + (i % 3) * 0.12; g.sphere(Math.cos(a) * rr, 0.1 + (i > 4 ? 0.18 : 0), 0.4 + Math.sin(a) * rr, 0.1, COL.bone, 6, 1.1); } B(0, 0.04, 0.4, 0.9, 0.04, 0.9, COL.blood); solid(-0.45, 0, 0.45, 0.85); };
  I.candles = () => { for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.12 + (C.rng.next() - 0.5) * 0.06, z = 0.3 + C.rng.next() * 0.2; g.cyl(x, 0.08 + (i % 2) * 0.04, z, 0.025, 0.16 + (i % 2) * 0.08, COL.bone, 6); C.glow.box(x, 0.2 + (i % 2) * 0.08, z, 0.02, 0.04, 0.02, 0xffa030); } B(0, 0.01, 0.4, 0.8, 0.01, 0.4, COL.blood); };
  I.tallMannequin = () => { B(0, 0.9, 0.3, 0.3, 1.0, 0.18, COL.paper); g.sphere(0, 1.7, 0.3, 0.13, COL.paper, 6, 1.3); B(0, 0.4, 0.3, 0.1, 0.8, 0.1, COL.paper); B(-0.25, 1.1, 0.3, 0.07, 0.6, 0.07, COL.paper, 0); B(0.25, 1.1, 0.3, 0.07, 0.6, 0.07, COL.paper, 0); solid(-0.2, 0.15, 0.2, 0.45); };
  I.operating = () => { B(0, 0.85, 0, 0.9, 0.1, 2.0, COL.metal); B(0, 0.45, 0, 0.2, 0.9, 0.2, COL.dmetal); B(0, 0.04, 0, 0.8, 0.08, 0.8, COL.dmetal); B(0, 0.92, -0.3, 0.7, 0.04, 1.2, COL.blood); B(0, 2.4, 0, 0.8, 0.1, 0.8, COL.metal); solid(-0.5, -1.0, 0.5, 1.0); };
  I.table = () => { B(0, 0.75, 0, 1.4, 0.07, 0.9, COL.wood); for (const [a, b] of [[-0.62, -0.38], [0.62, -0.38], [-0.62, 0.38], [0.62, 0.38]]) B(a, 0.36, b, 0.07, 0.72, 0.07, COL.dwood); B(0.1, 0.82, 0.05, 0.3, 0.07, 0.2, COL.paper); solid(-0.72, -0.47, 0.72, 0.47); };
  I.diningTable = () => { B(0, 0.78, 0, 2.2, 0.07, 1.0, COL.dwood); for (const [a, b] of [[-1.0, -0.4], [1.0, -0.4], [-1.0, 0.4], [1.0, 0.4]]) B(a, 0.37, b, 0.09, 0.74, 0.09, COL.wood); for (let i = -2; i <= 2; i++) if (i) { B(i * 0.4, 0.84, 0.25, 0.1, 0.06, 0.1, COL.white); g.cyl(i * 0.4, 0.4, -0.7 * Math.sign(i), 0.01, 0.01, COL.wood, 3); } for (const x of [-0.7, 0, 0.7]) { B(x, 0.45, 0.8, 0.45, 0.05, 0.45, COL.wood); B(x, 0.75, 1.0, 0.45, 0.6, 0.05, COL.wood); B(x, 0.45, -0.8, 0.45, 0.05, 0.45, COL.wood); B(x, 0.75, -1.0, 0.45, 0.6, 0.05, COL.wood); } C.glow.box(0, 0.9, 0, 0.03, 0.08, 0.03, 0xffa030); B(0, 0.83, 0, 0.5, 0.01, 0.3, COL.blood); solid(-1.15, -0.55, 1.15, 0.55); };
  I.pews = () => { for (const z of [-0.5, 0.5]) { B(0, 0.45, z, 2.0, 0.08, 0.45, COL.wood); B(0, 0.8, z - 0.2, 2.0, 0.7, 0.06, COL.dwood); B(-0.95, 0.22, z, 0.08, 0.44, 0.4, COL.dwood); B(0.95, 0.22, z, 0.08, 0.44, 0.4, COL.dwood); } solid(-1.05, -0.75, 1.05, 0.75); };
  I.ritual = () => { C.geo.ring(0, 0.012, 0, 0.9, 1.0, COL.blood, 28); C.geo.ring(0, 0.013, 0, 0.5, 0.55, COL.blood, 20); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; B(Math.cos(a) * 0.72, 0.013, Math.sin(a) * 0.72, 1.4, 0.008, 0.04, COL.blood, a + 1.57); } for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const x = Math.cos(a) * 1.05, z = Math.sin(a) * 1.05; g.cyl(x, 0.1, z, 0.03, 0.2, COL.bone, 6); C.glow.box(x, 0.24, z, 0.025, 0.05, 0.025, 0xffa030); } g.sphere(0, 0.12, 0, 0.1, COL.bone, 6, 1.1); solid(-0.35, -0.35, 0.35, 0.35); };
  I.hangDoll = () => { B(0, 2.45, 0, 0.015, 1.4, 0.015, COL.paper); g.sphere(0, 1.7, 0, 0.1, COL.skin, 6); B(0, 1.45, 0, 0.16, 0.35, 0.08, 0x7a5a7a); B(-0.12, 1.45, 0, 0.04, 0.3, 0.04, COL.skin); B(0.12, 1.45, 0, 0.04, 0.3, 0.04, COL.skin); C.glow.box(-0.035, 1.72, 0.09, 0.02, 0.02, 0.01, 0xaa1010); C.glow.box(0.035, 1.72, 0.09, 0.02, 0.02, 0.01, 0xaa1010); };
  I.chandelier = () => { g.cyl(0, 3.05, 0, 0.015, 0.3, COL.dmetal, 4); C.geo.ring(0, 2.88, 0, 0.35, 0.4, COL.gold, 14); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.cyl(Math.cos(a) * 0.38, 2.95, Math.sin(a) * 0.38, 0.02, 0.15, COL.bone, 5); C.glow.box(Math.cos(a) * 0.38, 3.05, Math.sin(a) * 0.38, 0.02, 0.05, 0.02, 0xffb050); } };
  I.stainFloor = () => { C.geo.disc(0, 0.01, 0, 0.5 + C.rng.next() * 0.6, COL.blood, 9); for (let i = 0; i < 3; i++) C.geo.disc((C.rng.next() - 0.5) * 1.4, 0.011, (C.rng.next() - 0.5) * 1.4, 0.1 + C.rng.next() * 0.25, 0x4a0808, 7); };
  I.footprints = () => { for (let i = 0; i < 8; i++) { B((i % 2 ? 0.13 : -0.13), 0.012, i * 0.4 - 1.4, 0.1, 0.006, 0.26, 0x3a0707); } };
  I.chair = () => { B(0, 0.45, 0, 0.45, 0.05, 0.45, COL.wood); B(0, 0.8, -0.2, 0.45, 0.7, 0.05, COL.wood); for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) B(a, 0.22, b, 0.05, 0.44, 0.05, COL.dwood); };
  I.deskSchool = () => { B(0, 0.7, 0, 0.9, 0.05, 0.55, COL.lwood); for (const [a, b] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) B(a, 0.35, b, 0.04, 0.7, 0.04, COL.metal); B(0, 0.4, 0.55, 0.4, 0.05, 0.4, COL.lwood); B(0, 0.65, 0.78, 0.4, 0.4, 0.04, COL.lwood); solid(-0.48, -0.3, 0.48, 0.8); };
  I.wheelchair = () => { B(0, 0.5, 0, 0.45, 0.05, 0.45, COL.dmetal); B(0, 0.85, -0.22, 0.45, 0.6, 0.04, COL.dmetal); g.cyl(-0.3, 0.3, 0, 0.3, 0.04, COL.black, 10); g.cyl(0.3, 0.3, 0, 0.3, 0.04, COL.black, 10); solid(-0.35, -0.3, 0.35, 0.3); };
  I.teddy = () => { g.sphere(0, 0.18, 0, 0.14, COL.brown, 6); g.sphere(0, 0.38, 0, 0.1, COL.brown, 6); g.sphere(-0.07, 0.46, 0, 0.04, COL.brown, 4); g.sphere(0.07, 0.46, 0, 0.04, COL.brown, 4); C.glow.box(-0.03, 0.4, 0.09, 0.015, 0.015, 0.01, 0xaa1010); C.glow.box(0.03, 0.4, 0.09, 0.015, 0.015, 0.01, 0xaa1010); };
  return I;
}

// xona turlari -> (devor buyumlari, markaz buyumlari, osma narsalar)
const LAYOUT = {
  bedroom: { wall: ['bed', 'bookshelf', 'mirror', 'clock', 'mask'], center: ['rocking'], hang: ['portrait', 'cross', 'handprints', 'mirror'] },
  kitchen: { wall: ['fridge', 'stove', 'counter', 'counter', 'shelfJars'], center: ['table'], hang: ['handprints', 'clock'] },
  living: { wall: ['sofa', 'tv', 'bookshelf', 'clock', 'piano'], center: ['table', 'rocking', 'dollChair'], hang: ['portrait', 'deer', 'mirror'] },
  bath: { wall: ['bathtub', 'sink', 'toilet'], center: [], hang: ['mirror', 'handprints'] },
  library: { wall: ['bookshelf', 'bookshelf', 'bookshelf', 'desk', 'clock'], center: ['table', 'tallMannequin'], hang: ['portrait', 'mask'] },
  nursery: { wall: ['crib', 'toybox', 'bookshelf', 'crib'], center: ['rocking', 'dollChair'], hang: ['portrait', 'handprints'] },
  dining: { wall: ['counter', 'clock', 'bookshelf'], center: ['diningTable'], hang: ['portrait', 'deer', 'mask'] },
  classroom: { wall: ['blackboard', 'lockerDeco', 'bookshelf'], center: ['deskSchool', 'deskSchool', 'deskSchool', 'deskSchool', 'deskSchool', 'deskSchool'], hang: ['handprints', 'clock'] },
  office: { wall: ['desk', 'bookshelf', 'lockerDeco'], center: ['table'], hang: ['portrait', 'handprints'] },
  storage: { wall: ['crates', 'barrels', 'lockerDeco', 'shelfJars'], center: ['crates', 'barrels'], hang: ['handprints'] },
  ward: { wall: ['hospBed', 'hospBed', 'hospBed', 'iv'], center: ['wheelchair'], hang: ['handprints', 'clock'] },
  surgery: { wall: ['counter', 'shelfJars', 'iv'], center: ['operating'], hang: ['handprints'] },
  chapel: { wall: ['altar', 'cross', 'statue', 'candles'], center: ['pews', 'pews', 'pews'], hang: ['cross', 'portrait'] },
  ritual: { wall: ['skullPile', 'candles', 'mask', 'statue'], center: ['ritual'], hang: ['handprints', 'mask'] },
  crypt: { wall: ['coffin', 'skullPile', 'statue', 'candles'], center: ['coffin'], hang: ['cross'] },
  cell: { wall: ['bunk', 'toilet', 'bunk'], center: [], hang: ['handprints'] },
  hall: { wall: ['clock', 'mirror', 'statue', 'chair', 'tallMannequin', 'candles'], center: [], hang: ['portrait', 'portrait', 'mirror', 'deer', 'handprints'] },
};
const DEEP = new Set(['bed', 'hospBed', 'bunk', 'coffin', 'crib', 'piano']);
const HANG = new Set(['portrait', 'cross', 'mask', 'deer', 'handprints', 'mirror', 'shelfJars']);
// shu buyumlar xona ichida emas, devor sirtida: ularni "osma" slot (used'ga qaramaydigan) oladi
const WALLFLAT = new Set(['blackboard']);

// ---------------------------------------------------------------- asosiy
export function buildLevel(seed, levelIndex) {
  const map = generate(seed, levelIndex);
  const C = map.ctx, rng = C.rng, cfg = map.cfg;
  const geo = new Geo(), glow = new Geo();
  C.geo = geo; C.glow = glow;
  // glow ham geo bilan bir xil lokal transformni ishlatsin
  const sync = g => { glow.ox = g.ox; glow.oz = g.oz; glow.cs = g.cs; glow.sn = g.sn; };
  const kit0 = makeKit(geo, C);
  // glow.box chaqirilganda joriy lokal transformni geo'dan oladi
  const origBox = glow.box.bind(glow);
  glow.box = (...a) => { sync(geo); return origBox(...a); };
  const origRing = geo.ring.bind(geo);
  // start xonasi markazi band (spawn)
  const sr = map.rooms[map.start];
  const scx = Math.floor(sr.x + sr.w / 2), scy = Math.floor(sr.y + sr.h / 2);
  C.used[scy * map.W + scx] = 1;

  // ---- shkaflar
  const cabinets = [];
  const roomOrder = rng.shuffle(map.rooms.filter(r => !r.hall || rng.chance(0.4)).map(r => r.id));
  const want = cfg.cabinets;
  let guard = 0;
  while (cabinets.length < want && guard++ < want * 12) {
    const room = map.rooms[roomOrder[guard % roomOrder.length]];
    const per = cabinets.filter(c => c.room === room.id).length;
    if (per >= 3) continue;
    const s = C.takeWall(room);
    if (!s) continue;
    const kind = ({ hospital: 'locker', school: 'locker', asylum: 'locker', factory: 'locker' }[cfg.theme] && rng.chance(0.6)) ? 'locker' : (rng.chance(0.3) ? 'dresser' : 'wardrobe');
    const dims = kind === 'wardrobe' ? { w: 1.15, d: 0.6, h: 2.1 } : kind === 'dresser' ? { w: 1.1, d: 0.5, h: 1.05 } : { w: 0.8, d: 0.5, h: 1.9 };
    cabinets.push({ id: cabinets.length, room: room.id, kind, x: s.x, z: s.z, rot: s.rot, ...dims, hasKey: false, open: false });
    C.solidLocal(geo.local(s.x, s.z, s.rot), -dims.w / 2, 0, dims.w / 2, dims.d);
  }
  // kalitlar: boshlang'ich xonadan uzoqroq, turli xonalarda
  {
    const cand = cabinets.filter(c => map.rooms[c.room].dist >= 1 && c.room !== map.start);
    const pool = cand.length >= map.keysNeeded ? cand : cabinets.filter(c => c.room !== map.start);
    rng.shuffle(pool);
    const usedRooms = new Set();
    let placed = 0;
    for (const c of pool) { if (placed >= map.keysNeeded) break; if (usedRooms.has(c.room) && pool.length > map.keysNeeded * 2) continue; c.hasKey = true; usedRooms.add(c.room); placed++; }
    for (const c of pool) { if (placed >= map.keysNeeded) break; if (!c.hasKey) { c.hasKey = true; placed++; } }
  }

  // ---- xonalarni jihozlash
  for (const room of map.rooms) {
    const lay = LAYOUT[room.type] || LAYOUT.hall;
    const area = room.w * room.h;
    const nWall = Math.max(1, Math.min(lay.wall.length + 1, Math.round(area / 5.5) + rng.int(0, 1)));
    for (let i = 0; i < nWall; i++) {
      const name = rng.pick(lay.wall);
      if (HANG.has(name) || WALLFLAT.has(name)) continue;
      const s = C.takeWall(room, DEEP.has(name)); if (!s) break;
      geo.local(s.x, s.z, s.rot);
      kit0[name]();
    }
    // blackboard: faqat classroom uchun, devorga
    if (room.type === 'classroom') { const s = C.takeWall(room); if (s) { geo.local(s.x, s.z, s.rot); kit0.blackboard(); } }
    // markaz
    const nCenter = lay.center.length ? Math.min(room.type === 'classroom' ? 6 : 2, Math.max(0, Math.round(area / 9))) : 0;
    for (let i = 0; i < nCenter; i++) {
      const name = lay.center[i % lay.center.length] === 'ritual' ? 'ritual' : rng.pick(lay.center);
      const cell = C.takeCenter(room); if (!cell) break;
      const square = name === 'pews' || name === 'deskSchool' || name === 'diningTable';
      const j = square ? 0 : 0.2;
      geo.local(cell.wx + rng.range(-j, j), cell.wz + rng.range(-j, j), square ? (rng.int(0, 1) * Math.PI / 2) : rng.range(0, Math.PI * 2));
      kit0[name]();
    }
    // osma narsalar (portret, qon izlari...)
    const nHang = rng.int(1, Math.max(1, Math.min(4, Math.round(area / 6))));
    for (let i = 0; i < nHang; i++) {
      const name = rng.pick(lay.hang);
      const slots = C.wallSlots(room).filter(s => !C.doorCells.has(s.x + ',' + s.y));
      if (!slots.length) break;
      const sl = rng.pick(slots), w = C.slotWorld(sl, -0.0);
      // osma narsa devordagi shkaf/buyum yonida bo'lmasin: 'used' bo'lmagan yoki baland buyum
      geo.local(w.x, w.z, w.rot);
      kit0[name]();
    }
    // qon dog'lari, iz
    if (rng.chance(0.55)) { const cell = { x: room.x + rng.int(0, room.w - 1), y: room.y + rng.int(0, room.h - 1) }; geo.local((cell.x + 0.5) * CELL + rng.range(-0.6, 0.6), (cell.y + 0.5) * CELL + rng.range(-0.6, 0.6), 0); kit0.stainFloor(); }
    if (rng.chance(0.2)) { const cell = { x: room.x + rng.int(0, room.w - 1), y: room.y + rng.int(0, room.h - 1) }; geo.local((cell.x + 0.5) * CELL, (cell.y + 0.5) * CELL, rng.int(0, 3) * Math.PI / 2); kit0.footprints(); }
    // osma qo'g'irchoq (o'rtadan emas, ancha sirtqi joydan)
    if (room.type !== 'hall' && rng.chance(0.12)) { geo.local(room.cx + rng.range(-0.6, 0.6), room.cz + rng.range(-0.6, 0.6), 0); kit0.hangDoll(); }
    if (room.lamp && room.lamp.kind === 'chandelier') { geo.local(room.cx, room.cz, 0); kit0.chandelier(); }
  }
  geo.reset(); glow.reset();

  // ---- chiqish eshigi belgisi
  const ex = map.exit;
  {
    const inX = -ex.nx, inZ = -ex.nz;
    glow.reset();
    const sx = ex.x + inX * 0.2, sz = ex.z + inZ * 0.2;
    glow.box(sx, 2.75, sz, ex.vertical ? 0.05 : 0.9, 0.28, ex.vertical ? 0.9 : 0.05, 0x33ff66);
  }

  // ---- otiladigan narsalar
  const throwables = [];
  for (let i = 0, t = 0; i < cfg.throwables && t < cfg.throwables * 30; t++) {
    const room = map.rooms[rng.int(0, map.rooms.length - 1)];
    const x = (room.x + rng.range(0.4, room.w - 0.4)) * CELL, z = (room.y + rng.range(0.4, room.h - 0.4)) * CELL;
    if (inCollider(map, x, z, 0.35)) continue;
    const type = rng.pick(THROW_TYPES);
    throwables.push({ id: i, type, x, y: 0.15, z, room: room.id });
    i++;
  }

  // ---- spawn nuqtalari (start xonasi markazi)
  const spawn = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; spawn.push({ x: (scx + 0.5) * CELL + Math.cos(a) * (i ? 0.85 : 0), z: (scy + 0.5) * CELL + Math.sin(a) * (i ? 0.85 : 0) }); }
  // ruh boshlang'ich joyi: start xonasidan uzoq
  const gr = map.rooms.filter(r => r.dist >= 3).sort((a, b) => b.dist - a.dist)[Math.min(2, map.rooms.length - 1)] || map.rooms[map.rooms.length - 1];

  // ---- hamma kollayderlar (devorlar + buyumlar)
  const colliders = [...map.walls, ...C.colliders];
  return {
    ...map, geo, glow, cabinets, throwables, spawn, colliders, ghostStart: { x: gr.cx, z: gr.cz },
    ctx: undefined, bounds: { x0: 0, z0: 0, x1: map.sizeX, z1: map.sizeZ },
  };
}

export function inCollider(map, x, z, r) {
  const cols = map.ctx ? [...map.walls, ...map.ctx.colliders] : map.colliders;
  for (const c of cols) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  return false;
}
