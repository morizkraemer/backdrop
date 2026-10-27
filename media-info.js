/**
 * Thumbnails (videos and images) and video durations via ffmpeg/ffprobe.
 * Optional: if ffmpeg is not installed, media simply has no thumbnail.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const THUMB_DIR = '.thumbs';
const THUMB_WIDTH = 576; // 3:1 panel at a quarter of 2304x768

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

async function probeDuration(filePath) {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const sec = parseFloat(out.trim());
  return Number.isFinite(sec) ? sec : null;
}

async function makeThumbnail(filePath, outPath, duration) {
  // Grab a frame a little way in, so fade-ins don't give a black thumbnail
  // (stills get no -ss at all: seeking a single image yields no frame)
  const seek = duration ? ['-ss', String(Math.min(duration * 0.1, 3))] : [];
  await run('ffmpeg', [
    '-y', '-v', 'error',
    ...seek,
    '-i', filePath,
    '-frames:v', '1',
    // Never upscale small images
    '-vf', `scale='min(${THUMB_WIDTH},iw)':-2`,
    '-q:v', '4',
    outPath,
  ]);
}

/**
 * Returns { thumb, duration } for a library item. thumb is relative to uploadsDir;
 * duration is only probed for videos. Either field may be null when ffmpeg is
 * unavailable or the file can't be read.
 */
async function analyzeMedia(uploadsDir, item) {
  const filePath = path.resolve(uploadsDir, item.filename);
  const thumbRel = `${THUMB_DIR}/${item.id}.jpg`;
  const thumbPath = path.resolve(uploadsDir, thumbRel);
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });

  let duration = null;
  let thumb = null;
  if (item.type === 'video') {
    try {
      duration = await probeDuration(filePath);
    } catch (e) {
      console.warn(`ffprobe failed for ${item.originalName}:`, e.code === 'ENOENT' ? 'ffprobe not installed' : e.message);
    }
  }
  try {
    fs.rmSync(thumbPath, { force: true });
    await makeThumbnail(filePath, thumbPath, duration);
    if (!fs.existsSync(thumbPath)) throw new Error('ffmpeg wrote no frame');
    thumb = thumbRel;
  } catch (e) {
    console.warn(`Thumbnail failed for ${item.originalName}:`, e.code === 'ENOENT' ? 'ffmpeg not installed' : e.message);
  }
  return { thumb, duration };
}

function removeThumbnail(uploadsDir, item) {
  if (!item.thumb) return;
  try {
    fs.unlinkSync(path.resolve(uploadsDir, item.thumb));
  } catch (_) {}
}

module.exports = { analyzeMedia, removeThumbnail };
