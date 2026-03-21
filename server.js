const { spawn } = require('child_process');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const config = require('./config');
const { MpvController } = require('./mpv-controller');
const { createStateManager } = require('./state');

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
  });
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(payload);
    });
  }
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

  const { loop = false, displayMode = 'fill', duration = null } = cue.settings || {};

  mpv.loadFile(filePath, { loop, displayMode, isImage: media.type === 'image' })
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
  advance();
}

// mpv events
mpv.on('file-ended', handleFileEnded);
mpv.on('file-loaded', () => {
  if (isTransitioning) clearTransitionLock();
});
mpv.onReconnect(() => {
  const s = state.getState();
  if (s.currentCueIndex >= 0 && s.currentCueIndex < s.playlist.length) {
    playCue(s.currentCueIndex);
  }
});

// Ensure uploads dir exists
fs.mkdirSync(config.uploadsDir, { recursive: true });

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
      settings: { loop: false, displayMode: 'fill', duration: null },
    };
    state.updateState((s) => ({
      ...s,
      library: [...s.library, item],
      playlist: [...s.playlist, cue],
    }));
    broadcastState();
    res.status(201).json({ item, cue });
  });
});

app.put('/api/playlist/:cueId', (req, res) => {
  if (!isValidId(req.params.cueId)) return res.status(400).json({ error: 'Invalid cue ID' });
  const s = state.getState();
  const idx = s.playlist.findIndex((c) => c.id === req.params.cueId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { loop, displayMode, duration } = req.body;
  const cue = { ...s.playlist[idx] };
  cue.settings = { ...cue.settings };
  if (loop !== undefined) cue.settings.loop = !!loop;
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
        mpv.loadFile(filePath, {
          loop: cue.settings.loop,
          displayMode: cue.settings.displayMode,
          isImage: media.type === 'image',
        }).catch(console.error);
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

const server = app.listen(config.port, () => {
  console.log(`Screenview listening on port ${config.port}`);
});

wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    ...state.getState(),
    diskFree: getDiskFree(),
    isTransitioning,
    mpvConnected: mpv.connected,
  }));
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
