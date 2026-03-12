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
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setEncoding('utf8');

      this.socket.on('data', (chunk) => this._onData(chunk));
      this.socket.on('close', () => this._onClose());
      this.socket.on('error', (err) => {
        if (!this.connected) reject(err);
      });

      this.socket.connect({ path: this.socketPath }, () => {
        this.connected = true;
        this.intentionalDisconnect = false;
        this.reconnectAttempts = 0;
        this.emit('connected');
        this._flushQueue();
        if (this.reconnectCallback) this.reconnectCallback();
        resolve();
      });
    });
  }

  disconnect() {
    this.intentionalDisconnect = true;
    this._clearReconnectTimer();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
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
    this.connected = false;
    this.socket = null;
    this._rejectPending(new Error('Connection closed'));
    this.buffer = '';
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
    const { loop = false, displayMode = 'fill' } = opts;
    const mode = DISPLAY_MODES[displayMode] || DISPLAY_MODES.fill;

    await this._command('loadfile', [path, 'replace']);
    await this.setProperty('loop-file', loop ? 'inf' : 'no');
    await this.setProperty('keepaspect', mode.keepaspect);
    await this.setProperty('panscan', mode.panscan);
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
}

module.exports = { MpvController };
