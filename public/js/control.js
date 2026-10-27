const API = '/api';
const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${location.host}/ws`;
const MEDIA_MIME = 'application/x-screenview-media';
const CUE_MIME = 'application/x-screenview-cue';
const FOLDER_MIME = 'application/x-screenview-folder';

let state = {
  library: [],
  folders: [],
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
let currentFolderId = null;
try { currentFolderId = localStorage.getItem('libraryFolder') || null; } catch (_) {}
let renaming = null; // { kind: 'media' | 'folder', id } while a name is being edited
let menuTarget = null; // { kind, id } the open row menu belongs to
let libDrag = null; // { kind, id } while a library row is being dragged
let saveStatus = null; // null | 'saving' | 'saved' | error message

const $ = (id) => document.getElementById(id);
const appEl = $('app');
const playerPill = $('playerPill');
const playerText = $('playerText');
const diskSpace = $('diskSpace');
const connStatus = $('connStatus');
const connText = $('connText');
const monitorNow = $('monitorNow');
const btnGo = $('btnGo');
const btnStop = $('btnStop');
const btnBack = $('btnBack');
const btnLoop = $('btnLoop');
const libraryPane = $('libraryPane');
const libraryList = $('libraryList');
const libraryFilters = $('libraryFilters');
const librarySearch = $('librarySearch');
const libraryCrumbs = $('libraryCrumbs');
const libraryMenu = $('libraryMenu');
const fileInput = $('fileInput');
const cuesPane = $('cuesPane');
const cueList = $('cueList');
const cueFileInput = $('cueFileInput');
const inspector = $('inspector');
const segDisplay = $('segDisplay');
const segEnd = $('segEnd');
const inspSeconds = $('inspSeconds');
const inspScreen = $('inspScreen');
const inspScale = $('inspScale');
const uploadsEl = $('uploads');

const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
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

// Skips the rebuild when nothing changed, so state pushes (LED, HDMI, other
// clients) don't re-create every row and its thumbnail
const lastHtml = new WeakMap();
function setHtml(el, html) {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
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

// Small server-made thumbnail for list rows. Images fall back to the original
// until the thumbnail exists, which is heavy: photos can be 20+ megapixels.
function thumbSrc(media) {
  if (!media) return null;
  const v = encodeURIComponent(media.addedAt || '');
  if (media.thumb) return `/uploads/${media.thumb.split('/').map(encodeURIComponent).join('/')}?t=${v}`;
  if (media.type === 'image') return `/uploads/${encodeURIComponent(media.filename)}?t=${v}`;
  return null;
}

// Full picture for the big screens (live monitor, inspector), so they stay sharp
function pictureSrc(media) {
  if (media?.type !== 'image') return thumbSrc(media);
  return `/uploads/${encodeURIComponent(media.filename)}?t=${encodeURIComponent(media.addedAt || '')}`;
}

function thumbHtml(media, src = thumbSrc(media)) {
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

// --- framing: moving and resizing a centered clip on the panel ---
// Offsets use mpv's video-pan units (a fraction of the scaled picture's size),
// so a drag maps 1:1 to what mpv does on the panel.
const PANEL_ASPECT = 3; // 2304x768
const mediaAspects = new Map(); // media id -> width / height
let dragFraming = null; // { cueId, offsetX, offsetY, scale } while dragging

function rememberAspect(mediaId, w, h) {
  if (w > 0 && h > 0) mediaAspects.set(mediaId, w / h);
}

function cueFraming(settings = {}) {
  return { offsetX: settings.offsetX ?? 0, offsetY: settings.offsetY ?? 0, scale: settings.scale ?? 1 };
}

function liveFraming(cue) {
  return dragFraming?.cueId === cue.id ? { ...cue.settings, ...dragFraming } : cue.settings;
}

// Size of the contained picture as a fraction of the 3:1 screen box
function fitFraction(mediaId) {
  const aspect = mediaAspects.get(mediaId);
  if (!aspect) return null;
  return { w: Math.min(1, aspect / PANEL_ASPECT), h: Math.min(1, PANEL_ASPECT / aspect) };
}

// Positions a contained <img>/<video> filling a .screen box the way mpv draws it
function applyFraming(el, settings = {}, mediaId) {
  const fit = fitFraction(mediaId);
  if ((settings.displayMode ?? 'fill') !== 'centered' || !fit) {
    el.style.transform = '';
    return;
  }
  const { offsetX, offsetY, scale } = cueFraming(settings);
  const tx = offsetX * fit.w * scale * 100;
  const ty = offsetY * fit.h * scale * 100;
  el.style.transform = `translate(${tx}%, ${ty}%) scale(${scale})`;
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
  video.addEventListener('loadedmetadata', () => {
    rememberAspect(media.id, video.videoWidth, video.videoHeight);
    applyFraming(video, cue.settings, media.id);
    syncPreview(video);
  }, { once: true });
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
  if (isNow && previewCollapsed()) {
    // Phones keep the live preview behind a tap, so don't stream video nobody sees
    stopPreview();
    delete screen.dataset.preview;
    delete screen.dataset.shown;
    screen.innerHTML = '';
    updatePanelShot(screen, false);
  } else if (isNow && cue && media?.type === 'video') {
    renderLivePreview(screen, cue, media);
    delete screen.dataset.shown;
    screen.classList.toggle('letterbox', cue.settings?.displayMode !== 'fill');
    const video = screen.querySelector('video');
    if (video) applyFraming(video, liveFraming(cue), media.id);
  } else {
    if (isNow) {
      stopPreview();
      delete screen.dataset.preview;
    }
    // Rebuild only when the picture changes, so dragging a live image doesn't flicker
    const key = cue ? `${cue.id}:${pictureSrc(media)}` : '';
    if (screen.dataset.shown !== key || !cue) {
      screen.dataset.shown = key;
      screen.innerHTML = cue ? thumbHtml(media, pictureSrc(media)) : '';
    }
    const img = isNow && media?.type === 'image' && screen.querySelector('img:not(.panel-shot)');
    screen.classList.toggle('letterbox', !!img && cue.settings?.displayMode !== 'fill');
    if (img) {
      img.style.objectFit = PREVIEW_FIT[cue.settings?.displayMode ?? 'fill'];
      const place = () => {
        rememberAspect(media.id, img.naturalWidth, img.naturalHeight);
        applyFraming(img, liveFraming(cue), media.id);
      };
      if (img.complete) place();
      else img.addEventListener('load', place, { once: true });
    }
  }
  if (isNow && !previewCollapsed()) updatePanelShot(screen, !!cue);
  if (isNow) {
    root.classList.toggle('playing', !!cue);
    const tag = $('nowTag');
    tag.textContent = cue ? 'LIVE' : 'IDLE';
    tag.className = `tag ${cue ? 'tag-live' : 'tag-idle'}`;
  }
}

// --- live preview on phones: hidden until tapped, then shown in a popup ---

const phoneLayout = window.matchMedia('(max-width: 900px)');
const btnPreview = $('btnPreview');
const previewBackdrop = $('previewBackdrop');

function previewCollapsed() {
  return phoneLayout.matches && !monitorNow.classList.contains('preview-open');
}

function setPreviewOpen(open) {
  monitorNow.classList.toggle('preview-open', open);
  previewBackdrop.hidden = !open;
  btnPreview.setAttribute('aria-expanded', String(open));
  renderTransport();
}

btnPreview.addEventListener('click', () => setPreviewOpen(true));
previewBackdrop.addEventListener('click', () => setPreviewOpen(false));
$('nowScreen').addEventListener('click', () => {
  if (phoneLayout.matches) setPreviewOpen(false);
});
phoneLayout.addEventListener('change', () => setPreviewOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && monitorNow.classList.contains('preview-open')) setPreviewOpen(false);
});

function renderTransport() {
  renderMonitor(monitorNow, state.currentCueIndex, true);
  const next = nextCueIndex();

  const nextCue = state.playlist[next];
  $('goSub').textContent = nextCue ? `to Q${next + 1} · Space` : (state.currentCueIndex >= 0 ? 'ends · Space' : 'Space');
  const nextName = nextCue ? getMedia(nextCue.mediaId)?.originalName ?? '?' : '';
  $('controlsNext').innerHTML = nextCue
    ? `<span>Next: <strong>Q${next + 1}</strong> ${escapeHtml(nextName)}</span>`
    : '<span>Next: end of list</span>';

  btnGo.disabled = state.isTransitioning || !state.playlist.length;
  btnBack.disabled = state.isTransitioning || !state.playlist.length;
  btnLoop.classList.toggle('active', state.playlistLoop);
  btnLoop.setAttribute('aria-pressed', String(state.playlistLoop));
}

// --- library folders ---

function getFolder(id) {
  return state.folders.find((f) => f.id === id);
}

function libraryItems() {
  return state.library.filter((m) => !m.playlistOnly);
}

// Root-first list of folders leading to `id`
function folderPath(id) {
  const path = [];
  const seen = new Set();
  let f = getFolder(id);
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    path.unshift(f);
    f = getFolder(f.parentId);
  }
  return path;
}

function folderLabel(id) {
  return id ? folderPath(id).map((f) => f.name).join(' / ') : 'Library';
}

function isInside(folderId, ancestorId) {
  return folderPath(folderId).some((f) => f.id === ancestorId);
}

function folderCount(id) {
  const n = state.folders.filter((f) => f.parentId === id).length
    + libraryItems().filter((m) => (m.folderId || null) === id).length;
  return n === 1 ? '1 item' : `${n} items`;
}

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function openFolder(id) {
  currentFolderId = id || null;
  try { localStorage.setItem('libraryFolder', currentFolderId || ''); } catch (_) {}
  closeMenu();
  renderLibrary();
  libraryList.scrollTop = 0;
}

function nameHtml(kind, id, name) {
  if (renaming?.kind === kind && renaming.id === id) {
    return `<input class="rename" value="${escapeHtml(name)}" aria-label="New name" spellcheck="false">`;
  }
  return `<span class="media-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
}

