# Live visuals

Generative visuals for the LED wall, rendered by mpv itself on the box's Intel GPU. A visual is a GLSL shader with sliders. They live in the **Visuals lab** (`/visuals`, linked as "Visuals" in backdrop's header), so backdrop stays simple for everyday shows. A 59-channel DMX fixture (setup/DMX.md) picks visuals and adds dimmer, colour, speed, strobe, three per-visual controls and a 12 × 4 grid of cells for desk chases.

## The Visuals cue

Visuals reach the wall only through the **Visuals** item in backdrop's library: put it in the cue list like any clip. While that cue is live, the wall shows the last visual played (the first one the very first time) and the desk's fixture and the Visuals lab pick and drive it. GO, BACK or any other cue moves on as usual and ends the visuals; when the Visuals cue isn't live, the fixture channels do nothing. Like a still, the cue holds until GO or auto-advances after its seconds.

## The Visuals lab

- **Preview**: the selected visual runs in the browser (WebGL2) with the same code, so you can try sliders and edits without touching the wall.
- **Send to wall** puts it on the LED wall and the sliders then move it live. While the Visuals cue is live this just switches visuals; otherwise it's a test outside the cue list, which **Stop**, GO or any cue ends.
- **Save as default** stores the sliders as the values DMX and Send to wall start with (`visuals.json`, `VISUALS_SETTINGS`).
- **Desk faders**: which sliders the fixture's Control 1-3 move for this visual, saved right away. Speed, RGB and Colour always move the `speed`, `hue` and `hue2` (else `spread`) sliders.
- **Shader code**: edit and **Run preview** (Ctrl/Cmd+Enter); compile errors show over the preview with line numbers of the file. Built-ins are read-only: **Save as copy** makes your own, stored in `uploads/visuals/`. **New** starts from a template.
- **DMX fixture**: channel of each fixture function and live fader values. The select value of each visual is shown in the list (DMX 10, 20, ...).

There is no second display process: mpv plays a tiny generated source and the shader draws the picture at the panel's size (`VISUAL_SIZE`, default `2304x768`), which then goes through the same Fill/Centered/Stretch handling as a 2304×768 clip.

## Built-in visuals

Shipped in `visuals/`, with 576×192 thumbnails in `visuals/thumbs/`.

| Visual | What it is |
|---|---|
| Plasma | Soft colour clouds drifting across the wall |
| Scanner | Light bars sweeping back and forth |
| Smoke | Slow flowing noise, like haze in a beam |
| Tunnel | Rings pulsing out from the centre |
| Dots | A grid of LED-style dots lit by a travelling wave |
| Wash | One colour over the whole wall, optionally breathing |
| Stars | A starfield flying towards the audience |
| Chase | Blocks lighting up in turn: run, bounce, fill, random, alternate |
| Black hole | A swirling accretion disk falling into the dark, with lensed stars; "Trippy" cycles the colours |
| Kaleido | A kaleidoscope of drifting colour, with adjustable mirrors |
| Rain | Columns of falling glowing code |
| Fire | Flames licking up from the bottom of the wall |
| Lines | Stacked waveforms, like a sound-wave landscape |
| Cells | Pulsing stained-glass (Voronoi) cells |
| Ink | Clouds of ink blooming and curling in water |
| Nebula | Glowing gas clouds and stars in deep space |
| Marble | Slow liquid marbling of two colours |
| Lava | Blobs rising and merging like a lava lamp |
| Mandala | Rings of petals turning against each other |
| Crystal | A kaleidoscope of sharp glassy facets |
| Bars | Minimal: bars wiping across the wall (wipe, centre out, in from the sides, build up, random) |
| Grid | Minimal: a grid of cells lighting in sequence (reading order, snake, columns, rows, random, checker) |
| Pulse | Minimal: the whole wall hitting on the beat like a blinder (single, double, swell, left/right, thirds) |
| Stripes | Minimal: clean lines moving across the wall at any angle |
| Frames | Minimal: rectangles opening out from (or into) the centre |

## Writing a visual

Use **New** or **Save as copy** in the lab (or add a file to `visuals/` with a 576×192 thumbnail). The file holds:

1. A first comment line with the name: `// Plasma: soft colour clouds`. Optionally a `// controls: <param>, <param>, <param>` line naming the sliders the desk's Control 1-3 move by default (otherwise its sliders other than speed and hue, in order). The lab can change them per visual. A slider named `speed` follows the Speed channel, `hue` the RGB channels, and `hue2` (else `spread`) the Colour channel.
2. One libplacebo `//!PARAM` block per slider. Use `DYNAMIC float` so moving the slider doesn't recompile the shader. `DESC` is the slider's label, `MINIMUM`/`MAXIMUM` its range, and the line after the block its default.
3. A function `vec3 visual(vec2 uv, float t)` returning the colour (0-1) at `uv` (0-1, top left is 0,0) at time `t` in seconds.

```glsl
// Pulse: the whole wall breathing in one colour

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
    return hsv2rgb(vec3(hue, 1.0, 0.5 + 0.5 * sin(t * 2.0)));
}
```

Available helpers: `RES` (panel size in pixels), `ASPECT` (width / height, 3 for the wall), `PI`, `hsv2rgb(vec3)`, `hash21(vec2)`, `noise(vec2)` and `fbm(vec2)`.

A param named `speed` is special: `t` already runs at that speed, and the server keeps the animation continuous when it changes, so a DMX fader on speed never makes the picture jump.

Shadertoy code ports easily: `fragCoord / iResolution.xy` becomes `uv` (with y flipped), `iTime` becomes `t`, and `mainImage` becomes `visual`.

## How it works

mpv user shaders get no playback time, so the source is `lavfi nullsrc` at 16×16 and 60 fps whose pixel colour encodes its own frame number; the wrapper reads it back as seconds. `visuals.js` turns a visual file into a full mpv shader (the params, a hidden clock, a `MAIN` hook at panel size and the helpers) in `uploads/.visuals/`, and plays it with per-file `glsl-shaders` / `glsl-shader-opts` options so the next clip plays without it. `visuals-lab.js` holds the lab's API (`/api/visuals`), the on-air state and the DMX fixture; the lab preview uses `buildPreview`, the same code as a WebGL2 fragment shader. Slider moves set `glsl-shader-opts` on the running file. The DMX fixture's dimmer, colour, strobe and cells are hidden `fx_*` params of the same wrapper, applied after `visual()`.

backdrop's Live monitor shows "Visual: <name>" while one plays; its panel inset uses a `window` screenshot for visuals, because the `video` screenshot would be the 16×16 source.

## Requirements on the box

Shaders need mpv's GPU output. `--vo=drm` (software scaling) can't run them, so `screenview-mpv.service` uses `--vo=gpu-next --gpu-context=drm`. That also lets `--hwdec=vaapi` actually decode on the GPU.

The mpv user needs the GPU's render node. In the LXC container `/dev/dri/renderD128` belongs to group `kvm` (the host's render GID doesn't map to the container's `render` group), so once:

```bash
usermod -aG kvm screenview
systemctl restart screenview-mpv
```

Check with `journalctl -u screenview-mpv -n 50`: there should be no "Failed initializing" lines, and a clip should still play. To go back to the old output, put `--vo=drm` back in the unit and restart it.
