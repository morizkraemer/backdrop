# Server Access & Deployment

How to reach the running backdrop install and push updates to it.

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

The app was renamed from "Screenview" to "backdrop". System-level names
(Linux user, `/opt/screenview`, socket paths, service names)
intentionally still say `screenview`.

- Code: `/opt/screenview/backdrop` (git checkout, owned by `screenview`, branch `main`)
- Processes: two systemd services, both running as `screenview`:
  - `screenview-mpv.service` drives the panel (mpv, IPC socket `/run/screenview/mpv.sock`, audio via PulseAudio)
  - `screenview.service` is the Node server, which connects to that socket
- Restarting `screenview.service` leaves mpv and the screen running; the
  server reconnects and replays the current cue. Restart `screenview-mpv`
  only when mpv itself is stuck.
- Secrets: `.env` in the repo dir (`BT_HOST`, `BT_USER`, `BT_PASSWORD` for the Bluetooth Pi), loaded by `screenview.service`
- LED brightness: the server talks to the NovaStar controller at `192.168.178.173` by default ([NOVASTAR.md](NOVASTAR.md)). Override with `NOVA_HOST` in `.env`, or set `NOVA_HOST=` (empty) to hide the control.
- HDMI matrix: the server talks to the ezcoo matrix over TCP port 23 ([HDMI-MATRIX.md](HDMI-MATRIX.md)). It tries `w550-010203` (its DHCP hostname) and then `192.168.178.211`. Override with `HDMI_HOST` in `.env` (comma-separated, first that answers wins), or set `HDMI_HOST=` (empty) to hide the control.
- `/etc/sudoers.d/screenview` (from `setup/sudoers-screenview`) lets `screenview` run `systemctl restart screenview.service`, which the deploy job needs.

Run git as `screenview`, not root: git refuses the repo as root ("dubious ownership").

## Deploying an update

Merging to `main` deploys automatically. The `CI` workflow
(`.github/workflows/ci.yml`) syntax-checks every PR and push; on `main` its
`deploy` job runs on a self-hosted GitHub Actions runner inside the
container, which runs `scripts/deploy.sh`:

- fast-forwards `/opt/screenview/backdrop` to `origin/main`
- runs `npm ci --omit=dev` if `package.json` or `package-lock.json` changed
- restarts `screenview.service` unless only `public/`, docs or `setup/` changed

Changes to the unit files in `setup/` are not applied automatically; copy
them to `/etc/systemd/system/` and `systemctl daemon-reload` by hand.

The container is only reachable on the LAN, so GitHub can't push to it. The
runner instead polls GitHub over an outbound connection. To redeploy by hand,
run the workflow from the Actions tab, or on the container:

```bash
ssh root@192.168.178.75 'runuser -u screenview -- /opt/screenview/backdrop/scripts/deploy.sh'
```

### Installing the runner (once)

1. On GitHub: **Settings → Actions → Runners → New self-hosted runner**,
   Linux x64. Keep the page open for the download URL and token.
2. On the container, as root:

```bash
mkdir -p /opt/screenview/actions-runner && cd /opt/screenview/actions-runner
curl -fsSL -o runner.tar.gz <download URL from the GitHub page>
tar xzf runner.tar.gz && rm runner.tar.gz
chown -R screenview:screenview .
runuser -u screenview -- ./config.sh --unattended \
  --url https://github.com/morizkraemer/backdrop --token <token> \
  --name backdrop --labels backdrop
./svc.sh install screenview
./svc.sh start
```

The runner service runs as `screenview`, so git behaves as described above. Check it with `./svc.sh status` or under Settings → Actions → Runners.

Because the repo is public, keep **Settings → Actions → General → Fork pull
request workflows** on "Require approval for all external contributors", so
nobody else's PR can run code on the runner without you approving it.

## Status & logs

```bash
ssh root@192.168.178.75 'systemctl status screenview screenview-mpv'
ssh root@192.168.178.75 'journalctl -u screenview -u screenview-mpv -n 100 --no-pager'
```
