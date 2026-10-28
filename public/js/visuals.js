// Visuals lab: preview shader visuals in the browser, tweak and edit them,
// send them to the LED wall, and set up the DMX fixture (setup/VISUALS.md).
const API = '/api';
const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

const $ = (id) => document.getElementById(id);
const DMX_SLOT = 5; // visual select values per visual (visuals-lab.js)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let state = {}; // backdrop's state over the WebSocket: visual (on air), dmx
let visuals = [];
let slots = [];
let current = null; // the selected visual's detail (GET /api/visuals/:id)
let values = {}; // its slider values in this page

async function api(method, url, body) {
  const r = await fetch(API + url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status} ${r.statusText}`);
  return r.status === 204 ? null : r.json();
}

const onAirId = () => state.visual?.id ?? null;
const isOnAir = () => !!current && onAirId() === current.id;

// --- the list ---

async function loadList() {
  const data = await api('GET', '/visuals');
  visuals = data.visuals;
  slots = data.slots;
  renderList();
  renderDmx();
}

function renderList() {
  const air = onAirId();
  $('visualList').innerHTML = visuals.map((v, i) => `<button type="button" class="lab-item${current?.id === v.id ? ' selected' : ''}${air === v.id ? ' live' : ''}" data-id="${esc(v.id)}">
    <span class="lab-thumb">${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : ''}</span>
    <span class="lab-item-text">
      <span class="lab-item-name">${esc(v.name)}</span>
      <span class="lab-item-sub">DMX ${(i + 1) * DMX_SLOT}${v.builtin ? '' : ' · yours'}${air === v.id ? ' · on wall' : ''}</span>
    </span>
  </button>`).join('');
}

$('visualList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) select(b.dataset.id);
});

async function select(id, { keepValues = false } = {}) {
  try {
    current = await api('GET', `/visuals/${encodeURIComponent(id)}`);
  } catch (err) {
    setStatus(err.message, true);
    return;
  }
  try { localStorage.setItem('labVisual', id); } catch (_) {}
  // Follow the wall when this visual is on it, else start from its saved defaults
  values = keepValues ? { ...current.values, ...values } : { ...(isOnAir() ? state.visual.values : current.values) };
  $('code').value = current.source;
  compile(current.preview);
  render();
  renderList();
}

// --- the preview (WebGL2; the same visual code mpv runs) ---

const canvas = $('preview');
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false });
let program = null;
let uniforms = {};
let clock = 0;
let lastFrame = null;

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

if (gl) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
} else {
  showError('This browser has no WebGL2, so there is no preview here. Send to wall still works.');
}

function showError(text) {
  const el = $('previewError');
  el.hidden = !text;
  el.textContent = text || '';
}

function shaderError(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return { shader: s };
  const log = gl.getShaderInfoLog(s);
  gl.deleteShader(s);
  return { error: log };
}

// Line numbers in errors count from the visual's own code (#line 1)
function compile(source) {
  if (!gl) return false;
  const vs = shaderError(gl.VERTEX_SHADER, VERTEX);
  const fs = shaderError(gl.FRAGMENT_SHADER, source);
  if (fs.error) {
    showError(fs.error.trim());
    return false;
  }
  const p = gl.createProgram();
  gl.attachShader(p, vs.shader);
  gl.attachShader(p, fs.shader);
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    showError(gl.getProgramInfoLog(p));
    return false;
  }
  if (program) gl.deleteProgram(program);
  program = p;
  uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = { loc: gl.getUniformLocation(p, info.name), int: info.type === gl.INT };
  }
  showError(null);
  return true;
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!gl || !program || !current) return;
  const dt = lastFrame === null ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  // Speed scales the clock, like the hidden clock params on the wall
  clock += dt * (values.speed ?? 1);
  if (canvas.clientWidth && canvas.width !== Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2))) {
    canvas.width = Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2));
    canvas.height = Math.round(canvas.width / 3);
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(program);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  if (uniforms.u_t) gl.uniform1f(uniforms.u_t.loc, clock);
  if (uniforms.u_res) gl.uniform2f(uniforms.u_res.loc, canvas.width, canvas.height);
  for (const [name, v] of Object.entries(values)) {
    const u = uniforms[name];
    if (!u) continue;
    if (u.int) gl.uniform1i(u.loc, Math.round(v));
    else gl.uniform1f(u.loc, v);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
requestAnimationFrame(frame);

// --- name, sliders, wall ---

function fmt(p, v) {
  if (p.int) return String(Math.round(v));
  const span = p.max - p.min;
  return Number(v).toFixed(span >= 20 ? 0 : span >= 2 ? 1 : 2);
}

function render() {
  if (!current) return;
  $('visualName').textContent = current.name;
  const i = visuals.findIndex((v) => v.id === current.id);
  $('visualSub').textContent = [
    i >= 0 ? `DMX select ${(i + 1) * DMX_SLOT}` : null,
    current.builtin ? 'built-in' : 'yours',
  ].filter(Boolean).join(' · ');
  $('previewTag').textContent = isOnAir() ? 'Preview · on the wall' : 'Preview';
  $('previewTag').classList.toggle('live', isOnAir());
  $('btnPlay').textContent = isOnAir() ? 'Restart on wall' : 'Send to wall';
  $('btnSave').disabled = current.builtin;
  $('btnSave').title = current.builtin ? 'Built-in visuals are read-only: save a copy' : '';
  $('btnDelete').hidden = current.builtin;

  renderParams();
  renderControls();
}

// Rebuilt only when the params change, so a slider being dragged stays put
let paramsKey = null;
function renderParams() {
  const key = JSON.stringify([current.id, current.controls, current.params]);
  if (key === paramsKey) {
    $('params').querySelectorAll('input[data-param]').forEach((input) => {
      const p = current.params.find((x) => x.name === input.dataset.param);
      if (document.activeElement === input && input.matches(':active')) return;
      input.value = values[p.name];
      input.parentElement.querySelector('.lab-param-val').textContent = fmt(p, values[p.name]);
    });
    return;
  }
  paramsKey = key;
  $('params').innerHTML = current.params.length
    ? current.params.map((p) => `<label class="lab-param">
      <span class="lab-param-name">${esc(p.desc || p.name)}${paramTag(p.name)}</span>
      <input type="range" data-param="${esc(p.name)}" min="${p.min}" max="${p.max}" step="${p.int ? 1 : (p.max - p.min) / 500}" value="${values[p.name]}">
      <span class="lab-param-val">${fmt(p, values[p.name])}</span>
    </label>`).join('')
    : '<span class="field-hint">This visual has no sliders.</span>';
}

// Which desk fader moves a slider: speed, hue (RGB) and the second colour
// (hue2, else spread) are fixed, Control 1-3 are picked per visual
function paramTag(name) {
  const tags = [];
  const second = ['hue2', 'spread'].find((n) => current.params.some((p) => p.name === n));
  if (name === 'speed') tags.push('DMX speed');
  if (name === 'hue') tags.push('DMX RGB');
  if (name === second) tags.push('DMX colour');
  current.controls.forEach((c, i) => { if (c === name) tags.push(`Control ${i + 1}`); });
  return tags.map((t) => ` <em>${t}</em>`).join('');
}

function renderControls() {
  const options = current.params.filter((p) => p.name !== 'speed' && p.name !== 'hue');
  $('controls').innerHTML = current.controls.map((c, i) => `<label class="lab-control">
    <span>Control ${i + 1}</span>
    <select data-control="${i}">
      <option value="">Nothing</option>
      ${options.map((p) => `<option value="${esc(p.name)}"${p.name === c ? ' selected' : ''}>${esc(p.desc || p.name)}</option>`).join('')}
    </select>
  </label>`).join('');
}

$('controls').addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-control]');
  if (!sel) return;
  const controls = [...current.controls];
  controls[Number(sel.dataset.control)] = sel.value || null;
  current.controls = controls;
  render();
  try {
    const r = await api('PUT', `/visuals/${encodeURIComponent(current.id)}/controls`, { controls });
    current.controls = r.controls;
    render();
  } catch (err) {
    setStatus(err.message, true);
  }
});

// Slider moves reach the wall at most every 50 ms while this visual is on it
let liveTimer = null;
let livePatch = {};
function sendLive(patch) {
  if (!isOnAir()) return;
  Object.assign(livePatch, patch);
  if (liveTimer) return;
  liveTimer = setTimeout(() => {
    const body = { values: livePatch };
    livePatch = {};
    liveTimer = null;
    api('POST', `/visuals/${encodeURIComponent(current.id)}/live`, body).catch(() => {});
  }, 50);
}

$('params').addEventListener('input', (e) => {
  const input = e.target.closest('input[data-param]');
  if (!input) return;
  const p = current.params.find((x) => x.name === input.dataset.param);
  const v = p.int ? Math.round(Number(input.value)) : Number(input.value);
  values[p.name] = v;
  input.parentElement.querySelector('.lab-param-val').textContent = fmt(p, v);
  sendLive({ [p.name]: v });
});

$('btnReset').addEventListener('click', () => {
  if (!current) return;
  values = Object.fromEntries(current.params.map((p) => [p.name, p.default]));
  render();
  sendLive(values);
});

$('btnSaveValues').addEventListener('click', async () => {
  if (!current) return;
  try {
    current.values = await api('PUT', `/visuals/${encodeURIComponent(current.id)}/values`, { values });
    flash($('btnSaveValues'), 'Saved');
  } catch (err) {
    flash($('btnSaveValues'), err.message);
  }
});

function flash(btn, text) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  clearTimeout(btn.flashTimer);
  btn.flashTimer = setTimeout(() => { btn.textContent = old; }, 1500);
}

$('btnPlay').addEventListener('click', async () => {
  if (!current) return;
  const btn = $('btnPlay');
  btn.disabled = true;
  try {
    state.visual = await api('POST', `/visuals/${encodeURIComponent(current.id)}/play`, { values });
    clock = 0;
    renderAir();
  } catch (err) {
    flash(btn, err.message);
  } finally {
    btn.disabled = false;
  }
});

// state.visual: the visual on the wall (id)
function renderAir() {
  const v = state.visual;
  $('airText').textContent = v?.name ? `On the wall: ${v.name}` : '';
  $('airText').classList.toggle('live', !!v?.name);
  render();
  renderList();
}

// --- the code editor ---

function setStatus(text, error = false) {
  const el = $('codeStatus');
  el.textContent = text || '';
  el.classList.toggle('error', error);
}

$('code').addEventListener('keydown', (e) => {
  // Tab indents instead of leaving the editor; Ctrl/Cmd+Enter runs the preview
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    document.execCommand('insertText', false, '    ');
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runPreview();
  }
});

// Builds the preview locally: the server parses the params, so ask it for the
// preview shader without saving (a dry run of the same parser)
async function runPreview() {
  if (!current) return;
  try {
    const r = await api('POST', '/visuals/preview', { source: $('code').value });
    // Keep the picked controls that still exist; the rest fall back like on the server
    const names = r.params.map((p) => p.name);
    const controls = r.defaultControls.map((d, i) => {
      const c = current.controls[i];
      return c === null ? null : names.includes(c) ? c : d;
    });
    current = { ...current, params: r.params, controls };
    values = Object.fromEntries(r.params.map((p) => [p.name, values[p.name] ?? p.default]));
    const ok = compile(r.preview);
    setStatus(ok ? 'Preview updated (not saved)' : 'Shader error, see the preview', !ok);
    render();
    return ok;
  } catch (err) {
    setStatus(err.message, true);
    return false;
  }
}

$('btnRun').addEventListener('click', runPreview);

$('btnSave').addEventListener('click', async () => {
  if (!current || current.builtin) return;
  if (!(await runPreview())) return;
  try {
    current = await api('PUT', `/visuals/${encodeURIComponent(current.id)}/source`, { source: $('code').value });
    setStatus(isOnAir() ? 'Saved, reloaded on the wall' : 'Saved');
    render();
  } catch (err) {
    setStatus(err.message, true);
  }
});

async function saveAs(name, source) {
  try {
    const v = await api('POST', '/visuals', { name, source });
    await loadList();
    await select(v.id, { keepValues: true });
    setStatus(`Saved as ${v.name}`);
    $('codePanel').open = true;
  } catch (err) {
    setStatus(err.message, true);
  }
}

$('btnSaveCopy').addEventListener('click', async () => {
  if (!current) return;
  if (!(await runPreview())) return;
  const name = prompt('Name for the copy', `${current.name} copy`);
  if (!name) return;
  // The first comment line is the visual's name
  const source = $('code').value.replace(/^\/\/[^\n!]*/, `// ${name.replace(/[\n:]/g, ' ')}:`);
  saveAs(name, /^\/\/[^!]/.test($('code').value) ? source : `// ${name}\n${$('code').value}`);
});

