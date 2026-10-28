/**
 * Visuals lab (setup/VISUALS.md): live shader visuals for the LED wall. The
 * lab page (/visuals) lists, previews, edits and plays visuals; DMX plays them
 * through the 10-channel Visuals fixture.
 *
 * Visuals are on the wall while the wall mode is Visuals (server.js
 * setWallMode, enter); another mode ends it (release). Playing a visual from
 * the lab switches the wall to Visuals (takeScreen); the desk only acts then.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const visuals = require('./visuals');

const ID_RE = /^[a-z0-9-]{1,64}$/;
const MAX_SOURCE = 256 * 1024;

// DMX functions of the Visuals fixture, in channel order (GO, BACK and the wall's
// brightness are backdrop's own Control fixture, server.js)
const CONTROL_FNS = Array.from({ length: visuals.CONTROLS }, (_, i) => `control${i + 1}`);
const DMX_FUNCTIONS = ['visual', 'red', 'green', 'blue', 'colour', 'speed', 'strobe', ...CONTROL_FNS];
const DMX_SLOT = 5; // visual select: 5-9 = first visual, 10-14 = second, ... (50 visuals)

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * MA fixture types (grandMA2 XML, which dot2 imports from USB: dot2/library),
 * one file each: backdrop's Control fixture (GO, BACK, brightness) and the
 * Visuals fixture. dot2 only knows its own attributes, so each function sits
 * on the nearest one (setup/DMX.md); channel sets name the visuals and ranges.
 */
const dmxSet = (name, from, to) => `<ChannelSet name="${xmlEsc(name)}" from_dmx="${from}" to_dmx="${to}" />`;

// MA shows a channel as its physical value x 100 %, so physto 1 reads 0-100 %
// (physto 100 showed 10000 %); the strobe's physical unit is Hz
function dmxChannel(coarse, attribute, feature, preset, sets = [], phys = [0, 1]) {
  return `
				<ChannelType attribute="${attribute}" feature="${feature}" preset="${preset}" coarse="${coarse}">
					<ChannelFunction from="0" to="100" min_dmx_24="0" max_dmx_24="16777215" physfrom="${phys[0]}" physto="${phys[1]}" subattribute="${attribute}" attribute="${attribute}" feature="${feature}" preset="${preset}">
						${sets.join('\n\t\t\t\t\t\t')}
					</ChannelFunction>
				</ChannelType>`;
}

// cells: { name, channel, count } adds count subfixtures of one channel each
// (dot2 shows them as Name.1, .2, ...) right after the main channels
function maFixtureType(name, channels, cells = null) {
  const modules = cells ? `
			<Module name="${xmlEsc(cells.name)}" class="Conventional" beamtype="Wash" beam_angle="25" beam_intensity="10000">${cells.channel}
			</Module>` : '';
  const instances = cells ? Array.from({ length: cells.count }, (_, i) => `
			<Instance module_index="1" patch="${channels.length + 1 + i}" locked="true" />`).join('') : '';
  const size = channels.length + (cells ? cells.count : 0);
  return `<?xml version="1.0" encoding="utf-8"?>
<MA xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA http://schemas.malighting.de/grandma2/xml/2.8.123/MA.xsd" major_vers="2" minor_vers="8" stream_vers="123" xmlns="http://schemas.malighting.de/grandma2/xml/MA">
	<FixtureType name="${name}" mode="${size}ch">
		<short_name>${name}</short_name>
		<manufacturer>backdrop</manufacturer>
		<short_manufacturer>backdrop</short_manufacturer>
		<Modules>
			<Module name="Main" class="Conventional" beamtype="Wash" beam_angle="25" beam_intensity="10000">${channels.join('')}
			</Module>${modules}
		</Modules>
		<Instances>
			<Instance module_index="0" patch="1" locked="true" />${instances}
		</Instances>
		<Wheels />
	</FixtureType>
</MA>
`;
}

// GO, BACK and the LED wall's brightness (server.js CONTROL_FNS)
function dot2ControlFixture() {
  return maFixtureType('Control', [
    dmxChannel(1, 'PRISMA1', 'BEAM', 'BEAM', [dmxSet('Rest', 0, 127), dmxSet('GO', 128, 255)]),
    dmxChannel(2, 'PRISMA2', 'BEAM', 'BEAM', [dmxSet('Rest', 0, 127), dmxSet('BACK', 128, 255)]),
    dmxChannel(3, 'DIM', 'DIMMER', 'DIMMER', [dmxSet('Closed', 0, 0), dmxSet('Open', 255, 255)]),
  ]);
}

