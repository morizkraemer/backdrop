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

The first packet after the server starts (or after the DMX settings change) only records the current values, so a fader that is already up does not fire.

## In the web UI

- A **DMX** pill in the header shows a green dot while Art-Net arrives on the universe (grey after 3 s without packets). Clicking it opens the channel for each function (saved as you leave a field), with each channel's live value.
- **BACK** sits next to GO and does the same as the BACK channel (`POST /api/back`).
- When DMX moves the brightness, the LED brightness pill follows it.

## Settings (.env)

| Variable | Default | |
|---|---|---|
| `DMX_UNIVERSE` | `0` | Art-Net universe, matching the node's Universe IN (15-bit port address: Net × 256 + Sub-Net × 16 + Universe). Empty disables DMX entirely. |
| `DMX_ADDRESS` | `1` | Default first channel (brightness; GO, BACK and the visuals fixture follow on consecutive channels) until changed in the UI. |

## Electroconcept "Node 2 Univers" (Art-Net / sACN)

The USB port on this node only powers it (5 V, at least 500 mA) and carries its configuration (WebHID, used by Electroconcept's *dmx_tools* page in Chrome/Edge). It does **not** carry DMX or Art-Net to the computer: on a Mac it shows up as a vendor HID device (VID `1fc9`, PID `0052`, "Node 2 Electro") and no network interface or serial port. DMX goes over its RJ45 port.

1. Plug the node's RJ45 into the LAN (the UniFi switch). Power it from any USB charger or a computer.
2. With the node on USB, open *dmx_tools* from https://www.electroconcept.fr/en/docs/2-universes-artnet-sacn-node/ in Chrome, click **Connect** and pick the node.
3. **IP Setting**: DHCP (default) is fine, or set a static address on 192.168.178.0/24. Protocol: Art-Net.
4. **DMX 1 Setting** (the XLR the console is plugged into): set *DMX* to **Input**, *Universe IN* to the same number as `DMX_UNIVERSE` (0), and *DMX IN -> IP Cast Out* to the backdrop box (192.168.178.75) or broadcast (192.168.178.255). The XLR ports are female, so the console's output needs a male-male (gender changer) cable.
5. Apply. The **Info** tab shows the node's current IP. That IP also serves the node's own config page in any browser, with a Status page showing the DMX values passing through.

To check that packets arrive on the box: `timeout 5 tcpdump -ni eth0 udp port 6454` (tcpdump is not installed in the container by default), or watch `journalctl -u screenview -f` while moving the GO fader.
