// All sounds are synthesised with WebAudio - no audio files needed.
// moments (s) of the pops / "taq-taq" hits inside ong-chap.m4a, used to sync exhaust flames
const POP_START = 1.3, POP_END = 6.0;   // the taq-taq section of ong-chap.m4a (first pop at 1.43 s)
export const BURN_POPS = [1.43, 1.58, 1.71, 1.9, 2.0, 2.11, 2.45, 2.54, 2.64, 2.9, 3.18, 3.29, 3.4, 3.49, 3.6, 3.82, 3.97, 4.09, 4.22, 4.3, 4.44, 4.65, 5.0, 5.13, 5.23, 5.34, 5.51, 5.76, 5.9];

export class EngineVoice {
  constructor(ctx, out, withPan = false) {
    this.ctx = ctx;
    const c = ctx;
    // engine-like harmonic stack (strong low harmonics, gently falling)
    const N = 14, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) im[n] = (1 / Math.pow(n, 0.85)) * (n % 2 === 0 ? 1.15 : 1);
    const wave = c.createPeriodicWave(re, im);
    this.o1 = c.createOscillator(); this.o1.setPeriodicWave(wave);          // firing frequency
    this.o2 = c.createOscillator(); this.o2.setPeriodicWave(wave);          // slightly detuned layer
    this.o3 = c.createOscillator(); this.o3.type = 'sine';                  // body (sub)
    this.g1 = c.createGain(); this.g2 = c.createGain(); this.g3 = c.createGain();
    this.g1.gain.value = 0.6; this.g2.gain.value = 0.35; this.g3.gain.value = 0.5;
    const mix = c.createGain();
    this.shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 1.8); }
    this.shaper.curve = curve;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 0.9;
    this.pk = c.createBiquadFilter(); this.pk.type = 'peaking'; this.pk.frequency.value = 180; this.pk.gain.value = 5; this.pk.Q.value = 0.8;
    this.vol = c.createGain(); this.vol.gain.value = 0;
    this.o1.connect(this.g1).connect(mix); this.o2.connect(this.g2).connect(mix); this.o3.connect(this.g3).connect(mix);
    mix.connect(this.shaper).connect(this.lp).connect(this.pk).connect(this.vol);
    if (withPan) { this.pan = c.createStereoPanner(); this.vol.connect(this.pan).connect(out); } else this.vol.connect(out);
    [this.o1, this.o2, this.o3].forEach(o => o.start());
    this.f = 40;
  }

  set(rpm, thr, volume, pan = 0) {
    const t = this.ctx.currentTime;
    const r = Math.min(Math.max(rpm, 0.1), 1.1);
    // 0.18 (idle) .. 1.0 (redline) -> 42 .. 330 Hz firing frequency, exponential so each step sounds even
    const k = Math.min(1, Math.max(0, (r - 0.18) / 0.82));
    const f = 42 * Math.pow(330 / 42, k) * (r > 1 ? 1 + (r - 1) * 0.6 : 1);
    this.o1.frequency.setTargetAtTime(f, t, 0.045);
    this.o2.frequency.setTargetAtTime(f * 1.006, t, 0.045);
    this.o3.frequency.setTargetAtTime(f * 0.5, t, 0.045);
    this.lp.frequency.setTargetAtTime(500 + k * 2600 + thr * 2200, t, 0.06);
    this.vol.gain.setTargetAtTime(volume * (0.4 + 0.6 * thr) * (0.55 + 0.45 * k), t, 0.05);
    if (this.pan) this.pan.pan.setTargetAtTime(pan, t, 0.05);
  }

  stop() { try { [this.o1, this.o2, this.o3].forEach(o => o.stop()); this.vol.disconnect(); } catch (e) { /* noop */ } }
}

