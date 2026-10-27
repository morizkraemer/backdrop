const API = '/api';
const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${location.host}/ws`;
const MEDIA_MIME = 'application/x-screenview-media';
const CUE_MIME = 'application/x-screenview-cue';

let state = {
  library: [],
  playlist: [],
  currentCueIndex: -1,
  diskFree: 0,
  isTransitioning: false,
  mpvConnected: false,
  playlistLoop: false,
};
let wsConnected = false;
let selectedCueId = null;
let libraryFilter = 'all';
let saveStatus = null; // null | 'saving' | 'saved' | error message

const $ = (id) => document.getElementById(id);
const appEl = $('app');
const playerPill = $('playerPill');
const playerText = $('playerText');
const diskSpace = $('diskSpace');
const connStatus = $('connStatus');
const connText = $('connText');
const monitorNow = $('monitorNow');
const monitorNext = $('monitorNext');
const btnGo = $('btnGo');
const btnStop = $('btnStop');
const btnLoop = $('btnLoop');
const libraryPane = $('libraryPane');
const libraryList = $('libraryList');
const libraryFilters = $('libraryFilters');
const librarySearch = $('librarySearch');
const fileInput = $('fileInput');
const cuesPane = $('cuesPane');
const cueList = $('cueList');
const cueFileInput = $('cueFileInput');
const inspector = $('inspector');
const segDisplay = $('segDisplay');
const segEnd = $('segEnd');
const inspSeconds = $('inspSeconds');
const uploadsEl = $('uploads');

const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
};

const DISPLAY_LABELS = { fill: 'Fill', centered: 'Centered', stretch: 'Stretch' };

// --- helpers ---

function connectWs() {
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (e) => {
    state = { ...state, ...JSON.parse(e.data) };
    if (selectedCueId && !state.playlist.some((c) => c.id === selectedCueId)) selectedCueId = null;
    render();
  };
  ws.onopen = () => {
    wsConnected = true;
    render();
  };
  ws.onclose = () => {
    wsConnected = false;
    render();
    setTimeout(connectWs, 2000);
  };
}

function api(method, path, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return fetch(`${API}${path}`, opts);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function formatBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
  return n + ' B';
}

function formatDuration(sec) {
  if (sec == null) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function getMedia(mediaId) {
  return state.library.find((m) => m.id === mediaId);
}

function thumbSrc(media) {
  if (!media) return null;
  const v = encodeURIComponent(media.addedAt || '');
  if (media.type === 'image') return `/uploads/${encodeURIComponent(media.filename)}?t=${v}`;
  if (media.thumb) return `/uploads/${media.thumb.split('/').map(encodeURIComponent).join('/')}?t=${v}`;
  return null;
}

function thumbHtml(media) {
  const src = thumbSrc(media);
  const img = src
    ? `<img src="${src}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  return `${ICONS.play}${img}`;
}

function mediaMeta(media) {
  if (!media) return 'Missing file';
  const parts = [media.type === 'video' ? 'Video' : 'Image'];
  if (media.type === 'video' && media.duration != null) parts.push(formatDuration(media.duration));
  parts.push(formatBytes(media.size));
  return parts.join(' · ');
}

function endShort(cue, media) {
  const st = cue.settings || {};
  if (media?.type === 'video') return st.loop ? 'Loop' : st.freeze ? 'Freeze' : 'To end';
  return st.duration > 0 ? `${st.duration} s` : 'Hold';
}

function endLong(cue, media) {
  const st = cue.settings || {};
  if (media?.type === 'video') return st.loop ? 'loops until GO' : st.freeze ? 'freezes on the last frame' : 'plays to the end';
  return st.duration > 0 ? `advances after ${st.duration} s` : 'holds until GO';
}

function cueSummary(cue, media) {
  return `${DISPLAY_LABELS[cue.settings?.displayMode ?? 'fill']} · ${endLong(cue, media)}`;
}

function nextCueIndex() {
  const len = state.playlist.length;
  if (!len) return -1;
  const n = state.currentCueIndex + 1;
  if (n < len) return n;
  return state.playlistLoop ? 0 : -1;
}

