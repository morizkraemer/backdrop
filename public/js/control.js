const API = '/api';
const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${location.host}/ws`;

let state = {
  library: [],
  playlist: [],
  currentCueIndex: -1,
  diskFree: 0,
  isTransitioning: false,
};
let selectedCueId = null;
let ws = null;

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const libraryGrid = document.getElementById('libraryGrid');
const diskSpace = document.getElementById('diskSpace');
const cueList = document.getElementById('cueList');
const btnGo = document.getElementById('btnGo');
const btnStop = document.getElementById('btnStop');
const status = document.getElementById('status');
const cueSettings = document.getElementById('cueSettings');
const noSelection = document.getElementById('noSelection');
const settingsFields = document.getElementById('settingsFields');
const settingLoop = document.getElementById('settingLoop');
const settingDisplayMode = document.getElementById('settingDisplayMode');
const settingDuration = document.getElementById('settingDuration');
const settingHold = document.getElementById('settingHold');

function connectWs() {
  ws = new WebSocket(WS_URL);
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    state = { ...state, ...data };
    render();
  };
  ws.onclose = () => {
    status.textContent = 'Disconnected';
    setTimeout(connectWs, 2000);
  };
  ws.onopen = () => {
    status.textContent = 'Connected';
  };
}

function formatBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
}

function api(method, path, body) {
  const opts = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return fetch(`${API}${path}`, opts);
}

function renderLibrary() {
  libraryGrid.innerHTML = state.library.map((item) => {
    const thumb = item.type === 'image'
      ? `<img class="thumb" src="/uploads/${encodeURIComponent(item.filename)}" alt="">`
      : '<div class="thumb-placeholder">▶</div>';
    return `
      <div class="library-item" data-id="${item.id}">
        ${thumb}
        <span class="name">${escapeHtml(item.originalName)}</span>
        <span class="meta">
          <span class="badge">${item.type}</span>
          ${formatBytes(item.size)}
        </span>
        <div class="actions">
          <button class="add" data-id="${item.id}">+</button>
          <button class="delete" data-id="${item.id}">×</button>
        </div>
      </div>
    `;
  }).join('');

  libraryGrid.querySelectorAll('.add').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      api('POST', '/playlist', { mediaId: btn.dataset.id }).then(() => {});
    });
  });
  libraryGrid.querySelectorAll('.delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete this file?')) api('DELETE', `/library/${btn.dataset.id}`).then(() => {});
    });
  });
}

function renderPlaylist() {
  const getMediaName = (mediaId) => {
    const m = state.library.find((x) => x.id === mediaId);
    return m ? m.originalName : '?';
  };

  cueList.innerHTML = state.playlist.map((cue, i) => {
    const active = i === state.currentCueIndex;
    return `
      <div class="cue-row ${active ? 'active' : ''}" data-cue-id="${cue.id}" data-index="${i}" draggable="true">
        <span class="handle">⋮⋮</span>
        <span class="num">Q${i + 1}</span>
        <span class="name">${escapeHtml(getMediaName(cue.mediaId))}</span>
      </div>
    `;
  }).join('');

  cueList.querySelectorAll('.cue-row').forEach((row) => {
    row.addEventListener('click', () => {
      selectedCueId = row.dataset.cueId;
      renderSettings();
    });
    row.addEventListener('dblclick', () => {
      api('POST', `/go/${row.dataset.cueId}`).then(() => {});
    });
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', row.dataset.cueId);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      const over = e.currentTarget;
      if (over.classList.contains('dragging')) return;
      over.classList.add('drag-over');
    });
    row.addEventListener('dragleave', (e) => e.currentTarget.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      const toId = e.currentTarget.dataset.cueId;
      if (fromId === toId) return;
      const ids = state.playlist.map((c) => c.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, fromId);
      api('PUT', '/playlist/reorder', ids).then(() => {});
    });
  });

  btnGo.disabled = state.isTransitioning;
  btnStop.disabled = false;
}

function renderSettings() {
  if (!selectedCueId) {
    noSelection.hidden = false;
    settingsFields.hidden = true;
    return;
  }
  const cue = state.playlist.find((c) => c.id === selectedCueId);
  if (!cue) {
    selectedCueId = null;
    noSelection.hidden = false;
    settingsFields.hidden = true;
    return;
  }
  noSelection.hidden = true;
  settingsFields.hidden = false;

  const media = state.library.find((m) => m.id === cue.mediaId);
  const isVideo = media?.type === 'video';

  settingLoop.checked = cue.settings?.loop ?? false;
  settingLoop.disabled = !isVideo;
  settingDisplayMode.value = cue.settings?.displayMode ?? 'fill';
  const dur = cue.settings?.duration;
  settingDuration.value = dur != null ? dur : '';
  settingHold.checked = dur == null || dur === '';

  settingLoop.onchange = () => updateCueSettings({ loop: settingLoop.checked });
  settingDisplayMode.onchange = () => updateCueSettings({ displayMode: settingDisplayMode.value });
  settingDuration.oninput = () => {
    settingHold.checked = settingDuration.value === '';
    updateCueSettings({ duration: settingDuration.value ? Number(settingDuration.value) : null });
  };
  settingHold.onchange = () => {
    if (settingHold.checked) {
      settingDuration.value = '';
      updateCueSettings({ duration: null });
    }
  };
}

function updateCueSettings(updates) {
  if (!selectedCueId) return;
  api('PUT', `/playlist/${selectedCueId}`, updates).then(() => {});
}

function render() {
  renderLibrary();
  renderPlaylist();
  renderSettings();

  diskSpace.textContent = `Free: ${formatBytes(state.diskFree)}`;

  const idx = state.currentCueIndex;
  if (idx >= 0 && idx < state.playlist.length) {
    const cue = state.playlist[idx];
    const name = state.library.find((m) => m.id === cue.mediaId)?.originalName ?? '?';
    status.textContent = `Playing Q${idx + 1}: ${name}`;
  } else {
    status.textContent = state.isTransitioning ? 'Transitioning…' : 'Stopped';
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) uploadFiles(fileInput.files);
  fileInput.value = '';
});

function uploadFiles(files) {
  for (const file of files) {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', file);

    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<span>${escapeHtml(file.name)}</span> <progress value="0" max="100">0%</progress>`;
    uploadProgress.appendChild(div);
    const prog = div.querySelector('progress');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) prog.value = (e.loaded / e.total) * 100;
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        div.remove();
        render();
      } else {
        let err = 'Upload failed';
        try {
          const body = JSON.parse(xhr.responseText);
          err = body.error || err;
        } catch (_) {}
        div.innerHTML = `<span class="upload-error">${escapeHtml(err)}</span> <button class="retry">Retry</button>`;
        div.classList.add('error');
        div.querySelector('.retry').onclick = () => { div.remove(); uploadFiles([file]); };
      }
    };
    xhr.onerror = () => {
      div.innerHTML = `<span class="upload-error">Network error</span> <button class="retry">Retry</button>`;
      div.classList.add('error');
      div.querySelector('.retry').onclick = () => { div.remove(); uploadFiles([file]); };
    };
    xhr.open('POST', `${API}/upload`);
    xhr.send(fd);
  }
}

btnGo.addEventListener('click', () => api('POST', '/go').then(() => {}));
btnStop.addEventListener('click', () => api('POST', '/stop').then(() => {}));

connectWs();
render();
