// Seed'li tasodifiy sonlar: hamma o'yinchida xarita aynan bir xil quriladi.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash32(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    let x = (n | 0) >>> 0;
    for (let i = 0; i < 4; i++) { h ^= x & 255; h = Math.imul(h, 16777619) >>> 0; x >>>= 8; }
  }
  return h >>> 0;
}
export class Rng {
  constructor(seed) { this.f = mulberry32(seed >>> 0); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }       // [a..b]
  chance(p) { return this.f() < p; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
}
