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
const { analyzeMedia, removeThumbnail } = require('./media-info');
const { createMatrix } = require('./hdmi-matrix');
const { listenArtNet } = require('./artnet');
const { createRemoteUpload } = require('./remote-upload');
const visuals = require('./visuals');

const ALLOWED_EXT = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
  'mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v',
  'glsl',
];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const VISUAL_EXT = ['glsl'];
// Built shaders for live visuals (visuals.js), next to the media so mpv can read them
const VISUAL_CACHE = path.resolve(config.uploadsDir, '.visuals');
const TRANSITION_TIMEOUT_MS = 2000;

const app = express();
const state = createStateManager(config.statePath);
const mpv = new MpvController(config.mpvSocket);

let durationTimer = null;
let isTransitioning = false;
let wss = null;
let mpvProcess = null;
let led = { configured: !!config.novaHost, available: false, brightness: null };
const matrix = config.hdmiHosts.length ? createMatrix(config.hdmiHosts) : null;
let hdmi = {
  configured: !!matrix,
  available: false,
  sources: config.hdmiSources.map((name) => ({ name, signal: null })),
  current: null, // input number feeding config.hdmiOutput
};
// DMX functions in display order; each maps to one channel of the universe (0 = unused).
// After the three show controls comes a 16-channel "fixture" for live visuals
// (setup/DMX.md): visual select, dimmer, colour, speed, strobe, control, 8 strips.
const DMX_SEGMENTS = Array.from({ length: visuals.SEGMENTS }, (_, i) => `seg${i + 1}`);
const DMX_FIXTURE = ['visual', 'dimmer', 'red', 'green', 'blue', 'speed', 'strobe', 'control', ...DMX_SEGMENTS];
const DMX_FUNCTIONS = ['brightness', 'go', 'back', ...DMX_FIXTURE];
let dmx = {
  configured: config.dmxUniverse !== null,
  receiving: false,
  values: null, // { brightness, go, ..., seg8 }: 0-255, null for unused functions
};
// The visual on screen: what plays it (key: its cue id, or dmx:<media id> when
// the DMX visual channel picked it), the slider values it shows (saved values
// plus live moves from the UI or DMX) and its clock (visuals.clockAfterSpeedChange)
let liveVisual = null;
let dmxVisualId = null; // library id of the visual DMX put on screen, outside the cues
// The DMX fixture's dimmer, colour, strobe and strips, laid over every visual
let fx = { ...visuals.FX_NEUTRAL };

function onAirKey() {
  const s = state.getState();
  const cue = s.playlist[s.currentCueIndex];
  if (cue) return cue.id;
  return dmxVisualId ? `dmx:${dmxVisualId}` : null;
}

// liveVisual while it is still the one on screen (stop leaves it behind)
function currentVisual() {
  return liveVisual && liveVisual.key === onAirKey() ? liveVisual : null;
}

function liveVisualInfo() {
  const lv = currentVisual();
  if (!lv) return null;
  return { cueId: lv.key, mediaId: lv.mediaId, dmx: lv.key.startsWith('dmx:'), values: lv.values };
}

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
    hdmi,
    dmx: { ...dmx, ...getDmxConfig() },
    liveVisual: liveVisualInfo(),
  });
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(payload);
    });
  }
}

function patchLibraryItem(id, patch) {
  state.updateState((s) => ({
    ...s,
    library: s.library.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }));
  broadcastState();
}

// Adds a small thumbnail (and a video's duration) in the background, then pushes
// the update. Visuals get their sliders read from the shader instead.
function enrichMedia(item) {
  if (item.type === 'visual') {
    try {
      const v = visuals.readVisual(mediaPath(item));
      patchLibraryItem(item.id, { params: visuals.publicParams(v.params), control: visuals.controlParam(v) });
    } catch (e) {
      console.warn(`Could not read visual ${item.originalName}:`, e.message);
    }
    return Promise.resolve();
  }
  return analyzeMedia(config.uploadsDir, item).then(({ thumb, duration }) => {
    if (!thumb && duration == null) return;
    patchLibraryItem(item.id, item.type === 'video' ? { thumb, duration } : { thumb });
  });
}

// Built-in visuals live in visuals/, everything else in uploads/
function mediaPath(media) {
  return media.builtin
    ? path.join(visuals.BUILTIN_DIR, media.filename)
    : path.resolve(config.uploadsDir, media.filename);
}

