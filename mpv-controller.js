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
        // With keep-open=yes mpv sends no end-file at EOF, so watch eof-reached
        this._command('observe_property', [1, 'eof-reached']).catch(() => {});
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
          else if (msg.event === 'property-change' && msg.name === 'eof-reached') {
            if (msg.data === true) this.emit('file-ended', { event: 'end-file', reason: 'eof' });
          }
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
    } = opts;
    const mode = DISPLAY_MODES[displayMode] || DISPLAY_MODES.fill;

    // Options go with the loadfile command so they apply as the new file starts
    // and never reframe the old one. keep-open=yes holds the last frame on
    // screen at EOF instead of dropping to a black idle screen while the next
    // cue loads; eof-reached tells the server when to move on.
    const options = {
      'pause': 'no',
      'loop-file': loop ? 'inf' : 'no',
      'keep-open': isImage ? 'no' : 'yes',
      'keepaspect': mode.keepaspect ? 'yes' : 'no',
      'panscan': String(mode.panscan),
    };
    if (isImage) options['image-display-duration'] = 'inf';
    const optionString = Object.entries(options).map(([k, v]) => `${k}=${v}`).join(',');

    try {
      // mpv 0.38+: loadfile <url> <flags> <index> <options>
      await this._command('loadfile', [path, 'replace', -1, optionString]);
    } catch (_) {
      // Older mpv has no index argument ("invalid parameter"): set the options
      // as globals instead. A file that really fails to load fails here again.
      for (const [name, value] of Object.entries(options)) {
        await this.setProperty(name, value);
      }
      await this._command('loadfile', [path, 'replace']);
    }
  }

  // Play the loaded file again from the start, e.g. a one-cue playlist on loop,
  // without unloading it (which would flash black)
  async restart() {
    await this._command('seek', [0, 'absolute', 'exact']);
    await this.setProperty('pause', false);
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
