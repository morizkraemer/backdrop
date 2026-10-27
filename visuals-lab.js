/**
 * Visuals lab (setup/VISUALS.md): live shader visuals for the LED wall, kept
 * apart from backdrop's cue list. The lab page (/visuals) lists, previews,
 * edits and plays visuals; DMX plays them through a 16-channel fixture.
 *
 * Backdrop and the lab share mpv, and the wall is in one of two modes: cues
 * (backdrop) or visuals (a visual on air). Playing a visual takes the screen
 * from the cues (takeScreen); exitToCues hands it back, and backdrop calls
 * release() when a cue takes it back. Whoever acted last wins: backdrop's
 * switch, a cue or GO, the lab, or the desk's select channel.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const visuals = require('./visuals');

const ID_RE = /^[a-z0-9-]{1,64}$/;
const MAX_SOURCE = 256 * 1024;

// DMX functions of the visuals fixture, in channel order after brightness/GO/BACK
const SEGMENT_FNS = Array.from({ length: visuals.SEGMENTS }, (_, i) => `seg${i + 1}`);
const DMX_FUNCTIONS = ['visual', 'dimmer', 'red', 'green', 'blue', 'speed', 'strobe', 'control', ...SEGMENT_FNS];
const DMX_SLOT = 10; // visual select: 10-19 = first visual, 20-29 = second, ...
const DMX_MASK_HOLD_MS = 2000; // strips all at 0 this long = whole wall again

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * The fixture as an MA fixture type (grandMA2 XML, which dot2 imports from
 * USB: dot2/library). dot2 only knows its own attributes, so each function
 * sits on the nearest one (setup/DMX.md); channel sets name the visuals and
 * ranges. The 8 strips are sub-fixtures with their own dimmer, so the desk's
 * effects can chase across them.
 */