// Puts the built-in visuals into the library (in a "Visuals" folder on first
// run) and keeps their sliders in step with the shader files. Deleted ones
// come back on the next start.
function seedBuiltinVisuals() {
  const builtins = visuals.listBuiltins();
  if (!builtins.length) return;
  const s = state.getState();
  let folder = s.folders.find((f) => !f.parentId && f.name === 'Visuals');
  const folders = folder ? s.folders : [...s.folders, folder = { id: 'f-visuals', name: 'Visuals', parentId: null }];
  const ids = new Set(builtins.map((b) => `vis-${path.basename(b.file, '.glsl')}`));
  const library = s.library.filter((m) => !m.builtin || ids.has(m.id) || s.playlist.some((c) => c.mediaId === m.id));
  for (const b of builtins) {
    const id = `vis-${path.basename(b.file, '.glsl')}`;
    const fields = {
      filename: b.file,
      type: 'visual',
      builtin: true,
      params: b.params,
      control: b.control,
      thumbUrl: `/visuals/thumbs/${path.basename(b.file, '.glsl')}.jpg`,
    };
    const i = library.findIndex((m) => m.id === id);
    if (i >= 0) library[i] = { ...library[i], ...fields };
    else library.push({ id, originalName: b.name, size: 0, addedAt: new Date(0).toISOString(), folderId: folder.id, ...fields });
  }
  state.updateState({ folders, library });
}

function getMediaType(filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (VISUAL_EXT.includes(ext)) return 'visual';
  return IMAGE_EXT.includes(ext) ? 'image' : 'video';
}

function sanitizeFilename(name) {
  const base = path.basename(name || '');
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 200) || 'unnamed';
}

// Adds a finished phone upload to the library, inside a root folder of that
// name (created on first use so phone uploads don't mix into the root)
function addRemoteUpload({ filename, originalName, size }, folderName) {
  let folder = state.getState().folders.find((f) => !f.parentId && f.name === folderName);
  if (!folder) {
    folder = { id: `f-${uuidv4().slice(0, 8)}`, name: folderName, parentId: null };
    const created = folder;
    state.updateState((s) => ({ ...s, folders: [...s.folders, created] }));
  }
  const item = {
    id: filename.slice(0, 32),
    filename,
    originalName,
    type: getMediaType(filename),
    size,
    addedAt: new Date().toISOString(),
    folderId: folder.id,
  };
  state.updateState((s) => ({ ...s, library: [...s.library, item] }));
  broadcastState();
  enrichMedia(item);
  return item;
}

function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(id);
}

function isValidDisplayMode(m) {
  return ['stretch', 'centered', 'fill'].includes(m);
}

const FRAMING_LIMITS = { offset: 2, minScale: 0.1, maxScale: 4 };

// Moving and resizing only applies to centered clips; fill and stretch always cover the panel
function getCueFraming(settings = {}) {
  if ((settings.displayMode ?? 'fill') !== 'centered') return { offsetX: 0, offsetY: 0, scale: 1 };
  return {
    offsetX: settings.offsetX ?? 0,
    offsetY: settings.offsetY ?? 0,
    scale: settings.scale ?? 1,
  };
}

// Validates a visual's slider values ({ name: number }); returns { params } or { error }.
// Ranges are clamped when the visual plays.
function parseParams(body) {
  if (body === undefined) return {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'params must be an object' };
  const params = {};
  for (const [k, v] of Object.entries(body)) {
    if (!/^\w{1,64}$/.test(k) || k.startsWith('clock_')) return { error: `Invalid param ${k}` };
    const n = Number(v);
    if (!Number.isFinite(n)) return { error: `Invalid value for ${k}` };
    params[k] = n;
  }
  return { params };
}

// Validates offsetX/offsetY/scale in body; returns { framing } or { error }
function parseFraming(body) {
  const framing = {};
  for (const key of ['offsetX', 'offsetY']) {
    if (body[key] === undefined) continue;
    const v = Number(body[key]);
    if (!Number.isFinite(v) || Math.abs(v) > FRAMING_LIMITS.offset) return { error: `Invalid ${key}` };
    framing[key] = v;
  }
  if (body.scale !== undefined) {
    const v = Number(body.scale);
    if (!Number.isFinite(v) || v < FRAMING_LIMITS.minScale || v > FRAMING_LIMITS.maxScale) return { error: 'Invalid scale' };
    framing.scale = v;
  }
  return { framing };
}

function getCuePlaybackOptions(cue, media) {
  const settings = cue.settings || {};
  return {
    loop: media.type === 'visual' || (settings.loop ?? false),
    displayMode: settings.displayMode ?? 'fill',
    isImage: media.type === 'image',
    freeze: settings.freeze ?? false,
    framing: getCueFraming(settings),
  };
}

