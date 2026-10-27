# backdrop Setup Guide

> For access to the live install and deploy steps, see [ACCESS.md](ACCESS.md).

Deploy the backdrop media signage app in a Proxmox LXC container, driving a 2304×768 LED panel via mpv with DRM output.

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
apt install -y nodejs npm mpv ffmpeg   # ffmpeg is optional: video thumbnails and lengths
```

If Node.js is too old, use [NodeSource](https://github.com/nodesource/distributions) for Node 20 LTS.

## 5. User and Permissions

```bash
useradd -r -s /bin/false screenview
mkdir -p /opt/screenview
chown -R screenview:screenview /opt/screenview
```

## 6. Deploy Application

Clone the repo as `screenview` and install dependencies:

```bash
cd /opt/screenview
runuser -u screenview -- git clone https://github.com/morizkraemer/backdrop.git
cd backdrop
runuser -u screenview -- npm ci --omit=dev
```

Later updates deploy automatically from `main`; see [ACCESS.md](ACCESS.md).

## 7. systemd Services

Set up audio (section 8) first: the mpv unit outputs to PulseAudio.

```bash
cd /opt/screenview/backdrop
cp setup/screenview-mpv.service setup/screenview.service /etc/systemd/system/
install -m 0440 setup/sudoers-screenview /etc/sudoers.d/screenview   # needs: apt install sudo
systemctl daemon-reload
systemctl enable --now screenview-mpv screenview
```

## 8. Audio (Snapcast to Raspberry Pi)

Route audio from mpv through PulseAudio → Snapcast → a Raspberry Pi with speakers.

### On the backdrop LXC:

```bash
apt install -y pulseaudio pulseaudio-utils alsa-utils socat snapserver

# Create the Snapcast FIFO
mkfifo /tmp/snapfifo
chmod 666 /tmp/snapfifo

# Reduce Snapcast buffer for low latency
sed -i 's/#buffer = 1000/buffer = 200/' /etc/snapserver.conf

# Install PulseAudio service
cp /opt/screenview/setup/pulseaudio-screenview.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable pulseaudio-screenview snapserver
systemctl start pulseaudio-screenview snapserver
```

`screenview-mpv.service` sets `PULSE_SERVER` and `XDG_RUNTIME_DIR` so mpv
reaches this PulseAudio instance (uid 1000 is `screenview`).

### On the Raspberry Pi:

```bash
apt install -y snapclient

# Configure to connect to backdrop and output to USB audio
cat > /etc/default/snapclient <<EOF
SNAPCLIENT_OPTS="--host <backdrop-ip> --soundcard hw:CODEC --hostID bhf-audio"
EOF

systemctl enable snapclient
systemctl start snapclient
```

## 9. Verification

- **mpv**: `systemctl status screenview-mpv` – should show active
- **Node**: `systemctl status screenview` – should show active
- **Control page**: Open `http://<container-ip>:3000/control` from a device on the LAN
- **Display**: mpv should show a window (or fullscreen on the LED panel if configured)

## Dev Mode (macOS/Linux)

For local development, let the server spawn mpv in a window:

```bash
npm run dev
```

Then open `http://localhost:3000/control`. mpv opens in a 1280×720 window.

To run mpv yourself instead (e.g. for debugging), start it with an IPC socket and run the server without `SPAWN_MPV`:

```bash
mpv --idle --force-window=yes --input-ipc-server=/tmp/screenview-mpv.sock &
NODE_ENV=development npm start
```