// The Visuals fixture (DMX_FUNCTIONS), with the visuals named on select
function dot2Fixture(slots) {
  const visualSets = [
    dmxSet('Keep', 0, DMX_SLOT - 1),
    ...slots.map((s) => dmxSet(s.name, s.value, s.value + DMX_SLOT - 1)),
  ];
  return maFixtureType('Visuals', [
    dmxChannel(1, 'GOBO1', 'GOBO', 'GOBO', visualSets),
    dmxChannel(2, 'COLORRGB1', 'RGB', 'COLOR'),
    dmxChannel(3, 'COLORRGB2', 'RGB', 'COLOR'),
    dmxChannel(4, 'COLORRGB3', 'RGB', 'COLOR'),
    dmxChannel(5, 'COLOR1', 'COLOR', 'COLOR', [dmxSet('Second colour', 0, 255)]),
    dmxChannel(6, 'GOBO1_POS', 'GOBO', 'GOBO', [dmxSet('Speed slow', 0, 0), dmxSet('Speed fast', 255, 255)]),
    dmxChannel(7, 'SHUTTER', 'SHUTTER', 'BEAM', [dmxSet('Open', 0, 9), dmxSet('Strobe 1-20 Hz', 10, 255)], [0, 20]),
    dmxChannel(8, 'GOBO2', 'GOBO', 'GOBO', [dmxSet('Control 1', 0, 255)]),
    dmxChannel(9, 'GOBO2_POS', 'GOBO', 'GOBO', [dmxSet('Control 2', 0, 255)]),
    dmxChannel(10, 'GOBO3', 'GOBO', 'GOBO', [dmxSet('Control 3', 0, 255)]),
  ]);
}

// 0-255 RGB to hue, saturation and value, each 0-1
function toHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h / 6, s: max ? d / max : 0, v: max / 255 };
}

// The slider the Colour channel moves: a second colour, else the colour spread
const SECOND_COLOUR = ['hue2', 'spread'];
function secondColour(v) {
  return SECOND_COLOUR.find((n) => v.params.some((p) => p.name === n)) ?? null;
}