$('btnDelete').addEventListener('click', async () => {
  if (!current || current.builtin || !confirm(`Delete ${current.name}?`)) return;
  try {
    await api('DELETE', `/visuals/${encodeURIComponent(current.id)}`);
    current = null;
    await loadList();
    if (visuals[0]) select(visuals[0].id);
  } catch (err) {
    setStatus(err.message, true);
  }
});

const TEMPLATE = `// My visual: a starting point
//
// Sliders are //!PARAM blocks. uv runs 0-1 across the whole wall,
// t is seconds (already scaled by speed). Helpers: hsv2rgb, noise, fbm, hash21,
// PI, ASPECT. See setup/VISUALS.md.

//!PARAM speed
//!DESC Speed
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 4.0
1.0

//!PARAM hue
//!DESC Colour
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.6

vec3 visual(vec2 uv, float t) {
    vec2 p = vec2(uv.x * ASPECT, uv.y);
    float wave = sin(p.x * 6.0 + t * 2.0) * 0.5 + 0.5;
    float v = smoothstep(0.02, 0.0, abs(uv.y - wave * 0.8 - 0.1));
    return hsv2rgb(vec3(hue + uv.x * 0.2, 0.8, v));
}
`;

$('btnNew').addEventListener('click', () => {
  const name = prompt('Name for the new visual', 'My visual');
  if (name) saveAs(name, TEMPLATE.replace('My visual', name.replace(/[\n:]/g, ' ')));
});

