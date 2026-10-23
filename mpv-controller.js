/**
 * mpv JSON IPC client over Unix socket.
 * Request/response tracking, event demux, auto-reconnect, command queue.
 */
const net = require('net');
const { EventEmitter } = require('events');

const DISPLAY_MODES = {
  stretch: { keepaspect: false, panscan: 0 },
  centered: { keepaspect: true, panscan: 0 },
  fill: { keepaspect: true, panscan: 1 },
};

class MpvController extends EventEmitter {
  constructor(socketPath) {
    super();
    this.socketPath = socketPath;
    this.socket = null;
    this.buffer = '';
    this.requestId = 0;
    this.pending = new Map();
    this.queue = [];
    this.connected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.reconnectCallback = null;
    this.connecting = null;
    this.minBackoff = 1000;
    this.maxBackoff = 10000;
    this.intentionalDisconnect = false;
    this.requestTimeoutMs = 10000;
    this.maxBufferSize = 1024 * 1024; // 1MB
  }

  _rejectPending(err) {
    for (const [, { reject }] of this.pending) {
      try { reject(err); } catch (_) {}
    }
    this.pending.clear();
  }

  connect() {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      // Only the current socket may change state; a stale socket closing late
      // must not mark a live connection as disconnected.
      const sock = new net.Socket();
      this.socket = sock;
      sock.setEncoding('utf8');

      sock.on('data', (chunk) => {
        if (sock === this.socket) this._onData(chunk);
      });
      sock.on('close', () => {
        if (sock !== this.socket) return;
        this.connecting = null;
        this._onClose();
      });
      sock.on('error', (err) => {
        if (sock === this.socket && !this.connected) reject(err);
      });

      sock.connect({ path: this.socketPath }, () => {
        if (sock !== this.socket) return;
        this.connecting = null;
        this.connected = true;
        this.intentionalDisconnect = false;
        this.reconnectAttempts = 0;
        this._clearReconnectTimer();
        console.log('mpv connected');
        this.emit('connected');
        this._flushQueue();
        if (this.reconnectCallback) this.reconnectCallback();
        resolve();
      });
    });
    return this.connecting;
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this._clearReconnectTimer();
    this.connecting = null;
    if (this.socket) {
      const sock = this.socket;
      this.socket = null;
      sock.destroy();
    }
    this.connected = false;
    this.emit('disconnected');
  }

  onReconnect(callback) {
    this.reconnectCallback = callback;
  }

  _onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = '';
      return;
    }
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.request_id !== undefined && msg.event === undefined) {
          const pending = this.pending.get(msg.request_id);
          if (pending) {
            this.pending.delete(msg.request_id);
            if (msg.error === 'success') {
              pending.resolve(msg.data);
            } else {
              pending.reject(new Error(msg.error || 'Unknown error'));
            }
          }
        } else if (msg.event) {
          if (msg.event === 'end-file') this.emit('file-ended', msg);
          else if (msg.event === 'start-file') this.emit('file-loaded', msg);
          else this.emit('event', msg);
        }
      } catch (_) {
        // Skip malformed lines
      }
    }
  }

  _onClose() {
    const wasConnected = this.connected;
    this.connected = false;
    this.socket = null;
    this._rejectPending(new Error('Connection closed'));
    this.buffer = '';
    if (wasConnected) console.warn('mpv disconnected, reconnecting');
    this.emit('disconnected');
    if (!this.intentionalDisconnect) this._scheduleReconnect();
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();
    const delay = Math.min(
      this.minBackoff * Math.pow(2, this.reconnectAttempts),
      this.maxBackoff
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Will retry via _scheduleReconnect from _onClose
      });
    }, delay);
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _send(obj) {
    const line = JSON.stringify(obj) + '\n';
    if (this.connected && this.socket && this.socket.writable) {
      this.socket.write(line);
    } else {
      this.queue.push(line);
    }
  }

  _flushQueue() {
    while (this.queue.length > 0 && this.connected && this.socket?.writable) {
      this.socket.write(this.queue.shift());
    }
  }

  _command(cmd, args = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          p.reject(new Error('Request timeout'));
        }
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this._send({ command: [cmd, ...args], request_id: id });
    });
  }

  async loadFile(path, opts = {}) {
    const {
      loop = false,
      displayMode = 'fill',
      isImage = false,
      freeze = false,
      color = {},
    } = opts;
    const mode = DISPLAY_MODES[displayMode] || DISPLAY_MODES.fill;

    await this.setProperty('keep-open', 'no');
    await this.setProperty('pause', 'no');
    await this._command('loadfile', [path, 'replace']);
    await this.setProperty('loop-file', loop ? 'inf' : 'no');
    await this.setProperty('keep-open', freeze && !loop ? 'yes' : 'no');
    await this.setProperty('keepaspect', mode.keepaspect);
    await this.setProperty('panscan', mode.panscan);
    await this.applyColorSettings(color);
    if (isImage) {
      await this.setProperty('image-display-duration', 'inf');
    }
  }

  stop() {
    return this._command('stop');
  }

  setProperty(name, value) {
    return this._command('set_property', [name, value]);
  }

  getProperty(name) {
    return this._command('get_property', [name]);
  }

  async applyColorSettings(color = {}) {
    const hue = Number.isFinite(color.hue) ? color.hue : 0;
    const saturation = Number.isFinite(color.saturation) ? color.saturation : 0;

    await this.setProperty('hue', hue);
    await this.setProperty('saturation', saturation);
  }
}

module.exports = { MpvController };
