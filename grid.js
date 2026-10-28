/**
 * The Grid (setup/DMX.md): a 12x4 grid of lights on the LED wall, drawn by an
 * mpv shader (grid/lights.glsl) and played from the desk's Grid fixture: Shape
 * (square, circle, triangle, lightbulb), one RGB colour and a dimmer per cell.
 * It's on the wall while the wall mode is Grid (server.js setWallMode). Without
 * the desk every cell shows full white squares; with it the cells follow the
 * fixture exactly.
 */
const express = require('express');
const path = require('path');
const visuals = require('./visuals');
const { maFixtureType, dmxChannel, dmxSet } = require('./visuals-lab');

const FILE = path.join(__dirname, 'grid', 'lights.glsl');
const COLS = 12;
const ROWS = 4;
const CELLS = COLS * ROWS;
const SHAPES = ['Square', 'Circle', 'Triangle', 'Lightbulb'];
const CELL_FNS = Array.from({ length: CELLS }, (_, i) => `cell${i + 1}`);
const DMX_FUNCTIONS = ['shape', 'grid_red', 'grid_green', 'grid_blue', ...CELL_FNS];

const NEUTRAL = {
  shape: 0,
  red: 1,
  green: 1,
  blue: 1,
  ...Object.fromEntries(CELL_FNS.map((_, i) => [`c${i + 1}`, 1])),
};

// Shape 0-63 square, 64-127 circle, 128-191 triangle, 192-255 lightbulb
const shapeOf = (v) => Math.min(SHAPES.length - 1, Math.floor(v / 64));

// The Grid fixture for the dot2: Shape, RGB, then 48 cells as subfixtures
function dot2GridFixture() {
  return maFixtureType('Grid', [
    dmxChannel(1, 'GOBO1', 'GOBO', 'GOBO', SHAPES.map((name, i) => dmxSet(name, i * 64, i * 64 + 63))),
    dmxChannel(2, 'COLORRGB1', 'RGB', 'COLOR'),
    dmxChannel(3, 'COLORRGB2', 'RGB', 'COLOR'),
    dmxChannel(4, 'COLORRGB3', 'RGB', 'COLOR'),
  ], {
    name: 'Cell',
    count: CELLS,
    channel: dmxChannel(1, 'DIM', 'DIMMER', 'DIMMER', [dmxSet('Closed', 0, 0), dmxSet('Open', 255, 255)]),
  });
}

function createGrid({ config, mpv, broadcast }) {
  const cacheDir = path.resolve(config.uploadsDir, '.visuals');
  let active = false;
  let values = { ...NEUTRAL };

  // Shader values while mpv is busy merge into one follow-up, so DMX at 40
  // frames a second never queues up behind mpv
  let busy = false;
  let pending = false;
  let uiTimer = null;
  async function push() {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      do {
        pending = false;
        if (active) await mpv.setShaderOpts(visuals.shaderOpts(values, {}, visuals.FX_NEUTRAL));
      } while (pending && active);
    } catch (err) {
      console.warn('Grid:', err.message);
    } finally {
      busy = false;
    }
  }

  // The wall mode went to Grid
  async function enter() {
    active = true;
    const shaderPath = visuals.writeShader(FILE, cacheDir, 'grid', config.visualSize);
    try {
      await mpv.loadFile(visuals.SOURCE, {
        loop: true,
        displayMode: 'fill',
        shader: { path: shaderPath, opts: visuals.shaderOpts(values, {}, visuals.FX_NEUTRAL) },
      });
    } finally {
      broadcast();
    }
  }

  function release() {
    active = false;
  }

  // Art-Net (or the virtual desk) went quiet: back to the full grid
  function resetDmx() {
    values = { ...NEUTRAL };
    if (active) push();
    broadcast();
  }

  // values/prev: { shape, grid_red, ..., cell48 } 0-255 or null for unused; the
  // grid follows every channel that's patched, only while it's on the wall
  function applyDmx(dmx) {
    if (!active) return;
    const next = { ...values };
    const level = (fn) => dmx[fn] / 255;
    if (dmx.shape !== null) next.shape = shapeOf(dmx.shape);
    if (dmx.grid_red !== null) next.red = level('grid_red');
    if (dmx.grid_green !== null) next.green = level('grid_green');
    if (dmx.grid_blue !== null) next.blue = level('grid_blue');
    CELL_FNS.forEach((fn, i) => {
      if (dmx[fn] !== null) next[`c${i + 1}`] = level(fn);
    });
    if (Object.keys(next).some((k) => next[k] !== values[k])) {
      values = next;
      push();
      // The Grid page's preview follows at most every 200 ms
      if (!uiTimer) uiTimer = setTimeout(() => { uiTimer = null; broadcast(); }, 200);
    }
  }

  // live: the wall mode is Grid; values: the shader's (shape 0-3, colour and cells 0-1)
  function status() {
    return { live: active, values };
  }

  // --- HTTP API, mounted at /api/grid ---

  const router = express.Router();

  // The shader for the page's preview
  router.get('/', (req, res) => {
    const parsed = visuals.readVisual(FILE);
    const { width, height } = config.visualSize;
    res.json({ cols: COLS, rows: ROWS, shapes: SHAPES, preview: visuals.buildPreview(parsed, width, height) });
  });

  router.get('/dot2.xml', (req, res) => {
    res.type('application/xml');
    res.attachment('backdrop_grid.xml');
    res.send(dot2GridFixture());
  });

  return { router, enter, release, resetDmx, applyDmx, status };
}

module.exports = { createGrid, DMX_FUNCTIONS, dot2GridFixture };
