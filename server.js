const { spawn, execFile } = require('child_process');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const config = require('./config');
const { MpvController } = require('./mpv-controller');
const { createStateManager } = require('./state');
const { analyzeVideo, removeThumbnail } = require('./media-info');

const ALLOWED_EXT = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
  'mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v',
];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const TRANSITION_TIMEOUT_MS = 2000;

const app = express();
const state = createStateManager(config.statePath);
const mpv = new MpvController(config.mpvSocket);

let durationTimer = null;
let isTransitioning = false;
let wss = null;
let mpvProcess = null;
let led = { configured: !!config.novaHost, available: false, brightness: null };

function getDiskFree() {
  try {
    const stat = fs.statfsSync(config.uploadsDir);
    return (stat.bavail ?? 0) * (stat.bsize ?? 4096);
  } catch {
    return 1024 * 1024 * 1024; // Fallback: assume 1GB free
  }
}

function broadcastState() {
  const s = state.getState();
  const payload = JSON.stringify({
    ...s,
    diskFree: getDiskFree(),
    isTransitioning,
    mpvConnected: mpv.connected,
    led,
  });
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(payload);
    });
  }
}

// Adds thumbnail + duration to a video in the background, then pushes the update
function enrichMedia(item) {
  if (item.type !== 'video') return Promise.resolve();
  return analyzeVideo(config.uploadsDir, item).then(({ thumb, duration }) => {
    if (!thumb && duration == null) return;
    state.updateState((s) => ({
      ...s,
      library: s.library.map((m) => (m.id === item.id ? { ...m, thumb, duration } : m)),
    }));
    broadcastState();
  });
}

function getMediaType(filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return IMAGE_EXT.includes(ext) ? 'image' : 'video';
}

function sanitizeFilename(name) {
  const base = path.basename(name || '');
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 200) || 'unnamed';
}

function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(id);
}

function isValidDisplayMode(m) {
  return ['stretch', 'centered', 'fill'].includes(m);
}

function getCuePlaybackOptions(cue, media) {
  const settings = cue.settings || {};
  return {
    loop: settings.loop ?? false,
    displayMode: settings.displayMode ?? 'fill',
    isImage: media.type === 'image',
    freeze: settings.freeze ?? false,
  };
}

function clearDurationTimer() {
  if (durationTimer) {
    clearTimeout(durationTimer);
    durationTimer = null;
  }
}

function clearTransitionLock() {
  isTransitioning = false;
  broadcastState();
}

function playCue(index) {
  if (isTransitioning) return;
  clearDurationTimer();

  const s = state.getState();
  const cue = s.playlist[index];
  if (!cue) {
    mpv.stop();
    state.updateState({ currentCueIndex: -1 });
    broadcastState();
    return;
  }

  const media = s.library.find((m) => m.id === cue.mediaId);
  if (!media) {
    advance();
    return;
  }

  const filePath = path.resolve(config.uploadsDir, media.filename);
  if (!fs.existsSync(filePath)) {
    advance();
    return;
  }

  isTransitioning = true;
  broadcastState();

  const duration = cue.settings?.duration ?? null;

  mpv.loadFile(filePath, getCuePlaybackOptions(cue, media))
    .then(() => {
      state.updateState({ currentCueIndex: index });
      clearTransitionLock();

      const isImage = media.type === 'image';
      const sec = duration != null && duration > 0 ? Number(duration) : null;
      if (isImage && sec) {
        durationTimer = setTimeout(advance, sec * 1000);
      }
    })
    .catch((err) => {
      console.error('mpv loadFile error:', err);
      clearTransitionLock();
      advance();
    });

  // Safety timeout
  setTimeout(() => {
    if (isTransitioning) clearTransitionLock();
  }, TRANSITION_TIMEOUT_MS);
}

function advance() {
  if (isTransitioning) return;
  const s = state.getState();
  const next = s.currentCueIndex + 1;
  if (next >= s.playlist.length) {
    if (s.playlistLoop && s.playlist.length > 0) {
      playCue(0);
    } else {
      mpv.stop();
      state.updateState({ currentCueIndex: -1 });
      broadcastState();
      clearDurationTimer();
    }
    return;
  }
  playCue(next);
}

function handleFileEnded() {
  if (isTransitioning) return;
  const s = state.getState();
  const cue = s.playlist[s.currentCueIndex];
  if (!cue) return;
  const media = s.library.find((m) => m.id === cue.mediaId);
  if (!media || media.type === 'image') return;
  const loop = cue.settings?.loop ?? false;
  if (loop) return;
  const freeze = cue.settings?.freeze ?? false;
  if (freeze) return;
  advance();
}