function isTyping(el) {
  return el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName));
}

// --- render ---

function renderHeader() {
  const online = state.mpvConnected !== false;
  playerPill.classList.toggle('offline', !online);
  playerPill.querySelector('.dot').className = `dot ${online ? 'on' : 'off'}`;
  playerText.textContent = online ? 'LED panel · 2304×768 · player online' : 'Player offline';
  diskSpace.textContent = `${formatBytes(state.diskFree)} free`;
  connStatus.querySelector('.dot').className = `dot ${wsConnected ? 'on' : 'off'}`;
  connText.textContent = wsConnected ? 'Connected' : 'Reconnecting…';
}

// The Live monitor plays the live video itself, muted and kept in step with
// mpv's position, so the preview moves smoothly without streaming the panel.
const PREVIEW_SYNC_MS = 2000;
const PREVIEW_MAX_DRIFT = 0.3; // seconds
const PREVIEW_FIT = { fill: 'cover', centered: 'contain', stretch: 'fill' };
let previewTimer = null;

function previewKey(cue, media) {
  const st = cue.settings || {};
  return `${cue.id}:${media.id}:${!!st.loop}:${st.displayMode ?? 'fill'}`;
}

async function syncPreview(video) {
  if (!video.isConnected) return;
  try {
    const startedAt = performance.now();
    const { position } = await (await api('GET', '/position')).json();
    if (position == null || !video.isConnected) return;
    const target = position + (performance.now() - startedAt) / 2000;
    if (Math.abs(video.currentTime - target) > PREVIEW_MAX_DRIFT) video.currentTime = target;
    if (video.paused) video.play().catch(() => {});
  } catch {
    // Keep playing on our own clock until the next sync
  }
}

function stopPreview() {
  clearInterval(previewTimer);
  previewTimer = null;
}

function renderLivePreview(screen, cue, media) {
  const key = previewKey(cue, media);
  if (screen.dataset.preview === key) return;
  stopPreview();
  screen.dataset.preview = key;
  const poster = thumbSrc(media);
  screen.innerHTML = `<video muted playsinline autoplay preload="auto"${poster ? ` poster="${poster}"` : ''}></video>`;
  const video = screen.querySelector('video');
  video.loop = !!cue.settings?.loop;
  video.style.objectFit = PREVIEW_FIT[cue.settings?.displayMode ?? 'fill'];
  video.src = `/uploads/${encodeURIComponent(media.filename)}`;
  video.addEventListener('loadedmetadata', () => syncPreview(video), { once: true });
  previewTimer = setInterval(() => syncPreview(video), PREVIEW_SYNC_MS);
}

// Small inset with a real snapshot of the panel, refreshed about once a
// second while something is live, so a frozen or black panel shows up even
// though the big preview is a mirror.
const PANEL_SHOT_MS = 1000;
const panelShot = document.createElement('img');
panelShot.className = 'panel-shot';
panelShot.alt = 'Panel output';
panelShot.title = 'Actual panel output (1 fps)';
panelShot.hidden = true;
let panelShotTimer = null;
let panelShotUrl = null;

