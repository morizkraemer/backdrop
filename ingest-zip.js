/**
 * Unpacking zips from share links (setup/INGEST.md): folders are flattened,
 * Mac and hidden junk is ignored, anything that isn't an allowed image or
 * video is listed as skipped. Extraction stops once the unpacked bytes pass
 * the limit, so a zip bomb can't fill the disk.
 */
const fs = require('fs');
const path = require('path');
const { pipeline, Transform } = require('stream');
const yauzl = require('yauzl');
const { IngestError } = require('./ingest-links');

const MAX_ENTRIES = 5000;

/**
 * What to do with one zip entry, from its name alone:
 * { action: 'ignore' } for folders and junk, { action: 'skip', name, reason }
 * for files that aren't media, { action: 'extract', name } otherwise, where
 * name is the bare file name (folders flattened).
 */
function zipEntryDecision(entryName, allowedExt) {
  const normalized = String(entryName || '').replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return { action: 'ignore' };
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('__MACOSX')) return { action: 'ignore' };
  const name = parts[parts.length - 1] || '';
  if (parts.includes('..')) return { action: 'skip', name, reason: 'Ungültiger Pfad' };
  if (!name || name.startsWith('.') || parts.some((p) => p.startsWith('.'))) return { action: 'ignore' };
  if (name === 'Thumbs.db' || name === 'desktop.ini') return { action: 'ignore' };
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!allowedExt.includes(ext)) return { action: 'skip', name, reason: 'Kein Bild oder Video' };
  return { action: 'extract', name };
}

function isZipFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    const n = fs.readSync(fd, buf, 0, 4, 0);
    return n === 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Extracts the media files of `zipPath` into `outDir` as <prefix><n>, one at a time.
 * @returns {Promise<{ files: { file, name, size }[], skipped: { name, reason }[] }>}
 *   The caller moves the files into place; on a throw they're already removed.
 */
function extractMedia(zipPath, { outDir, prefix, allowedExt, maxBytes, checkDisk = () => {}, isCancelled = () => false }) {
  return new Promise((resolve, reject) => {
    const files = [];
    const skipped = [];
    let total = 0;
    let count = 0;
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      if (err) {
        for (const f of files) fs.rm(f.file, { force: true }, () => {});
        reject(err);
      } else resolve({ files, skipped });
    };

    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: false }, (openErr, zip) => {
      if (openErr) return finish(new IngestError('Zip-Datei ist beschädigt'));
      const fail = (err) => {
        zip.close();
        finish(err);
      };
      zip.on('error', () => fail(new IngestError('Zip-Datei ist beschädigt')));
      zip.on('end', () => finish());
      zip.on('entry', (entry) => {
        if (done) return;
        if (isCancelled()) return fail(new IngestError('Abgebrochen'));
        if (++count > MAX_ENTRIES) return fail(new IngestError('Zu viele Dateien im Zip'));
        const decision = zipEntryDecision(entry.fileName, allowedExt);
        if (decision.action === 'ignore') return zip.readEntry();
        if (decision.action === 'skip') {
          skipped.push({ name: decision.name, reason: decision.reason });
          return zip.readEntry();
        }
        // eslint-disable-next-line no-bitwise
        if (entry.generalPurposeBitFlag & 0x1) {
          skipped.push({ name: decision.name, reason: 'Verschlüsselt' });
          return zip.readEntry();
        }
        if (total + entry.uncompressedSize > maxBytes) return fail(new IngestError('Entpackt zu groß'));
        try {
          checkDisk(entry.uncompressedSize);
        } catch (err) {
          return fail(err);
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) {
            skipped.push({ name: decision.name, reason: 'Nicht lesbar' });
            return zip.readEntry();
          }
          const file = path.join(outDir, `${prefix}${files.length}`);
          let size = 0;
          // Counts what really comes out, whatever the zip's headers claim
          const counter = new Transform({
            transform(chunk, enc, cb) {
              size += chunk.length;
              total += chunk.length;
              if (total > maxBytes) return cb(new IngestError('Entpackt zu groß'));
              cb(null, chunk);
            },
          });
          pipeline(stream, counter, fs.createWriteStream(file), (err) => {
            if (err) {
              fs.rm(file, { force: true }, () => {});
              return fail(err instanceof IngestError ? err : new IngestError('Zip-Datei ist beschädigt'));
            }
            files.push({ file, name: decision.name, size });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

module.exports = { zipEntryDecision, isZipFile, extractMedia, MAX_ENTRIES };
