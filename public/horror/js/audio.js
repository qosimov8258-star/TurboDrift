// Ovoz tizimi: WebAudio sintezi (baqiriq, g'ichirlash, yurak urishi...), fazoviy ovoz,
// musiqa: start (menyu), room1-3 (har bir xonaga), all* (hamma xonalarga har 20 soniyada aralashtiriladi), ruh ovozi (TTS).
import { Rng, hash32 } from './rng.js';
import { envelopeFrom } from './cine.js';

const FILES = '/horror-files/music/';
export const ROOM_TRACKS = ['room1.mp3', 'room2.mp3', 'room3.mp3'];
export const ALL_SOUNDS = ['all.m4a', 'all1.m4a', 'all2.mp3', 'all4.m4a', 'all5.mp3'];
export const ALL_PERIOD = 20000;

export class HAudio {
  constructor() {
    this.ctx = null; this.ready = false; this.muted = false;
    this.menu = null; this.menuWanted = false;
    this.roomPool = []; this.roomAssign = []; this.allBuffers = []; this.allLoaded = false;
    this.lastSlot = -1; this.slotFired = new Set();
    this.tts = { voice: null, ok: typeof speechSynthesis !== 'undefined' };
    this.heart = { next: 0, rate: 0, vol: 0 };
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.noiseBuf = null;
    this.active = new Set();
    this._amb = null;
  }