export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; this.voices = new Map(); }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp).connect(c.destination);
    // shared noise
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const loopNoise = () => { const n = c.createBufferSource(); n.buffer = buf; n.loop = true; n.start(); return n; };

    this.engine = new EngineVoice(c, this.master);
    // burnout (gas + brake on the spot) sample, looped while it lasts
    this.burnG = c.createGain(); this.burnG.gain.value = 0; this.burnG.connect(this.master);
    this.nitSG = c.createGain(); this.nitSG.gain.value = 0; this.nitSG.connect(this.master);   // same pops clip, looped while nitro is held
    fetch('/saund/supra_mk4/ong-chap.m4a').then(r => r.arrayBuffer()).then(b => c.decodeAudioData(b)).then(b => {
      this.burnBuf = b;
    }).catch(() => { this.burnFail = true; });
    // Supra MK4 engine loop (pitch follows rpm)
    this.roadG = c.createGain(); this.roadG.gain.value = 0;
    // squash the loud rev bursts in the recording so it stays an even engine hum
    const rc = c.createDynamicsCompressor(); rc.threshold.value = -30; rc.ratio.value = 12; rc.attack.value = 0.003; rc.release.value = 0.15;
    this.roadG.connect(rc).connect(this.master);
    fetch('/saund/supra_mk4/road.mp3').then(r => r.arrayBuffer()).then(b => c.decodeAudioData(b)).then(b => { this.roadBuf = b; }).catch(() => { /* fall back to synth */ });
    // idle loop (stop.m4a): first 5 s as a seamless, cross-faded loop, plays while the car stands still
    this.stopG = c.createGain(); this.stopG.gain.value = 0; this.stopG.connect(this.master); this.idleLevel = 0;
    fetch('/saund/supra_mk4/stop.m4a').then(r => r.arrayBuffer()).then(b => c.decodeAudioData(b)).then(b => {
      const N = Math.floor(5 * b.sampleRate), X = Math.floor(0.8 * b.sampleRate);
      if (b.length < N + X) return;
      const loop = c.createBuffer(b.numberOfChannels, N, b.sampleRate);
      for (let ch = 0; ch < b.numberOfChannels; ch++) {
        const src = b.getChannelData(ch), dst = loop.getChannelData(ch);
        dst.set(src.subarray(0, N));
        for (let i = 0; i < X; i++) { const w = i / X, a = Math.sin(w * Math.PI / 2), z = Math.cos(w * Math.PI / 2); dst[i] = src[i] * a + src[N + i] * z; }
      }
      const n = c.createBufferSource(); n.buffer = loop; n.loop = true; n.connect(this.stopG); n.start(); this.stopBuf = loop;
    }).catch(() => { /* no idle clip */ });
    // gear-shift sample
    fetch('/saund/supra_mk4/skorst.mp3').then(r => r.arrayBuffer()).then(b => c.decodeAudioData(b)).then(b => { this.shiftBuf = b; }).catch(() => { /* fall back to synth */ });
    // tyre squeal
    this.sqN = loopNoise(); this.sqF = c.createBiquadFilter(); this.sqF.type = 'bandpass'; this.sqF.frequency.value = 1500; this.sqF.Q.value = 7;
    this.sqG = c.createGain(); this.sqG.gain.value = 0; this.sqN.connect(this.sqF).connect(this.sqG).connect(this.master);
    // wind
    this.wN = loopNoise(); this.wF = c.createBiquadFilter(); this.wF.type = 'lowpass'; this.wF.frequency.value = 400;
    this.wG = c.createGain(); this.wG.gain.value = 0; this.wN.connect(this.wF).connect(this.wG).connect(this.master);
    // gravel
    this.gN = loopNoise(); this.gF = c.createBiquadFilter(); this.gF.type = 'bandpass'; this.gF.frequency.value = 700; this.gF.Q.value = 0.8;
    this.gG = c.createGain(); this.gG.gain.value = 0; this.gN.connect(this.gF).connect(this.gG).connect(this.master);
    // nitro roar
    this.nN = loopNoise(); this.nF = c.createBiquadFilter(); this.nF.type = 'bandpass'; this.nF.frequency.value = 1800; this.nF.Q.value = 0.6;
    this.nG = c.createGain(); this.nG.gain.value = 0; this.nN.connect(this.nF).connect(this.nG).connect(this.master);
    // turbo whistle
    this.tO = c.createOscillator(); this.tO.type = 'sine'; this.tO.frequency.value = 2400; this.tG = c.createGain(); this.tG.gain.value = 0;
    this.tO.connect(this.tG).connect(this.master); this.tO.start();
    this.lastThr = 0; this.crackleT = 0;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }

  /** seconds into the burnout clip, or -1 when it is not playing */
  burnPos() { return this.burnWas && this.burnSrc && this.ctx.currentTime < this.burnEnd ? this.ctx.currentTime - this.burnStart + POP_START : -1; }

  /** player's own car */
  updatePlayer(v, dt, carId) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const thr = v.locked ? 0 : v.throttle;
    if (v.shifted) this.shift(carId, v.gear);          // skorst.mp3 plays exactly when the gear really changes (1-2-3-4-5)
    const burning = carId === 'supra_mk4' && !!this.burnBuf && v.burnout && !v.locked;
    if (burning && !this.burnWas) {       // burnout just started: play the first 6 s of the clip once
      const n = this.ctx.createBufferSource(); n.buffer = this.burnBuf; n.connect(this.burnG); n.start(t, POP_START, 6);   // skip the lead-in: begin right where the taq-taq starts
      this.burnSrc = n; this.burnStart = t; this.burnEnd = t + 6;
      this.burnG.gain.cancelScheduledValues(t); this.burnG.gain.setValueAtTime(0, t); this.burnG.gain.linearRampToValueAtTime(1.7, t + 0.25);
      this.burnG.gain.setValueAtTime(1.7, t + 5.6); this.burnG.gain.linearRampToValueAtTime(0, t + 6);
    } else if (!burning && this.burnWas && this.burnSrc) {   // released early: fade out
      this.burnG.gain.cancelScheduledValues(t); this.burnG.gain.setTargetAtTime(0, t, 0.08);
      this.burnSrc.stop(t + 0.5); this.burnSrc = null;
    }
    this.burnWas = burning;
    // nitro: the same taq-taq pops, from where they start, looping while the button is held
    const nit = carId === 'supra_mk4' && !!this.burnBuf && !!v.nitroOn && !burning;
    if (nit && !this.nitSrc) {
      const n = this.ctx.createBufferSource(); n.buffer = this.burnBuf; n.loop = true; n.loopStart = POP_START; n.loopEnd = POP_END; n.connect(this.nitSG);
      n.start(t, POP_START); this.nitSrc = n;
      this.nitSG.gain.cancelScheduledValues(t); this.nitSG.gain.setValueAtTime(0, t); this.nitSG.gain.linearRampToValueAtTime(1.3, t + 0.08);
    } else if (!nit && this.nitSrc) {
      this.nitSG.gain.cancelScheduledValues(t); this.nitSG.gain.setTargetAtTime(0, t, 0.06);
      this.nitSrc.stop(t + 0.4); this.nitSrc = null;
    }
    const burnSample = burning && t < this.burnEnd;
    const engThr = v.locked ? Math.max(v.revHold || 0, 0) : thr;
    const useRoad = carId === 'supra_mk4' && !!this.roadBuf;
    this.engine.set(v.rpm, engThr, burnSample || useRoad ? 0 : 1.25 + (v.nitroOn ? 0.3 : 0));
    // standing still, no pedals: idle loop; cross-faded (equal power) with the engine so the switch is not noticed
    const idle = useRoad && !!this.stopBuf && v.speed < 0.8 && engThr < 0.05 && !burning && !v.nitroOn;
    this.idleLevel += ((idle ? 1 : 0) - this.idleLevel) * (1 - Math.exp(-dt / 0.35));
    this.stopG.gain.setTargetAtTime(Math.sin(this.idleLevel * Math.PI / 2) * 0.5 * (burnSample ? 0 : 1), t, 0.05);
    const roadMix = Math.cos(this.idleLevel * Math.PI / 2);
    if (useRoad) this.roadEngine(v.speed, engThr, (burnSample ? 0 : 1 + (v.nitroOn ? 0.2 : 0)) * roadMix);
    else { if (this.roadSrc) this.roadG.gain.setTargetAtTime(0, t, 0.05); this.stopG.gain.setTargetAtTime(0, t, 0.05); this.idleLevel = 0; }
    let slipAmt = Math.min(1, Math.max(v.drift * 1.1, Math.abs(v.slip) * 1.6) * Math.min(1, v.speed / 8));
    if (v.burnout) slipAmt = 1;
    this.sqG.gain.setTargetAtTime(v.surface === 'gravel' ? 0 : slipAmt * 0.22, t, 0.04);
    this.sqF.frequency.setTargetAtTime(1100 + v.speed * 14 + (v.launchSpin ? 600 : 0), t, 0.08);
    this.wG.gain.setTargetAtTime(Math.min(1, v.speed / 110) ** 1.6 * 0.3, t, 0.1);
    this.wF.frequency.setTargetAtTime(300 + v.speed * 18, t, 0.1);
    this.gG.gain.setTargetAtTime(v.surface === 'gravel' ? Math.min(1, v.speed / 25) * 0.32 : 0, t, 0.08);
    this.gF.frequency.setTargetAtTime(500 + v.speed * 22, t, 0.1);
    this.nG.gain.setTargetAtTime(v.nitroOn ? 0.3 : 0, t, 0.06);
    this.nF.frequency.setTargetAtTime(1400 + v.rpm * 1400, t, 0.1);
    this.tG.gain.setTargetAtTime(thr > 0.3 && v.rpm > 0.6 ? 0.006 + 0.01 * v.rpm : 0, t, 0.08);
    this.tO.frequency.setTargetAtTime(1800 + v.rpm * 3600, t, 0.08);
    // no blow-off / crackle sounds: the only shift sound is skorst.mp3 on E/Q
    this.lastThr = thr;
  }

  /** road.mp3 looped; playback speed follows the engine rpm, so it slows down / speeds up with the car */
  roadEngine(speed, thr, vol) {
    const c = this.ctx, t = c.currentTime;
    if (!this.roadSrc) {
      const n = c.createBufferSource(); n.buffer = this.roadBuf; n.loop = true;
      n.loopStart = 10.6; n.loopEnd = 14.6;   // the calmest 4 s of road.mp3
      n.connect(this.roadG); n.start(t, 10.6); this.roadSrc = n;
    }
    // pitch follows road speed (not the gear rpm, which jumps), so slow = low and calm, fast = higher
    const k = Math.min(1, speed / 110);
    const rate = 0.55 + 0.75 * k + 0.08 * thr;
    this.roadSrc.playbackRate.setTargetAtTime(rate, t, 0.25);
    this.roadG.gain.setTargetAtTime(vol * 1.0 * (0.45 + 0.55 * thr) * (0.6 + 0.4 * k), t, 0.12);
  }

  noiseBurst(dur, freq, vol, type = 'bandpass', q = 1) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    n.connect(f).connect(g).connect(this.master); n.start(c.currentTime, Math.random()); n.stop(c.currentTime + dur + 0.05);
  }

  pop(vol = 0.15) { this.noiseBurst(0.07, 380 + Math.random() * 500, vol, 'lowpass'); }
  /** manual gear change (E / Q): only the Supra MK4 has a clip for it */
  shift(carId, gear = 2) {
    if (carId !== 'supra_mk4' || !this.shiftBuf || !this.ctx) return;
    // skorst.mp3 holds four gear-change hits back to back (peaks ~0.5 / 2.1 / 3.4 / 4.8 s):
    // play only the hit that belongs to this gear, one at a time, never overlapping
    const SEG = [[0.3, 1.5], [1.5, 2.9], [2.9, 4.25], [4.25, 5.55]];
    const [from, to] = SEG[Math.max(0, Math.min(3, gear - 2))];
    const c = this.ctx, t = c.currentTime;
    if (this.shiftSrc) { try { this.shiftG.gain.cancelScheduledValues(t); this.shiftG.gain.setTargetAtTime(0, t, 0.01); this.shiftSrc.stop(t + 0.06); } catch (e) { /* ended */ } }
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = this.shiftBuf; src.connect(g).connect(this.master);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.3, t + 0.01);
    g.gain.setValueAtTime(1.3, t + (to - from) - 0.08); g.gain.linearRampToValueAtTime(0, t + (to - from));
    src.start(t, from, to - from);
    this.shiftSrc = src; this.shiftG = g;
  }
  thump(intensity = 1) { this.noiseBurst(0.35, 160, Math.min(1, 0.25 + intensity * 0.6), 'lowpass'); this.noiseBurst(0.18, 2400, Math.min(0.5, intensity * 0.3), 'highpass'); }

  beep(freq = 440, dur = 0.25, vol = 0.22) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(this.master); o.start(); o.stop(c.currentTime + dur + 0.05);
  }

  /** other cars: distance-attenuated, panned engines */
  updateRemote(id, rpm, thr, dist, pan) {
    if (!this.ctx) return;
    let v = this.voices.get(id);
    if (!v) { v = new EngineVoice(this.ctx, this.master, true); this.voices.set(id, v); }
    const vol = Math.max(0, 0.34 / (1 + dist / 12)) * (dist > 140 ? 0 : 1);
    v.set(rpm, thr, vol, pan);
  }

  removeRemote(id) { const v = this.voices.get(id); if (v) { v.stop(); this.voices.delete(id); } }
  clearRemotes() { for (const id of [...this.voices.keys()]) this.removeRemote(id); }
}

/** garage: Supra MK4 idle loop (stop.m4a) while it is shown standing still */
GameAudio.prototype.garageIdle = function (on) {
  if (!this.ctx || !this.stopG) return;
  this.stopG.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, on ? 0.15 : 0.08);
};

GameAudio.prototype.silence = function () {
  if (!this.ctx) return;
  const t = this.ctx.currentTime;
  for (const g of [this.engine.vol, this.roadG, this.sqG, this.wG, this.gG, this.nG, this.tG]) g.gain.setTargetAtTime(0, t, 0.05);
  this.clearRemotes();
};
