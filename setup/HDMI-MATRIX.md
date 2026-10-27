# HDMI matrix (ezcoo EZ-MX44HAS2)

4x4 HDMI matrix, firmware 1.11. Only output 1 is used; it feeds the LED wall.

| Input | Source |
|---|---|
| 1 | backdrop (this app) |
| 2 | HDMI FOH |
| 3 | HDMI Stage |
| 4 | HDMI Balkon |

The source button in the control page header shows the current source (amber when
it isn't backdrop) and opens a list to switch it. `HDMI_OUTPUT` (default `1`) and
`HDMI_SOURCES` (default `Backdrop,FOH,Stage,Balkon`) in `.env` change the output
and the names.

## Network

- On DHCP for now, last seen at `192.168.178.211`, hostname `w550-010203`.
  The MAC is the generic WIZnet `00:08:dc:01:02:03`.
- The server tries each entry of `HDMI_HOST` in order and sticks with the first
  one that answers. Default: `w550-010203,192.168.178.211`. Once the matrix has a
  fixed address, set `HDMI_HOST=<ip>` in `.env`. `host:port` is accepted too.
- Web UI on port 80 still works alongside the app.

## Protocol

Raw TCP on port 23, no login, commands end with `\r`.

| Command | Does |
|---|---|
| `EZS OUTx VS INy` | Route input `y` to output `x` (`x=0` = all outputs) |
| `EZG STA` | Compact status, one value per line (`OUT1 VS IN2`, ...) |
| `EZSTA` | Full status table; the only one with link (signal) state, ~1.6 s |

Pitfalls:

- Only **two** TCP sockets at a time, and replies go to **every** open socket.
  The server therefore opens a short-lived connection per job and runs one job
  at a time, so it never holds a socket while idle.
- The matrix never pushes changes. The server polls `EZSTA` every 10 s while a
  control page is open, so front-panel, IR or web-UI switches show up.
- To pin a static IP from the matrix itself: `EZS DHCP 0`,
  `EZS HIP 192.168.178.xxx` (zero-padded), then `EZS RBT`. A DHCP reservation in
  UniFi works as well.

Full reference: https://github.com/matnig/ha-ezcoo-matrix (PROTOCOL.md).

## API

- `PUT /api/hdmi/source` `{ "input": 1-4 }`: routes that input to `HDMI_OUTPUT`,
  reads it back and returns 502 if the matrix did not switch.
- Live state is in the WebSocket payload under `hdmi`
  (`available`, `current` input number, `sources` with `name` and `signal`).
