// Xarita generatori (sof JS, DOM va three.js yo'q => Node'da testlanadi).
// Uy rejasi BSP bilan bo'linadi (butun maydon xonalar bilan to'ladi), xonalar orasida eshiklar qo'yiladi.
// Devorlar — katakchalar CHEKKASIDA (ingichka), shuning uchun xonalar haqiqiy uyga o'xshaydi.
import { Rng, hash32 } from './rng.js';
import { LEVELS, CELL, WALL_H } from './levels.js';

export const WALL_T = 0.24;       // devor qalinligi
export const DOOR_W = 1.3;        // eshik ochig'i kengligi
export const DOOR_H = 2.3;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // 0:+x 1:+z 2:-x 3:-z

export function generate(seed, levelIndex) {
  const cfg = LEVELS[levelIndex];
  if (!cfg) throw new Error('bad level ' + levelIndex);
  const rng = new Rng(hash32(seed, levelIndex, 77));
  const W = cfg.W, H = cfg.H;
  const region = new Int16Array(W * H).fill(-1);
  const rooms = [];

  // ---------- 1. BSP: maydonni xonalarga bo'lish
  const leaves = [];
  const tree = [];          // [{a,b}] bo'linishlar: ichki tugunlar
  function split(x, y, w, h, depth) {
    const node = { x, y, w, h, kids: null, leaf: null };
    const can = (len, minChild) => len >= minChild * 2;
    const maxR = cfg.maxRoom;
    const big = w > maxR || h > maxR;
    const wantSplit = big || (depth < 6 && (w * h > 30) && rng.chance(0.45));
    const hall = Math.min(w, h) <= 2;
    let axis = null;       // 'x' — vertikal chiziq bilan bo'lish (chap/o'ng), 'z' — gorizontal
    if (wantSplit && !hall) {
      const okX = can(w, 3), okZ = can(h, 3);
      if (okX && okZ) axis = w > h * 1.25 ? 'x' : h > w * 1.25 ? 'z' : (rng.chance(0.5) ? 'x' : 'z');
      else if (okX) axis = 'x'; else if (okZ) axis = 'z';
    } else if (hall && Math.max(w, h) >= 9) axis = w > h ? 'x' : 'z';
    if (!axis) { node.leaf = leaves.length; leaves.push(node); return node; }
    const len = axis === 'x' ? w : h;
    let lo = hall ? 4 : 3, hi = len - lo;
    // ba'zan 2 kenglikdagi yo'lak ajratamiz
    let pos;
    if (!hall && len >= 8 && rng.chance(0.22)) pos = rng.chance(0.5) ? 2 : len - 2;
    else pos = rng.int(lo, hi);
    if (pos < 2 || len - pos < 2) pos = Math.floor(len / 2);
    if (axis === 'x') { node.kids = [split(x, y, pos, h, depth + 1), split(x + pos, y, w - pos, h, depth + 1)]; node.axis = 'x'; node.pos = x + pos; }
    else { node.kids = [split(x, y, w, pos, depth + 1), split(x, y + pos, w, h - pos, depth + 1)]; node.axis = 'z'; node.pos = y + pos; }
    tree.push(node);
    return node;
  }
  const root = split(0, 0, W, H, 0);
  for (const lf of leaves) {
    const id = rooms.length;
    const r = { id, x: lf.x, y: lf.y, w: lf.w, h: lf.h, hall: Math.min(lf.w, lf.h) <= 2, doors: [], type: 'hall' };
    r.cx = (lf.x + lf.w / 2) * CELL; r.cz = (lf.y + lf.h / 2) * CELL;
    rooms.push(r);
    for (let yy = lf.y; yy < lf.y + lf.h; yy++) for (let xx = lf.x; xx < lf.x + lf.w; xx++) region[yy * W + xx] = id;
  }
  const rid = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : region[y * W + x];

  // ---------- 2. Eshiklar: har bir bo'linishda bitta (daraxt => bog'langanlik), keyin tsikllar uchun qo'shimcha
  const doors = [];
  const doorKey = new Set();
  function addDoor(x, y, dir) {            // (x,y) katakdan dir tomonga chiqadigan chekka
    const nx = x + DIRS[dir][0], ny = y + DIRS[dir][1];
    const ra = rid(x, y), rb = rid(nx, ny);
    if (ra < 0 || rb < 0 || ra === rb) return null;
    // kanonik shakl: chap/yuqori katak
    let cx = x, cy = y, d = dir;
    if (dir === 2) { cx = nx; cy = ny; d = 0; } else if (dir === 3) { cx = nx; cy = ny; d = 1; }
    const key = cx + ',' + cy + ',' + d;
    if (doorKey.has(key)) return null;
    // yaqin atrofda boshqa eshik bo'lmasin (kamida 1 katak)
    for (const o of doors) if (Math.abs(o.cx - cx) + Math.abs(o.cy - cy) <= 1 && o.d === d) return null;
    doorKey.add(key);
    const dd = { id: doors.length, cx, cy, d, a: rid(cx, cy), b: rid(cx + DIRS[d][0], cy + DIRS[d][1]), exit: false };
    // eshik markazi (dunyo koordinatasi): chekka o'rtasi. d=0 => vertikal devor x=(cx+1)*CELL, eshik tekisligi YZ
    if (d === 0) { dd.x = (cx + 1) * CELL; dd.z = (cy + 0.5) * CELL; } else { dd.x = (cx + 0.5) * CELL; dd.z = (cy + 1) * CELL; }
    doors.push(dd);
    rooms[dd.a].doors.push(dd.id); rooms[dd.b].doors.push(dd.id);
    return dd;
  }
  // bo'linish chizig'i bo'yicha mumkin bo'lgan chekkalar
  function edgesOn(node) {
    const out = [];
    if (node.axis === 'x') { const xs = node.pos; for (let y = node.y; y < node.y + node.h; y++) out.push([xs - 1, y, 0]); }
    else { const ys = node.pos; for (let x = node.x; x < node.x + node.w; x++) out.push([x, ys - 1, 1]); }
    return out;
  }
  for (const node of tree) {
    const cand = edgesOn(node);
    rng.shuffle(cand);
    let ok = false;
    for (const [x, y, d] of cand) { if (addDoor(x, y, d)) { ok = true; break; } }
    if (!ok) {          // juda kamdan-kam: yaqinlik cheklovisiz
      for (const [x, y, d] of cand) {
        const key = x + ',' + y + ',' + d; if (doorKey.has(key)) { ok = true; break; }
      }
      if (!ok) { const [x, y, d] = cand[0]; const sv = doors.length; doorKey.add(x + ',' + y + ',' + d); const dd = { id: sv, cx: x, cy: y, d, a: rid(x, y), b: rid(x + DIRS[d][0], y + DIRS[d][1]), exit: false }; if (d === 0) { dd.x = (x + 1) * CELL; dd.z = (y + 0.5) * CELL; } else { dd.x = (x + 0.5) * CELL; dd.z = (y + 1) * CELL; } doors.push(dd); rooms[dd.a].doors.push(sv); rooms[dd.b].doors.push(sv); }
    }
  }
  // qo'shimcha eshiklar (aylanma yo'llar): qo'shni xonalar chegaralari
  const extra = Math.max(2, Math.round(rooms.length * 0.22));
  for (let i = 0, tries = 0; i < extra && tries < extra * 20; tries++) {
    const x = rng.int(0, W - 1), y = rng.int(0, H - 1), d = rng.int(0, 1);
    if (addDoor(x, y, d)) i++;
  }

  // ---------- 3. Graf: BFS masofalar, boshlang'ich xona va chiqish xonasi
  const adj = rooms.map(() => []);
  for (const d of doors) { adj[d.a].push(d.b); adj[d.b].push(d.a); }
  function bfs(src) {
    const dist = new Array(rooms.length).fill(-1); dist[src] = 0;
    const q = [src];
    for (let i = 0; i < q.length; i++) for (const n of adj[q[i]]) if (dist[n] < 0) { dist[n] = dist[q[i]] + 1; q.push(n); }
    return dist;
  }
  const isBoundary = r => r.x === 0 || r.y === 0 || r.x + r.w === W || r.y + r.h === H;
  let start = rng.int(0, rooms.length - 1);
  // boshlang'ich xona kamida 3x3 bo'lsin
  for (let t = 0; t < 50 && (rooms[start].hall || rooms[start].w < 3 || rooms[start].h < 3); t++) start = rng.int(0, rooms.length - 1);
  let dist0 = bfs(start);
  const boundRooms = rooms.filter(r => isBoundary(r) && !r.hall);
  let exitRoom = boundRooms.reduce((b, r) => (dist0[r.id] > (b ? dist0[b.id] : -1) ? r : b), null) || rooms[rooms.length - 1];
  const distE = bfs(exitRoom.id);
  // boshlang'ich xonani chiqishdan eng uzoq (lekin 3x3 dan kichik bo'lmagan) xonaga ko'chiramiz
  let bestS = start;
  for (const r of rooms) if (!r.hall && r.w >= 3 && r.h >= 3 && distE[r.id] > distE[bestS]) bestS = r.id;
  start = bestS;
  dist0 = bfs(start);
  for (const r of rooms) { r.dist = dist0[r.id]; r.distE = distE[r.id]; }

  // ---------- 4. Chiqish eshigi: chiqish xonasining tashqi devorida
  const exitEdges = [];
  const er = exitRoom;
  for (let y = er.y; y < er.y + er.h; y++) { if (er.x === 0) exitEdges.push({ x: 0, y, side: 'W' }); if (er.x + er.w === W) exitEdges.push({ x: W - 1, y, side: 'E' }); }
  for (let x = er.x; x < er.x + er.w; x++) { if (er.y === 0) exitEdges.push({ x, y: 0, side: 'N' }); if (er.y + er.h === H) exitEdges.push({ x, y: H - 1, side: 'S' }); }
  // eshik yonida boshqa eshik bo'lmasin
  const usable = exitEdges.filter(e => {
    const px = e.side === 'W' ? 0 : e.side === 'E' ? W : e.x + 0.5, pz = e.side === 'N' ? 0 : e.side === 'S' ? H : e.y + 0.5;
    return !doors.some(d => Math.hypot(d.x - px * CELL, d.z - pz * CELL) < CELL * 1.2);
  });
  const pickE = rng.pick(usable.length ? usable : exitEdges);
  const exit = { side: pickE.side, cx: pickE.x, cy: pickE.y, room: er.id, open: false };
  const outN = { W: [-1, 0], E: [1, 0], N: [0, -1], S: [0, 1] }[exit.side];
  exit.nx = outN[0]; exit.nz = outN[1];
  exit.x = exit.side === 'W' ? 0 : exit.side === 'E' ? W * CELL : (pickE.x + 0.5) * CELL;
  exit.z = exit.side === 'N' ? 0 : exit.side === 'S' ? H * CELL : (pickE.y + 0.5) * CELL;
  exit.vertical = exit.side === 'W' || exit.side === 'E';     // devor x=const (tekislik YZ)
  exit.cell = [pickE.x, pickE.y];

  // ---------- 5. Devor kesmalari (chekkalar) — eshiklar ochig'i bilan
  const walls = [];          // {x0,z0,x1,z1} to'liq balandlik
  const lintels = [];        // eshik ustidagi yopqich {x0,z0,x1,z1,y0,y1}
  const edgeDoor = new Map();
  for (const d of doors) edgeDoor.set(d.cx + ',' + d.cy + ',' + d.d, d);
  const exitKey = exit.vertical ? (exit.side === 'W' ? '-1,' + exit.cy + ',0' : (W - 1) + ',' + exit.cy + ',0') : (exit.side === 'N' ? exit.cx + ',-1,1' : exit.cx + ',' + (H - 1) + ',1');
  // vertikal chiziqlar (d=0): x=k*CELL, k=0..W, har bir y uchun
  const vRuns = [], hRuns = [];
  for (let k = 0; k <= W; k++) {
    let run = null;
    for (let y = 0; y < H; y++) {
      const L = rid(k - 1, y), R = rid(k, y);
      let wall = L !== R;              // (ikkalasi -1 bo'lishi mumkin emas)
      const dk = (k - 1) + ',' + y + ',0';
      const isDoor = edgeDoor.has(dk) || exitKey === dk;
      if (wall && !isDoor) { if (!run) run = { a: y, b: y + 1 }; else run.b = y + 1; }
      else { if (run) { vRuns.push({ k, ...run }); run = null; } if (isDoor) vRuns.push({ k, a: y, b: y, door: true, exit: exitKey === dk }); }
    }
    if (run) vRuns.push({ k, ...run });
  }
  for (let k = 0; k <= H; k++) {
    let run = null;
    for (let x = 0; x < W; x++) {
      const U = rid(x, k - 1), D = rid(x, k);
      let wall = U !== D;
      const dk = x + ',' + (k - 1) + ',1';
      const isDoor = edgeDoor.has(dk) || exitKey === dk;
      if (wall && !isDoor) { if (!run) run = { a: x, b: x + 1 }; else run.b = x + 1; }
      else { if (run) { hRuns.push({ k, ...run }); run = null; } if (isDoor) hRuns.push({ k, a: x, b: x, door: true, exit: exitKey === dk }); }
    }
    if (run) hRuns.push({ k, ...run });
  }
  const T2 = WALL_T / 2;
  const sideW = (CELL - DOOR_W) / 2;
  for (const r of vRuns) {
    const x = r.k * CELL;
    if (!r.door) walls.push({ x0: x - T2, x1: x + T2, z0: r.a * CELL - T2, z1: r.b * CELL + T2 });
    else {
      const z0 = r.a * CELL;
      walls.push({ x0: x - T2, x1: x + T2, z0: z0 - T2, z1: z0 + sideW });
      walls.push({ x0: x - T2, x1: x + T2, z0: z0 + CELL - sideW, z1: z0 + CELL + T2 });
      lintels.push({ x0: x - T2, x1: x + T2, z0: z0 + sideW, z1: z0 + CELL - sideW, y0: DOOR_H, y1: WALL_H });
    }
  }
  for (const r of hRuns) {
    const z = r.k * CELL;
    if (!r.door) walls.push({ z0: z - T2, z1: z + T2, x0: r.a * CELL - T2, x1: r.b * CELL + T2 });
    else {
      const x0 = r.a * CELL;
      walls.push({ z0: z - T2, z1: z + T2, x0: x0 - T2, x1: x0 + sideW });
      walls.push({ z0: z - T2, z1: z + T2, x0: x0 + CELL - sideW, x1: x0 + CELL + T2 });
      lintels.push({ z0: z - T2, z1: z + T2, x0: x0 + sideW, x1: x0 + CELL - sideW, y0: DOOR_H, y1: WALL_H });
    }
  }
  // eshik tashqi tomonidagi kichik "yo'lak"ni chiqish eshigi uchun bo'sh qoldiramiz (collider yo'q) — gate alohida

  // ---------- 6. Xona turlari va lamp
  const types = cfg.rooms;
  for (const r of rooms) {
    if (r.hall) { r.type = 'hall'; continue; }
    r.type = rng.pick(types);
    if (r.id === start) r.type = r.w * r.h >= 12 ? 'living' : r.type;
  }
  rooms[start].start = true;
  for (const r of rooms) {
    const area = r.w * r.h;
    const has = r.id === start ? rng.chance(0.25) : rng.chance(cfg.lampP + (r.hall ? 0.1 : 0));
    r.lamp = has ? { x: r.cx, y: WALL_H - 0.35, z: r.cz, mode: rng.pick(['flicker', 'flicker', 'dim', 'strobe', 'dying']), seed: rng.int(1, 9999), kind: area > 24 ? 'chandelier' : 'bulb' } : null;
  }

  // ---------- 7. Slotlar: devorga yaslangan joylar (chekka) va markaziy katakchalar
  const doorCells = new Set();          // eshik oldidagi kataklar — bo'sh turishi kerak
  for (const d of doors) {
    doorCells.add(d.cx + ',' + d.cy);
    doorCells.add((d.cx + DIRS[d.d][0]) + ',' + (d.cy + DIRS[d.d][1]));
  }
  doorCells.add(exit.cell[0] + ',' + exit.cell[1]);
  // chiqish eshigi oldida yana 1 katak
  const blocked = new Uint8Array(W * H);         // markazga qo'yilgan buyum / band
  const used = new Uint8Array(W * H);            // devorga qo'yilgan buyum bor
  const isRoomCell = (x, y, id) => rid(x, y) === id;
  function wallSlots(room) {
    const out = [];
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
      if (doorCells.has(x + ',' + y)) continue;
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + DIRS[dir][0], ny = y + DIRS[dir][1];
        if (rid(nx, ny) === room.id) continue;                 // bu chekka devor
        const k = dir === 0 ? x + ',' + y + ',0' : dir === 1 ? x + ',' + y + ',1' : dir === 2 ? (x - 1) + ',' + y + ',0' : x + ',' + (y - 1) + ',1';
        if (edgeDoor.has(k) || exitKey === k) continue;
        // devorga qarab, ichkariga qaraydigan yo'nalish: dir=0 (devor sharqda) => buyum -x tomonga qaraydi
        out.push({ x, y, dir });
      }
    }
    return out;
  }
  // slot -> dunyo: devor chizig'iga yaqin (WALL_T/2 + 0.02) dan boshlanadi, "rot" lokal +z ni xona ichkarisiga qaratadi
  // local(x,z,rot): tz = oz - x*sn + z*cs ; tx = ox + x*cs + z*sn. rot=0 => lokal +z = dunyo +z
  const slotRot = { 0: -Math.PI / 2, 1: Math.PI, 2: Math.PI / 2, 3: 0 };   // dir (devor qaysi tomonda) -> burilish: lokal +z ichkariga
  function slotWorld(s, off = 0) {
    const cxw = (s.x + 0.5) * CELL, czw = (s.y + 0.5) * CELL, h = CELL / 2 - WALL_T / 2 - off;
    if (s.dir === 0) return { x: cxw + h, z: czw, rot: slotRot[0] };
    if (s.dir === 2) return { x: cxw - h, z: czw, rot: slotRot[2] };
    if (s.dir === 1) return { x: cxw, z: czw + h, rot: slotRot[1] };
    return { x: cxw, z: czw - h, rot: slotRot[3] };
  }

  // xona ichidagi bo'sh joylar bog'langanligini tekshirish (markaziy buyum qo'yilsa ham)
  function roomStaysConnected(room, bx, by) {
    const freeCells = [];
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (!blocked[y * W + x] && !(x === bx && y === by)) freeCells.push([x, y]);
    if (!freeCells.length) return false;
    const seen = new Set([freeCells[0][0] + ',' + freeCells[0][1]]); const q = [freeCells[0]];
    for (let i = 0; i < q.length; i++) for (const [dx, dy] of DIRS) {
      const nx = q[i][0] + dx, ny = q[i][1] + dy, k = nx + ',' + ny;
      if (!seen.has(k) && rid(nx, ny) === room.id && !blocked[ny * W + nx] && !(nx === bx && ny === by)) { seen.add(k); q.push([nx, ny]); }
    }
    return seen.size === freeCells.length;
  }

  const ctx = {
    rng, cfg, CELL, WALL_T, rooms, W, H, region, blocked, used, doorCells, wallSlots, slotWorld,
    takeWall(room, deep = false) {      // bo'sh devor slotini ol (deep — chuqur buyum: katakni to'liq egallaydi)
      let s = wallSlots(room).filter(s => !used[s.y * W + s.x] && !blocked[s.y * W + s.x]);
      if (deep) s = s.filter(s => roomStaysConnected(room, s.x, s.y));
      if (!s.length) return null;
      const sl = rng.pick(s); used[sl.y * W + sl.x] = 1;
      if (deep) blocked[sl.y * W + sl.x] = 1;
      return { ...sl, ...slotWorld(sl) };
    },
    takeCenter(room, allowBlocking = false) {     // markaziy katak (eshik oldidan tashqari)
      const cand = [];
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
        const i = y * W + x;
        if (doorCells.has(x + ',' + y) || blocked[i] || used[i]) continue;
        cand.push([x, y]);
      }
      rng.shuffle(cand);
      for (const [x, y] of cand) {
        if (!roomStaysConnected(room, x, y)) continue;
        // eshik oldidagi kataklar o'tish uchun ulangan bo'lishi kerak — roomStaysConnected tekshiradi
        blocked[y * W + x] = 1;
        return { x, y, wx: (x + 0.5) * CELL, wz: (y + 0.5) * CELL };
      }
      return null;
    },
    colliders: [],           // statik to'siqlar (AABB)
    solid(x0, z0, x1, z1) { this.colliders.push({ x0, z0, x1, z1 }); },
    solidLocal(g, lx0, lz0, lx1, lz1) {        // lokal to'rtburchak -> dunyo AABB
      const pts = [[lx0, lz0], [lx1, lz0], [lx1, lz1], [lx0, lz1]].map(([a, b]) => [g.tx(a, b), g.tz(a, b)]);
      this.colliders.push({ x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), z0: Math.min(...pts.map(p => p[1])), z1: Math.max(...pts.map(p => p[1])) });
    },
  };

  // ---------- 8. Shkaflar (kalit shu yerda) — decor.js dan keyin joylanadi (decor wallSlot'larni band qiladi), shuning uchun
  // bu yerda faqat natija strukturasi; decor.js `finishMap(map, geo)` chaqiradi.
  return {
    seed, level: levelIndex, cfg, W, H, CELL, region, rooms, doors, exit, walls, lintels, start, ctx,
    keysNeeded: cfg.keys,
    sizeX: W * CELL, sizeZ: H * CELL,
  };
}

// ----- yordamchi: dunyo koordinatasidan xona
export function roomAt(map, x, z) {
  const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
  if (cx < 0 || cy < 0 || cx >= map.W || cy >= map.H) return -1;
  return map.region[cy * map.W + cx];
}
