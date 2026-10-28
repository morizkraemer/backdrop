# DMX control (Art-Net)

backdrop listens for Art-Net on UDP port 6454. The universe is set once in .env (`DMX_UNIVERSE`) and must match the universe the node sends. On the desk, backdrop is three fixtures, each patched from its own start address. Set the address in backdrop: the Control fixture in the DMX menu in backdrop's header, the Visuals fixture in the Visuals lab's DMX panel, the Grid fixture on the Grid page. Single channels can still be moved there, and a channel left empty is unused. Everything is saved in state.json.

Each channel only takes over once its fader moves, so the web UI can still set things while the desk's faders rest. When Art-Net stops for 3 s, everything goes back to neutral, and the next packet only records the fader positions again.

### Control fixture (3 channels)

For every show. By default at channel 1 (`DMX_ADDRESS`).

| Fixture channel | Function | Behaviour |
|---|---|---|
| 1 | GO | Plays the next cue when the value rises past 50 % (128). Bring it back below 50 % to arm it again. |
| 2 | BACK | Plays the previous cue, same trigger as GO. From the first cue it wraps to the last one when the playlist loops; when stopped it goes to the last cue. |
| 3 | Brightness | The LED wall's brightness, 0-255 to 0-100 % on the NovaStar controller, for every cue. |

### Visuals fixture (10 channels)

By default right after the Control fixture (channels 4-13). It only acts while the wall is on the Visuals tab (setup/VISUALS.md), never on clips or stills.

| Fixture channel | Function | Behaviour |
|---|---|---|
| 1 | Visual select | 5-9 plays the first visual, 10-14 the second, and so on, up to 50 visuals (the Visuals lab lists each one's value: built-ins by file name, then your own by file name; the dot2 fixture names them); 0-4 keeps the current one. |
| 2-4 | Red, green, blue | The visual's colour, mixed like on any RGB fixture: the hue turns the visual's own colour slider, so its gradients and spread stay; less saturation fades it towards white, and the mix's brightness dims it (all at 0 is dark). |
| 5 | Colour | The visual's second colour (Marble's second colour), else its colour spread, for visuals with either. |
| 6 | Speed | Across the visual's speed range. The animation never jumps when it changes. |
| 7 | Strobe | 0-9 off, then 1-20 flashes per second. |
| 8-10 | Control 1-3 | Three visual-specific sliders, picked per visual in the Visuals lab under Desk faders (by default its main sliders, e.g. pattern, size or density). |

The lab's **Virtual desk** plays the Control and Visuals fixtures from the browser, to try them without the dot2.

### Grid fixture (52 channels)

By default right after the Visuals fixture (channels 14-65). It only acts while the wall is on the Grid tab, and then the wall shows 12×4 lights in one colour. Without the desk every cell is lit white; once Art-Net arrives the cells follow the fixture exactly (back to all white 3 s after it stops).

| Fixture channel | Function | Behaviour |
|---|---|---|
| 1 | Shape | 0-63 square, 64-127 circle, 128-191 triangle, 192-255 lightbulb (a drawn bulb: glass, filament and glow in the colour). |
| 2-4 | Red, green, blue | The colour of every cell. |
| 5-52 | Cell 1-48 | Each cell's dimmer, row by row from the top left (cell 1-12 the top row). |

The Grid page has its own **Virtual desk**: shape, colour, and click cells on and off.

### dot2 fixture types

The Visuals lab has **Download Visuals fixture** (`/api/visuals/dot2.xml`) and **Download Control fixture** (`/api/visuals/dot2-control.xml`), the Grid page **Download Grid fixture** (`/api/grid/dot2.xml`): one MA fixture type (grandMA2 XML) each, with every visual named on the Visuals fixture's select channel and the Grid's cells as 48 subfixtures (Grid.1-48). Download the Visuals one again after adding visuals, so the names stay current.

To import: copy them to a USB stick in `dot2/library/`, then on the dot2 open Setup → Patch and Fixture Schedule → Add New Fixtures → Select other... → Import, pick the USB drive, manufacturer "backdrop", then "Control", "Visuals" or "Grid". Patch each at any address on the universe the node forwards, and enter the same addresses in backdrop.

dot2 only has its own attribute names, so the functions sit on the nearest ones:

| Fixture | Channel | On the dot2 | Function |
|---|---|---|---|
| Control | 1 | Prisma 1 (Beam view: Rest / GO) | GO |
| Control | 2 | Prisma 2 (Beam view: Rest / BACK) | BACK |
| Control | 3 | Dimmer | Brightness |
| Visuals | 1 | Gobo 1 (Gobo view, named buttons) | Visual select |
| Visuals | 2-4 | Color RGB | Red, green, blue |
| Visuals | 5 | Color 1 | Colour (second colour) |
| Visuals | 6 | Gobo 1 position | Speed |
| Visuals | 7 | Shutter (Beam view) | Strobe |
| Visuals | 8 | Gobo 2 | Control 1 |
| Visuals | 9 | Gobo 2 position | Control 2 |
| Visuals | 10 | Gobo 3 | Control 3 (what Control 1-3 move per visual is shown in the lab) |
| Grid | 1 | Gobo 1 (named buttons) | Shape |
| Grid | 2-4 | Color RGB | Red, green, blue |
| Grid | 5-52 | Dimmer of subfixtures .1-.48 | Cell 1-48 |

If an import fails, patch generic fixtures from the dot2 library at the same channels instead (dimmers for GO, BACK, brightness and select, an RGB LED, more dimmers for the rest); everything works, only the names are missing.
