const path = require('path');

const maxFileSize = Math.max(0, parseInt(process.env.MAX_FILE_SIZE || String(10 * 1024 * 1024 * 1024), 10));
const minFreeDisk = Math.max(0, parseInt(process.env.MIN_FREE_DISK || String(500 * 1024 * 1024), 10));

const isDev = process.env.NODE_ENV !== 'production';
const spawnMpv = process.env.SPAWN_MPV === '1';

module.exports = {
  port: Math.max(1, parseInt(process.env.PORT || '3000', 10)),
  mpvSocket: process.env.MPV_SOCKET || '/tmp/screenview-mpv.sock',
  uploadsDir: process.env.UPLOADS_DIR || './uploads',
  statePath: process.env.STATE_PATH || path.join(__dirname, 'state.json'),
  maxFileSize: maxFileSize || 10 * 1024 * 1024 * 1024,
  minFreeDisk: minFreeDisk || 500 * 1024 * 1024,
  isDev,
  spawnMpv,
  btHost: process.env.BT_HOST || null,
  btUser: process.env.BT_USER || 'bhf',
  btPassword: process.env.BT_PASSWORD || null,
  // NovaStar LED controller (setup/NOVASTAR.md). Set NOVA_HOST= (empty) to disable.
  novaHost: process.env.NOVA_HOST ?? '192.168.178.173',
  // ezcoo HDMI matrix (setup/HDMI-MATRIX.md): comma-separated hosts, tried in order until
  // one answers. Set HDMI_HOST= (empty) to disable.
  hdmiHosts: (process.env.HDMI_HOST ?? 'w550-010203,192.168.178.211')
    .split(',').map((h) => h.trim()).filter(Boolean),
  // Only this matrix output is used (it feeds the LED wall); inputs are named in order
  hdmiOutput: Math.max(1, parseInt(process.env.HDMI_OUTPUT || '1', 10)),
  hdmiSources: (process.env.HDMI_SOURCES || 'Backdrop,FOH,Stage,Balkon')
    .split(',').map((n) => n.trim()).filter(Boolean),
  // Upload-only server for the Cloudflare Tunnel (setup/REMOTE-UPLOAD.md).
  // REMOTE_UPLOAD_URL is the public https address the QR code points to.
  // Set REMOTE_UPLOAD_PORT=0 to turn remote uploads off.
  remoteUploadUrl: process.env.REMOTE_UPLOAD_URL || null,
  remoteUploadPort: Math.max(0, parseInt(process.env.REMOTE_UPLOAD_PORT ?? '3100', 10) || 0),
  remoteUploadHost: process.env.REMOTE_UPLOAD_HOST || '127.0.0.1',
  remoteUploadFolder: process.env.REMOTE_UPLOAD_FOLDER || 'Remote uploads',
  remoteUploadSettingsPath: process.env.REMOTE_UPLOAD_SETTINGS || path.join(__dirname, 'remote-upload.json'),
};
