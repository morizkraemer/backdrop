/**
 * EPS uploads: mpv and browsers can't show EPS, so an uploaded .eps is rendered
 * to a transparent PNG with Ghostscript (apt install ghostscript) and the PNG
 * replaces it in the uploads folder. Transparent areas show the wall's black
 * background.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Render big enough to cover the 2304x768 panel (the default "fill" mode), but cap
// the size so a tiny bounding box can't blow up into a huge bitmap
const WALL_W = 2304;
const WALL_H = 768;
const MAX_SIDE = 8192;
const FALLBACK_DPI = 300;

function isEps(filename) {
  return /\.eps$/i.test(filename);
}

// The EPS bounding box in points, from its DSC header: { w, h } or null.
// DOS EPS files start with a binary header that points at the PostScript part.
function readBoundingBox(filePath) {
  let buf;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(30);
      fs.readSync(fd, head, 0, 30, 0);
      let start = 0;
      if (head.readUInt32BE(0) === 0xc5d0d3c6) start = head.readUInt32LE(4);
      buf = Buffer.alloc(256 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, start);
      buf = buf.subarray(0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return null;
  }
  const text = buf.toString('latin1');
  const m = text.match(/^%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/m)
    || text.match(/^%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/m);
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  const w = x2 - x1;
  const h = y2 - y1;
  return w > 0 && h > 0 ? { w, h } : null;
}

function renderDpi(box) {
  if (!box) return FALLBACK_DPI;
  const cover = Math.max(WALL_W / box.w, WALL_H / box.h) * 72;
  const cap = (MAX_SIDE / Math.max(box.w, box.h)) * 72;
  return Math.max(36, Math.round(Math.min(cover, cap)));
}

/**
 * Renders uploadsDir/filename (an .eps) to a PNG next to it and deletes the EPS.
 * Resolves to { filename, size } of the PNG. Rejects with a readable message if
 * Ghostscript is missing or can't read the file; the EPS is deleted either way.
 */
function convertEps(uploadsDir, filename) {
  const src = path.join(uploadsDir, filename);
  const outName = `${filename.replace(/\.eps$/i, '')}.png`;
  const out = path.join(uploadsDir, outName);
  const dpi = renderDpi(readBoundingBox(src));
  const args = [
    '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE',
    '-sDEVICE=pngalpha',
    '-dEPSCrop',
    '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
    `-r${dpi}`,
    `-sOutputFile=${out}`,
    src,
  ];
  return new Promise((resolve, reject) => {
    execFile('gs', args, { timeout: 60000 }, (err, stdout, stderr) => {
      fs.rm(src, { force: true }, () => {});
      let size = 0;
      try {
        size = fs.statSync(out).size;
      } catch (_) {}
      if (err || !size) {
        fs.rm(out, { force: true }, () => {});
        if (err && err.code === 'ENOENT') return reject(new Error('EPS needs Ghostscript on the server (apt install ghostscript)'));
        console.warn(`EPS conversion failed for ${filename}:`, (stderr || err?.message || 'no output').toString().trim());
        return reject(new Error('Could not read this EPS file'));
      }
      resolve({ filename: outName, size });
    });
  });
}

module.exports = { isEps, convertEps };
