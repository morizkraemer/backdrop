# Server Access & Deployment

How to reach the running Backdrop install and push updates to it.

> This repo is public. Do not commit passwords or keys here. Access is
> SSH-key based; secrets live only in `/opt/screenview/backdrop/.env` on the
> container (gitignored).

## Machines

| What | Address | User | Auth |
|------|---------|------|------|
| Proxmox host (`bhf`) | `192.168.178.18` | `root` | SSH key |
| LXC 102 `backdrop` (Debian 13) | `192.168.178.75` | `root` | SSH key |
| Control page | `http://192.168.178.75:3000/control` | – | – |

The container gets its IP via DHCP (`net0: ip=dhcp`). Reserve
`192.168.178.75` on the router, or installed web apps and these docs break.

## Connecting

Directly to the container:

```bash
ssh root@192.168.178.75
```

Via the Proxmox host (works even if the container's sshd or key is broken):

```bash
ssh root@192.168.178.18
pct enter 102                      # interactive shell
pct exec 102 -- <command>          # one-off command
```

### Granting access to a new machine

Copy its public key onto the host and into the container:

```bash
ssh-copy-id root@192.168.178.18
ssh root@192.168.178.18 "pct exec 102 -- bash -c 'cat >> /root/.ssh/authorized_keys'" < ~/.ssh/id_ed25519.pub
```

## How the app runs

The app was renamed from "Screenview" to "Backdrop". System-level names
(Linux user, `/opt/screenview`, PM2 process, socket paths, service files)
intentionally still say `screenview`.

- Code: `/opt/screenview/backdrop` (git checkout, owned by `screenview`, branch `feature/implementation`)
- Process: PM2 as user `screenview`, `PM2_HOME=/opt/screenview/.pm2`, app name `screenview`, running `npm run start:all:prod`
- Boot: `pm2-screenview.service` (systemd) resurrects PM2. The `screenview*.service` units from SETUP.md are **not** used.
- Secrets: `.env` in the repo dir (`BT_HOST`, `BT_USER`, `BT_PASSWORD` for the Bluetooth Pi)

Run git and PM2 as `screenview`, not root. Root has its own empty PM2, and
git refuses the repo as root ("dubious ownership").

```bash
alias svpm2='runuser -u screenview -- env PM2_HOME=/opt/screenview/.pm2 pm2'
```

## Deploying an update

From your Mac, after pushing to `feature/implementation`:

```bash
ssh root@192.168.178.75 'cd /opt/screenview/backdrop && runuser -u screenview -- git pull --ff-only'
```

- Changes only under `public/`: live immediately, no restart needed.
- Server JS or `package.json` changes: restart (and `npm install` if deps changed):

```bash
ssh root@192.168.178.75 'cd /opt/screenview/backdrop \
  && runuser -u screenview -- npm install --omit=dev \
  && runuser -u screenview -- env PM2_HOME=/opt/screenview/.pm2 pm2 restart screenview'
```

## Status & logs

```bash
ssh root@192.168.178.75 'runuser -u screenview -- env PM2_HOME=/opt/screenview/.pm2 pm2 status'
ssh root@192.168.178.75 'runuser -u screenview -- env PM2_HOME=/opt/screenview/.pm2 pm2 logs screenview --lines 100 --nostream'
```