function folderRowHtml(f, showPath) {
  return `
    <div class="media-item folder-item" draggable="${renaming ? 'false' : 'true'}" data-folder-id="${f.id}">
      <div class="thumb folder-thumb">${ICONS.folder}</div>
      <div class="media-text">
        ${nameHtml('folder', f.id, f.name)}
        <span class="media-meta">${showPath && f.parentId ? `${escapeHtml(folderLabel(f.parentId))} · ` : ''}${folderCount(f.id)}</span>
      </div>
      <div class="media-actions">
        <button type="button" class="menu-btn" data-kind="folder" data-id="${f.id}" aria-label="More for ${escapeHtml(f.name)}" aria-haspopup="menu">${ICONS.more}</button>
      </div>
    </div>`;
}

function mediaRowHtml(m, showPath) {
  return `
    <div class="media-item" draggable="${renaming ? 'false' : 'true'}" data-id="${m.id}">
      <div class="thumb">${thumbHtml(m)}</div>
      <div class="media-text">
        ${nameHtml('media', m.id, m.originalName)}
        <span class="media-meta">${showPath && m.folderId ? `${escapeHtml(folderLabel(m.folderId))} · ` : ''}${mediaMeta(m)}</span>
      </div>
      <div class="media-actions">
        <button type="button" class="menu-btn" data-kind="media" data-id="${m.id}" aria-label="More for ${escapeHtml(m.originalName)}" aria-haspopup="menu">${ICONS.more}</button>
        <button type="button" class="add" data-id="${m.id}" aria-label="Add ${escapeHtml(m.originalName)} to cues">${ICONS.plus}</button>
      </div>
    </div>`;
}

