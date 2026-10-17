// Thin WebSocket client with event callbacks.
export class Net {
  constructor() { this.ws = null; this.on = {}; this.id = null; this.room = null; this.connected = false; this.latency = 0; }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try { ws = new WebSocket(`${proto}://${location.host}`); } catch (e) { return reject(e); }
      this.ws = ws;
      const to = setTimeout(() => { reject(new Error('timeout')); try { ws.close(); } catch (e) { /* noop */ } }, 6000);
      ws.onopen = () => { clearTimeout(to); this.connected = true; resolve(); this._ping(); };
      ws.onerror = () => { clearTimeout(to); reject(new Error('socket')); };
      ws.onclose = () => { this.connected = false; clearInterval(this._pi); (this.on.close || (() => {}))(); };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'pong') { this.latency = performance.now() - m.c; return; }
        if (m.t === 'joined') { this.id = m.id; this.room = m.room; }
        const h = this.on[m.t]; if (h) h(m);
      };
    });
  }

  _ping() { this._pi = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000); }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() { clearInterval(this._pi); if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.ws = null; this.connected = false; this.id = null; this.room = null; }
}
