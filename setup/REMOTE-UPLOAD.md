# Phone uploads (QR code)

Guests scan a QR code and send photos and videos into the library. The code
opens a small upload page; nothing else of backdrop is reachable through it.

By default this only works on the LAN (fast, nothing leaves the building). A
Cloudflare Tunnel can make the same page reachable from outside later, see
the end of this file.

## How it works

```
phone on the Wi-Fi ──http──▶ 192.168.178.75:3100  upload-only server
                                     │
                                     ▼
                       uploads/ + library folder "Phone uploads"
```

- The server runs a **second listener** (`REMOTE_UPLOAD_PORT`, default `3100`).
  It serves only `/u/<token>` (the page) and its upload endpoints. `/control`,
  `/api`, `/ws` and `/uploads` don't exist on it.
- The control UI stays on port 3000. The QR never points there.
- The QR uses the address you opened the control UI with, on port 3100. If you
  open the control UI as `localhost`, the dialog warns you, because the code
  would point phones at themselves.
- The link carries a random token. In the control UI (Library → QR button) you
  can switch **Accept uploads** off, or make a **New link**, which kills every
  old QR code.
- Files arrive in 32 MB chunks. A dropped Wi-Fi connection resumes from the
  last chunk instead of starting over.
- Finished files land in the root library folder **Phone uploads** (created on
  first upload, `REMOTE_UPLOAD_FOLDER` renames it). `MAX_FILE_SIZE` and
  `MIN_FREE_DISK` apply as for normal uploads.
- The token and on/off switch live in `remote-upload.json` next to the code
  (git-ignored).

No setup is needed on the LAN. If guests use a separate guest Wi-Fi/VLAN on
the UniFi, it needs a firewall rule that lets it reach `192.168.178.75:3100`.

## Optional: from outside the LAN (Cloudflare Tunnel)

Slower, since every file goes out to Cloudflare and back in over the
building's upload bandwidth. Needs a domain on Cloudflare.

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create a tunnel*
   → Cloudflared → name it `backdrop`.
2. As root on `192.168.178.75`, install `cloudflared` as the dashboard shows
   for Debian, then `cloudflared service install <TUNNEL_TOKEN>`.
3. In the tunnel → *Public Hostname* → add e.g. `backdrop-upload.<domain>`,
   Service `HTTP` → `localhost:3100`. **Never point it at 3000.**
4. If a Cloudflare Access app covers the whole domain, add a *Bypass →
   Everyone* app for this hostname, or guests hit a login screen.
5. In `/opt/screenview/backdrop/.env` set
   `REMOTE_UPLOAD_URL=https://backdrop-upload.<domain>` and
   `sudo systemctl restart screenview.service`. The QR then uses that address.

## Env

| Variable | Default | |
|---|---|---|
| `REMOTE_UPLOAD_PORT` | `3100` | Upload-only listener. `0` turns phone uploads off. |
| `REMOTE_UPLOAD_HOST` | `0.0.0.0` | Bind address. `127.0.0.1` makes it tunnel-only. |
| `REMOTE_UPLOAD_URL` | none | Public address of a Cloudflare Tunnel. Without it the QR points at the LAN. |
| `REMOTE_UPLOAD_FOLDER` | `Phone uploads` | Library folder new files go into. |