function createVisualsLab({ config, mpv, takeScreen, broadcast }) {
  const userDir = path.resolve(config.uploadsDir, 'visuals');
  const cacheDir = path.resolve(config.uploadsDir, '.visuals');
  const settingsPath = config.visualsSettingsPath;

  // Saved slider values per visual: what play and DMX start a visual with
  let settings = { values: {} };
  try {
    settings = { values: {}, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  } catch (_) {}

  function saveSettings() {
    const tmp = `${settingsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, settingsPath);
  }

  // The visual on the wall: { id, values, clock } (visuals.clockAfterSpeedChange)
  let onAir = null;
  // The Visuals fixture's saturation (RGB) and strobe, laid over the visual
  let fx = { ...visuals.FX_NEUTRAL };

  // --- the visuals: built-ins from visuals/, then the lab's own in uploads/visuals ---

  function describe(file, id, builtin) {
    try {
      const v = visuals.readVisual(file);
      return {
        id,
        file,
        builtin,
        name: v.name || id,
        category: v.category || (builtin ? 'Other' : 'Yours'),
        params: visuals.publicParams(v.params),
        control: visuals.controlParam(v),
        defaultControls: visuals.controlParams(v),
        thumb: builtin && fs.existsSync(path.join(visuals.BUILTIN_DIR, 'thumbs', `${id}.jpg`))
          ? `/visuals/thumbs/${id}.jpg` : null,
      };
    } catch (_) {
      return null;
    }
  }

  function readDir(dir) {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.glsl')).sort();
    } catch (_) {
      return [];
    }
  }

  // In DMX slot order: built-ins by file name, then the lab's own by file name
  function list() {
    return [
      ...readDir(visuals.BUILTIN_DIR).map((f) => describe(path.join(visuals.BUILTIN_DIR, f), path.basename(f, '.glsl'), true)),
      ...readDir(userDir).map((f) => describe(path.join(userDir, f), path.basename(f, '.glsl'), false)),
    ].filter(Boolean).slice(0, Math.floor(256 / DMX_SLOT) - 1);
  }

  function find(id) {
    return ID_RE.test(id) ? list().find((v) => v.id === id) : null;
  }

  function slots() {
    return list().map((v, i) => ({ value: (i + 1) * DMX_SLOT, id: v.id, name: v.name }));
  }

  // The sliders Control 1-3 move for a visual: as set in the lab, else its defaults
  function controlsFor(v) {
    const names = v.params.map((p) => p.name);
    const saved = settings.controls?.[v.id];
    return v.defaultControls.map((d, i) => {
      const c = saved?.[i];
      if (c === null) return null;
      return c && names.includes(c) ? c : d;
    });
  }

  function savedValues(v) {
    return visuals.paramValues(v.params, settings.values[v.id]);
  }

  // --- the wall ---

  // True while the wall mode is Visuals: only then does the desk act
  let active = false;

  async function play(id, values) {
    const v = find(id);
    if (!v) throw new Error('Visual not found');
    // Played from the lab while the wall shows something else: the wall goes to Visuals
    if (!active) {
      takeScreen();
      active = true;
      resetEngaged();
    }
    const shaderPath = visuals.writeShader(v.file, cacheDir, v.id, config.visualSize);
    const vals = visuals.paramValues(v.params, values ?? settings.values[v.id]);
    const clock = { clock_t0: 0, clock_ta: 0 };
    onAir = { id: v.id, values: vals, clock };
    if (settings.last !== v.id) {
      settings.last = v.id;
      try { saveSettings(); } catch (err) { console.warn('Visuals settings:', err.message); }
    }
    try {
      await mpv.loadFile(visuals.SOURCE, {
        loop: true,
        displayMode: 'fill',
        shader: { path: shaderPath, opts: visuals.shaderOpts(vals, clock, fx) },
      });
    } finally {
      broadcast();
    }
  }

  // The wall mode went to Visuals: the last visual played (else the first) starts,
  // and desk faders count again once they move
  function enter() {
    active = true;
    resetEngaged();
    const all = list();
    const v = all.find((x) => x.id === settings.last) ?? all[0];
    if (!v) return Promise.reject(new Error('No visuals'));
    return play(v.id);
  }

  // The wall went to another mode
  function release() {
    if (!active && !onAir) return;
    active = false;
    onAir = null;
    broadcast();
  }

  // cue: the wall mode is Visuals
  function status() {
    if (!onAir) return active ? { id: null, name: null, values: {}, cue: true } : null;
    const v = find(onAir.id);
    return { id: onAir.id, name: v?.name ?? onAir.id, values: onAir.values, cue: active };
  }

  // Live slider moves on the wall (nothing saved). While one update runs,
  // later ones merge into a single follow-up, so DMX at 40 frames a second
  // never queues up behind mpv. id null = whatever is on air; no patch just
  // pushes the fixture state (fx).
  let queue = Promise.resolve();
  let next = null;
  let uiTimer = null;

  function setLive(id, patch = {}) {
    if (next && next.id === id) {
      Object.assign(next.patch, patch);
      return next.promise;
    }
    const job = { id, patch: { ...patch } };
    job.promise = new Promise((resolve) => { job.resolve = resolve; });
    next = job;
    queue = queue.then(async () => {
      if (next === job) next = null;
      job.resolve(await applyLive(job.id, job.patch));
    });
    return job.promise;
  }

  async function applyLive(id, patch) {
    try {
      const air = onAir;
      if (!air || (id && air.id !== id)) return false;
      const v = find(air.id);
      const values = visuals.paramValues(v?.params, { ...air.values, ...patch });
      if ('speed' in values && values.speed !== air.values.speed) {
        const now = await mpv.getProperty('time-pos').catch(() => null);
        if (typeof now === 'number') air.clock = visuals.clockAfterSpeedChange(air.clock, air.values.speed, now);
      }
      air.values = values;
      await mpv.setShaderOpts(visuals.shaderOpts(values, air.clock, fx));
      // Pages see slider moves (e.g. from DMX) at most every 200 ms
      if (Object.keys(patch).length && !uiTimer) {
        uiTimer = setTimeout(() => { uiTimer = null; broadcast(); }, 200);
      }
      return true;
    } catch (err) {
      console.warn('Visual params:', err.message);
      return false;
    }
  }

  // --- DMX fixture (setup/DMX.md) ---

  let engaged = new Set(); // functions whose fader moved since the last prime

  function resetEngaged() {
    engaged = new Set();
    fx = { ...visuals.FX_NEUTRAL };
  }

  // Back to neutral: nothing engaged, visuals show as they are
  function resetDmx() {
    resetEngaged();
    setLive(null);
  }

  // values/prev: { visual, red, ..., control3 } 0-255 or null for unused.
  // Select plays a visual; RGB and strobe lie over it; RGB, speed, colour and
  // Control 1-3 move its sliders (controlsFor). Each
  // follows only once it moved.
  // Only while the wall mode is Visuals.
  function applyDmx(values, prev) {
    if (!active) return;
    for (const fn of DMX_FUNCTIONS) {
      if (values[fn] !== null && values[fn] !== prev[fn]) engaged.add(fn);
    }
    const on = (fn) => engaged.has(fn) && values[fn] !== null;
    const level = (fn) => values[fn] / 255;

    if (on('visual') && Math.floor(values.visual / DMX_SLOT) !== Math.floor((prev.visual ?? 0) / DMX_SLOT)) {
      const v = list()[Math.floor(values.visual / DMX_SLOT) - 1];
      if (v && onAir?.id !== v.id) play(v.id).catch((err) => console.warn('DMX visual:', err.message));
    }

    const nextFx = { ...visuals.FX_NEUTRAL };
    // RGB picks the visual's colour like a colour mix on a fixture: its hue turns the
    // visual's hue slider (below), saturation and brightness apply on top
    const rgbOn = on('red') || on('green') || on('blue');
    const rgb = rgbOn ? toHsv(values.red ?? 0, values.green ?? 0, values.blue ?? 0) : null;
    if (rgb) {
      nextFx.fx_sat = rgb.s;
      nextFx.fx_dimmer *= rgb.v;
    }
    // 0-9 open, then 1-20 flashes per second
    if (on('strobe') && values.strobe >= 10) nextFx.fx_strobe = Math.round((1 + ((values.strobe - 10) * 19) / 245) * 10) / 10;

    const patch = {};
    const v = onAir && find(onAir.id);
    const param = (name) => v?.params.find((p) => p.name === name);
    const scaled = (p, fn) => p.min + (p.max - p.min) * level(fn);
    if (on('speed') && values.speed !== prev.speed && param('speed')) patch.speed = scaled(param('speed'), 'speed');
    const moved = (fn) => on(fn) && values[fn] !== prev[fn];
    const rgbMoved = moved('red') || moved('green') || moved('blue');
    // Grey has no hue: leave the slider where it is
    if (rgbMoved && rgb.s > 0.02 && param('hue')) patch.hue = param('hue').min + (param('hue').max - param('hue').min) * rgb.h;
    const second = v && secondColour(v);
    if (moved('colour') && second) patch[second] = scaled(param(second), 'colour');
    if (v) {
      controlsFor(v).forEach((name, i) => {
        if (name && moved(CONTROL_FNS[i]) && param(name)) patch[name] = scaled(param(name), CONTROL_FNS[i]);
      });
    }

    const fxChanged = Object.keys(nextFx).some((k) => nextFx[k] !== fx[k]);
    fx = nextFx;
    if (onAir && (fxChanged || Object.keys(patch).length)) setLive(onAir.id, patch);
  }

  // --- HTTP API, mounted at /api/visuals ---

  const router = express.Router();
  router.use(express.json({ limit: MAX_SOURCE * 2 }));

  function parseValues(body) {
    if (body === undefined) return {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'values must be an object' };
    const values = {};
    for (const [k, val] of Object.entries(body)) {
      const n = Number(val);
      if (!/^\w{1,64}$/.test(k) || !Number.isFinite(n)) return { error: `Invalid value for ${k}` };
      values[k] = n;
    }
    return { values };
  }

  function detail(v) {
    const parsed = visuals.readVisual(v.file);
    const { width, height } = config.visualSize;
    return {
      ...v,
      file: undefined,
      source: fs.readFileSync(v.file, 'utf8'),
      preview: visuals.buildPreview(parsed, width, height),
      values: savedValues(v),
      controls: controlsFor(v),
    };
  }

  router.get('/', (req, res) => {
    res.json({ visuals: list().map((v) => ({ ...v, file: undefined })), slots: slots(), onAir: status(), size: config.visualSize });
  });

  // dot2 / grandMA2 fixture type for the fixture, with the visuals named on select
  router.get('/dot2.xml', (req, res) => {
    res.type('application/xml');
    res.attachment('backdrop_visuals.xml');
    res.send(dot2Fixture(slots()));
  });

  router.get('/dot2-control.xml', (req, res) => {
    res.type('application/xml');
    res.attachment('backdrop_control.xml');
    res.send(dot2ControlFixture());
  });

  // Parse a shader without saving it: its sliders and preview (lab editor)
  router.post('/preview', (req, res) => {
    const { source } = req.body;
    if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_SOURCE) return res.status(400).json({ error: 'source required' });
    const parsed = visuals.parseVisual(source);
    const { width, height } = config.visualSize;
    res.json({
      params: visuals.publicParams(parsed.params),
      control: visuals.controlParam(parsed),
      defaultControls: visuals.controlParams(parsed),
      preview: visuals.buildPreview(parsed, width, height),
    });
  });

  router.get('/:id', (req, res) => {
    const v = find(req.params.id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    res.json(detail(v));
  });

  // Save slider values as the visual's defaults (used by play and DMX)
  router.put('/:id/values', (req, res) => {
    const v = find(req.params.id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    const { values, error } = parseValues(req.body.values);
    if (error) return res.status(400).json({ error });
    settings.values[v.id] = visuals.paramValues(v.params, values);
    saveSettings();
    res.json(settings.values[v.id]);
  });

  // Which sliders the desk's Control 1-3 faders move (null = none)
  router.put('/:id/controls', (req, res) => {
    const v = find(req.params.id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    const c = req.body.controls;
    const names = v.params.map((p) => p.name);
    if (!Array.isArray(c) || c.length !== visuals.CONTROLS || c.some((n) => n !== null && !names.includes(n))) {
      return res.status(400).json({ error: `controls must be ${visuals.CONTROLS} slider names or null` });
    }
    settings.controls = { ...settings.controls, [v.id]: c };
    saveSettings();
    res.json({ controls: controlsFor(v) });
  });

  // Move sliders on the wall without saving
  router.post('/:id/live', async (req, res) => {
    const { values, error } = parseValues(req.body.values);
    if (error) return res.status(400).json({ error });
    res.json({ live: await setLive(req.params.id, values) });
  });

  router.post('/:id/play', async (req, res) => {
    const { values, error } = parseValues(req.body.values);
    if (error) return res.status(400).json({ error });
    try {
      await play(req.params.id, req.body.values ? values : undefined);
      res.json(status());
    } catch (err) {
      res.status(err.message === 'Visual not found' ? 404 : 502).json({ error: err.message });
    }
  });

  // Create (POST) or overwrite (PUT) one of the lab's own visuals.
  // Built-ins can't be changed here: save a copy instead.
  function writeUserVisual(id, source) {
    if (typeof source !== 'string' || !source.trim()) return 'source required';
    if (Buffer.byteLength(source) > MAX_SOURCE) return 'Shader too large';
    if (!/vec3\s+visual\s*\(/.test(source)) return 'The shader needs a function vec3 visual(vec2 uv, float t)';
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, `${id}.glsl`), source);
    return null;
  }

  router.post('/', (req, res) => {
    const base = String(req.body.name || 'visual').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'visual';
    let id = base;
    for (let n = 2; find(id); n++) id = `${base}-${n}`;
    const error = writeUserVisual(id, req.body.source);
    if (error) return res.status(400).json({ error });
    const v = find(id);
    broadcast();
    res.status(201).json(detail(v));
  });

  router.put('/:id/source', async (req, res) => {
    const v = find(req.params.id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    if (v.builtin) return res.status(403).json({ error: 'Built-in visuals are read-only: save a copy' });
    const error = writeUserVisual(v.id, req.body.source);
    if (error) return res.status(400).json({ error });
    // Reload it on the wall if it's playing, so the change shows
    if (onAir?.id === v.id) await play(v.id, onAir.values).catch(() => {});
    broadcast();
    res.json(detail(find(v.id)));
  });

  router.delete('/:id', (req, res) => {
    const v = find(req.params.id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    if (v.builtin) return res.status(403).json({ error: 'Built-in visuals can\'t be deleted' });
    if (onAir?.id === v.id) return res.status(409).json({ error: 'It\'s on the wall: pick another visual first' });
    fs.rmSync(v.file, { force: true });
    delete settings.values[v.id];
    saveSettings();
    broadcast();
    res.status(204).send();
  });

  return {
    router,
    DMX_FUNCTIONS,
    applyDmx,
    resetDmx,
    release,
    status,
    slots,
    enter,
    isOnAir: () => !!onAir,
  };
}

module.exports = { createVisualsLab, DMX_FUNCTIONS, dot2Fixture, dot2ControlFixture, maFixtureType, dmxChannel, dmxSet };
