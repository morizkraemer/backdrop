# Screenview Setup Guide

Deploy the Screenview media signage app in a Proxmox LXC container, driving a 2304×768 LED panel via mpv with DRM output.

## 1. LXC Container

Create a **privileged** Debian 12 LXC container in Proxmox.

Add GPU passthrough to `/etc/pve/lxc/<container-id>.conf`:

```
lxc.cgroup2.devices.allow: c 226:* rwm
lxc.mount.entry: /dev/dri dev/dri none bind,optional,create=dir
```

This gives the container access to the host's Intel UHD 770 iGPU.

## 2. HDMI Resolution (2304×768)

The LED panel uses a non-standard resolution. Configure at the **host** level (the LXC uses the host kernel's DRM).

**Option A – Kernel command line** (in `/etc/default/grub`):

```
GRUB_CMDLINE_LINUX="video=HDMI-A-1:2304x768@60 consoleblank=0"
```

Then run `update-grub` and reboot.

**Option B** – If the LED sending card's EDID reports 2304×768, it may work without changes.

**Finding the connector name:** Run `ls /sys/class/drm/` on the host. Connectors are named like `card0-HDMI-A-1`, `card0-DP-1`, etc. Use the part after `card0-` (e.g. `HDMI-A-1`).

## 3. Console Blanking

Disable console blanking so the display does not go dark:

```
GRUB_CMDLINE_LINUX="... consoleblank=0"
```

## 4. Packages (inside LXC)

```bash
apt update
apt install -y nodejs npm mpv
```

If Node.js is too old, use [NodeSource](https://github.com/nodesource/distributions) for Node 20 LTS.

## 5. User and Permissions

```bash
useradd -r -s /bin/false screenview
mkdir -p /opt/screenview
chown -R screenview:screenview /opt/screenview
```

## 6. Deploy Application

Copy the Screenview files to `/opt/screenview`:

```
/opt/screenview/
  package.json
  config.js
  server.js
  mpv-controller.js
  state.js
  public/
  uploads/
  setup/
```

Install dependencies:

```bash
cd /opt/screenview
npm install --production
```

## 7. systemd Services

```bash
cp /opt/screenview/setup/screenview-mpv.service /etc/systemd/system/
cp /opt/screenview/setup/screenview.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable screenview-mpv screenview
systemctl start screenview-mpv screenview
```

## 8. Verification

- **mpv**: `systemctl status screenview-mpv` – should show active
- **Node**: `systemctl status screenview` – should show active
- **Control page**: Open `http://<container-ip>:3000/control` from a device on the LAN
- **Display**: mpv should show a window (or fullscreen on the LED panel if configured)

## Dev Mode (macOS/Linux)

For local development without DRM:

**Terminal 1 – mpv (windowed):**

```bash
mpv --idle --force-window=yes --input-ipc-server=/tmp/screenview-mpv.sock \
    --geometry=1280x720 --no-osc --no-osd-bar --no-input-default-bindings
```

**Terminal 2 – server:**

```bash
MPV_SOCKET=/tmp/screenview-mpv.sock NODE_ENV=development node server.js
```

Then open `http://localhost:3000/control`.
