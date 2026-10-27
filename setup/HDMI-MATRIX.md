# HDMI matrix (ezcoo EZ-MX44HAS2)

4x4 HDMI matrix, firmware 1.11. The control page's **HDMI** button in the header
shows which input feeds each output and switches them. Input and output names
are set with **Rename** in that popover and saved in `state.json`.

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

- `PUT /api/hdmi/route` `{ "output": 0-4, "input": 1-4 }`: switches, reads the
  routes back and returns 502 if the matrix did not switch.
- `PUT /api/hdmi/names` `{ "inputs": [...], "outputs": [...] }`
- Live state is in the WebSocket payload under `hdmi`
  (`available`, `routes`, `inputLink`, `outputLink`, `names`).
