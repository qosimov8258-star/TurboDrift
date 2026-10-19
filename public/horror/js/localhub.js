// Yakka o'yinda ruh bo'lganda: omon qolganlarni botlar o'ynaydi. Har bir bot o'z Sim'iga ega,
// xabarlar server o'rniga shu yerda almashadi.
import { Sim } from './sim.js';
import { Bot } from './bot.js';
import { mulberry32 } from './rng.js';

export class LocalHub {
  constructor(cfg, mySim) {
    this.mySim = mySim; this.bots = [];
    for (const p of cfg.players) {
      if (!p.bot) continue;
      const sim = new Sim({ seed: cfg.seed, level: cfg.level, diff: cfg.diff, me: p, players: cfg.players, hostId: cfg.hostId, ghostId: cfg.ghostId, send: m => this._fromBot(p.id, m) });
      this.bots.push({ id: p.id, sim, bot: new Bot(sim, mulberry32(cfg.seed ^ (p.id.length * 7919))) });
    }
  }
  fromMe(m) { for (const b of this.bots) b.sim.handleNet({ ...m, id: this.mySim.myId }); }
  _fromBot(id, m) {
    if (!['ev', 'st', 'gs', 'end'].includes(m.t)) return;
    const mm = { ...m, id };
    this.mySim.handleNet(mm);
    for (const b of this.bots) if (b.id !== id) b.sim.handleNet(mm);
  }
  update(dt) { for (const b of this.bots) { if (b.sim.over) continue; b.sim.update(dt, b.bot.step(dt)); b.sim.fx.length = 0; } }
}