  // brauzer talabi: foydalanuvchi bosgandan keyin ishga tushadi
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 1; this.music.connect(this.master);
    this.reverb = this._makeReverb(); this.reverb.connect(this.master);
    // oq shovqin buferi
    const len = ctx.sampleRate * 2; this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ready = true;
    this._loadScreams();
    this._loadBat();
    this._loadBlood();
    if (this.tts.ok) { const pick = () => { const vs = speechSynthesis.getVoices(); if (!vs.length) return; for (const p of ['uz', 'tr', 'az', 'kk', 'ru', 'en']) { const v = vs.find(v => v.lang.toLowerCase().startsWith(p)); if (v) { this.tts.voice = v; this.tts.lang = p; return; } } }; pick(); speechSynthesis.onvoiceschanged = pick; }
    if (this.menuWanted) this.startMenu();
  }
  async _loadScreams() {
    this.screams = [];
    try {
      const list = await (await fetch('/horror-list')).json();
      for (const f of list) { try { const r = await fetch(FILES + 'uchratsa/' + encodeURIComponent(f)); this.screams.push(await this.ctx.decodeAudioData(await r.arrayBuffer())); } catch (e) { /* bu fayl ochilmadi */ } }
    } catch (e) { /* ro'yxat yo'q — sintez ishlatiladi */ }
  }
  drip(vol = 0.5) {           // qon tomchisi: qisqa "plop" + ho'l shapillash
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, f = 900 + Math.random() * 500, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.3, t + 0.07);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(this.sfx); g.connect(this.reverb); o.start(t); o.stop(t + 0.14);
    const n = this._noise(0.08, t), bp = ctx.createBiquadFilter(), ng = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.2;
    ng.gain.setValueAtTime(0.05 * vol, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07); n.connect(bp); bp.connect(ng); ng.connect(this.sfx);
  }
  zap() {                     // lampa portlashi: elektr chirsillashi + qisqa "pop"
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, n = this._noise(0.4, t), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 2500; g.gain.setValueAtTime(0.5, t); g.gain.setValueAtTime(0.0001, t + 0.03); g.gain.setValueAtTime(0.35, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    n.connect(hp); hp.connect(g); g.connect(this.sfx); g.connect(this.reverb);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(og); og.connect(this.sfx); o.start(t); o.stop(t + 0.35);
  }
  casing(vol = 0.5) {         // gilza yerga tushib jiringlaydi
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let k = 0; k < 3; k++) { const o = ctx.createOscillator(), g = ctx.createGain(), f = 3200 + Math.random() * 1400; o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + k * 0.09); g.gain.exponentialRampToValueAtTime(0.1 * vol / (k + 1), t + k * 0.09 + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.09 + 0.12); o.connect(g); g.connect(this.sfx); g.connect(this.reverb); o.start(t + k * 0.09); o.stop(t + k * 0.09 + 0.15); }
  }
  gasp(pitch = 1, vol = 0.6) { // cho'chib nafas olish: filtrlangan shovqin, tez ko'tariladigan
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, n = this._noise(0.5, t), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(900 * pitch, t); bp.frequency.exponentialRampToValueAtTime(2200 * pitch, t + 0.28); bp.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22 * vol, t + 0.16); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    n.connect(bp); bp.connect(g); g.connect(this.sfx);
  }
  async _loadBlood() {        // kadr (badroom) musiqasi
    try { const r = await fetch(FILES + 'blood.mp3'); this.blood = await this.ctx.decodeAudioData(await r.arrayBuffer()); this.bloodEnv = envelopeFrom(this.blood); } catch (e) { /* fayl yo'q — musiqasiz */ }
  }
  // kadr musiqasi: xona musiqalari va fon pasayadi. Qaytaradi { startAt, env } yoki null
  playCine() {
    if (!this.ready) return null;
    const ctx = this.ctx, t = ctx.currentTime;
    this.music.gain.cancelScheduledValues(t); this.music.gain.setTargetAtTime(0, t, 0.15);
    if (this._amb) this._amb.g.gain.setTargetAtTime(0.06, t, 0.2);
    const h = { startAt: t + 0.05, env: this.bloodEnv || null, src: null, g: null };
    if (this.blood) {
      const src = ctx.createBufferSource(); src.buffer = this.blood;
      const g = ctx.createGain(); g.gain.value = 1.0; src.connect(g); g.connect(this.master);
      const rv = ctx.createGain(); rv.gain.value = 0.18; g.connect(rv); rv.connect(this.reverb);
      src.start(h.startAt); h.src = src; h.g = g;
    }
    return h;
  }
  stopCine(h) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (h && h.g) { try { h.g.gain.setTargetAtTime(0, t, 0.08); h.src.stop(t + 0.4); } catch (e) {} }
    this.music.gain.cancelScheduledValues(t); this.music.gain.setTargetAtTime(1, t, 0.6);
    if (this._amb) this._amb.g.gain.setTargetAtTime(0.5, t, 0.8);
  }
  async _loadBat() {          // shkaf ochilganda ko'rshapalaklar ovozi: barcha baqiriqlar ichida eng baland va qisqasi (2 s)
    try { const r = await fetch(FILES + 'bat.mp3'); this.bat = await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { /* fayl yo'q — sintez */ }
  }
  bats(x = null, z = null) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (this.bat) {
      const o = this._out(x, z, { reverb: 0.5, ref: 7, roll: 0.8 }), src = ctx.createBufferSource(); src.buffer = this.bat;
      const g = ctx.createGain(); g.gain.value = 2.2; src.connect(g); g.connect(o.node); src.start(t); this._track(src, src.buffer.duration);
    } else this.scream({ x, z, pitch: 1.3, vol: 1.3 });
    // qanotlar shovqini
    const o2 = this._out(x, z, { reverb: 0.3, ref: 4 });
    for (let i = 0; i < 9; i++) {
      const n = this._noise(0.1, t + i * 0.07), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 900; bp.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + i * 0.07); g.gain.exponentialRampToValueAtTime(0.5, t + i * 0.07 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.11);
      n.connect(bp); bp.connect(g); g.connect(o2.node);
    }
  }
  bite(x = null, z = null) {          // tishlash: jag' chaqnashi + past zarba + nam shovqin
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 0.3, ref: 4 });
    const g = ctx.createGain(); g.gain.setValueAtTime(1.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); g.connect(o.node);
    const n = this._noise(0.5, t), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.5); n.connect(lp); lp.connect(g);
    for (const d of [0, 0.12, 0.26]) { const k = ctx.createOscillator(); k.type = 'square'; k.frequency.setValueAtTime(220, t + d); k.frequency.exponentialRampToValueAtTime(45, t + d + 0.1); const kg = ctx.createGain(); kg.gain.setValueAtTime(0.0001, t + d); kg.gain.exponentialRampToValueAtTime(0.6, t + d + 0.01); kg.gain.exponentialRampToValueAtTime(0.001, t + d + 0.15); k.connect(kg); kg.connect(g); k.start(t + d); k.stop(t + d + 0.2); }
  }
  hiss(x = null, z = null, vol = 1) {       // ilon xirillashi
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 0.4, ref: 4 });
    const n = this._noise(1.1, t), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6500; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * vol, t + 0.12); g.gain.setValueAtTime(0.9 * vol, t + 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(o.node);
  }
  scrape(x = null, z = null) {              // sudralish: yerga ishqalanish
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { ref: 3 });
    const n = this._noise(0.4, t), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 350 + Math.random() * 250; bp.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    n.connect(bp); bp.connect(g); g.connect(o.node);
  }
  swing(x = null, z = null) {         // bolg'a shiviri
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { ref: 3 });
    const n = this._noise(0.3, t), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28); n.connect(bp); bp.connect(g); g.connect(o.node);
  }
  shot(x = null, z = null) {          // to'pponcha o'qi
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 0.6, ref: 8, roll: 0.9 });
    const g = ctx.createGain(); g.gain.setValueAtTime(1.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5); g.connect(o.node);
    const n = this._noise(0.4, t), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500; n.connect(hp); hp.connect(g);
    const k = ctx.createOscillator(); k.type = 'sine'; k.frequency.setValueAtTime(180, t); k.frequency.exponentialRampToValueAtTime(40, t + 0.15); const kg = ctx.createGain(); kg.gain.value = 1.2; k.connect(kg); kg.connect(g); k.start(t); k.stop(t + 0.3);
  }
  _makeReverb() {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * 2.2), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const conv = ctx.createConvolver(); conv.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.35; conv.connect(g); g.connect(this.master);
    return conv;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.9; if (this.menu) this.menu.muted = m; for (const s of this.roomPool) s.el.muted = m; if (m && this.tts.ok) speechSynthesis.cancel(); }

  // ---------- menyu musiqasi
  startMenu(vol = 0.6) {
    this.menuWanted = true; this.menuVol = vol;
    if (!this.menu) { this.menu = new Audio(FILES + 'start.mp3'); this.menu.loop = true; this.menu.preload = 'auto'; }
    this.menu.muted = this.muted; this.menu.volume = vol;
    const p = this.menu.play(); if (p && p.catch) p.catch(() => {});
  }
  stopMenu(fade = 1200) {
    this.menuWanted = false;
    const m = this.menu; if (!m) return;
    const t0 = performance.now(), v0 = m.volume;
    const step = () => { const k = Math.min(1, (performance.now() - t0) / fade); m.volume = v0 * (1 - k); if (k < 1) requestAnimationFrame(step); else { m.pause(); m.volume = this.menuVol || 0.6; } };
    step();
  }

  // ---------- fazoviy ovoz
  setListener(x, z, yaw) {
    this.listener.x = x; this.listener.z = z; this.listener.yaw = yaw;
    if (!this.ctx) return;
    const L = this.ctx.listener, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX) { L.positionX.value = x; L.positionY.value = 1.6; L.positionZ.value = z; L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(x, 1.6, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
  }
  _out(x, z, opts = {}) {      // x,z berilsa fazoviy; aks holda to'g'ridan-to'g'ri
    const ctx = this.ctx;
    if (x == null) return { node: this.sfx, rev: null, done() {} };
    const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = opts.ref || 2.5; p.maxDistance = 80; p.rolloffFactor = opts.roll || 1.5;
    p.positionX ? (p.positionX.value = x, p.positionY.value = opts.y ?? 1.5, p.positionZ.value = z) : p.setPosition(x, opts.y ?? 1.5, z);
    p.connect(this.sfx);
    if (opts.reverb) { const s = ctx.createGain(); s.gain.value = opts.reverb; p.connect(s); s.connect(this.reverb); }
    return { node: p };
  }
  _noise(dur, t) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(t, Math.random()); s.stop(t + dur); return s; }
  _track(node, dur) { this.active.add(node); setTimeout(() => this.active.delete(node), dur * 1000 + 500); }
  _dist(x, z) { return Math.hypot(x - this.listener.x, z - this.listener.z); }

  // ---------- baqiriq
  scream({ x = null, z = null, pitch = 1, vol = 1, dur = 1.9, loud = true } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 0.5, ref: 6, roll: 1.0 });
    if (this.screams && this.screams.length) {          // tayyor baqiriq fayllari (horror/music/uchratsa)
      const src = ctx.createBufferSource(); src.buffer = this.screams[Math.floor(Math.random() * this.screams.length)];
      src.playbackRate.value = Math.max(0.8, Math.min(1.25, 0.8 + pitch * 0.3));
      const sg = ctx.createGain(); sg.gain.value = Math.min(2.2, 1.7 * vol);
      src.connect(sg); sg.connect(o.node); src.start(t); this._track(src, src.buffer.duration);
      return;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * (loud ? 1.0 : 0.6), t + 0.04);
    g.gain.setValueAtTime(vol * (loud ? 1.0 : 0.6), t + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const dist = ctx.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x2 = i / 512 - 1; curve[i] = Math.tanh(x2 * 4.2); } dist.curve = curve; dist.oversample = '2x';
    const am = ctx.createGain(); am.gain.value = 0.8;
    const amLfo = ctx.createOscillator(); amLfo.frequency.value = 64 + Math.random() * 20; const amDepth = ctx.createGain(); amDepth.gain.value = 0.35; amLfo.connect(amDepth); amDepth.connect(am.gain); amLfo.start(t); amLfo.stop(t + dur);
    const f0 = 560 * pitch;
    const vib = ctx.createOscillator(); vib.frequency.value = 6.2; const vibG = ctx.createGain(); vibG.gain.value = 38 * pitch; vib.connect(vibG); vib.start(t); vib.stop(t + dur);
    const mk = (type, mult, detune) => {
      const os = ctx.createOscillator(); os.type = type; os.detune.value = detune;
      os.frequency.setValueAtTime(f0 * 0.85 * mult, t); os.frequency.exponentialRampToValueAtTime(f0 * 1.95 * mult, t + 0.14);
      os.frequency.linearRampToValueAtTime(f0 * 1.7 * mult, t + dur * 0.6); os.frequency.exponentialRampToValueAtTime(f0 * 1.0 * mult, t + dur);
      vibG.connect(os.frequency); os.start(t); os.stop(t + dur + 0.05); return os;
    };
    const src = ctx.createGain(); src.gain.value = 0.5;
    mk('sawtooth', 1, 0).connect(src); mk('sawtooth', 1.003, 14).connect(src); mk('square', 0.5, -8).connect(src);
    // formantlar: "aaa" unlisi
    const mixF = ctx.createGain(); mixF.gain.value = 1.4;
    for (const [fr, q, gn] of [[850, 7, 1], [1500, 9, 0.8], [2900, 10, 0.55], [3800, 8, 0.3]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
      bp.frequency.setValueAtTime(fr * 0.8, t); bp.frequency.linearRampToValueAtTime(fr * 1.15, t + 0.2); bp.frequency.linearRampToValueAtTime(fr, t + dur);
      const gg = ctx.createGain(); gg.gain.value = gn; src.connect(bp); bp.connect(gg); gg.connect(mixF);
    }
    // nafas/shovqin
    const n = this._noise(dur, t), nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 3200; nb.Q.value = 0.7; const ng = ctx.createGain(); ng.gain.value = 0.55; n.connect(nb); nb.connect(ng); ng.connect(mixF);
    mixF.connect(am); am.connect(dist); dist.connect(g); g.connect(o.node);
    this._track(g, dur);
  }

  stinger(vol = 1) {          // to'satdan "dum!" zarbi
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4); g.connect(this.sfx);
    for (const f of [110, 116.5, 164.8, 233, 311]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.5); const og = ctx.createGain(); og.gain.value = 0.16; o.connect(og); og.connect(g); o.start(t); o.stop(t + 1.5); }
    const n = this._noise(0.5, t), nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.setValueAtTime(5000, t); nf.frequency.exponentialRampToValueAtTime(200, t + 0.5); const ng = ctx.createGain(); ng.gain.setValueAtTime(0.9, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5); n.connect(nf); nf.connect(ng); ng.connect(g);
    const k = ctx.createOscillator(); k.frequency.setValueAtTime(140, t); k.frequency.exponentialRampToValueAtTime(30, t + 0.4); const kg = ctx.createGain(); kg.gain.setValueAtTime(1, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.45); k.connect(kg); kg.connect(g); k.start(t); k.stop(t + 0.5);
  }
  creak(x, z, vol = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 0.3 }), dur = 0.7 + Math.random() * 0.6;
    const os = ctx.createOscillator(); os.type = 'sawtooth'; const f = 70 + Math.random() * 60; os.frequency.setValueAtTime(f, t); os.frequency.linearRampToValueAtTime(f * (1.5 + Math.random()), t + dur * 0.5); os.frequency.linearRampToValueAtTime(f * 0.9, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 22 + Math.random() * 20; const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg);
    const am = ctx.createGain(); am.gain.value = 0.5; lg.connect(am.gain);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    os.connect(am); am.connect(bp); bp.connect(g); g.connect(o.node); os.start(t); lfo.start(t); os.stop(t + dur); lfo.stop(t + dur);
  }
  slam(x, z, vol = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 0.7, ref: 4 });
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); g.connect(o.node);
    const n = this._noise(0.4, t), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.35); n.connect(lp); lp.connect(g);
    const k = ctx.createOscillator(); k.frequency.setValueAtTime(110, t); k.frequency.exponentialRampToValueAtTime(35, t + 0.3); const kg = ctx.createGain(); kg.gain.setValueAtTime(1.2, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.5); k.connect(kg); kg.connect(g); k.start(t); k.stop(t + 0.6);
  }
  thud(x, z, vol = 0.6, hard = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 0.3, ref: 2 });
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); g.connect(o.node);
    const n = this._noise(0.15, t), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400 * hard + 200; n.connect(bp); bp.connect(g);
    const k = ctx.createOscillator(); k.frequency.setValueAtTime(160, t); k.frequency.exponentialRampToValueAtTime(60, t + 0.12); const kg = ctx.createGain(); kg.gain.value = 0.7; k.connect(kg); kg.connect(g); k.start(t); k.stop(t + 0.2);
  }
  glass(x, z, vol = 0.6) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 0.5 });
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7); g.connect(o.node);
    const n = this._noise(0.5, t), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500; n.connect(hp); hp.connect(g);
    for (let i = 0; i < 6; i++) { const os = ctx.createOscillator(); os.frequency.value = 2500 + Math.random() * 3500; const og = ctx.createGain(); og.gain.setValueAtTime(0.15, t + i * 0.04); og.gain.exponentialRampToValueAtTime(0.001, t + i * 0.04 + 0.25); os.connect(og); og.connect(g); os.start(t + i * 0.04); os.stop(t + i * 0.04 + 0.3); }
  }
  step(x, z, vol = 0.25, run = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { ref: 1.5, roll: 2 });
    const g = ctx.createGain(); g.gain.setValueAtTime(vol * (run ? 1.5 : 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); g.connect(o.node);
    const n = this._noise(0.1, t), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + Math.random() * 400; n.connect(lp); lp.connect(g);
  }
  bell(x, z, vol = 0.4) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, o = this._out(x, z, { reverb: 1.2, ref: 6 }), f = [196, 233, 262][Math.floor(Math.random() * 3)];
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 5); g.connect(o.node);
    for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.3], [8.9, 0.15]]) { const os = ctx.createOscillator(); os.frequency.value = f * m; const og = ctx.createGain(); og.gain.value = a * 0.3; os.connect(og); og.connect(g); os.start(t); os.stop(t + 5); }
  }
  whisperNoise(x, z, vol = 0.5) {         // pichirlash: filtrlangan shovqin modulyatsiyasi
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.6, o = this._out(x, z, { reverb: 0.8, ref: 2 });
    const n = this._noise(dur, t), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(1800, t);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5; const lg = ctx.createGain(); lg.gain.value = 900; lfo.connect(lg); lg.connect(bp.frequency); lfo.start(t); lfo.stop(t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(o.node);
  }
  growl(x, z, vol = 0.7) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.8, o = this._out(x, z, { reverb: 0.6, ref: 3 });
    const os = ctx.createOscillator(); os.type = 'sawtooth'; os.frequency.setValueAtTime(70, t); os.frequency.linearRampToValueAtTime(48, t + dur);
    const am = ctx.createOscillator(); am.frequency.value = 28; const ag = ctx.createGain(); ag.gain.value = 0.5; const base = ctx.createGain(); base.gain.value = 0.5; am.connect(ag); ag.connect(base.gain);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    os.connect(base); base.connect(lp); lp.connect(g); g.connect(o.node); os.start(t); am.start(t); os.stop(t + dur); am.stop(t + dur);
  }
  chime(kind = 'key') {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain(); g.gain.value = 0.28; g.connect(this.sfx); g.connect(this.reverb);
    const notes = kind === 'key' ? [659, 880, 1318] : kind === 'win' ? [523, 659, 784, 1046] : [392, 311];
    notes.forEach((f, i) => { const os = ctx.createOscillator(); os.type = 'triangle'; os.frequency.value = f; const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t + i * 0.11); og.gain.exponentialRampToValueAtTime(0.8, t + i * 0.11 + 0.02); og.gain.exponentialRampToValueAtTime(0.001, t + i * 0.11 + 0.9); os.connect(og); og.connect(g); os.start(t + i * 0.11); os.stop(t + i * 0.11 + 1); });
  }
  clank(x, z) { this.slam(x, z, 0.8); this.bell(x, z, 0.25); }
  uiClick() { if (!this.ready) return; const ctx = this.ctx, t = ctx.currentTime, os = ctx.createOscillator(), g = ctx.createGain(); os.frequency.value = 220; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); os.connect(g); g.connect(this.sfx); os.start(t); os.stop(t + 0.1); }

  // yurak urishi: fear 0..1
  heartbeat(fear, dt) {
    if (!this.ready) return;
    this.heart.vol = fear;
    if (fear < 0.18) return;
    const now = this.ctx.currentTime;
    if (now < this.heart.next) return;
    const bpm = 60 + fear * 110, gap = 60 / bpm;
    this.heart.next = now + gap;
    const v = Math.min(1, fear * 1.2) * 0.9;
    for (const [d, a] of [[0, 1], [0.18, 0.7]]) {
      const os = this.ctx.createOscillator(); os.frequency.setValueAtTime(75, now + d); os.frequency.exponentialRampToValueAtTime(38, now + d + 0.14);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(v * a, now + d); g.gain.exponentialRampToValueAtTime(0.001, now + d + 0.2);
      os.connect(g); g.connect(this.sfx); os.start(now + d); os.stop(now + d + 0.25);
    }
  }
  // doimiy qo'rqinchli fon (past gumburlash + shamol)
  startAmbience(level = 0) {
    if (!this.ready || this._amb) return;
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0.0001; g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 4); g.connect(this.sfx);
    const mk = (f, type) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const og = ctx.createGain(); og.gain.value = 0.12; o.connect(og); og.connect(g); o.start(); return o; };
    const o1 = mk(41 + level, 'sine'), o2 = mk(43.3 + level, 'sine'), o3 = mk(82.4, 'triangle');
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 3; lfo.connect(lg); lg.connect(o2.frequency); lfo.start();
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 1.2; const wg = ctx.createGain(); wg.gain.value = 0.05;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.11; const wlg = ctx.createGain(); wlg.gain.value = 0.04; wl.connect(wlg); wlg.connect(wg.gain); wl.start();
    ns.connect(bp); bp.connect(wg); wg.connect(g); ns.start();
    this._amb = { g, nodes: [o1, o2, o3, lfo, ns, wl] };
  }
  stopAmbience() { const a = this._amb; if (!a) return; this._amb = null; try { a.g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 1); } catch (e) {} setTimeout(() => a.nodes.forEach(n => { try { n.stop(); } catch (e) {} }), 1200); }

  // ---------- ruhning ovozi (TTS) — masofaga qarab balandligi
  speak(text, { dist = 0, vol = 1, pitch = 0.25, rate = 0.62 } = {}) {
    if (!this.tts.ok || this.muted) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (this.tts.voice) { u.voice = this.tts.voice; u.lang = this.tts.voice.lang; }
      u.pitch = pitch; u.rate = rate; u.volume = Math.max(0.15, Math.min(1, vol * (1.1 - dist / 40)));
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* ovoz bo'lmasa — ahamiyatsiz */ }
  }

  // ---------- xona musiqalari
  setupRooms(rooms, seed) {
    if (!this.ready) return;
    this.rooms = rooms.map(r => ({ id: r.id, x: r.cx, z: r.cz }));
    // xonalarga tasodifiy-lekin muvozanatli ro'yxat: har bir track bir xil sonda
    const rng = new Rng(hash32(seed, 4242)); const order = rng.shuffle(this.rooms.map(r => r.id));
    this.roomAssign = new Array(rooms.length); order.forEach((id, i) => { this.roomAssign[id] = ROOM_TRACKS[i % ROOM_TRACKS.length]; });
    this.roomSeed = seed;
    if (!this.roomPool.length) {
      for (let i = 0; i < 4; i++) {
        const el = new Audio(); el.loop = true; el.preload = 'none'; el.crossOrigin = 'anonymous'; el.volume = 1;
        let panner = null, filter = null, gain = null;
        try {
          const src = this.ctx.createMediaElementSource(el);
          filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 14000;
          gain = this.ctx.createGain(); gain.gain.value = 0;
          panner = this.ctx.createPanner(); panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse'; panner.refDistance = 5; panner.rolloffFactor = 1.2; panner.maxDistance = 80;
          src.connect(filter); filter.connect(gain); gain.connect(panner); panner.connect(this.music);
        } catch (e) { /* element allaqachon ulangan bo'lishi mumkin */ }
        this.roomPool.push({ el, panner, filter, gain, room: -1, playing: false, vol: 0, track: '' });
      }
    }
    for (const s of this.roomPool) { s.room = -1; s.vol = 0; if (s.gain) s.gain.gain.value = 0; try { s.el.pause(); } catch (e) {} }
    this._loadAll();
  }
  async _loadAll() {
    if (this.allLoaded || this._loadingAll) return; this._loadingAll = true;
    for (const f of ALL_SOUNDS) {
      try { const r = await fetch(FILES + f); const ab = await r.arrayBuffer(); this.allBuffers.push(await this.ctx.decodeAudioData(ab)); } catch (e) { this.allBuffers.push(null); }
    }
    this.allLoaded = true;
  }
  // har kadr: o'yinchi o'rni, devor orqali eshitilishi (occl(x,z)->bool)
  updateRooms(px, pz, nowMs, occl) {
    if (!this.ready || !this.rooms) return;
    // 1) eng yaqin 4 ta xona ovozi
    const near = this.rooms.map(r => ({ r, d: Math.hypot(r.x - px, r.z - pz) })).filter(o => o.d < 36).sort((a, b) => a.d - b.d).slice(0, 4);
    const want = new Set(near.map(n => n.r.id));
    for (const s of this.roomPool) if (s.room >= 0 && !want.has(s.room)) { s.vol = 0; if (s.gain && s.gain.gain.value < 0.01) { try { s.el.pause(); } catch (e) {} s.room = -1; s.playing = false; } }
    for (const n of near) {
      let s = this.roomPool.find(p => p.room === n.r.id);
      if (!s) {
        s = this.roomPool.find(p => p.room < 0); if (!s) continue;
        const track = this.roomAssign[n.r.id]; s.room = n.r.id; s.track = track;
        const h = hash32(this.roomSeed, n.r.id, 9);
        s.el.src = FILES + track; s.el.muted = this.muted;
        const startAt = track === 'room1.mp3' ? (h % 150) : (h % 600);
        s.el.addEventListener('loadedmetadata', () => { try { s.el.currentTime = startAt; } catch (e) {} }, { once: true });
        const p = s.el.play(); if (p && p.catch) p.catch(() => {});
        s.playing = true;
        if (s.panner) s.panner.positionX ? (s.panner.positionX.value = n.r.x, s.panner.positionY.value = 1.8, s.panner.positionZ.value = n.r.z) : s.panner.setPosition(n.r.x, 1.8, n.r.z);
      }
      const base = n.d < 4 ? 1 : Math.max(0, 1 - (n.d - 4) / 32);
      s.vol = 0.5 * base * base;
      const blocked = occl && occl(n.r.x, n.r.z);
      if (s.filter) s.filter.frequency.value = blocked ? 520 : 14000;
      if (blocked) s.vol *= 0.7;
    }
    for (const s of this.roomPool) if (s.gain) s.gain.gain.value += (s.vol - s.gain.gain.value) * 0.08;
    // 2) "all" tovushlari: har 20 soniyada aralashtirib, hamma xonalarga
    const slot = Math.floor(nowMs / ALL_PERIOD);
    if (slot !== this.lastSlot) { this.lastSlot = slot; this.slotFired = new Set(); this.slotStart = slot * ALL_PERIOD; const rng = new Rng(hash32(this.roomSeed, slot, 31)); const n = ALL_SOUNDS.length; const base = []; for (let i = 0; i < this.rooms.length; i++) base.push(i % n); this.slotAssign = rng.shuffle(base); }
    if (this.allLoaded) {
      for (const r of this.rooms) {
        if (this.slotFired.has(r.id)) continue;
        const d = Math.hypot(r.x - px, r.z - pz); if (d > 42) continue;
        const delay = hash32(this.roomSeed, this.lastSlot, r.id) % 9000;
        const since = nowMs - this.slotStart;
        if (since < delay) continue;
        this.slotFired.add(r.id);
        if (since > delay + 1500) continue;               // kech qoldik — o'tkazib yuboramiz
        const buf = this.allBuffers[this.slotAssign[r.id]]; if (!buf) continue;
        const src = this.ctx.createBufferSource(); src.buffer = buf;
        const o = this._out(r.x, r.z, { reverb: 0.5, ref: 5, roll: 1.1 });
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = occl && occl(r.x, r.z) ? 700 : 12000;
        const g = this.ctx.createGain(); g.gain.value = 0.9;
        src.connect(lp); lp.connect(g); g.connect(o.node); src.start();
        this._track(src, buf.duration);
      }
    }
  }
  stopRooms() {
    for (const s of this.roomPool) { s.room = -1; s.vol = 0; if (s.gain) s.gain.gain.value = 0; try { s.el.pause(); } catch (e) {} }
    this.rooms = null; this.lastSlot = -1;
  }
}