// --- DMX fixture channels ---

const DMX_FUNCTIONS = [
  { key: 'visual', name: 'Visual select', show: (v) => slotName(v) },
  { key: 'red', name: 'Red', show: pct },
  { key: 'green', name: 'Green', show: pct },
  { key: 'blue', name: 'Blue', show: pct },
  { key: 'colour', name: 'Colour', show: pct },
  { key: 'speed', name: 'Speed', show: pct },
  { key: 'strobe', name: 'Strobe', show: (v) => (v < 10 ? 'Off' : `${(1 + ((v - 10) * 19) / 245).toFixed(1)} Hz`) },
  ...Array.from({ length: 3 }, (_, i) => ({ key: `control${i + 1}`, name: `Control ${i + 1}`, show: pct })),
];

function pct(v) {
  return `${Math.round((v * 100) / 255)}%`;
}

function slotName(v) {
  const s = slots.find((x) => v >= x.value && v < x.value + DMX_SLOT);
  return s ? s.name : '—';
}

$('dmxChannels').insertAdjacentHTML('beforeend', DMX_FUNCTIONS.map((fn) => `<div class="dmx-ch">
  <input type="number" data-fn="${fn.key}" min="0" max="512" step="1" inputmode="numeric" placeholder="off" aria-label="${fn.name} channel">
  <span class="dmx-name">${fn.name}</span>
  <span class="dmx-bar"><span></span></span>
  <span class="dmx-val">—</span>
</div>`).join(''));