async function refreshPanelShot() {
  if (document.hidden) return;
  try {
    const res = await fetch(`${API}/screenshot`, { cache: 'no-store' });
    if (res.status !== 200) {
      panelShot.hidden = true;
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    panelShot.onload = () => {
      if (panelShotUrl) URL.revokeObjectURL(panelShotUrl);
      panelShotUrl = url;
      panelShot.hidden = false;
    };
    panelShot.src = url;
  } catch {
    panelShot.hidden = true;
  }
}

function updatePanelShot(screen, live) {
  if (!live) {
    clearInterval(panelShotTimer);
    panelShotTimer = null;
    panelShot.hidden = true;
    return;
  }
  if (panelShot.parentNode !== screen) screen.appendChild(panelShot);
  if (!panelShotTimer) {
    refreshPanelShot();
    panelShotTimer = setInterval(refreshPanelShot, PANEL_SHOT_MS);
  }
}

function renderMonitor(root, index, isNow) {
  const cue = state.playlist[index];
  const media = cue && getMedia(cue.mediaId);
  const screen = root.querySelector('.screen');
  root.querySelector('.cue-num').textContent = cue ? `Q${index + 1}` : '';
  root.querySelector('.monitor-name').textContent = cue
    ? media?.originalName ?? '?'
    : isNow ? (state.isTransitioning ? 'Loading…' : 'Nothing playing') : (state.playlist.length ? 'End of list' : '—');
  root.querySelector('.monitor-meta').textContent = cue ? cueSummary(cue, media) : '';
  if (isNow && cue && media?.type === 'video') {
    renderLivePreview(screen, cue, media);
  } else {
    if (isNow) {
      stopPreview();
      delete screen.dataset.preview;
    }
    screen.innerHTML = cue ? thumbHtml(media) : '';
  }
  if (isNow) updatePanelShot(screen, !!cue);
  if (isNow) {
    root.classList.toggle('playing', !!cue);
    const tag = $('nowTag');
    tag.textContent = cue ? 'LIVE' : 'IDLE';
    tag.className = `tag ${cue ? 'tag-live' : 'tag-idle'}`;
  }
}

function renderTransport() {
  renderMonitor(monitorNow, state.currentCueIndex, true);
  const next = nextCueIndex();
  renderMonitor(monitorNext, next, false);

  const nextCue = state.playlist[next];
  $('goSub').textContent = nextCue ? `to Q${next + 1} · Space` : (state.currentCueIndex >= 0 ? 'ends · Space' : 'Space');
  const nextName = nextCue ? getMedia(nextCue.mediaId)?.originalName ?? '?' : '';
  $('controlsNext').innerHTML = nextCue
    ? `<span>Next: <strong>Q${next + 1}</strong> ${escapeHtml(nextName)}</span>`
    : '<span>Next: end of list</span>';

  btnGo.disabled = state.isTransitioning || !state.playlist.length;
  btnLoop.classList.toggle('active', state.playlistLoop);
  btnLoop.setAttribute('aria-pressed', String(state.playlistLoop));
}

function renderLibrary() {
  const visible = state.library.filter((m) => !m.playlistOnly);
  const counts = {
    all: visible.length,
    image: visible.filter((m) => m.type === 'image').length,
    video: visible.filter((m) => m.type === 'video').length,
  };
  libraryFilters.innerHTML = [['all', 'All'], ['image', 'Images'], ['video', 'Videos']]
    .map(([key, label]) => `<button type="button" class="chip" data-filter="${key}" aria-pressed="${libraryFilter === key}">${label} ${counts[key]}</button>`)
    .join('');
  $('tabLibrary').textContent = `Library · ${counts.all}`;

  const q = librarySearch.value.trim().toLowerCase();
  const items = visible.filter((m) =>
    (libraryFilter === 'all' || m.type === libraryFilter) &&
    (!q || (m.originalName || '').toLowerCase().includes(q))
  );

  if (!items.length) {
    libraryList.innerHTML = `<div class="empty">${visible.length ? 'No matches' : 'Drop images or videos here, or use Upload'}</div>`;
    return;
  }
  libraryList.innerHTML = items.map((m) => `
    <div class="media-item" draggable="true" data-id="${m.id}">
      <div class="thumb">${thumbHtml(m)}</div>
      <div class="media-text">
        <span class="media-name" title="${escapeHtml(m.originalName)}">${escapeHtml(m.originalName)}</span>
        <span class="media-meta">${mediaMeta(m)}</span>
      </div>
      <div class="media-actions">
        <button type="button" class="delete" data-id="${m.id}" aria-label="Delete ${escapeHtml(m.originalName)}">${ICONS.trash}</button>
        <button type="button" class="add" data-id="${m.id}" aria-label="Add ${escapeHtml(m.originalName)} to cues">${ICONS.plus}</button>
      </div>
    </div>
  `).join('');
}

function renderCues() {
  $('cueCount').textContent = state.playlist.length || '';
  $('tabCues').textContent = `Cues · ${state.playlist.length}`;
  const next = nextCueIndex();

  if (!state.playlist.length) {
    cueList.innerHTML = '<div class="empty">No cues yet. Add media from the library.</div>';
    return;
  }
  cueList.innerHTML = state.playlist.map((cue, i) => {
    const media = getMedia(cue.mediaId);
    const live = i === state.currentCueIndex;
    const isNext = i === next && !live;
    const classes = ['cue-row', live && 'live', cue.id === selectedCueId && 'selected'].filter(Boolean).join(' ');
    const tag = live
      ? '<span class="tag tag-live">LIVE</span>'
      : isNext ? '<span class="tag tag-next">NEXT</span>' : '';
    return `
      <div class="${classes}" data-cue-id="${cue.id}" draggable="true">
        <span class="handle">${ICONS.grip}</span>
        <span class="num">Q${i + 1}</span>
        <span class="thumb">${thumbHtml(media)}</span>
        <span class="cue-text">
          <span class="cue-name">${escapeHtml(media?.originalName ?? '?')}</span>
          <span class="cue-summary">${escapeHtml(cueSummary(cue, media))}</span>
        </span>
        ${tag}
        <span class="cue-mode">${DISPLAY_LABELS[cue.settings?.displayMode ?? 'fill']}</span>
        <span class="cue-end">${endShort(cue, media)}</span>
        <button type="button" class="btn-icon more" data-cue-id="${cue.id}" aria-label="Cue settings">${ICONS.more}</button>
      </div>
    `;
  }).join('');
}

function setSegment(seg, value) {
  seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value)));
}

