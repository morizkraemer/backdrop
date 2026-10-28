# Live visuals

Generative visuals for the LED wall, rendered by mpv itself on the box's Intel GPU. A visual is a GLSL shader with sliders. They live in the **Visuals lab** (`/visuals`, the **Visuals** tab at the top of every page). A 10-channel DMX fixture (setup/DMX.md) picks visuals and sets their colour, speed, strobe and three per-visual controls from the desk.

## What the wall shows: the tabs

Every page has three tabs at the top: **Cues**, **Visuals** and **Grid**. The tab that's picked is what the wall shows, for everyone: picking one switches the wall, and every open page (phone, FOH laptop) follows to it. The choice is saved, so it survives a restart.

- **Cues**: backdrop's cue list as always. Coming back to it plays the current cue again from the start (or leaves the wall dark when nothing was playing).
- **Visuals**: the last visual played (the first one the very first time); the Visuals fixture and the lab pick and drive it. The cue list waits where it is.
- **Grid**: a 12×4 grid of lights played by the Grid fixture (setup/DMX.md).

GO or BACK (on a page or from the desk's Control fixture) always brings the wall back to Cues and plays the next or previous cue. The Visuals and Grid fixtures only act while their tab is on the wall.

## The Visuals lab

- **Preview**: the selected visual runs in the browser (WebGL2) with the same code, so you can try sliders and edits without touching the wall.
- **Send to wall** puts it on the LED wall and the sliders then move it live.
- **Save as default** stores the sliders as the values DMX and Send to wall start with (`visuals.json`, `VISUALS_SETTINGS`).
- **Desk faders**: which sliders the fixture's Control 1-3 move for this visual, saved right away. Speed, RGB and Colour always move the `speed`, `hue` and `hue2` (else `spread`) sliders.
- **Shader code**: edit and **Run preview** (Ctrl/Cmd+Enter); compile errors show over the preview with line numbers of the file. Built-ins are read-only: **Save as copy** makes your own, stored in `uploads/visuals/`. **New** starts from a template.
- **DMX fixture**: channel of each fixture function and live fader values. The select value of each visual is shown in the list (DMX 5, 10, ...).

There is no second display process: mpv plays a tiny generated source and the shader draws the picture at the panel's size (`VISUAL_SIZE`, default `2304x768`), which then goes through the same Fill/Centered/Stretch handling as a 2304×768 clip.

## Built-in visuals

Shipped in `visuals/`, with 576×192 thumbnails in `visuals/thumbs/`.

| Visual | What it is |
|---|---|
| Plasma | Soft colour clouds drifting across the wall |
| Scanner | Light bars sweeping back and forth |
| Smoke | Slow flowing noise, like haze in a beam |
| Dots | A grid of LED-style dots lit by a travelling wave |
| Kaleido | A kaleidoscope of drifting colour, with adjustable mirrors |
| Rain | Columns of falling glowing code |
| Fire | Flames licking up from the bottom of the wall |
| Lines | Stacked waveforms, like a sound-wave landscape |
| Ink | Clouds of ink blooming and curling in water |
| Nebula | Glowing gas clouds and stars in deep space |
| Marble | Slow liquid marbling of two colours |
| Lava | Blobs rising and merging like a lava lamp |
| Crystal | A kaleidoscope of sharp glassy facets |
| Bars | Minimal: bars across the wall at any angle: wipe, centre out, in from the sides, build up, random, run, bounce, alternate, scroll |
| Grid | Minimal: a grid of cells lighting in sequence (reading order, snake, columns, rows, random, checker) |
| Pulse | Minimal: the whole wall hitting on the beat like a blinder (single, double, swell, left/right, thirds) |
| Frames | Minimal: rectangles opening out from (or into) the centre |
| Shutters | Minimal: slats opening and closing like venetian blinds, in a wave across the wall (or sideways) |
| Wipes | Minimal: hard-edged wipes from one colour to the other (diagonal, iris, diamond, clock, split) |
| Triangles | Minimal: a mesh of triangles flipping on and off (random, wave, sweep) |
| Blocks | Minimal: the wall cut into hard rectangles that re-cut on every beat, in two colours |

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

mpv user shaders get no playback time, so the source is `lavfi nullsrc` at 16×16 and 60 fps whose pixel colour encodes its own frame number; the wrapper reads it back as seconds. `visuals.js` turns a visual file into a full mpv shader (the params, a hidden clock, a `MAIN` hook at panel size and the helpers) in `uploads/.visuals/`, and plays it with per-file `glsl-shaders` / `glsl-shader-opts` options so the next clip plays without it. `visuals-lab.js` holds the lab's API (`/api/visuals`), the on-air state and the DMX fixture; the lab preview uses `buildPreview`, the same code as a WebGL2 fragment shader. Slider moves set `glsl-shader-opts` on the running file. The DMX fixture's saturation, dimming and strobe are hidden `fx_*` params of the same wrapper, applied after `visual()`.

backdrop's Live monitor shows "Visual: <name>" while one plays; its panel inset uses a `window` screenshot for visuals, because the `video` screenshot would be the 16×16 source.

## Requirements on the box

Shaders need mpv's GPU output. `--vo=drm` (software scaling) can't run them, so `screenview-mpv.service` uses `--vo=gpu-next --gpu-context=drm`. That also lets `--hwdec=vaapi` actually decode on the GPU.

The mpv user needs the GPU's render node. In the LXC container `/dev/dri/renderD128` belongs to group `kvm` (the host's render GID doesn't map to the container's `render` group), so once:

```bash
usermod -aG kvm screenview
systemctl restart screenview-mpv
```

Check with `journalctl -u screenview-mpv -n 50`: there should be no "Failed initializing" lines, and a clip should still play. To go back to the old output, put `--vo=drm` back in the unit and restart it.
