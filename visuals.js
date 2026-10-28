/**
 * Live visuals (setup/VISUALS.md): GLSL shaders that mpv renders itself, so
 * generative content plays as an ordinary cue without a second display process.
 *
 * A visual file holds libplacebo //!PARAM blocks (the sliders) and GLSL code
 * defining `vec3 visual(vec2 uv, float t)`. This module wraps that in an mpv
 * user shader: a hook on the main picture that renders at panel size, plus the
 * clock and helpers every visual shares.
 *
 * mpv shaders get no playback time, so the source is a tiny lavfi picture whose
 * pixel encodes its own frame number; the shader reads it back as seconds. The
 * hidden clock_t0/clock_ta params let the server change `speed` without the
 * animation jumping (see clockAfterSpeedChange).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BUILTIN_DIR = path.join(__dirname, 'visuals');
const FPS = 60;
const CLOCK_PARAMS = ['clock_t0', 'clock_ta'];
// Desk-style controls laid over every visual (DMX, setup/DMX.md), neutral by default:
// dimmer and saturation (from the desk's RGB), strobe in Hz (0 = off)
const FX_NEUTRAL = {
  fx_dimmer: 1,
  fx_sat: 1,
  fx_strobe: 0,
};
const HIDDEN = (name) => CLOCK_PARAMS.includes(name) || name.startsWith('fx_');

// 16x16 frame whose colour is the frame number: r + 256 g + 65536 b
const SOURCE = `av://lavfi:nullsrc=s=16x16:r=${FPS},format=gbrp,`
  + "geq=r='mod(N,256)':g='mod(floor(N/256),256)':b='mod(floor(N/65536),256)'";

/**
 * Splits a visual file into { name, params, body }. params are the numeric
 * //!PARAM blocks: { name, desc, min, max, default, int }. name is the first
 * comment line, e.g. "// Plasma: soft colour clouds" -> "Plasma".
 */
function parseVisual(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const params = [];
  const body = [];
  let name = null;
  let controlParam = null;
  let controls = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\/\/!PARAM\s+(\w+)/.exec(line);
    if (!m) {
      const control = /^\/\/\s*control:\s*(\w+)/.exec(line);
      const many = /^\/\/\s*controls:\s*(.+)$/.exec(line);
      if (control) controlParam = control[1];
      else if (many) controls = many[1].split(/[\s,]+/).filter(Boolean);
      else if (name === null && /^\/\/\s*\S/.test(line) && !line.startsWith('//!')) {
        name = line.replace(/^\/\/\s*/, '').split(':')[0].trim();
      }
      body.push(line);
      continue;
    }
    // A PARAM block is its //! lines followed by one line holding the default
    const p = { name: m[1], desc: null, min: null, max: null, default: 0, int: false, raw: [line] };
    for (i++; i < lines.length && lines[i].startsWith('//!'); i++) {
      const [key, ...rest] = lines[i].slice(3).trim().split(/\s+/);
      const val = rest.join(' ');
      if (key === 'DESC') p.desc = val;
      else if (key === 'MINIMUM') p.min = Number(val);
      else if (key === 'MAXIMUM') p.max = Number(val);
      else if (key === 'TYPE') p.int = /\b(int|uint)\b/.test(val);
      p.raw.push(lines[i]);
    }
    p.default = Number(lines[i]);
    p.raw.push(lines[i] ?? '0');
    // Blank lines in its place keep compiler line numbers matching the file
    body.push(...p.raw.map(() => ''));
    if (!Number.isFinite(p.default)) p.default = 0;
    params.push(p);
  }
  return { name, params, body: body.join('\n'), control: controlParam, controls };
}

// The slider the DMX "control" channel moves: named by a "// control: <param>"
// line, else the first one that isn't speed or colour
function controlParam(visual) {
  const names = visual.params.map((p) => p.name);
  if (visual.control && names.includes(visual.control)) return visual.control;
  return names.find((n) => !HIDDEN(n) && !['speed', 'hue', 'saturation', 'spread'].includes(n)) ?? null;
}

// The sliders DMX Control 1-3 move by default: a "// controls: a, b, c" line,
// else the control slider and then the next ones that aren't speed or colour
const CONTROLS = 3;
function controlParams(visual) {
  const names = visual.params.filter((p) => !HIDDEN(p.name)).map((p) => p.name);
  const picked = (visual.controls || []).filter((n) => names.includes(n));
  const first = controlParam(visual);
  if (!picked.length && first) picked.push(first);
  for (const n of names) {
    if (picked.length >= CONTROLS) break;
    if (!picked.includes(n) && !['speed', 'hue'].includes(n)) picked.push(n);
  }
  while (picked.length < CONTROLS) picked.push(null);
  return picked.slice(0, CONTROLS);
}

// The params a client sees and can set (the clock stays internal)
function publicParams(params) {
  return params
    .filter((p) => !HIDDEN(p.name))
    .map(({ raw, ...p }) => ({ ...p, min: p.min ?? 0, max: p.max ?? 1 }));
}

const PRELUDE = `
#define RES vec2(float(VISUAL_W), float(VISUAL_H))
#define ASPECT (RES.x / RES.y)
#define PI 3.14159265359

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec2(17.0, 9.0);
        a *= 0.5;
    }
    return v;
}
`;