function renderInspector() {
  const idx = state.playlist.findIndex((c) => c.id === selectedCueId);
  const cue = state.playlist[idx];
  $('inspectorEmpty').hidden = !!cue;
  $('inspectorBody').hidden = !cue;
  inspector.classList.toggle('open', !!cue);
  if (!cue) return;

  const media = getMedia(cue.mediaId);
  const st = cue.settings || {};
  const isVideo = media?.type === 'video';
  $('inspCue').textContent = `CUE Q${idx + 1}`;
  $('inspName').textContent = media?.originalName ?? '?';
  $('inspMeta').textContent = mediaMeta(media);
  $('inspScreen').innerHTML = thumbHtml(media);
  setSegment(segDisplay, st.displayMode ?? 'fill');

  const endOptions = isVideo
    ? [['end', 'Next cue'], ['freeze', 'Freeze frame'], ['loop', 'Loop']]
    : [['hold', 'Hold until GO'], ['auto', 'Auto-advance']];
  const endValue = isVideo
    ? (st.loop ? 'loop' : st.freeze ? 'freeze' : 'end')
    : (st.duration > 0 ? 'auto' : 'hold');
  if (segEnd.dataset.kind !== (isVideo ? 'video' : 'image')) {
    segEnd.dataset.kind = isVideo ? 'video' : 'image';
    segEnd.className = `segmented ${isVideo ? 'seg-3' : 'seg-2'}`;
    segEnd.innerHTML = endOptions.map(([v, l]) => `<button type="button" role="radio" data-value="${v}">${l}</button>`).join('');
  }
  setSegment(segEnd, endValue);
  $('secondsRow').hidden = endValue !== 'auto';
  if (document.activeElement !== inspSeconds) inspSeconds.value = st.duration > 0 ? st.duration : '';

  const saved = $('inspSaved');
  saved.classList.toggle('error', !!saveStatus && !['saving', 'saved'].includes(saveStatus));
  saved.textContent = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'saved' ? 'Saved'
    : saveStatus || 'Changes save automatically';
}

function render() {
  renderHeader();
  renderLed();
  renderHdmi();
  renderTransport();
  renderLibrary();
  renderCues();
  renderInspector();
}

// --- actions ---

