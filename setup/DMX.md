# DMX control (Art-Net)

backdrop listens for Art-Net on UDP port 6454. The channel of each function is set in the web UI (DMX pill in the header for brightness, GO and BACK; the Visuals lab for the fixture) and saved in state.json; a channel left empty is unused. The universe is set once in .env and must match the node's Universe IN.

| Default channel | Function | Behaviour |
|---|---|---|
| 1 | LED brightness | 0-255 maps to 0-100 % on the NovaStar controller. Applied only when the fader moves, so the web UI can still change brightness while the fader rests. |
| 2 | GO | Plays the next cue when the value rises past 50 % (128). Bring it back below 50 % to arm it again. |
| 3 | BACK | Plays the previous cue, same trigger as GO. From the first cue it wraps to the last one when the playlist loops; when stopped it goes to the last cue. |

### Visuals fixture (16 channels)

By default the 16 channels after BACK (4-19 with `DMX_ADDRESS=1`). They only affect live visuals (setup/VISUALS.md), never clips or stills.

| Default channel | Function | Behaviour |
|---|---|---|
| 4 | Visual select | 0-9 leaves the cues alone. 10-19 plays the first visual, 20-29 the second, and so on (the Visuals lab lists them: built-ins by file name, then your own by file name). The visual plays outside the cue list; GO goes back to the cues. |
| 5 | Dimmer | 0-100 % on the visual. |
| 6-8 | Red, green, blue | Replaces the visual's colours with this colour, keeping its brightness pattern. |
| 9 | Speed | Across the visual's speed range. The animation never jumps when it changes. |
| 10 | Strobe | 0-9 off, then 1-20 flashes per second. |
| 11 | Control | One visual-specific slider: pattern for Chase, size for Plasma and Smoke, bars, rings, dot count, density, breathing for Wash. |
| 12-19 | Strips 1-8 | The wall split into 8 vertical strips, each with its own intensity. Patch them as 8 dimmers and run the desk's chase, wave or bounce effects over them. Once any strip is up the others mask the wall; when all eight have sat at 0 for 2 s the whole wall shows again, so a chase passing through dark doesn't flash it. |

Each function only takes over once its fader moves; until then the visual looks as its saved defaults in the Visuals lab set it. When Art-Net stops for 3 s, the fixture goes back to neutral and the next packet only records the fader positions again.

### dot2 fixture type

The Visuals lab has **Download dot2 fixture** (`/api/visuals/dot2.xml`): an MA fixture type (grandMA2 XML) for the 16 channels, with every visual named on the select channel. Download it again after adding visuals, so the names stay current.

To import: copy it to a USB stick as `dot2/library/backdrop_visuals.xml`, then on the dot2 open Setup → Patch and Fixture Schedule → Add New Fixtures → Select other... → Import, pick the USB drive, manufacturer "backdrop", "Visuals". Patch it at the first fixture channel (4 by default) on the Art-Net universe backdrop listens to.

dot2 only has its own attribute names, so the functions sit on the nearest ones:

| Fixture channel | On the dot2 | Function |
|---|---|---|
| 1 | Gobo 1 (Gobo view, named buttons) | Visual select |
| 2 | Dimmer | Dimmer |
| 3-5 | Color RGB | Red, green, blue |
| 6 | Gobo 1 position | Speed |
| 7 | Shutter (Beam view) | Strobe |
| 8 | Gobo 2 | Control (what it moves per visual is shown in the lab) |
| 9-16 | Sub-fixtures .1-.8, Dimmer | Strips 1-8, so the desk's effects can chase across them |

This file hasn't been tried on a real dot2 yet. If the import fails, patch generic fixtures from the dot2 library at the same channels instead (a dimmer for select, an RGB LED, 8 dimmers for the strips); everything works, only the names are missing.