function renderLibrary() {
  // Don't rebuild under someone typing a new name
  if (renaming && libraryList.contains(document.activeElement)) return;

  if (currentFolderId && !getFolder(currentFolderId)) currentFolderId = null;
  const visible = libraryItems();
  const counts = {
    all: visible.length,
    image: visible.filter((m) => m.type === 'image').length,
    video: visible.filter((m) => m.type === 'video').length,
  };
  setHtml(libraryFilters, [['all', 'All'], ['image', 'Images'], ['video', 'Videos']]
    .map(([key, label]) => `<button type="button" class="chip" data-filter="${key}" aria-pressed="${libraryFilter === key}">${label} ${counts[key]}</button>`)
    .join(''));
  $('tabLibrary').textContent = `Library · ${counts.all}`;

  const q = librarySearch.value.trim().toLowerCase();
  const crumbs = [{ id: '', name: 'Library' }, ...folderPath(currentFolderId)];
  setHtml(libraryCrumbs, q
    ? '<span class="crumb-note">Searching all folders</span>'
    : `<button type="button" class="crumb crumb-back" data-folder-id="${crumbs.length > 1 ? crumbs[crumbs.length - 2].id : ''}" aria-label="Back" title="Back" ${crumbs.length > 1 ? '' : 'disabled'}>${ICONS.chevron}</button>`
      + crumbs.map((c, i) => (i === crumbs.length - 1
      ? `<span class="crumb current" data-folder-id="${c.id}" aria-current="page">${escapeHtml(c.name)}</span>`
      : `<button type="button" class="crumb" data-folder-id="${c.id}">${escapeHtml(c.name)}</button>${ICONS.chevron}`)).join(''));

  const typeOk = (m) => libraryFilter === 'all' || m.type === libraryFilter;
  let folders;
  let items;
  if (q) {
    // Search looks through every folder and shows where each hit lives
    folders = state.folders.filter((f) => f.name.toLowerCase().includes(q));
    items = visible.filter((m) => typeOk(m) && (m.originalName || '').toLowerCase().includes(q));
  } else {
    folders = state.folders.filter((f) => (f.parentId || null) === currentFolderId);
    items = visible.filter((m) => typeOk(m) && (m.folderId || null) === currentFolderId);
  }
  folders.sort((a, b) => byName(a.name, b.name));

  if (!folders.length && !items.length) {
    let msg = 'Drop images or videos here, or use Upload';
    if (q) msg = 'No matches';
    else if (currentFolderId) msg = 'Empty folder. Drop files here to upload into it.';
    else if (visible.length) msg = 'No matches';
    setHtml(libraryList, `<div class="empty">${msg}</div>`);
  } else {
    setHtml(libraryList, folders.map((f) => folderRowHtml(f, !!q)).join('')
      + items.map((m) => mediaRowHtml(m, !!q)).join(''));
  }

  const input = libraryList.querySelector('input.rename');
  if (input) {
    input.focus();
    // Select the name without its extension, like a file manager
    const dot = renaming.kind === 'media' ? input.value.lastIndexOf('.') : -1;
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }
}

