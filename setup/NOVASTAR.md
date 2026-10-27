# NovaStar LED controller — HTTP API

The LED wall is driven by a NovaStar **MCTRL 4K** sending card at
**192.168.178.173**. It has a built-in web UI (slow, flaky, Chinese by default)
backed by a simple HTTP/JSON API that can be called directly.

Reverse-engineered on 2026-10-27 from the controller's own JavaScript
(`/js/myjs.js`, `/js/VM_Base.js`, `/js/BrightConfig_VM.js`) and verified against
the device.

## Ports

| Port | What |
|---|---|
| 80 | Web UI + API (`lwIP/1.3.1` embedded server). UI lives at `/page/panel/index.html` |
| 5200 | NovaStar binary protocol (NovaLCT). Not used here |

## Endpoint

```
GET http://192.168.178.173/leds.cgi?ReadWrite=<0|1>&DevidIndex=0&<key>=<value>[&<key>=<value>...]&anticache=<random>&_=<anything>
```

- `ReadWrite=0` reads, `ReadWrite=1` writes.
- `DevidIndex=0` is the first (only) controller. `255` means "all devices" in
  the stock UI; not needed.
- `/page/panel/leds.cgi` behaves identically to `/leds.cgi`.
- Plain GET, no auth, no cookies, no special headers needed.
- Responses are JSON. **No CORS headers**, so a browser page served from
  another origin can't read them — call it from a server/proxy.

### ⚠️ The write gotcha

**A write is only applied if the query contains `anticache=...` followed by at
least one more parameter.** If `anticache` is missing or is the last
parameter, the controller still replies `{"ERRC":"0"}` (success) but silently
ignores the write.

The stock UI works because jQuery (`cache:false`) appends `&_=<timestamp>`
after the `anticache` param that `makeAjaxURL()` adds. Always end writes with
`&anticache=<n>&_=<n>`. Header, URL length and timing were all ruled out.

Because the reply says "OK" regardless, **verify every write by reading the key
back.**

### Reads

Pass the keys you want with any value (e.g. `abaa=0`). Only those keys come
back. Reads are fast (~20 ms) and live.

```bash
curl -s "http://192.168.178.173/leds.cgi?ReadWrite=0&DevidIndex=0&abaa=0&aaas=0&anticache=1&_=1"
# {"abaa":"100","aaas":"100","ERRC":"0"}
```

Asking for a key the firmware doesn't know returns the known ones plus
`"ERRC":"3"`.

### Writes

```bash
curl -s "http://192.168.178.173/leds.cgi?ReadWrite=1&DevidIndex=0&abaa=50&anticache=$RANDOM&_=$(date +%s)"
# {"ERRC":"0"}   -> then read abaa back to confirm
```

## Error codes (`ERRC`)

| Code | Meaning (from stock UI strings) |
|---|---|
| 0 | OK (for writes: *not* proof it applied, see gotcha) |
| 1 | Timeout |
| 2 | Calibration error |
| 3 | Parameter undefined (unknown key) |
| 4 | Function not supported |
| 5 | Device connection broken |
| 6 | Receiving card failure |
| 7 | Invalid parameter |
| 8 | Main source (…) |

## Keys

✅ = verified on the device. Everything else is mapped from the stock UI's
JavaScript and not yet tested.

### Status (read)

| Key | Meaning | Example |
|---|---|---|
| `abaa` ✅ | Brightness, 0–100 (%) | `100` |
| `aaas` ✅ | Brightness as shown in the panel header | `100` |
| `aaaa` ✅ | Input source (see below) | `0` |
| `aaac` / `aaad` ✅ | Input resolution width / height | `2304` / `768` |
| `aaae` ✅ | Input refresh ×100 | `6000` (= 60 Hz) |
| `aaaf` ✅ | `1` = controlled by another client (UI shows lock warning) | `0` |
| `aaaz` ✅ | Front-panel lock | `0` |
| `aaax` | Network mode | |
| `ajad`…`ajag` | IP address octets | |
| `amab`…`amae` | Temperature / voltage alarm thresholds | |

The stock UI polls `aaaa`…`aaaw` plus `aaay aaax aaaz aabg aabh aabk aabl abaa ajad…`
every few seconds.

### Settings (write)

| Key | Setting | Values |
|---|---|---|
| `abaa` ✅ | Brightness | `0`–`100` |
| `aaaa` | Input source | `0` Auto, `1` DP, `2` HDMI, `3` DVI×2, `4` DVI1, `5` DVI2 |
| `alaa` | Display mode | normal / black / freeze (values untested) |
| `alam` | Pure color / test pattern | index (untested) |
| `alak` | Color temperature (K) | e.g. `6500` |
| `alag` / `alah` / `alai` | Red / green / blue gain | `0`–`255` |
| `alal` | Gamma ×10 | e.g. `28` = 2.8 |
| `alaj` | Hue | |
| `alae` / `alaf` | Contrast / saturation | default `50` |
| `adaa` `adab` `adad=0` | Preset output resolution + refresh | |
| `aeaa` `aeab` `aeac` `adad=1` | Custom resolution W / H / refresh×100 | |
| `afal` / `afam` | Start X / Y | |
| `acaa`…`acai` | Quick cabinet config (rows, cols, cascade, first-port count, enable) | |
| `ajad`…`ajak`, `akbw` | IP, subnet, DHCP | ⚠️ can lock you out |
| `aoaa=0` | Save/solidify settings to hardware | |
| `araa=0` | **Factory reset** | ⚠️ never call casually |
| `LANG` | UI language (`0` zh, `1` en) | |

Stock UI defaults for "reset color": R/G/B `255`, color temp `6500`, gamma `2.8`,
hue `0`, contrast `50`, saturation `50`.

## Example (Node)

```js
const NOVA = 'http://192.168.178.173/leds.cgi';

async function nova(readWrite, params) {
  const q = new URLSearchParams({ ReadWrite: readWrite, DevidIndex: 0, ...params });
  q.append('anticache', Math.floor(Math.random() * 1e4));
  q.append('_', Date.now()); // must come after anticache or writes are ignored
  const res = await fetch(`${NOVA}?${q}`, { signal: AbortSignal.timeout(4000) });
  return res.json();
}

async function setBrightness(pct, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await nova(1, { abaa: pct });
    const { abaa } = await nova(0, { abaa: 0 });
    if (Number(abaa) === pct) return true;
  }
  return false;
}
```