function dot2Fixture(slots) {
  const set = (name, from, to) => `<ChannelSet name="${xmlEsc(name)}" from_dmx="${from}" to_dmx="${to}" />`;
  const channel = (coarse, attribute, feature, preset, sets = [], range = [0, 100]) => `
				<ChannelType attribute="${attribute}" feature="${feature}" preset="${preset}" coarse="${coarse}">
					<ChannelFunction from="${range[0]}" to="${range[1]}" min_dmx_24="0" max_dmx_24="16777215" physfrom="${range[0]}" physto="${range[1]}" subattribute="${attribute}" attribute="${attribute}" feature="${feature}" preset="${preset}">
						${sets.join('\n\t\t\t\t\t\t')}
					</ChannelFunction>
				</ChannelType>`;
  const visualSets = [
    set('Cues (no visual)', 0, DMX_SLOT - 1),
    ...slots.map((s) => set(s.name, s.value, s.value + DMX_SLOT - 1)),
  ];
  const main = [
    channel(1, 'GOBO1', 'GOBO', 'GOBO', visualSets, [0, 255]),
    channel(2, 'DIM', 'DIMMER', 'DIMMER', [set('Closed', 0, 0), set('Open', 255, 255)]),
    channel(3, 'COLORRGB1', 'RGB', 'COLOR'),
    channel(4, 'COLORRGB2', 'RGB', 'COLOR'),
    channel(5, 'COLORRGB3', 'RGB', 'COLOR'),
    channel(6, 'GOBO1_POS', 'GOBO', 'GOBO', [set('Speed slow', 0, 0), set('Speed fast', 255, 255)]),
    channel(7, 'SHUTTER', 'SHUTTER', 'BEAM', [set('Open', 0, 9), set('Strobe 1-20 Hz', 10, 255)], [0, 20]),
    channel(8, 'GOBO2', 'GOBO', 'GOBO', [set('Control min', 0, 0), set('Control max', 255, 255)]),
  ].join('');
  const strips = SEGMENT_FNS.map((_, i) => `
			<Instance module_index="1" patch="${9 + i}" locked="true" />`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<MA xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA http://schemas.malighting.de/grandma2/xml/2.8.123/MA.xsd" major_vers="2" minor_vers="8" stream_vers="123" xmlns="http://schemas.malighting.de/grandma2/xml/MA">
	<FixtureType name="Visuals" mode="16ch">
		<short_name>Visuals</short_name>
		<manufacturer>backdrop</manufacturer>
		<short_manufacturer>backdrop</short_manufacturer>
		<Modules>
			<Module name="Main" class="Conventional" beamtype="Wash" beam_angle="25" beam_intensity="10000">${main}
			</Module>
			<Module name="Strip" class="Conventional" beamtype="Wash" beam_angle="25" beam_intensity="10000">${channel(1, 'DIM', 'DIMMER', 'DIMMER', [set('Closed', 0, 0), set('Open', 255, 255)])}
			</Module>
		</Modules>
		<Instances>
			<Instance module_index="0" patch="1" locked="true" />${strips}
		</Instances>
		<Wheels />
	</FixtureType>
</MA>
`;
}

function createVisualsLab({ config, mpv, takeScreen, exitToCues, broadcast }) {
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
  // The DMX fixture's dimmer, colour, strobe and strips, laid over the visual
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
        params: visuals.publicParams(v.params),
        control: visuals.controlParam(v),
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

  function savedValues(v) {
    return visuals.paramValues(v.params, settings.values[v.id]);
  }

  // --- the wall ---

  async function play(id, values) {
    const v = find(id);
    if (!v) throw new Error('Visual not found');
    takeScreen();
    const shaderPath = visuals.writeShader(v.file, cacheDir, v.id, config.visualSize);
    const vals = visuals.paramValues(v.params, values ?? settings.values[v.id]);
    const clock = { clock_t0: 0, clock_ta: 0 };
    // Entering visuals mode: faders only count once they move again
    if (!onAir) resetEngaged();
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

  // A cue (or stop) took the screen back
  function release() {
    if (!onAir) return;
    onAir = null;
    broadcast();
  }

  // Visuals mode from backdrop's switch: the last visual played, else the first
  function enter() {
    if (onAir) return Promise.resolve();
    const all = list();
    const v = all.find((x) => x.id === settings.last) ?? all[0];
    if (!v) return Promise.reject(new Error('No visuals'));
    return play(v.id);
  }

  function stop() {
    if (!onAir) return;
    onAir = null;
    mpv.stop().catch(() => {});
    broadcast();
  }

  function status() {
    if (!onAir) return null;
    const v = find(onAir.id);
    return { id: onAir.id, name: v?.name ?? onAir.id, values: onAir.values };
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
  let maskDarkSince = null;

  function resetEngaged() {
    engaged = new Set();
    maskDarkSince = null;
    fx = { ...visuals.FX_NEUTRAL };
  }

  // Back to neutral: nothing engaged, visuals show as they are
  function resetDmx() {
    resetEngaged();
    setLive(null);
  }

  // values/prev: { visual, dimmer, ..., seg8 } 0-255 or null for unused.
  // Select plays a visual; dimmer, colour, strobe and the 8 strips lie over
  // it; speed and control move its sliders. Each follows only once it moved.
  // Select 10+ switches the wall to visuals, back to 0-9 returns it to backdrop.
  function applyDmx(values, prev) {
    for (const fn of DMX_FUNCTIONS) {
      if (values[fn] !== null && values[fn] !== prev[fn]) engaged.add(fn);
    }
    const on = (fn) => engaged.has(fn) && values[fn] !== null;
    const level = (fn) => values[fn] / 255;

    if (on('visual') && Math.floor(values.visual / DMX_SLOT) !== Math.floor((prev.visual ?? 0) / DMX_SLOT)) {
      const slot = Math.floor(values.visual / DMX_SLOT);
      const v = list()[slot - 1];
      if (v && onAir?.id !== v.id) play(v.id).catch((err) => console.warn('DMX visual:', err.message));
      else if (slot === 0 && onAir) exitToCues();
    }

    const nextFx = { ...visuals.FX_NEUTRAL };
    if (on('dimmer')) nextFx.fx_dimmer = level('dimmer');
    if (on('red') || on('green') || on('blue')) {
      nextFx.fx_tint = 1;
      nextFx.fx_r = (values.red ?? 0) / 255;
      nextFx.fx_g = (values.green ?? 0) / 255;
      nextFx.fx_b = (values.blue ?? 0) / 255;
    }
    // 0-9 open, then 1-20 flashes per second
    if (on('strobe') && values.strobe >= 10) nextFx.fx_strobe = Math.round((1 + ((values.strobe - 10) * 19) / 245) * 10) / 10;
    // The strips mask the wall once one is up, and let go only after all have
    // sat at 0 for a while, so a chase passing through dark doesn't flash the wall
    const segs = SEGMENT_FNS.filter(on);
    if (segs.length) {
      const lit = segs.some((fn) => values[fn] > 0);
      if (lit) maskDarkSince = null;
      else maskDarkSince ??= Date.now();
      if (lit || (fx.fx_mask && Date.now() - maskDarkSince < DMX_MASK_HOLD_MS)) {
        nextFx.fx_mask = 1;
        SEGMENT_FNS.forEach((fn, i) => { nextFx[`fx_s${i}`] = on(fn) ? level(fn) : 0; });
      }
    }

    const patch = {};
    const v = onAir && find(onAir.id);
    const param = (name) => v?.params.find((p) => p.name === name);
    const scaled = (p, fn) => p.min + (p.max - p.min) * level(fn);
    if (on('speed') && values.speed !== prev.speed && param('speed')) patch.speed = scaled(param('speed'), 'speed');
    if (on('control') && values.control !== prev.control && v?.control && param(v.control)) {
      patch[v.control] = scaled(param(v.control), 'control');
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

  // Parse a shader without saving it: its sliders and preview (lab editor)
  router.post('/preview', (req, res) => {
    const { source } = req.body;
    if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_SOURCE) return res.status(400).json({ error: 'source required' });
    const parsed = visuals.parseVisual(source);
    const { width, height } = config.visualSize;
    res.json({
      params: visuals.publicParams(parsed.params),
      control: visuals.controlParam(parsed),
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

  // Back to backdrop (resumes the cue that was playing)
  router.post('/stop', (req, res) => {
    exitToCues();
    res.status(204).send();
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
    if (onAir?.id === v.id) stop();
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
    stop,
    isOnAir: () => !!onAir,
  };
}

module.exports = { createVisualsLab, DMX_FUNCTIONS, dot2Fixture };