function renderCues() {
  $('cueCount').textContent = state.playlist.length || '';
  $('tabCues').textContent = `Cues · ${state.playlist.length}`;
  const next = nextCueIndex();

  if (!state.playlist.length) {
    setHtml(cueList, '<div class="empty">No cues yet. Add media from the library.</div>');
    return;
  }
  setHtml(cueList, state.playlist.map((cue, i) => {
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
  }).join(''));
}

function setSegment(seg, value) {
  seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value)));
}

// The inspector screen shows the cue as the panel will; for centered cues it
// is also the drag surface for moving the picture.
function renderStage(cue, media) {
  const screen = inspScreen;
  const mode = cue.settings?.displayMode ?? 'fill';
  const src = pictureSrc(media);
  const key = `${media?.id}:${src}`;
  if (screen.dataset.media !== key) {
    screen.dataset.media = key;
    screen.innerHTML = src
      ? `<img src="${src}" alt="" draggable="false">`
      : media?.type === 'video'
        ? `<video muted playsinline preload="metadata" src="/uploads/${encodeURIComponent(media.filename)}#t=0.5"></video>`
        : ICONS.play;
    const el = screen.querySelector('img, video');
    if (el) {
      const onSize = () => {
        rememberAspect(media.id, el.naturalWidth || el.videoWidth, el.naturalHeight || el.videoHeight);
        renderInspector();
        renderTransport();
      };
      el.addEventListener(el.tagName === 'IMG' ? 'load' : 'loadedmetadata', onSize, { once: true });
      el.addEventListener('error', () => el.remove(), { once: true });
    }
  }
  const el = screen.querySelector('img, video');
  const centered = mode === 'centered';
  screen.classList.toggle('stage', centered);
  if (el) {
    el.style.objectFit = PREVIEW_FIT[mode];
    applyFraming(el, liveFraming(cue), media?.id);
  }

  $('framingField').hidden = !centered;
  if (centered) {
    const { scale } = cueFraming(liveFraming(cue));
    if (document.activeElement !== inspScale) inspScale.value = Math.round(scale * 100);
    $('inspScaleValue').textContent = `${Math.round(scale * 100)}%`;
  }
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
  renderStage(cue, media);
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
  renderDmx();
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
  api('POST', '/playlist', { mediaId })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((cue) => {
      // On phones the cue list is on the other tab, so say where it went
      const n = state.playlist.findIndex((c) => c.id === cue.id) + 1 || state.playlist.length + 1;
      toast(`Added to cues as Q${n}`);
    })
    .catch(() => toast('Could not add to cues'));
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'upload toast';
  el.textContent = msg;
  uploadsEl.appendChild(el);
  setTimeout(() => el.remove(), 2000);
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
btnBack.addEventListener('click', () => api('POST', '/back'));
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
  } else if (e.key === 'Escape' && !libraryMenu.hidden) {
    closeMenu();
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
  if (fileInput.files.length) {
    uploadFiles(fileInput.files, currentFolderId ? `/upload?folder=${encodeURIComponent(currentFolderId)}` : '/upload');
  }
  fileInput.value = '';
});
librarySearch.addEventListener('input', renderLibrary);
libraryFilters.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  libraryFilter = chip.dataset.filter;
  renderLibrary();
});

// --- library: rename, move, delete ---

function startRename(kind, id) {
  closeMenu();
  renaming = { kind, id };
  renderLibrary();
}

function finishRename(save) {
  if (!renaming) return;
  const input = libraryList.querySelector('input.rename');
  const { kind, id } = renaming;
  renaming = null;
  const name = input?.value.trim();
  if (save && name) {
    const current = kind === 'folder' ? getFolder(id)?.name : getMedia(id)?.originalName;
    if (name !== current) {
      // Show the new name right away; the server broadcast confirms it
      if (kind === 'folder') {
        state = { ...state, folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)) };
        api('PATCH', `/folders/${id}`, { name });
      } else {
        state = { ...state, library: state.library.map((m) => (m.id === id ? { ...m, originalName: name } : m)) };
        api('PATCH', `/library/${id}`, { name });
      }
    }
  }
  renderLibrary();
}

function moveTo(kind, id, folderId) {
  folderId = folderId || null;
  if (kind === 'folder') {
    if (id === folderId || isInside(folderId, id)) return;
    if ((getFolder(id)?.parentId || null) === folderId) return;
    state = { ...state, folders: state.folders.map((f) => (f.id === id ? { ...f, parentId: folderId } : f)) };
    api('PATCH', `/folders/${id}`, { parentId: folderId });
  } else {
    if ((getMedia(id)?.folderId || null) === folderId) return;
    state = { ...state, library: state.library.map((m) => (m.id === id ? { ...m, folderId } : m)) };
    api('PATCH', `/library/${id}`, { folderId });
  }
  renderLibrary();
}