// Starts a visual: a tiny generated source plus its shader, clock from zero
function loadVisual(key, media, saved, opts) {
  const shaderPath = visuals.writeShader(mediaPath(media), VISUAL_CACHE, media.id, config.visualSize);
  const values = visuals.paramValues(media.params, saved);
  const clock = { clock_t0: 0, clock_ta: 0 };
  liveVisual = { key, mediaId: media.id, values, clock };
  return mpv.loadFile(visuals.SOURCE, { ...opts, shader: { path: shaderPath, opts: visuals.shaderOpts(values, clock, fx) } });
}

// Loads a cue's media into mpv
async function loadCue(cue, media) {
  dmxVisualId = null;
  const opts = getCuePlaybackOptions(cue, media);
  if (media.type === 'visual') return loadVisual(cue.id, media, cue.settings?.params, opts);
  liveVisual = null;
  return mpv.loadFile(mediaPath(media), opts);
}

// The DMX visual channel plays a visual straight away, outside the cue list
async function playDmxVisual(media) {
  if (isTransitioning || !fs.existsSync(mediaPath(media))) return;
  clearDurationTimer();
  dmxVisualId = media.id;
  state.updateState({ currentCueIndex: -1 });
  try {
    await loadVisual(`dmx:${media.id}`, media, {}, { loop: true, displayMode: 'fill' });
  } catch (err) {
    console.warn('DMX visual:', err.message);
    dmxVisualId = null;
  }
  broadcastState();
}

// Moves sliders of the visual on screen without reloading it (nothing is saved).
// Calls run one after another so a burst of DMX frames can't interleave.
let visualQueue = Promise.resolve();
let visualUiTimer = null;

// Clients see slider moves (e.g. from DMX) at most every 200 ms
function scheduleVisualBroadcast() {
  if (visualUiTimer) return;
  visualUiTimer = setTimeout(() => {
    visualUiTimer = null;
    broadcastState();
  }, 200);
}

// key is the on-air key (a cue id or dmx:<id>); null means whatever is on air.
// No patch just pushes the DMX fixture state (fx). While one update is running,
// later ones merge into a single follow-up, so DMX at 40 frames a second never
// queues up behind mpv.
let visualNext = null; // { key, patch, promise, resolve } waiting for its turn

function setLiveVisualParams(key, patch = {}) {
  if (visualNext && visualNext.key === key) {
    Object.assign(visualNext.patch, patch);
    return visualNext.promise;
  }
  const job = { key, patch: { ...patch } };
  job.promise = new Promise((resolve) => { job.resolve = resolve; });
  visualNext = job;
  visualQueue = visualQueue.then(async () => {
    if (visualNext === job) visualNext = null;
    job.resolve(await applyLiveVisual(job.key, job.patch));
  });
  return job.promise;
}