// mpv events
mpv.on('file-ended', handleFileEnded);
mpv.onReconnect(() => {
  const s = state.getState();
  if (s.currentCueIndex >= 0 && s.currentCueIndex < s.playlist.length) {
    playCue(s.currentCueIndex);
  }
});

// Ensure uploads dir exists
fs.mkdirSync(config.uploadsDir, { recursive: true });

// Backfill thumbnails for videos uploaded before thumbnails existed, one at a time
(async () => {
  for (const item of state.getState().library) {
    if (item.type === 'video' && !item.thumb) await enrichMedia(item);
  }
})();

// Multer
const storage = multer.diskStorage({
  destination: config.uploadsDir,
  filename: (req, file, cb) => {
    const safe = sanitizeFilename(file.originalname);
    const id = uuidv4().replace(/-/g, '');
    cb(null, `${id}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) cb(null, true);
    else cb(new Error(`Format not allowed: ${ext}`));
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get(/^\/uploads\/.+/, (req, res) => {
  const requested = req.path.replace(/^\/uploads\/?/, '') || '';
  const filePath = path.join(config.uploadsDir, requested);
  const resolved = path.resolve(filePath);
  const uploadsResolved = path.resolve(config.uploadsDir);
  if (!resolved.startsWith(uploadsResolved + path.sep) && resolved !== uploadsResolved) {
    return res.status(403).send('Forbidden');
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return res.status(404).send('Not found');
  }
  res.sendFile(resolved);
});

app.get('/', (req, res) => res.redirect('/control'));
app.get('/control', (req, res) => res.sendFile(path.join(__dirname, 'public', 'control.html')));

// API
app.post('/api/upload', (req, res) => {
  const free = getDiskFree();
  if (free < config.minFreeDisk) {
    return res.status(507).json({ error: 'Insufficient disk space' });
  }
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const id = path.basename(req.file.filename).slice(0, 32);
    const item = {
      id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      type: getMediaType(req.file.filename),
      size: req.file.size,
      addedAt: new Date().toISOString(),
    };
    state.updateState((s) => ({
      ...s,
      library: [...s.library, item],
    }));
    broadcastState();
    res.json(item);
    enrichMedia(item);
  });
});

app.get('/api/library', (req, res) => {
  res.json(state.getState().library);
});

app.delete('/api/library/:id', (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const s = state.getState();
  const item = s.library.find((m) => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(config.uploadsDir, item.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error('Delete file error:', e);
  }
  removeThumbnail(config.uploadsDir, item);

  const library = s.library.filter((m) => m.id !== req.params.id);
  const playlist = s.playlist.filter((c) => c.mediaId !== req.params.id);
  const wasPlayingDeleted = s.playlist[s.currentCueIndex]?.mediaId === req.params.id;

  if (wasPlayingDeleted) {
    const nextIdx = s.currentCueIndex;
    state.updateState({ library, playlist, currentCueIndex: -1 });
    if (nextIdx < playlist.length) {
      playCue(nextIdx);
    } else {
      mpv.stop();
      clearDurationTimer();
    }
  } else {
    const currentCueIndex = s.currentCueIndex >= 0
      ? playlist.findIndex((c) => c.id === s.playlist[s.currentCueIndex]?.id)
      : -1;
    state.updateState({ library, playlist, currentCueIndex });
  }
  broadcastState();
  res.status(204).send();
});

app.get('/api/playlist', (req, res) => res.json(state.getState().playlist));
app.get('/api/state', (req, res) => res.json({ ...state.getState(), diskFree: getDiskFree() }));

// Playback position of the live video, for the control page's preview to follow
app.get('/api/position', async (req, res) => {
  if (!mpv.connected) return res.json({ position: null });
  try {
    const position = await mpv.getProperty('time-pos');
    res.json({ position: typeof position === 'number' ? position : null });
  } catch {
    res.json({ position: null }); // idle: mpv has no time-pos
  }
});

app.put('/api/settings', (req, res) => {
  const { playlistLoop } = req.body;
  if (typeof playlistLoop !== 'boolean') return res.status(400).json({ error: 'playlistLoop must be boolean' });
  state.updateState({ playlistLoop });
  broadcastState();
  res.json(state.getState());
});

app.post('/api/playlist', (req, res) => {
  const { mediaId, settings = {} } = req.body;
  if (!mediaId || !isValidId(mediaId)) return res.status(400).json({ error: 'mediaId required' });
  const s = state.getState();
  if (!s.library.some((m) => m.id === mediaId)) return res.status(404).json({ error: 'Media not found' });
  const id = `cue-${uuidv4().slice(0, 8)}`;
  const cue = {
    id,
    mediaId,
    settings: {
      loop: settings.loop ?? false,
      displayMode: settings.displayMode ?? 'fill',
      duration: settings.duration ?? null,
      freeze: settings.freeze ?? false,
    },
  };
  state.updateState((s) => ({ ...s, playlist: [...s.playlist, cue] }));
  broadcastState();
  res.status(201).json(cue);
});

app.post('/api/playlist/upload', (req, res) => {
  const free = getDiskFree();
  if (free < config.minFreeDisk) {
    return res.status(507).json({ error: 'Insufficient disk space' });
  }
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const id = path.basename(req.file.filename).slice(0, 32);
    const item = {
      id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      type: getMediaType(req.file.filename),
      size: req.file.size,
      addedAt: new Date().toISOString(),
      playlistOnly: true,
    };
    const cueId = `cue-${uuidv4().slice(0, 8)}`;
    const cue = {
      id: cueId,
      mediaId: id,
      settings: { loop: false, displayMode: 'fill', duration: null, freeze: false },
    };
    state.updateState((s) => ({
      ...s,
      library: [...s.library, item],
      playlist: [...s.playlist, cue],
    }));
    broadcastState();
    res.status(201).json({ item, cue });
    enrichMedia(item);
  });
});

// Must be registered before /api/playlist/:cueId, or "reorder" is taken as a cue ID
app.put('/api/playlist/reorder', (req, res) => {
  const ids = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Array of IDs required' });
  if (ids.some((id) => !isValidId(id))) return res.status(400).json({ error: 'Invalid cue ID in reorder' });
  const s = state.getState();
  const byId = new Map(s.playlist.map((c) => [c.id, c]));
  const playlist = ids.map((id) => byId.get(id)).filter(Boolean);
  if (playlist.length !== s.playlist.length) return res.status(400).json({ error: 'Invalid reorder' });
  const currentCue = s.playlist[s.currentCueIndex];
  const newIdx = currentCue ? playlist.findIndex((c) => c.id === currentCue.id) : -1;
  state.updateState({ playlist, currentCueIndex: newIdx });
  broadcastState();
  res.json(playlist);
});

app.put('/api/playlist/:cueId', (req, res) => {
  if (!isValidId(req.params.cueId)) return res.status(400).json({ error: 'Invalid cue ID' });
  const s = state.getState();
  const idx = s.playlist.findIndex((c) => c.id === req.params.cueId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { loop, displayMode, duration, freeze } = req.body;
  const cue = { ...s.playlist[idx] };
  cue.settings = { ...cue.settings };
  if (loop !== undefined) cue.settings.loop = !!loop;
  if (freeze !== undefined) cue.settings.freeze = !!freeze;
  if (displayMode !== undefined) {
    if (!isValidDisplayMode(displayMode)) return res.status(400).json({ error: 'Invalid displayMode' });
    cue.settings.displayMode = displayMode;
  }
  if (duration !== undefined) {
    const d = duration === null || duration === '' ? null : Number(duration);
    if (d !== null && (isNaN(d) || d < 0)) return res.status(400).json({ error: 'Invalid duration' });
    cue.settings.duration = d;
  }
  const playlist = [...s.playlist];
  playlist[idx] = cue;
  state.updateState({ playlist });

  if (idx === s.currentCueIndex) {
    const media = s.library.find((m) => m.id === cue.mediaId);
    if (media) {
      const filePath = path.resolve(config.uploadsDir, media.filename);
      if (fs.existsSync(filePath)) {
        mpv.loadFile(filePath, getCuePlaybackOptions(cue, media)).catch(console.error);
      }
    }
  }
  broadcastState();
  res.json(cue);
});

app.delete('/api/playlist/:cueId', (req, res) => {
  if (!isValidId(req.params.cueId)) return res.status(400).json({ error: 'Invalid cue ID' });
  const s = state.getState();
  const idx = s.playlist.findIndex((c) => c.id === req.params.cueId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const mediaId = s.playlist[idx].mediaId;
  const playlist = s.playlist.filter((c) => c.id !== req.params.cueId);
  let currentCueIndex = s.currentCueIndex;

  let library = s.library;
  const media = s.library.find((m) => m.id === mediaId);
  if (media?.playlistOnly && !playlist.some((c) => c.mediaId === mediaId)) {
    const filePath = path.join(config.uploadsDir, media.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error('Delete playlist-only file error:', e);
    }
    removeThumbnail(config.uploadsDir, media);
    library = s.library.filter((m) => m.id !== mediaId);
  }

  if (s.currentCueIndex === idx) {
    if (playlist.length > 0) {
      currentCueIndex = -1;
      playCue(Math.min(idx, playlist.length - 1));
    } else {
      mpv.stop();
      clearDurationTimer();
      currentCueIndex = -1;
    }
  } else if (s.currentCueIndex > idx) {
    currentCueIndex = s.currentCueIndex - 1;
  }
  state.updateState({ library, playlist, currentCueIndex });
  broadcastState();
  res.status(204).send();
});

app.post('/api/go', (req, res) => {
  const s = state.getState();
  const next = s.currentCueIndex + 1;
  if (next >= s.playlist.length) {
    if (s.playlistLoop && s.playlist.length > 0) {
      playCue(0);
    } else {
      mpv.stop();
      clearDurationTimer();
      state.updateState({ currentCueIndex: -1 });
    }
  } else {
    playCue(next);
  }
  broadcastState();
  res.status(204).send();
});

app.post('/api/go/:cueId', (req, res) => {
  if (!isValidId(req.params.cueId)) return res.status(400).json({ error: 'Invalid cue ID' });
  const s = state.getState();
  const idx = s.playlist.findIndex((c) => c.id === req.params.cueId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  playCue(idx);
  broadcastState();
  res.status(204).send();
});

app.post('/api/stop', (req, res) => {
  mpv.stop();
  clearDurationTimer();
  state.updateState({ currentCueIndex: -1 });
  broadcastState();
  res.status(204).send();
});

// Bluetooth pairing control (remote Pi)
function sshCommand(cmd) {
  return new Promise((resolve, reject) => {
    if (!config.btHost) return reject(new Error('BT_HOST not configured'));
    const args = ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5'];
    let bin = 'ssh';
    const fullArgs = [];
    if (config.btPassword) {
      bin = 'sshpass';
      fullArgs.push('-p', config.btPassword);
      fullArgs.push('ssh', ...args);
    } else {
      fullArgs.push(...args);
    }
    fullArgs.push(`${config.btUser}@${config.btHost}`, cmd);
    execFile(bin, fullArgs, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

app.get('/api/bluetooth/status', async (req, res) => {
  if (!config.btHost) return res.json({ available: false });
  try {
    const out = await sshCommand('bluetoothctl show | grep Discoverable:');
    const discoverable = out.includes('yes');
    res.json({ available: true, discoverable });
  } catch {
    res.json({ available: false });
  }
});

app.post('/api/bluetooth/pairing', async (req, res) => {
  if (!config.btHost) return res.status(501).json({ error: 'BT_HOST not configured' });
  const { enabled } = req.body;
  const onOff = enabled ? 'on' : 'off';
  try {
    await sshCommand(`bluetoothctl discoverable ${onOff}`);
    res.json({ discoverable: !!enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LED panel brightness via the NovaStar controller (see setup/NOVASTAR.md)
let ledTarget = null;
let ledJob = null;

function novaRequest(readWrite, params) {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ ReadWrite: String(readWrite), DevidIndex: '0', ...params });
    q.append('anticache', String(Math.floor(Math.random() * 1e4)));
    q.append('_', String(Date.now())); // must come after anticache or the controller ignores writes
    const req = http.get(`http://${config.novaHost}/leds.cgi?${q}`, { timeout: 4000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Bad response from LED controller'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('LED controller timed out')));
    req.on('error', reject);
  });
}

async function readLedBrightness() {
  const r = await novaRequest(0, { abaa: 0 });
  const n = parseInt(r.abaa, 10);
  if (r.ERRC !== '0' || !Number.isFinite(n)) throw new Error(`LED controller error ${r.ERRC}`);
  return n;
}

function setLed(available, brightness) {
  if (led.available === available && led.brightness === brightness) return;
  led = { ...led, available, brightness };
  broadcastState();
}

async function pollLed() {
  if (!config.novaHost || ledJob) return;
  try {
    const n = await readLedBrightness();
    if (!ledJob) setLed(true, n);
  } catch {
    if (!ledJob) setLed(false, led.brightness);
  }
}

// Applies the latest requested brightness. The controller replies OK even when it
// drops a write, so every write is read back and retried.
async function runLedWrites() {
  while (ledTarget !== null) {
    const want = ledTarget;
    let got = null;
    for (let i = 0; i < 3 && got !== want && ledTarget === want; i++) {
      await novaRequest(1, { abaa: want });
      got = await readLedBrightness();
    }
    setLed(true, got);
    if (ledTarget === want) {
      ledTarget = null;
      if (got !== want) throw new Error('LED controller did not apply the brightness');
    }
  }
}

app.put('/api/led/brightness', async (req, res) => {
  if (!config.novaHost) return res.status(501).json({ error: 'NOVA_HOST not configured' });
  const value = Number(req.body?.brightness);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return res.status(400).json({ error: 'brightness must be an integer 0-100' });
  }
  ledTarget = value;
  if (!ledJob) {
    ledJob = runLedWrites().finally(() => { ledJob = null; });
  }
  try {
    await ledJob;
    res.json(led);
  } catch (err) {
    ledTarget = null;
    if (err.code) setLed(false, led.brightness); // network error: controller unreachable
    res.status(502).json({ error: err.message });
  }
});