function deleteEntry(kind, id) {
  closeMenu();
  if (kind === 'media') {
    const name = getMedia(id)?.originalName ?? 'this file';
    const used = state.playlist.some((c) => c.mediaId === id);
    if (confirm(`Delete ${name}?${used ? ' It will also be removed from the cue list.' : ''}`)) {
      api('DELETE', `/library/${id}`);
    }
    return;
  }
  const folder = getFolder(id);
  if (!folder) return;
  const files = libraryItems().filter((m) => m.folderId && (m.folderId === id || isInside(m.folderId, id)));
  const cues = state.playlist.filter((c) => files.some((m) => m.id === c.mediaId)).length;
  let msg = `Delete the folder "${folder.name}"?`;
  if (files.length) msg += ` ${files.length === 1 ? 'The file' : `All ${files.length} files`} inside will be deleted too`;
  if (cues) msg += `, and ${cues === 1 ? '1 cue' : `${cues} cues`} using them will be removed`;
  if (files.length) msg += '.';
  if (confirm(msg)) api('DELETE', `/folders/${id}`);
}

function createFolder() {
  const parentId = currentFolderId;
  const taken = new Set(state.folders.filter((f) => (f.parentId || null) === parentId).map((f) => f.name));
  let name = 'New folder';
  for (let i = 2; taken.has(name); i++) name = `New folder ${i}`;
  librarySearch.value = '';
  api('POST', '/folders', { name, parentId })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((folder) => {
      if (!getFolder(folder.id)) state = { ...state, folders: [...state.folders, folder] };
      startRename('folder', folder.id);
    })
    .catch(() => {});
}

function closeMenu() {
  menuTarget = null;
  libraryMenu.hidden = true;
}

function openMenu(kind, id, button) {
  menuTarget = { kind, id };
  const entry = kind === 'folder' ? getFolder(id) : getMedia(id);
  const here = kind === 'folder' ? entry?.parentId || null : entry?.folderId || null;
  // Every folder it can move into, as an indented tree
  const targets = [];
  const walk = (parentId, depth) => {
    state.folders.filter((f) => (f.parentId || null) === parentId)
      .sort((a, b) => byName(a.name, b.name))
      .forEach((f) => {
        if (kind === 'folder' && f.id === id) return; // not into itself or below
        targets.push({ id: f.id, name: f.name, depth });
        walk(f.id, depth + 1);
      });
  };
  walk(null, 1);
  const moveRows = [{ id: '', name: 'Library', depth: 0 }, ...targets]
    .map((t) => `<button type="button" role="menuitem" data-move="${t.id}" style="--depth:${t.depth}" ${(t.id || null) === here ? 'disabled' : ''}>${t.depth ? ICONS.folder : ''}${escapeHtml(t.name)}</button>`)
    .join('');
  libraryMenu.innerHTML = `
    <button type="button" role="menuitem" data-action="rename">Rename</button>
    ${kind === 'folder' ? '<button type="button" role="menuitem" data-action="open">Open</button>' : ''}
    <button type="button" role="menuitem" data-action="delete" class="danger">Delete${kind === 'folder' ? ' folder' : ''}</button>
    <div class="lib-menu-label">Move to</div>
    <div class="lib-menu-moves">${moveRows}</div>`;
  libraryMenu.hidden = false;

  // Open below the button, or above when there's more room there, kept inside the visible workspace
  const pane = libraryPane.getBoundingClientRect();
  const btn = button.getBoundingClientRect();
  const area = (libraryPane.closest('.workspace') || libraryPane).getBoundingClientRect();
  const minTop = Math.max(0, area.top) + 8;
  const maxBottom = Math.min(window.innerHeight, area.bottom) - 8;
  const roomBelow = maxBottom - btn.bottom - 4;
  const roomAbove = btn.top - 4 - minTop;
  libraryMenu.style.maxHeight = '';
  const natural = libraryMenu.offsetHeight;
  const below = roomBelow >= natural || roomBelow >= roomAbove;
  const menuH = Math.min(natural, below ? roomBelow : roomAbove);
  libraryMenu.style.maxHeight = `${menuH}px`;
  libraryMenu.style.top = `${(below ? btn.bottom + 4 : btn.top - 4 - menuH) - pane.top}px`;
  libraryMenu.style.right = `${Math.max(8, pane.right - btn.right)}px`;
}

libraryMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !menuTarget) return;
  const { kind, id } = menuTarget;
  if (btn.dataset.action === 'rename') startRename(kind, id);
  else if (btn.dataset.action === 'open') openFolder(id);
  else if (btn.dataset.action === 'delete') deleteEntry(kind, id);
  else if (btn.dataset.move !== undefined) {
    closeMenu();
    moveTo(kind, id, btn.dataset.move);
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!libraryMenu.hidden && !libraryMenu.contains(e.target) && !e.target.closest('.menu-btn')) closeMenu();
});
libraryList.addEventListener('scroll', closeMenu);

$('btnNewFolder').addEventListener('click', createFolder);

libraryCrumbs.addEventListener('click', (e) => {
  const crumb = e.target.closest('button.crumb');
  if (crumb) openFolder(crumb.dataset.folderId);
});

