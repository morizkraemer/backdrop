# DMX control (Art-Net)

backdrop listens for Art-Net on UDP port 6454. The channel of each function is set in the web UI (DMX pill in the header) and saved in state.json; a channel left empty is unused. The universe is set once in .env and must match the node's Universe IN.

| Default channel | Function | Behaviour |
|---|---|---|
| 1 | LED brightness | 0-255 maps to 0-100 % on the NovaStar controller. Applied only when the fader moves, so the web UI can still change brightness while the fader rests. |
| 2 | GO | Plays the next cue when the value rises past 50 % (128). Bring it back below 50 % to arm it again. |
| 3 | BACK | Plays the previous cue, same trigger as GO. From the first cue it wraps to the last one when the playlist loops; when stopped it goes to the last cue. |
| off | Visual 1-4 | Move the first four sliders of the live visual on screen (setup/VISUALS.md), 0-255 across each slider's range. Like brightness, a fader only takes over when it moves; the moves are not saved to the cue. |

The first packet after the server starts (or after the DMX settings change) only records the current values, so a fader that is already up does not fire.

## In the web UI

- A **DMX** pill in the header shows a green dot while Art-Net arrives on the universe (grey after 3 s without packets). Clicking it opens the channel for each function (saved as you leave a field), with each channel's live value.
- **BACK** sits next to GO and does the same as the BACK channel (`POST /api/back`).
- When DMX moves the brightness, the LED brightness pill follows it.

## Settings (.env)

| Variable | Default | |
|---|---|---|
| `DMX_UNIVERSE` | `0` | Art-Net universe, matching the node's Universe IN (15-bit port address: Net × 256 + Sub-Net × 16 + Universe). Empty disables DMX entirely. |
| `DMX_ADDRESS` | `1` | Default first channel (brightness; GO and BACK follow) until changed in the UI. The visual sliders start unused. |

## Electroconcept "Node 2 Univers" (Art-Net / sACN)

The USB port on this node only powers it (5 V, at least 500 mA) and carries its configuration (WebHID, used by Electroconcept's *dmx_tools* page in Chrome/Edge). It does **not** carry DMX or Art-Net to the computer: on a Mac it shows up as a vendor HID device (VID `1fc9`, PID `0052`, "Node 2 Electro") and no network interface or serial port. DMX goes over its RJ45 port.

1. Plug the node's RJ45 into the LAN (the UniFi switch). Power it from any USB charger or a computer.
2. With the node on USB, open *dmx_tools* from https://www.electroconcept.fr/en/docs/2-universes-artnet-sacn-node/ in Chrome, click **Connect** and pick the node.
3. **IP Setting**: DHCP (default) is fine, or set a static address on 192.168.178.0/24. Protocol: Art-Net.
4. **DMX 1 Setting** (the XLR the console is plugged into): set *DMX* to **Input**, *Universe IN* to the same number as `DMX_UNIVERSE` (0), and *DMX IN -> IP Cast Out* to the backdrop box (192.168.178.75) or broadcast (192.168.178.255). The XLR ports are female, so the console's output needs a male-male (gender changer) cable.
5. Apply. The **Info** tab shows the node's current IP. That IP also serves the node's own config page in any browser, with a Status page showing the DMX values passing through.

To check that packets arrive on the box: `timeout 5 tcpdump -ni eth0 udp port 6454` (tcpdump is not installed in the container by default), or watch `journalctl -u screenview -f` while moving the GO fader.