let dmxError = null;

function renderDmx() {
  const d = state.dmx || {};
  const on = !!d.receiving;
  $('dmxState').textContent = !d.configured ? 'Off' : on ? 'Receiving' : 'No signal';
  $('dmxState').classList.toggle('on', on);
  DMX_FUNCTIONS.forEach((fn) => {
    const input = $('dmxChannels').querySelector(`input[data-fn="${fn.key}"]`);
    const row = input.closest('.dmx-ch');
    const ch = d.channels?.[fn.key] || 0;
    input.disabled = !d.configured;
    if (document.activeElement !== input) input.value = ch || '';
    const v = on && ch ? d.values?.[fn.key] : null;
    row.classList.toggle('unused', !ch);
    row.querySelector('.dmx-bar span').style.width = `${v == null ? 0 : (v * 100) / 255}%`;
    row.querySelector('.dmx-val').textContent = v == null ? '—' : fn.show(v);
  });
  const vis = d.fixtures?.visuals;
  const startInput = $('dmxStart');
  startInput.disabled = !d.configured;
  if (document.activeElement !== startInput) startInput.value = vis?.start || '';
  $('dmxStartHint').textContent = vis?.start
    ? `Uses channels ${vis.start}-${vis.start + vis.size - 1}`
    : d.configured ? 'Channels set one by one' : '';
  const status = $('dmxStatus');
  status.classList.toggle('error', !!dmxError);
  status.textContent = dmxError
    || (!d.configured ? 'DMX is off on this server (DMX_UNIVERSE is empty).'
      : on ? '' : `Waiting for Art-Net on universe ${d.universe ?? 0}`);
}

$('dmxStart').addEventListener('change', (e) => {
  const start = Math.round(Number(e.target.value));
  if (!start) return renderDmx();
  dmxError = null;
  api('PUT', '/dmx', { fixture: 'visuals', start })
    .catch((err) => { dmxError = err.message; })
    .finally(renderDmx);
});