libraryList.addEventListener('click', (e) => {
  if (e.target.closest('input.rename')) return;
  const add = e.target.closest('.add');
  const more = e.target.closest('.menu-btn');
  if (add) addToCues(add.dataset.id);
  else if (more) {
    const open = menuTarget?.id === more.dataset.id && !libraryMenu.hidden;
    if (open) closeMenu();
    else openMenu(more.dataset.kind, more.dataset.id, more);
  } else {
    const folder = e.target.closest('.folder-item');
    if (folder && !renaming) openFolder(folder.dataset.folderId);
  }
});
libraryList.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.media-item[data-id]');
  if (item && !e.target.closest('button, input')) addToCues(item.dataset.id);
});
libraryList.addEventListener('keydown', (e) => {
  if (!e.target.matches('input.rename')) return;
  if (e.key === 'Enter') { e.preventDefault(); finishRename(true); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(false); }
});
libraryList.addEventListener('focusout', (e) => {
  if (e.target.matches('input.rename')) finishRename(true);
});
libraryList.addEventListener('dragstart', (e) => {
  const folder = e.target.closest('.folder-item');
  const item = e.target.closest('.media-item[data-id]');
  closeMenu();
  if (folder) {
    libDrag = { kind: 'folder', id: folder.dataset.folderId };
    e.dataTransfer.setData(FOLDER_MIME, libDrag.id);
    e.dataTransfer.effectAllowed = 'move';
  } else if (item) {
    libDrag = { kind: 'media', id: item.dataset.id };
    e.dataTransfer.setData(MEDIA_MIME, item.dataset.id);
    e.dataTransfer.effectAllowed = 'copyMove';
  }
});
libraryList.addEventListener('dragend', () => {
  libDrag = null;
  clearFolderDropMarks();
});

function hasType(e, type) {
  return Array.from(e.dataTransfer.types).includes(type);
}

function clearFolderDropMarks() {
  libraryPane.querySelectorAll('.drop-into').forEach((el) => el.classList.remove('drop-into'));
}

// Folder rows and breadcrumbs take dragged library rows
function folderDropTarget(e) {
  if (!libDrag) return null;
  const el = e.target.closest('.folder-item, .crumb:not(:disabled)');
  if (!el) return null;
  const folderId = el.dataset.folderId || null;
  if (libDrag.kind === 'folder' && (folderId === libDrag.id || isInside(folderId, libDrag.id))) return null;
  return { el, folderId };
}

libraryPane.addEventListener('dragover', (e) => {
  const target = folderDropTarget(e);
  if (target) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!target.el.classList.contains('drop-into')) {
      clearFolderDropMarks();
      target.el.classList.add('drop-into');
    }
    return;
  }
  clearFolderDropMarks();
  if (!hasType(e, 'Files')) return;
  e.preventDefault();
  libraryPane.classList.add('dragover');
});
libraryPane.addEventListener('dragleave', (e) => {
  if (!libraryPane.contains(e.relatedTarget)) {
    libraryPane.classList.remove('dragover');
    clearFolderDropMarks();
  }
});
libraryPane.addEventListener('drop', (e) => {
  const target = folderDropTarget(e);
  if (target) {
    e.preventDefault();
    clearFolderDropMarks();
    moveTo(libDrag.kind, libDrag.id, target.folderId);
    return;
  }
  if (!hasType(e, 'Files')) return;
  e.preventDefault();
  libraryPane.classList.remove('dragover');
  // Dropped on a folder row uploads into that folder, otherwise into the open one
  const folder = e.target.closest('.folder-item, .crumb');
  const folderId = folder ? folder.dataset.folderId : currentFolderId;
  uploadFiles(e.dataTransfer.files, folderId ? `/upload?folder=${encodeURIComponent(folderId)}` : '/upload');
});

// --- events: cues ---

$('btnAddCueFile').addEventListener('click', () => cueFileInput.click());
$('btnCueUpload').addEventListener('click', () => cueFileInput.click());
$('btnCueFromLibrary').addEventListener('click', () => { appEl.dataset.tab = 'library'; });
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
// Live framing while dragging: one request in flight at a time, always
// sending the newest position, so the panel keeps up without a backlog.
let framingInFlight = false;
let framingQueued = false;

function sendLiveFraming() {
  if (!dragFraming) return;
  if (framingInFlight) {
    framingQueued = true;
    return;
  }
  framingInFlight = true;
  const { cueId, ...framing } = dragFraming;
  api('POST', `/playlist/${cueId}/framing`, framing)
    .catch(() => {})
    .finally(() => {
      framingInFlight = false;
      if (framingQueued) {
        framingQueued = false;
        sendLiveFraming();
      }
    });
}

function setDragFraming(patch) {
  const cue = state.playlist.find((c) => c.id === selectedCueId);
  if (!cue) return;
  dragFraming = { cueId: cue.id, ...cueFraming(cue.settings), ...(dragFraming?.cueId === cue.id ? dragFraming : {}), ...patch };
  renderStage(cue, getMedia(cue.mediaId));
  if (state.playlist[state.currentCueIndex]?.id === cue.id) renderTransport();
  sendLiveFraming();
}