if (config.novaHost) {
  // Picks up changes made on the controller itself; skipped while nobody is watching
  setInterval(() => {
    if (wss && wss.clients.size > 0) pollLed();
  }, 10000);
}

const server = app.listen(config.port, () => {
  console.log(`backdrop listening on port ${config.port}`);
});

wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    ...state.getState(),
    diskFree: getDiskFree(),
    isTransitioning,
    mpvConnected: mpv.connected,
    led,
  }));
  pollLed();
});

mpv.on('connected', () => broadcastState());
mpv.on('disconnected', () => broadcastState());

function ensureSocketDir() {
  const dir = path.dirname(config.mpvSocket);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function spawnMpvProcess() {
  ensureSocketDir();
  if (fs.existsSync(config.mpvSocket)) {
    try { fs.unlinkSync(config.mpvSocket); } catch (_) {}
  }
  const mpvBin = process.platform === 'linux' && fs.existsSync('/usr/bin/mpv') ? '/usr/bin/mpv' : 'mpv';
  const hasDisplay = !!process.env.DISPLAY;
  const args = [
    '--idle',
    `--force-window=${hasDisplay ? 'yes' : 'no'}`,
    `--input-ipc-server=${config.mpvSocket}`,
    '--no-osc',
    '--no-osd-bar',
    '--no-input-default-bindings',
    '--image-display-duration=inf',
  ];
  if (config.isDev || process.platform === 'darwin') {
    if (hasDisplay) {
      args.push('--geometry=1280x720');
    } else {
      args.push('--vo=null', '--no-terminal', '--really-quiet');
    }
  } else {
    args.push('--vo=drm', '--hwdec=vaapi', '--fs', '--no-terminal', '--really-quiet');
  }
  console.log('Spawning mpv, socket:', config.mpvSocket);
  mpvProcess = spawn(mpvBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  mpvProcess.stderr?.on('data', (d) => process.stderr.write(d));
  mpvProcess.on('error', (err) => {
    console.warn('Failed to spawn mpv:', err.message);
    if (err.code === 'ENOENT') console.warn('Install mpv: apt install mpv');
  });
  mpvProcess.on('exit', (code, signal) => {
    mpvProcess = null;
    if (code != null && code !== 0) console.warn('mpv exited:', code);
  });
  return mpvProcess;
}

function waitForSocket(maxMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(config.mpvSocket)) return resolve(true);
      if (Date.now() - start > maxMs) return resolve(false);
      setTimeout(check, 100);
    };
    check();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectMpv() {
  if (config.spawnMpv) {
    spawnMpvProcess();
    if (await waitForSocket(10000)) {
      await sleep(500);
    } else {
      console.warn('mpv socket did not appear in time at', config.mpvSocket);
    }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await mpv.connect();
      return;
    } catch (err) {
      if (attempt < 3) {
        await sleep(1000);
      } else {
        console.warn('mpv not available:', err.message, '(socket:', config.mpvSocket + ')');
        broadcastState();
      }
    }
  }
}

connectMpv();

function shutdown() {
  state.flush();
  mpv.disconnect();
  if (mpvProcess) {
    mpvProcess.kill('SIGTERM');
    mpvProcess = null;
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
