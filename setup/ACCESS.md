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
(Linux user, `/opt/screenview`, PM2 process, socket paths, service files)
intentionally still say `screenview`.

- Code: `/opt/screenview/backdrop` (git checkout, owned by `screenview`, branch `main`)
- Process: PM2 as user `screenview`, `PM2_HOME=/opt/screenview/.pm2`, app name `screenview`, running `npm run start:all:prod`
- Boot: `pm2-screenview.service` (systemd) resurrects PM2. The `screenview*.service` units from SETUP.md are **not** used.
- Secrets: `.env` in the repo dir (`BT_HOST`, `BT_USER`, `BT_PASSWORD` for the Bluetooth Pi)

Run git and PM2 as `screenview`, not root. Root has its own empty PM2, and
git refuses the repo as root ("dubious ownership").

```bash
alias svpm2='runuser -u screenview -- env PM2_HOME=/opt/screenview/.pm2 pm2'
```

## Deploying an update

Merging to `main` deploys automatically. The `CI` workflow
(`.github/workflows/ci.yml`) syntax-checks every PR and push; on `main` its
`deploy` job runs on a self-hosted GitHub Actions runner inside the
container, which runs `scripts/deploy.sh`:

- fast-forwards `/opt/screenview/backdrop` to `origin/main`
- runs `npm ci` if `package.json` or `package-lock.json` changed
- restarts the `screenview` PM2 app unless only `public/`, docs or `setup/` changed

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

The runner service runs as `screenview`, so git and PM2 behave as in the
commands below. Check it with `./svc.sh status` or under Settings → Actions → Runners.

Because the repo is public, keep **Settings → Actions → General → Fork pull
request workflows** on "Require approval for all external contributors", so
nobody else's PR can run code on the runner without you approving it.

## Status & logs

```bash
ssh root@192.168.178.75 'runuser -u screenview -- env PM2_HOME=/opt/screenview/.pm2 pm2 status'
ssh root@192.168.178.75 'runuser -u screenview -- env PM2_HOME=/opt/screenview/.pm2 pm2 logs screenview --lines 100 --nostream'
```