function commitFraming() {
  if (!dragFraming) return;
  const { cueId, ...framing } = dragFraming;
  dragFraming = null;
  if (cueId === selectedCueId) updateCue(framing);
}

const SNAP = 0.02; // snap to center when this close (fraction of the picture)
let drag = null;

inspScreen.addEventListener('pointerdown', (e) => {
  const cue = state.playlist.find((c) => c.id === selectedCueId);
  if (!cue || cue.settings?.displayMode !== 'centered') return;
  const fit = fitFraction(cue.mediaId);
  if (!fit) return;
  e.preventDefault();
  inspScreen.setPointerCapture(e.pointerId);
  const rect = inspScreen.getBoundingClientRect();
  const start = cueFraming(cue.settings);
  drag = {
    x: e.clientX,
    y: e.clientY,
    start,
    // screen pixels per unit of offset
    unitX: rect.width * fit.w * start.scale,
    unitY: rect.height * fit.h * start.scale,
  };
  inspScreen.classList.add('dragging');
});

inspScreen.addEventListener('pointermove', (e) => {
  if (!drag) return;
  let offsetX = drag.start.offsetX + (e.clientX - drag.x) / drag.unitX;
  let offsetY = drag.start.offsetY + (e.clientY - drag.y) / drag.unitY;
  if (Math.abs(offsetX) < SNAP) offsetX = 0;
  if (Math.abs(offsetY) < SNAP) offsetY = 0;
  const clamp = (v) => Math.max(-2, Math.min(2, Math.round(v * 1000) / 1000));
  setDragFraming({ offsetX: clamp(offsetX), offsetY: clamp(offsetY) });
});

function endDrag() {
  if (!drag) return;
  drag = null;
  inspScreen.classList.remove('dragging');
  commitFraming();
}
inspScreen.addEventListener('pointerup', endDrag);
inspScreen.addEventListener('pointercancel', endDrag);
inspScreen.addEventListener('dblclick', () => {
  const cue = state.playlist.find((c) => c.id === selectedCueId);
  if (cue?.settings?.displayMode === 'centered') updateCue({ offsetX: 0, offsetY: 0 });
});

inspScale.addEventListener('input', () => setDragFraming({ scale: Number(inspScale.value) / 100 }));
inspScale.addEventListener('change', commitFraming);
$('framingReset').addEventListener('click', () => updateCue({ offsetX: 0, offsetY: 0, scale: 1 }));

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

// --- DMX control (Art-Net input; channels are saved on the server) ---

const dmxEl = $('dmx');
const btnDmx = $('btnDmx');
const dmxPopover = $('dmxPopover');
const dmxChannels = $('dmxChannels');
const DMX_FUNCTIONS = [
  { key: 'brightness', name: 'Brightness', show: (v) => `${Math.round((v * 100) / 255)}%` },
  { key: 'go', name: 'GO', show: (v) => (v >= 128 ? 'On' : 'Off') },
  { key: 'back', name: 'BACK', show: (v) => (v >= 128 ? 'On' : 'Off') },
];
let dmxError = null;

dmxChannels.insertAdjacentHTML('beforeend', DMX_FUNCTIONS.map((fn) => `<div class="dmx-ch">
  <input type="number" data-fn="${fn.key}" min="0" max="512" step="1" inputmode="numeric" placeholder="off" aria-label="${fn.name} channel">
  <span class="dmx-name">${fn.name}</span>
  <span class="dmx-bar"><span></span></span>
  <span class="dmx-val">—</span>
</div>`).join(''));

function renderDmx() {
  const d = state.dmx || {};
  dmxEl.hidden = !d.configured;
  if (!d.configured) return;
  const on = !!d.receiving;
  btnDmx.classList.toggle('offline', !on);
  $('dmxSig').classList.toggle('on', on);
  btnDmx.title = on ? 'DMX: receiving' : 'DMX: no signal';
  $('dmxState').textContent = on ? 'Receiving' : 'No signal';
  $('dmxState').classList.toggle('on', on);
  DMX_FUNCTIONS.forEach((fn) => {
    const row = dmxChannels.querySelector(`input[data-fn="${fn.key}"]`).closest('.dmx-ch');
    const input = row.querySelector('input');
    const ch = d.channels?.[fn.key] || 0;
    if (document.activeElement !== input) input.value = ch || '';
    const v = on && ch ? d.values?.[fn.key] : null;
    row.classList.toggle('unused', !ch);
    row.querySelector('.dmx-bar span').style.width = `${v == null ? 0 : (v * 100) / 255}%`;
    row.querySelector('.dmx-val').textContent = v == null ? '—' : fn.show(v);
  });
  const status = $('dmxStatus');
  status.classList.toggle('error', !!dmxError);
  status.textContent = dmxError || (on ? '' : `Waiting for Art-Net on universe ${d.universe ?? 0}`);
}