async function applyLiveVisual(key, patch) {
  try {
    const lv = currentVisual();
    if (!lv || (key && lv.key !== key)) return false;
    const media = state.getState().library.find((m) => m.id === lv.mediaId);
    const values = visuals.paramValues(media?.params, { ...lv.values, ...patch });
    if ('speed' in values && values.speed !== lv.values.speed) {
      const now = await mpv.getProperty('time-pos').catch(() => null);
      if (typeof now === 'number') lv.clock = visuals.clockAfterSpeedChange(lv.clock, lv.values.speed, now);
    }
    lv.values = values;
    await mpv.setShaderOpts(visuals.shaderOpts(values, lv.clock, fx));
    if (Object.keys(patch).length) scheduleVisualBroadcast();
    return true;
  } catch (err) {
    console.warn('Visual params:', err.message);
    return false;
  }
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

  if (!fs.existsSync(mediaPath(media))) {
    advance();
    return;
  }

  isTransitioning = true;
  broadcastState();

  const duration = cue.settings?.duration ?? null;

  loadCue(cue, media)
    .then(() => {
      state.updateState({ currentCueIndex: index });
      clearTransitionLock();

      // Stills and visuals never end by themselves: advance after their duration
      const holds = media.type !== 'video';
      const sec = duration != null && duration > 0 ? Number(duration) : null;
      if (holds && sec) {
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
    if (s.playlistLoop && s.playlist.length === 1 && isCurrentCueVideo(s)) {
      restartCurrentCue();
    } else if (s.playlistLoop && s.playlist.length > 0) {
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

function isCurrentCueVideo(s) {
  const cue = s.playlist[s.currentCueIndex];
  return s.library.find((m) => m.id === cue?.mediaId)?.type === 'video';
}

// A one-cue playlist on loop: rewind the file mpv already has open (held on
// its last frame by keep-open) instead of reloading it, so there is no gap.
function restartCurrentCue() {
  const index = state.getState().currentCueIndex;
  mpv.restart().catch((err) => {
    console.error('mpv restart error:', err);
    playCue(index);
  });
}

function handleFileEnded() {
  if (isTransitioning) return;
  const s = state.getState();
  const cue = s.playlist[s.currentCueIndex];
  if (!cue) return;
  const media = s.library.find((m) => m.id === cue.mediaId);
  if (!media || media.type !== 'video') return;
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

seedBuiltinVisuals();

// Backfill thumbnails for media uploaded before thumbnails existed, one at a time
(async () => {
  for (const item of state.getState().library) {
    if (!item.thumb && !item.builtin) await enrichMedia(item);
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

const remoteUpload = config.remoteUploadPort
  ? createRemoteUpload({
    config,
    allowedExt: ALLOWED_EXT,
    getDiskFree,
    sanitizeFilename,
    addToLibrary: addRemoteUpload,
  })
  : null;
if (remoteUpload) app.use('/api/remote-upload', remoteUpload.controlRouter);
else app.get('/api/remote-upload', (req, res) => res.json({ disabled: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/visuals/thumbs', express.static(path.join(visuals.BUILTIN_DIR, 'thumbs')));
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
      folderId: null,
    };
    const folderId = req.query.folder;
    if (folderId && state.getState().folders.some((f) => f.id === folderId)) item.folderId = folderId;
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

// Deletes media files (and their thumbnails), drops their cues, and keeps playback sane
function removeMedia(ids, extra = {}) {
  const s = state.getState();
  const gone = new Set(ids);
  for (const item of s.library) {
    if (!gone.has(item.id) || item.builtin) continue;
    const filePath = path.join(config.uploadsDir, item.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error('Delete file error:', e);
    }
    removeThumbnail(config.uploadsDir, item);
  }

  const library = s.library.filter((m) => !gone.has(m.id));
  const playlist = s.playlist.filter((c) => !gone.has(c.mediaId));
  const current = s.playlist[s.currentCueIndex];
  const wasPlayingDeleted = current && gone.has(current.mediaId);

  if (wasPlayingDeleted) {
    // Continue with the first surviving cue after the deleted one
    const nextIdx = s.playlist.slice(0, s.currentCueIndex).filter((c) => !gone.has(c.mediaId)).length;
    state.updateState({ ...extra, library, playlist, currentCueIndex: -1 });
    if (nextIdx < playlist.length) {
      playCue(nextIdx);
    } else {
      mpv.stop();
      clearDurationTimer();
    }
  } else {
    const currentCueIndex = current ? playlist.findIndex((c) => c.id === current.id) : -1;
    state.updateState({ ...extra, library, playlist, currentCueIndex });
  }
  broadcastState();
}

app.delete('/api/library/:id', (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const s = state.getState();
  if (!s.library.some((m) => m.id === req.params.id)) return res.status(404).json({ error: 'Not found' });
  removeMedia([req.params.id]);
  res.status(204).send();
});

// Rename and/or move a library item. Only the display name changes; the file on disk,
// its thumbnail and every cue keep pointing at the same id, so nothing breaks.
app.patch('/api/library/:id', (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const s = state.getState();
  const item = s.library.find((m) => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const patch = {};
  if (req.body.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Name required' });
    patch.originalName = name;
  }
  if (req.body.folderId !== undefined) {
    const folderId = req.body.folderId || null;
    if (folderId && !s.folders.some((f) => f.id === folderId)) return res.status(404).json({ error: 'Folder not found' });
    patch.folderId = folderId;
  }
  const updated = { ...item, ...patch };
  state.updateState((st) => ({ ...st, library: st.library.map((m) => (m.id === item.id ? updated : m)) }));
  broadcastState();
  res.json(updated);
});

// --- Library folders (virtual: they only exist in state, files stay flat in uploads/) ---

function cleanName(name) {
  return typeof name === 'string' ? name.replace(/[\x00-\x1f]/g, '').trim().slice(0, 200) : '';
}

// Folder ids of `id` and everything nested below it
function folderSubtree(folders, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

app.post('/api/folders', (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const parentId = req.body.parentId || null;
  const s = state.getState();
  if (parentId && !s.folders.some((f) => f.id === parentId)) return res.status(404).json({ error: 'Parent folder not found' });
  const folder = { id: `f-${uuidv4().slice(0, 8)}`, name, parentId };
  state.updateState((st) => ({ ...st, folders: [...st.folders, folder] }));
  broadcastState();
  res.status(201).json(folder);
});

app.patch('/api/folders/:id', (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const s = state.getState();
  const folder = s.folders.find((f) => f.id === req.params.id);
  if (!folder) return res.status(404).json({ error: 'Not found' });

  const patch = {};
  if (req.body.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Name required' });
    patch.name = name;
  }
  if (req.body.parentId !== undefined) {
    const parentId = req.body.parentId || null;
    if (parentId && !s.folders.some((f) => f.id === parentId)) return res.status(404).json({ error: 'Parent folder not found' });
    if (parentId && folderSubtree(s.folders, folder.id).has(parentId)) {
      return res.status(400).json({ error: "Can't move a folder into itself" });
    }
    patch.parentId = parentId;
  }
  const updated = { ...folder, ...patch };
  state.updateState((st) => ({ ...st, folders: st.folders.map((f) => (f.id === folder.id ? updated : f)) }));
  broadcastState();
  res.json(updated);
});

// Deletes the folder, its subfolders and every file inside (and those files' cues)
app.delete('/api/folders/:id', (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const s = state.getState();
  if (!s.folders.some((f) => f.id === req.params.id)) return res.status(404).json({ error: 'Not found' });
  const subtree = folderSubtree(s.folders, req.params.id);
  const mediaIds = s.library.filter((m) => m.folderId && subtree.has(m.folderId)).map((m) => m.id);
  removeMedia(mediaIds, { folders: s.folders.filter((f) => !subtree.has(f.id)) });
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

// A still of what mpv is actually showing, for the Live monitor's panel inset.
// Shared between clients and taken at most once a second.
const SCREENSHOT_PATH = path.join(require('os').tmpdir(), 'backdrop-panel.jpg');
const SCREENSHOT_MAX_AGE_MS = 900;
let screenshot = { at: 0, pending: null };

function takeScreenshot() {
  if (Date.now() - screenshot.at < SCREENSHOT_MAX_AGE_MS) return Promise.resolve(true);
  if (!screenshot.pending) {
    screenshot.pending = mpv.screenshotToFile(SCREENSHOT_PATH, currentVisual() ? 'window' : 'video')
      .then(() => { screenshot.at = Date.now(); return true; })
      .catch(() => false)
      .finally(() => { screenshot.pending = null; });
  }
  return screenshot.pending;
}

app.get('/api/screenshot', async (req, res) => {
  if (!mpv.connected || !(await takeScreenshot())) return res.status(204).send();
  res.set('Cache-Control', 'no-store');
  res.sendFile(SCREENSHOT_PATH, (err) => {
    if (err && !res.headersSent) res.status(204).send();
  });
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
  const { framing, error } = parseFraming(req.body);
  if (error) return res.status(400).json({ error });
  const { params, error: paramsError } = parseParams(req.body.params);
  if (paramsError) return res.status(400).json({ error: paramsError });
  const cue = { ...s.playlist[idx] };
  const before = cue.settings || {};
  cue.settings = { ...before, ...framing };
  if (params) cue.settings.params = { ...before.params, ...params };
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

  // Only the framing changed: move the picture in place instead of reloading
  const needsReload = ['loop', 'freeze', 'displayMode', 'duration']
    .some((k) => (cue.settings[k] ?? null) !== (before[k] ?? null));
  if (idx === s.currentCueIndex && !needsReload) {
    mpv.setFraming(getCueFraming(cue.settings)).catch(console.error);
    if (params) setLiveVisualParams(cue.id, params);
  } else if (idx === s.currentCueIndex) {
    const media = s.library.find((m) => m.id === cue.mediaId);
    if (media && fs.existsSync(mediaPath(media))) loadCue(cue, media).catch(console.error);
  }
  broadcastState();
  res.json(cue);
});

// Live preview while dragging a clip around: moves the picture on the panel
// without saving. The final position is saved with PUT /api/playlist/:cueId.
app.post('/api/playlist/:cueId/framing', (req, res) => {
  if (!isValidId(req.params.cueId)) return res.status(400).json({ error: 'Invalid cue ID' });
  const s = state.getState();
  const cue = s.playlist.find((c) => c.id === req.params.cueId);
  if (!cue) return res.status(404).json({ error: 'Not found' });
  const { framing, error } = parseFraming(req.body);
  if (error) return res.status(400).json({ error });
  if (s.playlist[s.currentCueIndex]?.id !== cue.id) return res.json({ live: false });
  mpv.setFraming(getCueFraming({ ...cue.settings, ...framing }))
    .then(() => res.json({ live: true }))
    .catch((err) => res.status(502).json({ error: err.message }));
});

// Live preview while moving a visual's slider: changes the panel without
// saving. The final value is saved with PUT /api/playlist/:cueId.
app.post('/api/playlist/:cueId/params', async (req, res) => {
  if (!isValidId(req.params.cueId)) return res.status(400).json({ error: 'Invalid cue ID' });
  const { params, error } = parseParams(req.body.params);
  if (error || !params) return res.status(400).json({ error: error || 'params required' });
  res.json({ live: await setLiveVisualParams(req.params.cueId, params) });
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

// GO: the next cue, or stop / wrap around after the last one
function goNext() {
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
}

// BACK: the previous cue. From the first cue it wraps to the last one when the
// playlist loops (otherwise restarts it); when stopped it goes to the last cue.
function goBack() {
  const s = state.getState();
  if (!s.playlist.length) return;
  const i = s.currentCueIndex;
  if (i > 0) playCue(i - 1);
  else if (i === 0) playCue(s.playlistLoop ? s.playlist.length - 1 : 0);
  else playCue(s.playlist.length - 1);
  broadcastState();
}

app.post('/api/go', (req, res) => {
  goNext();
  res.status(204).send();
});

app.post('/api/back', (req, res) => {
  goBack();
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
  dmxVisualId = null;
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

// Queues a brightness write; resolves once the controller has applied the latest one
function setLedBrightness(value) {
  ledTarget = value;
  if (!ledJob) {
    ledJob = runLedWrites().finally(() => { ledJob = null; });
  }
  return ledJob.catch((err) => {
    ledTarget = null;
    if (err.code) setLed(false, led.brightness); // network error: controller unreachable
    throw err;
  });
}

app.put('/api/led/brightness', async (req, res) => {
  if (!config.novaHost) return res.status(501).json({ error: 'NOVA_HOST not configured' });
  const value = Number(req.body?.brightness);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return res.status(400).json({ error: 'brightness must be an integer 0-100' });
  }
  try {
    await setLedBrightness(value);
    res.json(led);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

if (config.novaHost) {
  // Picks up changes made on the controller itself; skipped while nobody is watching
  setInterval(() => {
    if (wss && wss.clients.size > 0) pollLed();
  }, 10000);
}

// HDMI matrix routing via the ezcoo EZ-MX44HAS2 (see setup/HDMI-MATRIX.md)
let hdmiPolling = false;

function setHdmi(patch) {
  const next = { ...hdmi, ...patch };
  if (JSON.stringify(next) === JSON.stringify(hdmi)) return;
  hdmi = next;
  broadcastState();
}

function hdmiFromStatus({ routes, inputLink }) {
  return {
    available: true,
    current: routes[config.hdmiOutput - 1] ?? hdmi.current,
    sources: hdmi.sources.map((src, i) => ({ ...src, signal: inputLink?.[i] ?? src.signal })),
  };
}

async function pollHdmi() {
  if (!matrix || hdmiPolling) return;
  hdmiPolling = true;
  try {
    setHdmi(hdmiFromStatus(await matrix.status()));
  } catch {
    setHdmi({ available: false });
  } finally {
    hdmiPolling = false;
  }
}

// Picks the source shown on the LED wall (matrix output config.hdmiOutput)
app.put('/api/hdmi/source', async (req, res) => {
  if (!matrix) return res.status(501).json({ error: 'HDMI_HOST not configured' });
  const input = Number(req.body?.input);
  if (!Number.isInteger(input) || input < 1 || input > hdmi.sources.length) {
    return res.status(400).json({ error: `input must be 1-${hdmi.sources.length}` });
  }
  try {
    const routes = await matrix.route(config.hdmiOutput, input);
    setHdmi(hdmiFromStatus({ routes }));
    if (hdmi.current !== input) return res.status(502).json({ error: 'HDMI matrix did not switch' });
    res.json(hdmi);
  } catch (err) {
    setHdmi({ available: false });
    res.status(502).json({ error: err.message });
  }
});

if (matrix) {
  // The matrix never pushes changes (front panel, IR, web UI), so poll while someone is watching
  setInterval(() => {
    if (wss && wss.clients.size > 0) pollHdmi();
  }, 10000);
}

// DMX control over Art-Net (see setup/DMX.md). The universe comes from .env; the channel
// of each function is set in the UI (state.dmxConfig, defaults from .env):
// brightness = LED brightness (0-255 -> 0-100 %), go = next cue, back = previous cue,
// then the visuals fixture (applyDmxFixture).
// GO and BACK fire once when their channel rises past half. Everything else follows
// its fader only once it has moved, so the UI keeps control while the faders rest.
const DMX_ON = 128;
const DMX_TIMEOUT_MS = 3000; // Art-Net senders repeat at least every 4 s, nodes usually ~40x/s
const DMX_UI_MS = 200; // the UI follows the channels at most this often
const DMX_SLOT = 10; // visual select: 10-19 = first visual, 20-29 = second, ...
const DMX_MASK_HOLD_MS = 2000; // strips all at 0 this long = whole wall again
let dmxLastPacket = 0;
let dmxLast = null; // previous frame's values; null primes on the next frame
let dmxUiTimer = null;
let dmxEngaged = new Set(); // functions whose fader moved since the last prime
let dmxMaskDarkSince = null;

function getDmxConfig() {
  const a = config.dmxAddress;
  const saved = state.getState().dmxConfig?.channels ?? {};
  const channels = {};
  // Unsaved functions default to consecutive channels from DMX_ADDRESS
  DMX_FUNCTIONS.forEach((fn, i) => { channels[fn] = saved[fn] ?? Math.min(512, a + i); });
  return { universe: config.dmxUniverse ?? 0, channels, visuals: dmxVisualSlots() };
}

// The visuals the select channel can pick, in slot order: built-ins by file
// name, then uploads oldest first
function dmxVisualList() {
  const all = state.getState().library.filter((m) => m.type === 'visual');
  const builtins = all.filter((m) => m.builtin).sort((x, y) => x.filename.localeCompare(y.filename));
  const uploads = all.filter((m) => !m.builtin).sort((x, y) => String(x.addedAt).localeCompare(String(y.addedAt)));
  return [...builtins, ...uploads].slice(0, Math.floor(256 / DMX_SLOT) - 1);
}

function dmxVisualSlots() {
  return dmxVisualList().map((m, i) => ({ value: (i + 1) * DMX_SLOT, name: m.originalName }));
}

function setDmx(patch) {
  dmx = { ...dmx, ...patch };
  if (dmxUiTimer) return;
  dmxUiTimer = setTimeout(() => {
    dmxUiTimer = null;
    broadcastState();
  }, DMX_UI_MS);
}

// Back to neutral: nothing engaged, the fixture lets visuals show as they are
function resetDmxFixture() {
  dmxEngaged = new Set();
  dmxMaskDarkSince = null;
  fx = { ...visuals.FX_NEUTRAL };
  setLiveVisualParams(null);
}

function handleDmxFrame(universe, data) {
  const { universe: want, channels } = getDmxConfig();
  if (universe !== want) return;
  dmxLastPacket = Date.now();
  const values = {};
  for (const fn of DMX_FUNCTIONS) values[fn] = channels[fn] ? data[channels[fn] - 1] ?? 0 : null;
  const prev = dmxLast;
  dmxLast = values;
  if (!dmx.receiving || DMX_FUNCTIONS.some((fn) => values[fn] !== dmx.values?.[fn])) {
    setDmx({ receiving: true, values });
  }
  // The first frame (after start or a config change) only records where the faders are
  if (!prev) return;
  if (values.brightness !== null && values.brightness !== prev.brightness && config.novaHost) {
    setLedBrightness(Math.round((values.brightness * 100) / 255))
      .catch((err) => console.warn('DMX brightness:', err.message));
  }
  if (values.go >= DMX_ON && !(prev.go >= DMX_ON)) goNext();
  if (values.back >= DMX_ON && !(prev.back >= DMX_ON)) goBack();
  applyDmxFixture(values, prev);
}

// The visuals fixture: select plays a visual; dimmer, colour, strobe and the
// 8 strips are laid over whatever visual is on screen; speed and control move
// that visual's sliders. Nothing here touches clips or stills.
function applyDmxFixture(values, prev) {
  for (const fn of DMX_FIXTURE) {
    if (values[fn] !== null && values[fn] !== prev[fn]) dmxEngaged.add(fn);
  }
  const on = (fn) => dmxEngaged.has(fn) && values[fn] !== null;
  const level = (fn) => values[fn] / 255;

  if (on('visual') && values.visual !== prev.visual) {
    const media = dmxVisualList()[Math.floor(values.visual / DMX_SLOT) - 1];
    const slotChanged = Math.floor(values.visual / DMX_SLOT) !== Math.floor((prev.visual ?? 0) / DMX_SLOT);
    if (media && slotChanged && currentVisual()?.mediaId !== media.id) playDmxVisual(media);
  }

  const next = { ...visuals.FX_NEUTRAL };
  if (on('dimmer')) next.fx_dimmer = level('dimmer');
  if (on('red') || on('green') || on('blue')) {
    next.fx_tint = 1;
    next.fx_r = (values.red ?? 0) / 255;
    next.fx_g = (values.green ?? 0) / 255;
    next.fx_b = (values.blue ?? 0) / 255;
  }
  // 0-9 open, then 1-20 flashes per second
  if (on('strobe') && values.strobe >= 10) next.fx_strobe = Math.round((1 + ((values.strobe - 10) * 19) / 245) * 10) / 10;
  // The strips mask the wall once one is up, and let go only after all have sat
  // at 0 for a while, so a chase passing through dark doesn't flash the whole wall
  const segs = DMX_SEGMENTS.filter(on);
  if (segs.length) {
    const lit = segs.some((fn) => values[fn] > 0);
    if (lit) dmxMaskDarkSince = null;
    else dmxMaskDarkSince ??= Date.now();
    const masking = lit || (fx.fx_mask && Date.now() - dmxMaskDarkSince < DMX_MASK_HOLD_MS);
    if (masking) {
      next.fx_mask = 1;
      DMX_SEGMENTS.forEach((fn, i) => { next[`fx_s${i}`] = on(fn) ? level(fn) : 0; });
    }
  }

  const patch = {};
  const lv = currentVisual();
  const media = lv && state.getState().library.find((m) => m.id === lv.mediaId);
  const param = (name) => media?.params?.find((p) => p.name === name);
  const scaled = (p, fn) => p.min + (p.max - p.min) * level(fn);
  if (on('speed') && values.speed !== prev.speed && param('speed')) patch.speed = scaled(param('speed'), 'speed');
  if (on('control') && values.control !== prev.control && media?.control && param(media.control)) {
    patch[media.control] = scaled(param(media.control), 'control');
  }

  const fxChanged = Object.keys(next).some((k) => next[k] !== fx[k]);
  fx = next;
  if (lv && (fxChanged || Object.keys(patch).length)) setLiveVisualParams(lv.key, patch);
}

if (dmx.configured) {
  listenArtNet({
    onFrame: handleDmxFrame,
    onError: (err) => console.warn('Art-Net:', err.message),
  });
  setInterval(() => {
    if (dmx.receiving && Date.now() - dmxLastPacket > DMX_TIMEOUT_MS) {
      setDmx({ receiving: false, values: null });
      dmxLast = null;
      resetDmxFixture();
    }
  }, 1000);
  const { universe, channels } = getDmxConfig();
  console.log(`DMX: Art-Net universe ${universe}, channels`, JSON.stringify(channels));
}

// Channels 1-512, or 0 for unused
app.put('/api/dmx', (req, res) => {
  if (!dmx.configured) return res.status(501).json({ error: 'DMX is disabled (DMX_UNIVERSE is empty)' });
  const cur = getDmxConfig();
  const channels = { ...cur.channels };
  for (const fn of DMX_FUNCTIONS) {
    const ch = req.body?.channels?.[fn];
    if (ch === undefined) continue;
    if (!Number.isInteger(ch) || ch < 0 || ch > 512) {
      return res.status(400).json({ error: `${fn} channel must be 1-512, or 0 for unused` });
    }
    channels[fn] = ch;
  }
  state.updateState({ dmxConfig: { channels } });
  dmxLast = null;
  resetDmxFixture();
  dmx = { ...dmx, receiving: false, values: null };
  broadcastState();
  res.json(getDmxConfig());
});

const server = app.listen(config.port, () => {
  console.log(`backdrop listening on port ${config.port}`);
});

// Upload-only listener for the QR code (LAN, or a Cloudflare Tunnel); it serves nothing but the upload page
if (remoteUpload) {
  remoteUpload.publicApp.listen(config.remoteUploadPort, config.remoteUploadHost, () => {
    console.log(`phone uploads listening on ${config.remoteUploadHost}:${config.remoteUploadPort}`);
  }).on('error', (err) => console.warn('Phone upload server failed:', err.message));
}

wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    ...state.getState(),
    diskFree: getDiskFree(),
    isTransitioning,
    mpvConnected: mpv.connected,
    led,
    hdmi,
    dmx: { ...dmx, ...getDmxConfig() },
    liveVisual: liveVisualInfo(),
  }));
  pollLed();
  pollHdmi();
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
    args.push('--vo=gpu-next', '--gpu-context=drm', '--hwdec=vaapi', '--fs', '--no-terminal', '--really-quiet');
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
