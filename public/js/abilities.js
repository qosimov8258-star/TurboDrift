// Battle-arena abilities. Before a fight the player picks LOADOUT_SIZE of them; they sit on keys 1 2 3. Each has its own cool-down.
// kind: 'atk' attack · 'def' defence · 'util' utility.   cd = cool-down in seconds.
export const ABILITIES = [
  { id: 'gun',     ico: '🔫', name: 'Pulemyot',   kind: 'atk',  cd: 8,  desc: '14 ta o\'q ketma-ket (har biri 3 jon)' },
  { id: 'missile', ico: '🚀', name: 'Raketa',     kind: 'atk',  cd: 11, desc: 'Oldingi dushmanga intiladi (26 jon)' },
  { id: 'mine',    ico: '💣', name: 'Mina',       kind: 'atk',  cd: 9,  desc: 'Orqangizga mina qo\'yadi, ustiga chiqqan portlaydi (30 jon)' },
  { id: 'shield',  ico: '🛡️', name: 'Qalqon',     kind: 'def',  cd: 18, desc: '4.5 soniya hech qanday zarar o\'tmaydi' },
  { id: 'repair',  ico: '🔧', name: 'Ta\'mir',    kind: 'def',  cd: 22, desc: '4 soniyada 30 jon tiklaydi' },
  { id: 'turbo',   ico: '🔥', name: 'Turbo',      kind: 'util', cd: 10, desc: '2.4 soniya kuchli tezlanish' },
  { id: 'oil',     ico: '🛢️', name: 'Yog\'',      kind: 'atk',  cd: 11, desc: 'Yo\'lga moy to\'kadi — ustiga chiqqan sirpanib aylanadi' },
  { id: 'emp',     ico: '🌀', name: 'EMP',        kind: 'atk',  cd: 18, desc: 'Atrofdagi dushmanlar dvigateli 2 soniya o\'chadi (9 jon)' },
  { id: 'bomb',    ico: '🧨', name: 'Bomba',      kind: 'atk',  cd: 12, desc: 'Oldinga uloqtiriladi, tushgan joyda portlaydi (28 jon)' },
  { id: 'laser',   ico: '🎯', name: 'Lazer',      kind: 'atk',  cd: 9,  desc: 'Bir zumda tegadigan nur, 80 m (20 jon)' },
  { id: 'armor',   ico: '🪖', name: 'Zirh',       kind: 'def',  cd: 20, desc: '10 soniya hamma zarar 2 baravar kam' },
  { id: 'magnet',  ico: '🧲', name: 'Magnit',     kind: 'util', cd: 15, desc: 'Atrofdagi dushmanlarni o\'zingizga tortadi' },
];

export const AB = Object.fromEntries(ABILITIES.map((a, i) => [a.id, i]));

export const LOADOUT_SIZE = 3;
export const DEFAULT_LOADOUT = [AB.gun, AB.missile, AB.shield];

/** keyboard code (top row / numpad 1-3) -> loadout slot 0..2, or -1 */
export function slotByCode(code) {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m && +m[1] <= LOADOUT_SIZE ? +m[1] - 1 : -1;
}

/** clean a loadout: unique valid ability indices, topped up from `fill` / random to LOADOUT_SIZE */
export function fixLoadout(list, random = false) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) if (Number.isInteger(v) && v >= 0 && v < ABILITIES.length && !out.includes(v)) out.push(v);
  out.length = Math.min(out.length, LOADOUT_SIZE);
  const pool = random ? ABILITIES.map((_, i) => i).sort(() => Math.random() - 0.5) : DEFAULT_LOADOUT.concat(ABILITIES.map((_, i) => i));
  for (const v of pool) { if (out.length >= LOADOUT_SIZE) break; if (!out.includes(v)) out.push(v); }
  return out;
}