function sendDmxConfig(patch) {
  dmxError = null;
  api('PUT', '/dmx', patch)
    .then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save');
    })
    .catch((err) => { dmxError = err.message; })
    .finally(renderDmx);
}

dmxChannels.addEventListener('change', (e) => {
  const input = e.target.closest('input[data-fn]');
  if (!input) return;
  const ch = Math.max(0, Math.round(Number(input.value) || 0));
  sendDmxConfig({ channels: { [input.dataset.fn]: ch } });
});

function setDmxOpen(open) {
  dmxPopover.hidden = !open;
  btnDmx.setAttribute('aria-expanded', String(open));
  if (open) renderDmx();
}

btnDmx.addEventListener('click', () => setDmxOpen(dmxPopover.hidden));
document.addEventListener('click', (e) => {
  if (!dmxPopover.hidden && !dmxEl.contains(e.target)) setDmxOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dmxPopover.hidden) setDmxOpen(false);
});

// --- Phone uploads (QR code for the upload-only page) ---

const qrBackdrop = $('qrBackdrop');
const qrBody = $('qrBody');
const btnRemoteUpload = $('btnRemoteUpload');
let remoteUpload = null;
let remoteUploadError = null;
let remoteUploadBusy = false;

function renderRemoteUpload() {
  const r = remoteUpload;
  if (!r) {
    qrBody.innerHTML = `<p class="qr-note${remoteUploadError ? ' error' : ''}">${escapeHtml(remoteUploadError || 'Loading…')}</p>`;
    return;
  }
  if (r.disabled) {
    qrBody.innerHTML = '<p class="qr-note">Phone uploads are turned off on this server (REMOTE_UPLOAD_PORT=0).</p>';
    return;
  }
  qrBody.innerHTML = `
    <div class="qr-code${r.enabled ? '' : ' closed'}">${r.qr}${r.enabled ? '' : '<span>Closed</span>'}</div>
    <div class="qr-url"><span>${escapeHtml(r.url)}</span><button type="button" class="btn-secondary" id="qrCopy">Copy</button></div>
    ${r.localOnly ? '<p class="qr-note error">This page is open as localhost, so the code points at the phone itself. Open the control UI by its network address to get a working code.</p>' : ''}
    <p class="qr-note">${r.public ? 'Anyone with this code can send photos and videos from anywhere.' : 'Phones on the same Wi-Fi as backdrop can send photos and videos with this code.'} They land in the “${escapeHtml(r.folderName)}” folder.</p>
    <label class="qr-toggle">
      <input type="checkbox" id="qrEnabled" ${r.enabled ? 'checked' : ''} ${remoteUploadBusy ? 'disabled' : ''}>
      <span>Accept uploads</span>
    </label>
    <div class="qr-actions">
      <button type="button" class="btn-secondary" id="qrRotate" ${remoteUploadBusy ? 'disabled' : ''}>New link</button>
      <span class="qr-hint">Makes old QR codes stop working</span>
    </div>
    ${remoteUploadError ? `<p class="qr-note error">${escapeHtml(remoteUploadError)}</p>` : ''}`;
}

function remoteUploadCall(method, path, body) {
  remoteUploadBusy = true;
  remoteUploadError = null;
  renderRemoteUpload();
  return api(method, `/remote-upload${path}`, body)
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Request failed');
      remoteUpload = data;
    })
    .catch((err) => { remoteUploadError = err.message; })
    .finally(() => {
      remoteUploadBusy = false;
      renderRemoteUpload();
    });
}

function setQrOpen(open) {
  qrBackdrop.hidden = !open;
  if (!open) return btnRemoteUpload.focus();
  remoteUpload = null;
  remoteUploadCall('GET', '');
  $('qrClose').focus();
}

btnRemoteUpload.addEventListener('click', () => setQrOpen(true));
$('qrClose').addEventListener('click', () => setQrOpen(false));
qrBackdrop.addEventListener('click', (e) => {
  if (e.target === qrBackdrop) setQrOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !qrBackdrop.hidden) setQrOpen(false);
});
qrBody.addEventListener('change', (e) => {
  if (e.target.id === 'qrEnabled') remoteUploadCall('PUT', '', { enabled: e.target.checked });
});
qrBody.addEventListener('click', (e) => {
  if (e.target.id === 'qrRotate' && confirm('Make a new link? The current QR code stops working, including any you printed or shared.')) {
    remoteUploadCall('POST', '/rotate');
  }
  if (e.target.id === 'qrCopy' && remoteUpload?.url) {
    // The clipboard API only exists over https; on the LAN select the link instead
    const selectUrl = () => getSelection().selectAllChildren(qrBody.querySelector('.qr-url span'));
    if (!navigator.clipboard) return selectUrl();
    navigator.clipboard.writeText(remoteUpload.url)
      .then(() => { e.target.textContent = 'Copied'; })
      .catch(selectUrl);
  }
});

connectWs();
render();