function selectCue(cueId) {
  if (selectedCueId !== cueId) saveStatus = null;
  selectedCueId = cueId;
  render();
}

function updateCue(patch) {
  const cue = state.playlist.find((c) => c.id === selectedCueId);
  if (!cue) return;
  const cueId = cue.id;
  state = {
    ...state,
    playlist: state.playlist.map((c) => (c.id === cueId ? { ...c, settings: { ...c.settings, ...patch } } : c)),
  };
  saveStatus = 'saving';
  render();
  api('PUT', `/playlist/${cueId}`, patch)
    .then(async (r) => {
      if (selectedCueId !== cueId) return;
      if (r.ok) {
        saveStatus = 'saved';
      } else {
        const body = await r.json().catch(() => ({}));
        saveStatus = body.error || 'Could not save';
      }
      render();
    })
    .catch(() => {
      saveStatus = 'Could not save (offline)';
      render();
    });
}

function addToCues(mediaId) {
  api('POST', '/playlist', { mediaId });
}

function reorderCue(fromId, toId, after) {
  if (fromId === toId) return;
  const ids = state.playlist.map((c) => c.id).filter((id) => id !== fromId);
  let to = ids.indexOf(toId);
  if (to === -1) return;
  if (after) to += 1;
  ids.splice(to, 0, fromId);
  api('PUT', '/playlist/reorder', ids);
}

function uploadFiles(files, url) {
  for (const file of files) {
    const el = document.createElement('div');
    el.className = 'upload';
    el.innerHTML = `
      <div class="upload-top"><span class="upload-name">${escapeHtml(file.name)}</span><span class="upload-pct">0%</span></div>
      <div class="upload-bar"><div></div></div>`;
    uploadsEl.appendChild(el);
    const pct = el.querySelector('.upload-pct');
    const bar = el.querySelector('.upload-bar div');

    const fail = (msg) => {
      el.classList.add('error');
      pct.textContent = msg;
      el.querySelector('.upload-bar').remove();
      const actions = document.createElement('div');
      actions.className = 'upload-top';
      actions.innerHTML = '<button type="button" class="retry">Retry</button><button type="button" class="dismiss">Dismiss</button>';
      el.appendChild(actions);
      actions.querySelector('.retry').onclick = () => { el.remove(); uploadFiles([file], url); };
      actions.querySelector('.dismiss').onclick = () => el.remove();
    };

    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', file);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      pct.textContent = `${p}%`;
      bar.style.width = `${p}%`;
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        el.remove();
        return;
      }
      let err = 'Upload failed';
      try { err = JSON.parse(xhr.responseText).error || err; } catch (_) {}
      fail(err);
    };
    xhr.onerror = () => fail('Network error');
    xhr.open('POST', `${API}${url}`);
    xhr.send(fd);
  }
}

// --- events: transport ---

btnGo.addEventListener('click', () => api('POST', '/go'));
btnStop.addEventListener('click', () => api('POST', '/stop'));
btnLoop.addEventListener('click', () => {
  const next = !state.playlistLoop;
  state = { ...state, playlistLoop: next };
  render();
  api('PUT', '/settings', { playlistLoop: next })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      state = { ...state, ...data };
      render();
    })
    .catch(() => {
      state = { ...state, playlistLoop: !next };
      render();
    });
});

document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !isTyping(e.target) && !e.repeat) {
    e.preventDefault();
    if (!btnGo.disabled) btnGo.click();
  } else if (e.key === 'Escape' && selectedCueId) {
    selectCue(null);
  }
});

// --- events: tabs (narrow screens) ---

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => { appEl.dataset.tab = tab.dataset.tab; });
});

// --- events: library ---

$('btnUpload').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) uploadFiles(fileInput.files, '/upload');
  fileInput.value = '';
});
librarySearch.addEventListener('input', renderLibrary);
libraryFilters.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  libraryFilter = chip.dataset.filter;
  renderLibrary();
});

