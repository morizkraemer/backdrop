/**
 * Phone uploads (setup/REMOTE-UPLOAD.md): a second, upload-only web server on
 * its own port. It serves one page and the upload endpoints, all under
 * /u/<token>, and nothing else, so people who scan the QR code never get the
 * control UI. By default the QR points at this port on the LAN; it can also
 * sit behind a Cloudflare Tunnel (REMOTE_UPLOAD_URL) to work from outside.
 *
 * Files arrive in chunks: a dropped Wi-Fi connection resumes instead of
 * starting over, and Cloudflare rejects request bodies over 100 MB.
 */
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const CHUNK_SIZE = 32 * 1024 * 1024;
const MAX_PENDING = 20;
const PENDING_TTL_MS = 60 * 60 * 1000; // partial uploads idle this long are dropped

function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * @param {object} opts
 * @param {object} opts.config      app config (uploadsDir, maxFileSize, minFreeDisk, remoteUpload*)
 * @param {string[]} opts.allowedExt
 * @param {() => number} opts.getDiskFree
 * @param {(name: string) => string} opts.sanitizeFilename
 * @param {(file: {filename, originalName, size}, folderName: string) => object} opts.addToLibrary
 */
function createRemoteUpload({ config, allowedExt, getDiskFree, sanitizeFilename, addToLibrary }) {
  const settingsPath = config.remoteUploadSettingsPath;
  const partialDir = path.join(config.uploadsDir, '.partial');
  const publicUrl = (config.remoteUploadUrl || '').replace(/\/+$/, '');
  const pending = new Map(); // id -> { name, size, received, file, busy, touchedAt }

  let settings = loadSettings();

  function loadSettings() {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (typeof s.token === 'string' && s.token.length >= 16) {
        return { enabled: s.enabled !== false, token: s.token };
      }
    } catch (_) {}
    const s = { enabled: true, token: newToken() };
    saveSettings(s);
    return s;
  }

  function saveSettings(s) {
    const tmp = `${settingsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
    fs.renameSync(tmp, settingsPath);
  }

  // Without a public URL, use the address the control UI was opened with,
  // on the upload port: phones on the same network can reach that
  function linkUrl(req) {
    const base = publicUrl || `http://${req.hostname.includes(':') ? `[${req.hostname}]` : req.hostname}:${config.remoteUploadPort}`;
    return `${base}/u/${settings.token}`;
  }

  // Leftovers from a restart or abandoned phones
  fs.rmSync(partialDir, { recursive: true, force: true });
  fs.mkdirSync(partialDir, { recursive: true });
  setInterval(() => {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, p] of pending) {
      if (!p.busy && p.touchedAt < cutoff) dropPending(id);
    }
  }, 10 * 60 * 1000).unref();

  function dropPending(id) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    fs.rm(p.file, { force: true }, () => {});
  }

  function dropAllPending() {
    for (const id of [...pending.keys()]) {
      if (!pending.get(id).busy) dropPending(id);
    }
  }

  // --- control API (LAN app only) ---

  async function status(req) {
    const url = linkUrl(req);
    return {
      enabled: settings.enabled,
      url,
      public: !!publicUrl,
      // Opened as localhost, the QR would point phones at themselves
      localOnly: !publicUrl && /^(localhost|127\.|::1$)/.test(req.hostname),
      qr: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
      folderName: config.remoteUploadFolder,
    };
  }

  const controlRouter = express.Router();

  controlRouter.get('/', async (req, res) => {
    res.json(await status(req));
  });

  controlRouter.put('/', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
    settings = { ...settings, enabled: req.body.enabled };
    saveSettings(settings);
    if (!settings.enabled) dropAllPending();
    res.json(await status(req));
  });

  // A new link makes every printed or shared QR code stop working
  controlRouter.post('/rotate', async (req, res) => {
    settings = { ...settings, token: newToken() };
    saveSettings(settings);
    dropAllPending();
    res.json(await status(req));
  });

  // --- upload-only app (its own port) ---

  const publicApp = express();
  publicApp.disable('x-powered-by');
  publicApp.set('trust proxy', true);
  publicApp.use((req, res, next) => {
    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    next();
  });

  const pagePath = path.join(__dirname, 'remote', 'upload.html');
  const closedPage = (res) => res.status(404).type('html').send(
    '<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><title>backdrop</title>'
    + '<body style="font:16px system-ui;background:#111214;color:#ececee;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;padding:24px">'
    + '<p>This upload link is closed.<br><span style="color:#9a9da4">Ask for a new QR code.</span></p>',
  );

  function checkToken(req, res, next) {
    if (!settings.enabled || !sameToken(req.params.token, settings.token)) {
      if (req.method === 'GET' && !req.params.id) return closedPage(res);
      return res.status(403).json({ error: 'This upload link is closed' });
    }
    next();
  }

  function getPending(req, res) {
    const p = pending.get(req.params.id);
    if (!p) res.status(404).json({ error: 'Upload not found, start again' });
    return p;
  }

  publicApp.get('/u/:token', checkToken, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(pagePath);
  });

  publicApp.post('/u/:token/files', checkToken, express.json({ limit: '4kb' }), (req, res) => {
    const name = sanitizeFilename(req.body?.name);
    const size = Number(req.body?.size);
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!allowedExt.includes(ext)) return res.status(400).json({ error: `Format not allowed: ${ext || 'none'}` });
    if (!Number.isSafeInteger(size) || size <= 0) return res.status(400).json({ error: 'Empty file' });
    if (size > config.maxFileSize) return res.status(413).json({ error: 'File too large' });
    if (pending.size >= MAX_PENDING) return res.status(429).json({ error: 'Too many uploads at once, try again shortly' });
    const reserved = [...pending.values()].reduce((sum, p) => sum + p.size - p.received, 0);
    if (getDiskFree() - reserved - size < config.minFreeDisk) return res.status(507).json({ error: 'Not enough space on backdrop' });

    const id = crypto.randomBytes(12).toString('hex');
    const file = path.join(partialDir, id);
    fs.writeFileSync(file, '');
    pending.set(id, { name, size, received: 0, file, busy: false, touchedAt: Date.now() });
    res.status(201).json({ id, chunkSize: CHUNK_SIZE });
  });

  // Lets a phone resume after a dropped connection
  publicApp.get('/u/:token/files/:id', checkToken, (req, res) => {
    const p = getPending(req, res);
    if (p) res.json({ received: p.received, size: p.size });
  });

  publicApp.put('/u/:token/files/:id', checkToken, (req, res) => {
    const p = getPending(req, res);
    if (!p) return;
    const offset = Number(req.query.offset);
    if (p.busy) return res.status(409).json({ error: 'Chunk already in progress', received: p.received });
    if (offset !== p.received) return res.status(409).json({ error: 'Wrong offset', received: p.received });

    p.busy = true;
    p.touchedAt = Date.now();
    const limit = Math.min(CHUNK_SIZE, p.size - p.received);
    let got = 0;
    let failed = false;
    const out = fs.createWriteStream(p.file, { flags: 'a' });

    const fail = (status, error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      // Cut back to the last whole chunk so the phone can retry it
      fs.truncate(p.file, p.received, () => {
        p.busy = false;
        if (!res.headersSent) res.status(status).json({ error, received: p.received });
      });
    };

    req.on('data', (buf) => {
      got += buf.length;
      if (got > limit) {
        fail(413, 'Chunk too large');
        req.destroy();
      }
    });
    req.on('close', () => {
      if (!req.complete) fail(400, 'Connection lost');
    });
    out.on('error', () => fail(500, 'Could not write file'));
    out.on('finish', () => {
      if (failed) return;
      if (got === 0) return fail(400, 'Empty chunk');
      p.received += got;
      p.busy = false;
      p.touchedAt = Date.now();
      res.json({ received: p.received });
    });
    req.pipe(out);
  });

  publicApp.post('/u/:token/files/:id/done', checkToken, (req, res) => {
    const p = getPending(req, res);
    if (!p) return;
    if (p.busy || p.received !== p.size) return res.status(409).json({ error: 'Upload incomplete', received: p.received });
    pending.delete(req.params.id);
    const id = crypto.randomUUID().replace(/-/g, '');
    const filename = `${id}-${p.name}`;
    try {
      fs.renameSync(p.file, path.join(config.uploadsDir, filename));
    } catch (err) {
      fs.rm(p.file, { force: true }, () => {});
      return res.status(500).json({ error: 'Could not save file' });
    }
    addToLibrary({ filename, originalName: p.name, size: p.size }, config.remoteUploadFolder);
    res.json({ ok: true });
  });

  publicApp.delete('/u/:token/files/:id', checkToken, (req, res) => {
    const p = getPending(req, res);
    if (!p) return;
    if (!p.busy) dropPending(req.params.id);
    res.json({ ok: true });
  });

  publicApp.use((req, res) => res.status(404).type('text').send('Not found'));

  return { controlRouter, publicApp };
}

module.exports = { createRemoteUpload, CHUNK_SIZE };