/** Builds the mpv user shader for a parsed visual at width x height. */
function buildShader(visual, width, height) {
  const params = visual.params.filter((p) => !HIDDEN(p.name));
  const hasSpeed = params.some((p) => p.name === 'speed');
  const hidden = [...CLOCK_PARAMS.map((name) => [name, 0]), ...Object.entries(FX_NEUTRAL)]
    .map(([name, v]) => `//!PARAM ${name}\n//!TYPE DYNAMIC float\n${Number(v).toFixed(1)}`);
  const time = hasSpeed ? 'clock_t0 + (src_t - clock_ta) * speed' : 'src_t';
  return [
    ...params.map((p) => p.raw.join('\n')),
    ...hidden,
    '',
    '//!HOOK MAIN',
    '//!BIND HOOKED',
    `//!WIDTH ${width}`,
    `//!HEIGHT ${height}`,
    `//!DESC backdrop visual: ${(visual.name || 'visual').replace(/\n/g, ' ')}`,
    `#define VISUAL_W ${width}`,
    `#define VISUAL_H ${height}`,
    PRELUDE,
    '#line 1',
    visual.body,
    '',
    'vec4 hook() {',
    '    vec3 c = floor(HOOKED_tex(vec2(0.5)).rgb * 255.0 + 0.5);',
    `    float src_t = (c.r + c.g * 256.0 + c.b * 65536.0) / ${FPS.toFixed(1)};`,
    `    float t = ${time};`,
    '    vec2 uv = HOOKED_pos;',
    '    vec3 col = clamp(visual(uv, t), 0.0, 1.0);',
    '    // Desk colour: its hue goes to the visual\'s hue slider, its saturation here',
    '    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, fx_sat);',
    '    if (fx_strobe > 0.0 && fract(src_t * fx_strobe) > 0.3) col = vec3(0.0);',
    '    return vec4(col * fx_dimmer, 1.0);',
    '}',
    '',
  ].join('\n');
}

/**
 * The same visual as a WebGL2 fragment shader, for previews in the browser
 * (the Visuals lab). Params become uniforms; the page supplies u_t (seconds,
 * already at the chosen speed) and u_res.
 */
function buildPreview(visual, width, height) {
  const params = visual.params.filter((p) => !HIDDEN(p.name));
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'uniform float u_t;',
    'uniform vec2 u_res;',
    ...params.map((p) => `uniform ${p.int ? 'int' : 'float'} ${p.name};`),
    'out vec4 fragColor;',
    `#define VISUAL_W ${width}`,
    `#define VISUAL_H ${height}`,
    PRELUDE,
    '#line 1',
    visual.body,
    '',
    'void main() {',
    '    vec2 uv = gl_FragCoord.xy / u_res;',
    '    uv.y = 1.0 - uv.y;',
    '    fragColor = vec4(clamp(visual(uv, u_t), 0.0, 1.0), 1.0);',
    '}',
    '',
  ].join('\n');
}

function readVisual(filePath) {
  return parseVisual(fs.readFileSync(filePath, 'utf8'));
}

/** Built-in visuals shipped in visuals/: [{ file, name, params }] */
function listBuiltins() {
  let files = [];
  try {
    files = fs.readdirSync(BUILTIN_DIR).filter((f) => f.endsWith('.glsl')).sort();
  } catch (_) {}
  return files.map((file) => {
    const v = readVisual(path.join(BUILTIN_DIR, file));
    return { file, name: v.name || path.basename(file, '.glsl'), params: publicParams(v.params), control: controlParam(v) };
  });
}

/** Writes the mpv shader for a visual file into cacheDir and returns its path. */
function writeShader(filePath, cacheDir, id, { width, height }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const shader = buildShader(readVisual(filePath), width, height);
  // mpv keeps a shader file it loaded once by its path, so a changed shader
  // (an edit, or a new backdrop) gets a new name; the old ones are removed
  const hash = crypto.createHash('sha1').update(shader).digest('hex').slice(0, 10);
  const name = `${id}-${hash}.glsl`;
  for (const f of fs.readdirSync(cacheDir)) {
    if (f !== name && (f === `${id}.glsl` || /^(.+)-[0-9a-f]{10}\.glsl$/.exec(f)?.[1] === id)) {
      try { fs.unlinkSync(path.join(cacheDir, f)); } catch (_) {}
    }
  }
  // Absolute: mpv resolves paths against its own working directory
  const out = path.resolve(cacheDir, name);
  if (!fs.existsSync(out)) fs.writeFileSync(out, shader);
  return out;
}

/** Values for every public param: saved cue values over the visual's defaults, clamped. */
function paramValues(params = [], saved = {}) {
  const values = {};
  for (const p of params) {
    let v = Number(saved[p.name] ?? p.default);
    if (!Number.isFinite(v)) v = p.default;
    v = Math.min(p.max, Math.max(p.min, v));
    values[p.name] = p.int ? Math.round(v) : v;
  }
  return values;
}

/**
 * Keeps the animation continuous when speed changes at source time `now`:
 * the phase reached so far becomes the new starting point.
 */
function clockAfterSpeedChange(clock, oldSpeed, now) {
  return { clock_t0: clock.clock_t0 + (now - clock.clock_ta) * oldSpeed, clock_ta: now };
}

// mpv's glsl-shader-opts as a map of strings
function shaderOpts(values, clock, fx = FX_NEUTRAL) {
  const opts = {};
  for (const [k, v] of Object.entries({ ...values, ...clock, ...fx })) opts[k] = String(v);
  return opts;
}

module.exports = {
  BUILTIN_DIR,
  SOURCE,
  FX_NEUTRAL,
  CONTROLS,
  controlParam,
  controlParams,
  parseVisual,
  publicParams,
  buildShader,
  buildPreview,
  readVisual,
  listBuiltins,
  writeShader,
  paramValues,
  clockAfterSpeedChange,
  shaderOpts,
};