libraryList.addEventListener('click', (e) => {
  const add = e.target.closest('.add');
  const del = e.target.closest('.delete');
  if (add) addToCues(add.dataset.id);
  if (del) {
    const name = getMedia(del.dataset.id)?.originalName ?? 'this file';
    const used = state.playlist.some((c) => c.mediaId === del.dataset.id);
    if (confirm(`Delete ${name}?${used ? ' It will also be removed from the cue list.' : ''}`)) {
      api('DELETE', `/library/${del.dataset.id}`);
    }
  }
});
libraryList.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.media-item');
  if (item && !e.target.closest('button')) addToCues(item.dataset.id);
});
libraryList.addEventListener('dragstart', (e) => {
  const item = e.target.closest('.media-item');
  if (!item) return;
  e.dataTransfer.setData(MEDIA_MIME, item.dataset.id);
  e.dataTransfer.effectAllowed = 'copy';
});

function hasType(e, type) {
  return Array.from(e.dataTransfer.types).includes(type);
}

libraryPane.addEventListener('dragover', (e) => {
  if (!hasType(e, 'Files')) return;
  e.preventDefault();
  libraryPane.classList.add('dragover');
});
libraryPane.addEventListener('dragleave', (e) => {
  if (!libraryPane.contains(e.relatedTarget)) libraryPane.classList.remove('dragover');
});
libraryPane.addEventListener('drop', (e) => {
  if (!hasType(e, 'Files')) return;
  e.preventDefault();
  libraryPane.classList.remove('dragover');
  uploadFiles(e.dataTransfer.files, '/upload');
});

// --- events: cues ---

$('btnAddCueFile').addEventListener('click', () => cueFileInput.click());
cueFileInput.addEventListener('change', () => {
  if (cueFileInput.files.length) uploadFiles(cueFileInput.files, '/playlist/upload');
  cueFileInput.value = '';
});

// Double-click plays the cue. Detected from click events because the first
// click re-renders the list, so the browser never sees two clicks on the
// same row element and never fires dblclick.
const DOUBLE_CLICK_MS = 400;
let lastCueClick = { id: null, at: 0 };

cueList.addEventListener('click', (e) => {
  const row = e.target.closest('.cue-row');
  if (!row) return;
  const cueId = row.dataset.cueId;
  const isDouble = !e.target.closest('button')
    && lastCueClick.id === cueId
    && e.timeStamp - lastCueClick.at < DOUBLE_CLICK_MS;
  lastCueClick = isDouble ? { id: null, at: 0 } : { id: cueId, at: e.timeStamp };
  selectCue(cueId);
  if (isDouble) api('POST', `/go/${cueId}`);
});

let draggingCueId = null;

function clearDropMarks() {
  cueList.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
}

cueList.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.cue-row');
  if (!row) return;
  draggingCueId = row.dataset.cueId;
  e.dataTransfer.setData(CUE_MIME, draggingCueId);
  e.dataTransfer.effectAllowed = 'move';
  row.classList.add('dragging');
});
cueList.addEventListener('dragend', () => {
  draggingCueId = null;
  clearDropMarks();
  cueList.querySelectorAll('.dragging').forEach((r) => r.classList.remove('dragging'));
});

cuesPane.addEventListener('dragover', (e) => {
  const isCue = hasType(e, CUE_MIME);
  if (!isCue && !hasType(e, MEDIA_MIME) && !hasType(e, 'Files')) return;
  e.preventDefault();
  if (!isCue) {
    cuesPane.classList.add('dragover');
    return;
  }
  clearDropMarks();
  const row = e.target.closest('.cue-row');
  if (row && row.dataset.cueId !== draggingCueId) {
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
  }
});
cuesPane.addEventListener('dragleave', (e) => {
  if (!cuesPane.contains(e.relatedTarget)) {
    cuesPane.classList.remove('dragover');
    clearDropMarks();
  }
});
cuesPane.addEventListener('drop', (e) => {
  e.preventDefault();
  cuesPane.classList.remove('dragover');
  const cueId = e.dataTransfer.getData(CUE_MIME);
  const mediaId = e.dataTransfer.getData(MEDIA_MIME);
  if (cueId) {
    const row = e.target.closest('.cue-row');
    if (row) {
      const r = row.getBoundingClientRect();
      reorderCue(cueId, row.dataset.cueId, e.clientY > r.top + r.height / 2);
    }
  } else if (mediaId) {
    addToCues(mediaId);
  } else if (e.dataTransfer.files.length) {
    uploadFiles(e.dataTransfer.files, '/playlist/upload');
  }
  clearDropMarks();
});

