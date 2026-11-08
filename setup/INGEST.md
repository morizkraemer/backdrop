# Mail ingest (Zentrale)

Zentrale, the production app (repo `morizkraemer/BHF-Prod-`, on another VM of
the same Proxmox), reads the mails that bands and promoters send and saves
their media into backdrop's library:

- **Attachments**: Zentrale uploads the file (`POST /api/ingest`).
- **Share links** (WeTransfer, Dropbox, Google Drive, direct file links):
  Zentrale hands over the link (`POST /api/ingest/url`) and backdrop downloads
  it itself, in the background, and unpacks zips.

Everything lands in the library folder **Aus E-Mails** (`INGEST_FOLDER`),
optionally in a subfolder per mail or event (e.g. `Kapa Tula · 12.11.`). In
the control UI an item from a mail shows "Aus Mail: <sender> · <subject>" in
its ⋮ menu and in the cue inspector.

The same downloads are behind **Link einfügen** (the link button in the
Library header): paste a WeTransfer/Dropbox/Drive link and the files land in
the folder that's open. That button calls the server directly and needs no
token, since the control UI is LAN only.

```
Zentrale VM ──http, Bearer token──▶ 192.168.178.75:3000/api/ingest*
                                            │  (links: downloads from WeTransfer etc.)
                                            ▼
                          uploads/ + library folder "Aus E-Mails/<subfolder>"
```

The routes live on the main app (port 3000), which is LAN only. Never put port
3000 behind a tunnel or port forward; the phone-upload listener on 3100 is
separate and has nothing to do with this.

## Setup

1. Make a token, e.g. `openssl rand -base64 32`.
2. In `/opt/screenview/backdrop/.env` set `INGEST_TOKEN=<token>` and
   `sudo systemctl restart screenview.service`.
3. In Zentrale set `BACKDROP_INGEST_TOKEN=<the same token>` (and backdrop's
   address, `http://192.168.178.75:3000`).

Without `INGEST_TOKEN` every `/api/ingest*` route answers 404 (feature off).

### Rotating the token

Change `INGEST_TOKEN` here (restart `screenview.service`) and
`BACKDROP_INGEST_TOKEN` in Zentrale. Until both match, Zentrale gets 401.

## Env

| Variable | Default | |
|---|---|---|
| `INGEST_TOKEN` | none | Bearer token for `/api/ingest*`. Empty = routes answer 404. |
| `INGEST_FOLDER` | `Aus E-Mails` | Root library folder for everything from Zentrale. |
| `INGEST_JOBS` | `ingest-jobs.json` next to the code | Where link jobs are kept (git-ignored). |

`MAX_FILE_SIZE` and `MIN_FREE_DISK` apply as for normal uploads. Only the
usual image and video formats become library items.

## Contract

Every request needs `Authorization: Bearer <INGEST_TOKEN>`. Wrong or missing
token: `401 { error }`.

`sourceId` is Zentrale's id for the attachment or link (string, required, max
128 chars). It makes both endpoints idempotent: if library items with that
`source.sourceId` already exist, they're returned instead of adding copies.

Every created item gets
`source: { kind: 'email', sourceId, sender, subject, url }` (`url` only for
links). Items in responses look like
`{ id, folderId, filename, originalName, type }`.

### `POST /api/ingest`: one attachment

`multipart/form-data`: `file` (one file), `sourceId`, optional `sender`,
`subject`, `subfolder`.

| Status | Body |
|---|---|
| 201 | `{ status: 'done', items: [...] }` |
| 200 | same, when the sourceId already exists (no new copy) |
| 400 | `{ error }`: format not allowed, missing sourceId or file |
| 413 | file larger than `MAX_FILE_SIZE` |
| 507 | disk below `MIN_FREE_DISK` |

### `POST /api/ingest/url`: a share link

JSON `{ url, sourceId, sender?, subject?, subfolder? }`. Answers right away;
the download runs in the background.

| Status | Body |
|---|---|
| 202 | `{ jobId, status: 'queued' }`: new job (or a failed one restarted, same jobId) |
| 200 | the existing job (any status) for this sourceId if queued, running or done |
| 400 | `{ error: 'unsupported_link' }`: no resolver recognises the URL |

### `GET /api/ingest/jobs/:jobId`

```json
{ "jobId": "…", "sourceId": "…", "provider": "wetransfer", "status": "downloading",
  "receivedBytes": 1048576, "totalBytes": 52428800, "items": [], "skipped": [], "error": null }
```

- `status`: `queued` | `downloading` | `unpacking` | `done` | `failed`
- `provider`: `wetransfer` | `dropbox` | `gdrive` | `direct`
- `totalBytes`: `null` when the server doesn't say
- `items`: filled when done
- `skipped`: `[{ name, reason }]` for files in a zip that weren't media
- `error`: short German text when failed, e.g. `Link abgelaufen`,
  `Keine Bild- oder Videodateien gefunden`, `Datei ist nicht öffentlich freigegeben`,
  `Datei zu groß`, `Nicht genug Speicherplatz auf backdrop`,
  `Unterbrochen, bitte erneut senden`
- 404 for an unknown job

Jobs are kept in `ingest-jobs.json` (git-ignored), so Zentrale can still ask
after a restart. Jobs that were downloading when the server stopped become
`failed` with "Unterbrochen, bitte erneut senden" (send the link again to
retry); queued ones carry on. At most 2 downloads run at once. Finished jobs
are dropped after 30 days.

## Links

One resolver per provider (`ingest-links.js`):

- **WeTransfer**: `we.tl/…` (the redirect is followed) and
  `wetransfer.com/downloads/<transferId>/<securityHash>` or
  `/downloads/<transferId>/<recipientId>/<securityHash>`. backdrop asks
  `https://wetransfer.com/api/v4/transfers/<transferId>/download` for the
  file link, which is what WeTransfer's own page does. That API is
  unofficial and may change; an expired or deleted transfer fails with "Link
  abgelaufen". Several files arrive as one zip.
- **Dropbox**: `dropbox.com/s/…`, `/scl/fi/…` (a file) and `/scl/fo/…` (a
  folder, arrives as a zip), downloaded with `dl=1`.
- **Google Drive**: `drive.google.com/file/d/<id>/…` and `open?id=<id>`.
  Only works when shared with "anyone with the link"; otherwise Google
  answers with a page and the job fails with "Datei ist nicht öffentlich
  freigegeben". Drive folders aren't supported.
- **Direct**: any other http(s) link whose path ends in an image/video
  extension (or `.zip`), or that answers with an `image/*` or `video/*`
  Content-Type.

Only http and https. Every host along the way (redirects included) must
resolve to a public address: links to the LAN, localhost, Tailscale (100.64/10)
and the like are refused, since the server sits on the venue network.

## Download and unpack

- Downloads stream to `uploads/.partial/`. `Content-Length` is checked against
  `MAX_FILE_SIZE` and the free disk before starting; a stream that goes over
  is cut off.
- The file name comes from `Content-Disposition`, else the URL. A file without
  an extension gets one from its Content-Type.
- Zips (by Content-Type or their first bytes) are unpacked: folders are
  flattened, `__MACOSX/`, dotfiles and `Thumbs.db` are ignored, other non-media
  files are listed in `skipped`. Entries with `..` in their path are skipped.
  Unpacking stops (and the job fails) once the unpacked bytes pass
  `MAX_FILE_SIZE`. The zip is deleted afterwards.
- Nothing usable inside: `failed` with "Keine Bild- oder Videodateien gefunden".

## Tests

`npm test` runs the resolver, zip-filter and route tests (`test/`), with a
local file server and no internet.
