const path = require('path');

const maxFileSize = Math.max(0, parseInt(process.env.MAX_FILE_SIZE || String(1024 * 1024 * 1024), 10));
const minFreeDisk = Math.max(0, parseInt(process.env.MIN_FREE_DISK || String(500 * 1024 * 1024), 10));

const isDev = process.env.NODE_ENV !== 'production';
const spawnMpv = isDev || process.env.SPAWN_MPV === '1';

module.exports = {
  port: Math.max(1, parseInt(process.env.PORT || '3000', 10)),
  mpvSocket: process.env.MPV_SOCKET || (isDev ? '/tmp/screenview-mpv.sock' : '/run/screenview/mpv.sock'),
  uploadsDir: process.env.UPLOADS_DIR || './uploads',
  statePath: process.env.STATE_PATH || path.join(__dirname, 'state.json'),
  maxFileSize: maxFileSize || 1024 * 1024 * 1024,
  minFreeDisk: minFreeDisk || 500 * 1024 * 1024,
  isDev,
  spawnMpv,
};
