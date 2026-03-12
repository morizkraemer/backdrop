const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  mpvSocket: process.env.MPV_SOCKET || '/run/screenview/mpv.sock',
  uploadsDir: process.env.UPLOADS_DIR || './uploads',
  statePath: process.env.STATE_PATH || path.join(__dirname, 'state.json'),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || String(1024 * 1024 * 1024), 10),
  minFreeDisk: parseInt(process.env.MIN_FREE_DISK || String(500 * 1024 * 1024), 10),
  isDev: process.env.NODE_ENV !== 'production',
};
