// Grid page: the 12x4 grid of lights on the wall (grid.js on the server), its
// dot2 fixture and a virtual desk to play it without the desk (setup/DMX.md).
const API = '/api';
const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

const $ = (id) => document.getElementById(id);
const CELLS = 48;
const CELL_FNS = Array.from({ length: CELLS }, (_, i) => `cell${i + 1}`);
const SHAPES = ['Square', 'Circle', 'Triangle', 'Lightbulb'];

let state = {}; // backdrop's state over the WebSocket: grid (values on the wall), dmx
let dmxError = null;

async function api(method, url, body) {
  const r = await fetch(API + url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status} ${r.statusText}`);
  return r.status === 204 ? null : r.json();
}

// --- the preview: the same shader the wall runs, with the wall's values ---

const canvas = $('preview');
const gl = canvas.getContext('webgl2');
let program = null;
let uniforms = {};

function showError(text) {
  $('previewError').hidden = !text;
  $('previewError').textContent = text || '';
}

function compile(source) {
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a_pos;\nvoid main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, source));
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  program = p;
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
}

function draw() {
  if (!gl || !program) return;
  const w = Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2));
  if (w && canvas.width !== w) {
    canvas.width = w;
    canvas.height = Math.round(w / 3);
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(program);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  if (uniforms.u_res) gl.uniform2f(uniforms.u_res, canvas.width, canvas.height);
  for (const [name, v] of Object.entries(state.grid?.values ?? {})) {
    if (uniforms[name]) gl.uniform1f(uniforms[name], v);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

if (gl) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  api('GET', '/grid').then((d) => {
    compile(d.preview);
    draw();
  }).catch((err) => showError(err.message));
  window.addEventListener('resize', draw);
} else {
  showError('This browser has no WebGL2, so there is no preview here.');
}

// --- the fixture ---

const FIXED = [['shape', 'Shape'], ['grid_red', 'Red'], ['grid_green', 'Green'], ['grid_blue', 'Blue']];

$('dmxChannels').innerHTML = `<div class="dmx-ch dmx-ch-head"><span>Channel</span><span>Function</span><span></span><span>Value</span></div>
${FIXED.map(([fn, name]) => `<div class="dmx-ch" data-fn="${fn}">
  <span class="dmx-num"></span><span>${name}</span><span class="dmx-bar"><span></span></span><span class="dmx-val"></span>
</div>`).join('')}
<div class="dmx-ch" data-fn="cells"><span class="dmx-num"></span><span>Cells 1-48</span><span class="grid-levels" id="dmxLevels">${CELL_FNS.map(() => '<span></span>').join('')}</span><span></span></div>`;

function renderDmx() {
  const d = state.dmx || {};
  const on = !!d.receiving;
  $('dmxState').textContent = !d.configured ? 'Off' : on ? 'Receiving' : 'No signal';
  $('dmxState').classList.toggle('on', on);
  for (const [fn] of FIXED) {
    const row = $('dmxChannels').querySelector(`[data-fn="${fn}"]`);
    const ch = d.channels?.[fn] || 0;
    const v = on && ch ? d.values?.[fn] : null;
    row.querySelector('.dmx-num').textContent = ch || '—';
    row.querySelector('.dmx-bar span').style.width = `${v == null ? 0 : (v * 100) / 255}%`;
    row.querySelector('.dmx-val').textContent = v == null ? '—'
      : fn === 'shape' ? SHAPES[Math.min(3, Math.floor(v / 64))] : `${Math.round((v * 100) / 255)}%`;
  }
  const first = d.channels?.cell1;
  const last = d.channels?.[`cell${CELLS}`];
  $('dmxChannels').querySelector('[data-fn="cells"] .dmx-num').textContent = first ? `${first}-${last}` : '—';
  const levels = $('dmxLevels').children;
  CELL_FNS.forEach((fn, i) => {
    const v = on && d.channels?.[fn] ? d.values?.[fn] ?? 0 : 0;
    levels[i].style.background = v ? `rgba(61, 220, 132, ${0.15 + (0.85 * v) / 255})` : '';
  });
  const fx = d.fixtures?.grid;
  const start = $('dmxStart');
  start.disabled = !d.configured;
  if (document.activeElement !== start) start.value = fx?.start || '';
  $('dmxStartHint').textContent = fx?.start ? `Uses channels ${fx.start}-${fx.start + fx.size - 1}`
    : d.configured ? 'Channels set one by one' : '';
  $('dmxStatus').classList.toggle('error', !!dmxError);
  $('dmxStatus').textContent = dmxError
    || (!d.configured ? 'DMX is off on this server (DMX_UNIVERSE is empty).'
      : on ? '' : `Waiting for Art-Net on universe ${d.universe ?? 0}`);
}

$('dmxStart').addEventListener('change', (e) => {
  const start = Math.round(Number(e.target.value));
  if (!start) return renderDmx();
  dmxError = null;
  api('PUT', '/dmx', { fixture: 'grid', start })
    .catch((err) => { dmxError = err.message; })
    .finally(renderDmx);
});

// --- virtual desk: the Grid fixture's channels, sent like Art-Net ---

const desk = {
  shape: 0,
  grid_red: 255,
  grid_green: 255,
  grid_blue: 255,
  ...Object.fromEntries(CELL_FNS.map((fn) => [fn, 255])),
};
let deskTimer = null;
let deskBeat = null;

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
  renderDesk();
  sendDesk();
}

$('deskShape').innerHTML = SHAPES.map((name, i) => `<button type="button" role="radio" data-shape="${i * 64}">${name}</button>`).join('');
$('deskCells').innerHTML = CELL_FNS.map((fn, i) => `<button type="button" data-cell="${fn}" aria-label="Cell ${i + 1}">${i + 1}</button>`).join('');
$('deskFaders').innerHTML = FIXED.slice(1).map(([fn, name]) => `<label class="lab-param">
  <span class="lab-param-name">${name}</span>
  <span class="lab-param-val"></span>
  <input type="range" data-desk="${fn}" min="0" max="255" step="1">
</label>`).join('');

function renderDesk() {
  for (const b of $('deskShape').children) b.setAttribute('aria-checked', String(Number(b.dataset.shape) === desk.shape));
  for (const b of $('deskCells').children) b.classList.toggle('on', desk[b.dataset.cell] > 0);
  for (const input of $('deskFaders').querySelectorAll('input')) {
    input.value = desk[input.dataset.desk];
    input.parentElement.querySelector('.lab-param-val').textContent = input.value;
  }
}
renderDesk();

$('deskPanel').addEventListener('toggle', () => {
  clearInterval(deskBeat);
  deskBeat = null;
  if ($('deskPanel').open) {
    sendDesk();
    deskBeat = setInterval(sendDesk, 1000);
  }
});

$('deskShape').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-shape]');
  if (b) setDesk({ shape: Number(b.dataset.shape) });
});
$('deskCells').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cell]');
  if (b) setDesk({ [b.dataset.cell]: desk[b.dataset.cell] > 0 ? 0 : 255 });
});
$('deskAllOn').addEventListener('click', () => setDesk(Object.fromEntries(CELL_FNS.map((fn) => [fn, 255]))));
$('deskAllOff').addEventListener('click', () => setDesk(Object.fromEntries(CELL_FNS.map((fn) => [fn, 0]))));
$('deskFaders').addEventListener('input', (e) => {
  const input = e.target.closest('input[data-desk]');
  if (input) setDesk({ [input.dataset.desk]: Number(input.value) });
});

// --- live state from backdrop ---

function renderAir() {
  $('airText').textContent = state.grid?.live ? 'On the wall' : '';
  $('airText').classList.toggle('live', !!state.grid?.live);
}

function connect() {
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    state = { ...state, ...msg };
    wallTabs.follow(state.wallMode);
    renderAir();
    if (msg.dmx) renderDmx();
    if (msg.grid) draw();
  };
  ws.onclose = () => setTimeout(connect, 2000);
}
connect();