// --- events: inspector ---

segDisplay.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (b) updateCue({ displayMode: b.dataset.value });
});
segEnd.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  const v = b.dataset.value;
  if (['end', 'freeze', 'loop'].includes(v)) updateCue({ loop: v === 'loop', freeze: v === 'freeze' });
  else if (v === 'hold') updateCue({ duration: null });
  else updateCue({ duration: Number(inspSeconds.value) > 0 ? Number(inspSeconds.value) : 10 });
});
inspSeconds.addEventListener('change', () => {
  const n = Number(inspSeconds.value);
  if (n > 0) updateCue({ duration: n });
  else render();
});
$('inspPlay').addEventListener('click', () => {
  if (selectedCueId) api('POST', `/go/${selectedCueId}`);
});
$('inspRemove').addEventListener('click', () => {
  if (!selectedCueId) return;
  const id = selectedCueId;
  selectCue(null);
  api('DELETE', `/playlist/${id}`);
});
$('inspClose').addEventListener('click', () => selectCue(null));

// --- Bluetooth pairing (only shown when the server has BT_HOST configured) ---

const btnBluetooth = $('btnBluetooth');
let btDiscoverable = false;

function renderBluetooth(available) {
  btnBluetooth.hidden = !available;
  btnBluetooth.classList.toggle('active', btDiscoverable);
  btnBluetooth.setAttribute('aria-pressed', String(btDiscoverable));
  $('btText').textContent = btDiscoverable ? 'BT pairing on' : 'BT pairing';
}

api('GET', '/bluetooth/status')
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (!data) return;
    btDiscoverable = !!data.discoverable;
    renderBluetooth(!!data.available);
  })
  .catch(() => {});

btnBluetooth.addEventListener('click', () => {
  api('POST', '/bluetooth/pairing', { enabled: !btDiscoverable })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data) btDiscoverable = !!data.discoverable;
      renderBluetooth(true);
    })
    .catch(() => {});
});

// --- LED panel brightness (NovaStar controller, proxied by the server) ---

const ledEl = $('led');
const btnLed = $('btnLed');
const ledPopover = $('ledPopover');
const ledSlider = $('ledSlider');
let ledDragging = false;
let ledPending = null; // value sent but not yet confirmed
let ledError = null;
let ledSendTimer = null;

function renderLed() {
  const led = state.led || {};
  ledEl.hidden = !led.configured;
  const online = !!led.available;
  const shown = ledDragging || ledPending !== null ? Number(ledSlider.value) : led.brightness;
  btnLed.classList.toggle('offline', !online);
  $('ledText').textContent = online && shown != null ? `${shown}%` : 'LED offline';
  $('ledValue').textContent = shown != null ? `${shown}%` : '—';
  if (!ledDragging && ledPending === null && led.brightness != null) ledSlider.value = led.brightness;
  ledSlider.disabled = !online;
  $('ledPresets').querySelectorAll('button').forEach((b) => {
    b.disabled = !online;
    b.classList.toggle('active', Number(b.dataset.value) === shown);
  });
  const status = $('ledStatus');
  status.classList.toggle('error', !!ledError || !online);
  status.textContent = !online ? 'Controller unreachable'
    : ledError ? ledError
    : ledPending !== null ? 'Applying…'
    : '';
}

function sendLed(value) {
  ledPending = value;
  ledError = null;
  renderLed();
  api('PUT', '/led/brightness', { brightness: value })
    .then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not set brightness');
    })
    .catch((err) => { ledError = err.message; })
    .finally(() => {
      if (ledPending === value) ledPending = null;
      renderLed();
    });
}

