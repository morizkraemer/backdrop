# Remote uploads (QR code, through Cloudflare)

People outside the LAN can send photos and videos into the library by scanning
a QR code. The QR opens a small upload page; nothing else of backdrop is
reachable from outside.

## How it works

```
phone ──https──▶ Cloudflare ──tunnel──▶ cloudflared (in the container)
                                          │
                                          ▼
                              127.0.0.1:3100  upload-only server
                                          │
                                          ▼
                              uploads/ + library folder "Remote uploads"
```

- The server runs a **second listener** (`REMOTE_UPLOAD_PORT`, default `3100`,
  bound to `127.0.0.1`). It serves only `/u/<token>` (the page) and its upload
  endpoints. `/control`, `/api`, `/ws` and `/uploads` don't exist on it, so the
  tunnel can't expose the control UI even by mistake.
- The control UI stays on port 3000, LAN only. **Never point the tunnel at 3000.**
- The link carries a random token. In the control UI (Library → QR button) you
  can switch **Accept uploads** off, or make a **New link**, which kills every
  old QR code.
- Files arrive in 32 MB chunks because Cloudflare rejects request bodies over
  100 MB. A dropped connection resumes from the last chunk.
- Finished files land in the root library folder **Remote uploads** (created on
  first upload, `REMOTE_UPLOAD_FOLDER` renames it). `MAX_FILE_SIZE` and
  `MIN_FREE_DISK` apply as for normal uploads.
- The token and on/off switch live in `remote-upload.json` next to the code
  (git-ignored).

## Setup (once)

Needs a domain that's on Cloudflare (the same account as BHF works).

1. **Create the tunnel.** Cloudflare dashboard → Zero Trust → Networks →
   Tunnels → *Create a tunnel* → Cloudflared → name it `backdrop`.
2. **Install the connector in the container.** The dashboard shows the
   commands for Debian. As root on `192.168.178.75`:
   ```sh
   # add Cloudflare's apt repo and install, as shown in the dashboard, then:
   cloudflared service install <TUNNEL_TOKEN>
   systemctl status cloudflared
   ```
   The dashboard flips the connector to *Healthy* once it's connected.
3. **Public hostname.** In the tunnel → *Public Hostname* → add:
   - Subdomain: e.g. `backdrop-upload`, Domain: your domain, Path: empty
   - Service: `HTTP` → `localhost:3100`
4. **Keep it public.** If a Cloudflare Access application covers the whole
   domain (`*.your-domain`), guests would hit a login screen. Either make sure
   this hostname isn't covered, or add an Access app for just this hostname
   with a *Bypass → Everyone* policy. The link token is what protects it.
5. **Tell backdrop the address.** Add to `/opt/screenview/backdrop/.env`:
   ```sh
   REMOTE_UPLOAD_URL=https://backdrop-upload.your-domain
   ```
   then `sudo systemctl restart screenview.service`.
6. Open the control UI → Library → QR button. Scan it with a phone on mobile
   data (Wi-Fi off) to check it works from outside.

## Env

| Variable | Default | |
|---|---|---|
| `REMOTE_UPLOAD_URL` | none | Public https address of the tunnel. Without it the QR dialog shows setup hints. |
| `REMOTE_UPLOAD_PORT` | `3100` | Upload-only listener. `0` turns remote uploads off. |
| `REMOTE_UPLOAD_HOST` | `127.0.0.1` | Bind address. Keep it on localhost when cloudflared runs in the same container. |
| `REMOTE_UPLOAD_FOLDER` | `Remote uploads` | Library folder new files go into. |