$('dmxChannels').addEventListener('change', (e) => {
  const input = e.target.closest('input[data-fn]');
  if (!input) return;
  const ch = Math.max(0, Math.min(512, Math.round(Number(input.value) || 0)));
  dmxError = null;
  api('PUT', '/dmx', { channels: { [input.dataset.fn]: ch } })
    .catch((err) => { dmxError = err.message; })
    .finally(renderDmx);
});

// --- virtual desk: the fixture's faders in the page (POST /api/dmx/desk) ---

const DESK_FADERS = [
  ['brightness', 'Brightness', 255], ['red', 'Red', 255], ['green', 'Green', 255], ['blue', 'Blue', 255],
  ['colour', 'Colour', 0], ['speed', 'Speed', 0], ['strobe', 'Strobe', 0],
  ['control1', 'Control 1', 0], ['control2', 'Control 2', 0], ['control3', 'Control 3', 0],
];
const desk = { go: 0, back: 0, visual: 0, ...Object.fromEntries(DESK_FADERS.map(([k, , v]) => [k, v])) };
let deskTimer = null;
let deskBeat = null;

$('deskFaders').innerHTML = DESK_FADERS.map(([k, name]) => `<label class="lab-param">
  <span class="lab-param-name">${name}</span>
  <input type="range" data-desk="${k}" min="0" max="255" step="1" value="${desk[k]}">
  <span class="lab-param-val">${desk[k]}</span>
</label>`).join('');

function renderDeskSelect() {
  const sel = $('deskVisual');
  const want = String(desk.visual);
  sel.innerHTML = '<option value="0">Keep (0)</option>'
    + slots.map((s) => `<option value="${s.value}">${esc(s.name)} (${s.value})</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === want) ? want : '0';
}

// Like a desk: send on change (at most every 50 ms) and repeat every second
function sendDesk() {
  if (deskTimer) return;
  deskTimer = setTimeout(() => {
    deskTimer = null;
    api('POST', '/dmx/desk', { values: desk }).catch(() => {});
  }, 50);
}

function setDesk(patch) {
  Object.assign(desk, patch);
  sendDesk();
}

$('deskPanel').addEventListener('toggle', () => {
  clearInterval(deskBeat);
  deskBeat = null;
  if ($('deskPanel').open) {
    renderDeskSelect();
    sendDesk();
    deskBeat = setInterval(sendDesk, 1000);
  }
});

$('deskFaders').addEventListener('input', (e) => {
  const input = e.target.closest('input[data-desk]');
  if (!input) return;
  input.parentElement.querySelector('.lab-param-val').textContent = input.value;
  setDesk({ [input.dataset.desk]: Number(input.value) });
});

$('deskVisual').addEventListener('change', (e) => setDesk({ visual: Number(e.target.value) }));

// GO and BACK fire on the rise past half, so press and let go
function deskButton(fn) {
  setDesk({ [fn]: 255 });
  setTimeout(() => setDesk({ [fn]: 0 }), 300);
}
$('deskGo').addEventListener('click', () => deskButton('go'));
$('deskBack').addEventListener('click', () => deskButton('back'));

// --- live state from backdrop ---

function connect() {
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (e) => {
    const prevAir = onAirId();
    const prevValues = JSON.stringify(state.visual?.values);
    const msg = JSON.parse(e.data);
    state = { ...state, ...msg };
    wallTabs.follow(state.wallMode);
    if ('visual' in msg || prevAir !== onAirId()) {
      // DMX moved the sliders of the visual shown here: follow them
      if (isOnAir() && JSON.stringify(state.visual.values) !== prevValues && !liveTimer) {
        const focused = document.activeElement?.dataset?.param;
        values = { ...values, ...state.visual.values };
        if (focused) values[focused] = Number(document.activeElement.value);
      }
      renderAir();
    }
    if (msg.dmx) {
      if (msg.dmx.visuals && JSON.stringify(msg.dmx.visuals) !== JSON.stringify(slots)) loadList().catch(() => {});
      renderDmx();
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
}

(async () => {
  try {
    await loadList();
  } catch (err) {
    showError(`Could not load the visuals: ${err.message}`);
    return;
  }
  let id = null;
  try { id = localStorage.getItem('labVisual'); } catch (_) {}
  if (!visuals.some((v) => v.id === id)) id = visuals[0]?.id;
  if (id) await select(id);
  connect();
})();