function setLedOpen(open) {
  ledPopover.hidden = !open;
  btnLed.setAttribute('aria-expanded', String(open));
  if (open) renderLed();
}

btnLed.addEventListener('click', () => setLedOpen(ledPopover.hidden));
document.addEventListener('click', (e) => {
  if (!ledPopover.hidden && !ledEl.contains(e.target)) setLedOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ledPopover.hidden) setLedOpen(false);
});

// Sends while dragging (throttled) so the panel follows the slider
ledSlider.addEventListener('input', () => {
  ledDragging = true;
  renderLed();
  if (!ledSendTimer) {
    ledSendTimer = setTimeout(() => {
      ledSendTimer = null;
      if (ledDragging) sendLed(Number(ledSlider.value));
    }, 250);
  }
});
ledSlider.addEventListener('change', () => {
  ledDragging = false;
  clearTimeout(ledSendTimer);
  ledSendTimer = null;
  sendLed(Number(ledSlider.value));
});
$('ledPresets').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  ledSlider.value = b.dataset.value;
  sendLed(Number(b.dataset.value));
});

// --- LED wall source (HDMI matrix output, proxied by the server) ---

const hdmiEl = $('hdmi');
const btnHdmi = $('btnHdmi');
const hdmiPopover = $('hdmiPopover');
const hdmiSources = $('hdmiSources');
let hdmiPending = null; // input sent but not yet confirmed
let hdmiError = null;

function renderHdmi() {
  const h = state.hdmi || {};
  hdmiEl.hidden = !h.configured;
  if (!h.configured) return;
  const online = !!h.available;
  const sources = h.sources || [];
  const current = sources[h.current - 1];
  btnHdmi.classList.toggle('offline', !online);
  // Input 1 is backdrop itself; anything else means the wall isn't showing the cues
  btnHdmi.classList.toggle('external', online && h.current > 1);
  $('hdmiText').textContent = !online ? 'Source offline' : current ? current.name : '—';

  const status = $('hdmiStatus');
  status.classList.toggle('error', !!hdmiError || !online);
  status.textContent = !online ? 'HDMI matrix unreachable'
    : hdmiError ? hdmiError
    : hdmiPending ? 'Switching…'
    : '';

  hdmiSources.innerHTML = sources.map((src, i) => {
    const input = i + 1;
    const active = h.current === input;
    const signal = src.signal == null ? ''
      : `<span class="sig${src.signal ? ' on' : ''}"></span><span class="hdmi-signal">${src.signal ? 'Signal' : 'No signal'}</span>`;
    return `<button type="button" role="radio" aria-checked="${active}" data-input="${input}" class="${active ? 'active' : ''}${hdmiPending === input ? ' pending' : ''}" ${online ? '' : 'disabled'}>
      <span class="hdmi-name">${escapeHtml(src.name)}</span>${signal}
    </button>`;
  }).join('');
}

function sendHdmiSource(input) {
  hdmiPending = input;
  hdmiError = null;
  renderHdmi();
  api('PUT', '/hdmi/source', { input })
    .then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not switch');
    })
    .catch((err) => { hdmiError = err.message; })
    .finally(() => {
      if (hdmiPending === input) hdmiPending = null;
      renderHdmi();
    });
}

function setHdmiOpen(open) {
  hdmiPopover.hidden = !open;
  btnHdmi.setAttribute('aria-expanded', String(open));
  if (open) renderHdmi();
}

btnHdmi.addEventListener('click', () => setHdmiOpen(hdmiPopover.hidden));
document.addEventListener('click', (e) => {
  // composedPath: the clicked button may already be replaced by a re-render
  if (!hdmiPopover.hidden && !e.composedPath().includes(hdmiEl)) setHdmiOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !hdmiPopover.hidden) setHdmiOpen(false);
});
hdmiSources.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-input]');
  if (b && !b.disabled) sendHdmiSource(Number(b.dataset.input));
});

connectWs();
render();
