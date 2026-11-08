/**
 * Mail ingest for Zentrale (setup/INGEST.md): Zentrale saves media from
 * incoming mails into the library, either by uploading an attachment or by
 * handing over a share link (WeTransfer, Dropbox, Google Drive, a direct file
 * link) that backdrop downloads itself in the background.
 *
 * Lives on the main app under /api/ingest and only answers the IPs in
 * INGEST_ALLOWED_IPS (Zentrale's VM). Without it the routes 404.
 * The control UI's "Link einfügen" calls addLink from its own route.
 */
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { pipeline, Readable, Transform } = require('stream');
const {
  createResolvers, parseUrl, isMediaType, isZipType, mimeOf, MEDIA_MIME_EXT,
  filenameFromDisposition, filenameFromUrl, assertPublicHost, IngestError,
} = require('./ingest-links');
const { isZipFile, extractMedia } = require('./ingest-zip');

const MAX_RUNNING = 2;
const MAX_REDIRECTS = 10;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000; // finished jobs are dropped after this
const PROBE_TIMEOUT_MS = 5000;
const DISK_CHECK_BYTES = 64 * 1024 * 1024;
const INTERRUPTED = 'Unterbrochen, bitte erneut senden';
const NO_MEDIA = 'Keine Bild- oder Videodateien gefunden';
const RUNNING = ['downloading', 'unpacking'];

function cleanText(value, max = 200) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) || null : null;
}

function validSourceId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f]/.test(value);
}

/**
 * @param {object} opts
 * @param {object} opts.config        app config (ingestAllowedIps, ingestJobsPath, uploadsDir, maxFileSize, minFreeDisk)
 * @param {string[]} opts.allowedExt
 * @param {object} opts.upload        the multer instance of /api/upload
 * @param {() => number} opts.getDiskFree
 * @param {(name: string) => string} opts.sanitizeFilename
 * @param {(sourceId: string) => object[]} opts.findBySource   library items with that source.sourceId
 * @param {(file: {filename, originalName, size}, where: {subfolder?, folderId?, source}) => object} opts.addItem
 * @param {(hostname: string) => Promise<void>} [opts.assertHost]  throws for hosts on the LAN (tests replace it)
 */
function createIngest({
  config, allowedExt, upload, getDiskFree, sanitizeFilename, findBySource, addItem, assertHost = assertPublicHost,
}) {
  const jobsPath = config.ingestJobsPath;
  const partialDir = path.join(config.uploadsDir, '.partial');
  const resolvers = createResolvers(allowedExt);
  const jobs = new Map(); // jobId -> job
  const queue = []; // jobIds waiting for a download slot
  let running = 0;
  let saveTimer = null;

  fs.mkdirSync(partialDir, { recursive: true });
  loadJobs();

  function loadJobs() {
    let list = [];
    try {
      list = JSON.parse(fs.readFileSync(jobsPath, 'utf8')).jobs || [];
    } catch (_) {}
    for (const job of list) {
      if (!job?.jobId) continue;
      // A download that was cut off by a restart can't resume
      if (RUNNING.includes(job.status)) Object.assign(job, { status: 'failed', error: INTERRUPTED, finishedAt: new Date().toISOString() });
      jobs.set(job.jobId, job);
      if (job.status === 'queued') queue.push(job.jobId);
    }
    // Leftover downloads of this module from before the restart
    try {
      for (const f of fs.readdirSync(partialDir)) {
        if (f.startsWith('ingest-')) fs.rmSync(path.join(partialDir, f), { force: true });
      }
    } catch (_) {}
    prune();
    saveJobs();
    pump();
  }

  function saveJobs() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      const tmp = `${jobsPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ jobs: [...jobs.values()] }, null, 2), 'utf8');
      fs.renameSync(tmp, jobsPath);
    } catch (err) {
      console.warn('Could not save ingest jobs:', err.message);
    }
  }

  // Progress changes often; it only needs to survive a restart roughly
  function saveSoon() {
    if (!saveTimer) saveTimer = setTimeout(saveJobs, 2000).unref();
  }

  function prune() {
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, job] of jobs) {
      const finished = Date.parse(job.finishedAt || job.updatedAt || job.createdAt || 0);
      if (['done', 'failed'].includes(job.status) && finished < cutoff) jobs.delete(id);
    }
  }
  setInterval(() => {
    prune();
    saveJobs();
  }, 24 * 60 * 60 * 1000).unref();

  function itemView(m) {
    return { id: m.id, folderId: m.folderId ?? null, filename: m.filename, originalName: m.originalName, type: m.type };
  }

  function jobView(job) {
    return {
      jobId: job.jobId,
      sourceId: job.sourceId,
      provider: job.provider,
      status: job.status,
      receivedBytes: job.receivedBytes,
      totalBytes: job.totalBytes,
      items: job.items,
      skipped: job.skipped,
      error: job.error,
    };
  }

  function update(job, patch, { now = true } = {}) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    if (['done', 'failed'].includes(job.status)) job.finishedAt = job.updatedAt;
    if (now) saveJobs();
    else saveSoon();
  }

  // --- Fetching: redirects are followed by hand so every hop is checked
  // against the LAN (the server sits on the venue network) ---

  async function safeFetch(url, init = {}) {
    let current = url;
    let opts = { ...init };
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new IngestError('Nur http- und https-Links');
      await assertHost(u.hostname);
      const res = await fetch(current, {
        ...opts,
        redirect: 'manual',
        headers: { 'user-agent': 'backdrop', 'accept-encoding': 'identity', ...opts.headers },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        res.body?.cancel().catch(() => {});
        current = new URL(location, current).href;
        // Like a browser: a redirected POST continues as a plain GET
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && opts.method === 'POST')) {
          const { body, headers = {}, ...rest } = opts;
          const { 'content-type': _, ...keep } = headers;
          opts = { ...rest, method: 'GET', headers: keep };
        }
        continue;
      }
      return res;
    }
    throw new IngestError('Zu viele Weiterleitungen');
  }

  // A direct link without a media extension: does it answer with a picture or video?
  async function probeDirect(url) {
    const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    for (const method of ['HEAD', 'GET']) {
      try {
        const res = await safeFetch(url, { method, signal });
        res.body?.cancel().catch(() => {});
        if (res.ok) {
          const type = res.headers.get('content-type');
          if (isMediaType(type) || isZipType(type)) return true;
          if (method === 'GET' || mimeOf(type)) return false;
        }
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  // --- Jobs ---

  function findJobBySource(sourceId) {
    for (const job of jobs.values()) if (job.sourceId === sourceId) return job;
    return null;
  }

  /**
   * Starts (or returns) the download of a share link.
   * @returns {Promise<{ status: number, body: object }>}
   */
  // Two sends of the same link at once (e.g. Zentrale retrying) share one answer
  const adding = new Map(); // sourceId -> Promise
  function addLink(opts) {
    const key = opts?.sourceId;
    if (adding.has(key)) return adding.get(key);
    const p = addLinkNow(opts).finally(() => adding.delete(key));
    if (validSourceId(key)) adding.set(key, p);
    return p;
  }

  async function addLinkNow({ url, sourceId, sender, subject, subfolder, folderId, origin = 'email' }) {
    if (typeof url !== 'string' || !url.trim()) return { status: 400, body: { error: 'url required' } };
    if (!validSourceId(sourceId)) return { status: 400, body: { error: 'sourceId required (string, max 128 chars)' } };

    const existing = findJobBySource(sourceId);
    if (existing && existing.status !== 'failed') return { status: 200, body: jobView(existing) };

    let match = resolvers.match(url);
    if (!match) {
      const parsed = parseUrl(url);
      if (parsed && await probeDirect(parsed.href)) match = { provider: resolvers.direct, parsed: { url: parsed.href } };
    }
    if (!match) return { status: 400, body: { error: 'unsupported_link' } };

    // Already in the library (e.g. the job list was cleared): nothing to download
    const items = findBySource(sourceId);
    const now = new Date().toISOString();
    const base = {
      sourceId,
      provider: match.provider.name,
      url: url.trim(),
      sender: cleanText(sender),
      subject: cleanText(subject),
      subfolder: cleanText(subfolder),
      folderId,
      origin,
      receivedBytes: 0,
      totalBytes: null,
      items: [],
      skipped: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    if (items.length) {
      const job = { jobId: existing?.jobId ?? crypto.randomUUID(), ...base, status: 'done', items: items.map(itemView), finishedAt: now };
      jobs.set(job.jobId, job);
      saveJobs();
      return { status: 200, body: jobView(job) };
    }

    // A failed job starts over under the same id
    const job = existing || { jobId: crypto.randomUUID() };
    Object.assign(job, base, { jobId: job.jobId, createdAt: existing?.createdAt ?? now, status: 'queued' });
    jobs.set(job.jobId, job);
    saveJobs();
    queue.push(job.jobId);
    pump();
    return { status: 202, body: { jobId: job.jobId, status: 'queued' } };
  }

  function pump() {
    while (running < MAX_RUNNING && queue.length) {
      const job = jobs.get(queue.shift());
      if (!job || job.status !== 'queued') continue;
      running++;
      runJob(job)
        .catch((err) => {
          const message = err instanceof IngestError ? err.message : 'Download fehlgeschlagen';
          if (!(err instanceof IngestError)) console.warn(`Ingest job ${job.jobId} failed:`, err.message);
          update(job, { status: 'failed', error: message });
        })
        .finally(() => {
          running--;
          pump();
        });
    }
  }

  function httpError(provider, status) {
    if (status === 404 || status === 410) return new IngestError(provider.name === 'gdrive' ? 'Datei nicht gefunden oder nicht freigegeben' : 'Link abgelaufen');
    if (status === 401 || status === 403) return new IngestError(provider.name === 'gdrive' ? 'Datei ist nicht öffentlich freigegeben' : 'Kein Zugriff auf den Link');
    return new IngestError(`Download fehlgeschlagen (HTTP ${status})`);
  }

  function checkSpace(bytes) {
    if (getDiskFree() - bytes < config.minFreeDisk) throw new IngestError('Nicht genug Speicherplatz auf backdrop');
  }

  // Moves a finished file into uploads/ as <uuid>-<name> and adds it to the library
  function addFile(job, file, name, size) {
    const filename = `${crypto.randomUUID().replace(/-/g, '')}-${name}`;
    fs.renameSync(file, path.join(config.uploadsDir, filename));
    const source = job.origin === 'email'
      ? { kind: 'email', sourceId: job.sourceId, sender: job.sender, subject: job.subject, url: job.url }
      : { kind: 'link', sourceId: job.sourceId, url: job.url };
    return addItem({ filename, originalName: name, size }, { subfolder: job.subfolder, folderId: job.folderId, source });
  }

  async function runJob(job) {
    update(job, { status: 'downloading', receivedBytes: 0, totalBytes: null, items: [], skipped: [], error: null });
    const { provider, parsed } = resolvers.match(job.url) || { provider: resolvers.direct, parsed: { url: job.url } };
    const target = await provider.request(parsed, safeFetch);
    const res = await safeFetch(target.url, target.init);
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      throw httpError(provider, res.status);
    }
    const type = res.headers.get('content-type');
    if (mimeOf(type) === 'text/html' || !res.body) {
      res.body?.cancel().catch(() => {});
      throw new IngestError(provider.htmlError || 'Link zeigt auf keine Datei');
    }

    const length = Number(res.headers.get('content-length'));
    const totalBytes = Number.isSafeInteger(length) && length > 0 ? length : null;
    if (totalBytes && totalBytes > config.maxFileSize) {
      res.body.cancel().catch(() => {});
      throw new IngestError('Datei zu groß');
    }
    try {
      checkSpace(totalBytes || 0);
    } catch (err) {
      res.body.cancel().catch(() => {});
      throw err;
    }
    update(job, { totalBytes });

    let name = sanitizeFilename(filenameFromDisposition(res.headers.get('content-disposition'))
      || filenameFromUrl(res.url) || filenameFromUrl(job.url) || 'download');
    const download = path.join(partialDir, `ingest-${job.jobId}`);
    let received = 0;
    let sinceCheck = 0;
    const counter = new Transform({
      transform(chunk, enc, cb) {
        received += chunk.length;
        sinceCheck += chunk.length;
        if (received > config.maxFileSize) return cb(new IngestError('Datei zu groß'));
        if (sinceCheck >= DISK_CHECK_BYTES) {
          sinceCheck = 0;
          try { checkSpace(0); } catch (err) { return cb(err); }
        }
        job.receivedBytes = received;
        saveSoon();
        cb(null, chunk);
      },
    });
    try {
      await new Promise((resolve, reject) => {
        pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(download), (err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      fs.rmSync(download, { force: true });
      throw err instanceof IngestError ? err : new IngestError('Download abgebrochen');
    }
    update(job, { receivedBytes: received });

    try {
      if (isZipType(type) || isZipFile(download)) {
        update(job, { status: 'unpacking' });
        const { files, skipped } = await extractMedia(download, {
          outDir: partialDir,
          prefix: `ingest-${job.jobId}-`,
          allowedExt,
          maxBytes: config.maxFileSize,
          checkDisk: checkSpace,
        });
        if (!files.length) throw Object.assign(new IngestError(NO_MEDIA), { skipped });
        const items = files.map((f) => addFile(job, f.file, sanitizeFilename(f.name), f.size));
        update(job, { status: 'done', items: items.map(itemView), skipped });
        return;
      }

      // One file: a missing extension comes from its Content-Type
      let ext = path.extname(name).slice(1).toLowerCase();
      if (!allowedExt.includes(ext) && MEDIA_MIME_EXT[mimeOf(type)]) {
        ext = MEDIA_MIME_EXT[mimeOf(type)];
        name = sanitizeFilename(`${name}.${ext}`);
      }
      if (!allowedExt.includes(ext)) {
        throw Object.assign(new IngestError(NO_MEDIA), { skipped: [{ name, reason: 'Kein Bild oder Video' }] });
      }
      const item = addFile(job, download, name, received);
      update(job, { status: 'done', items: [itemView(item)] });
    } catch (err) {
      if (err.skipped) job.skipped = err.skipped;
      throw err;
    } finally {
      fs.rmSync(download, { force: true });
    }
  }

  // --- Routes (Zentrale) ---

  const router = express.Router();

  router.use((req, res, next) => {
    if (!config.ingestAllowedIps?.length) return res.status(404).json({ error: 'Not found' });
    // The socket's address, never X-Forwarded-For: only Zentrale's VM may call this
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
    if (!config.ingestAllowedIps.includes(ip)) return res.status(403).json({ error: 'Not allowed from this address' });
    next();
  });

  // One attachment
  router.post('/', (req, res) => {
    if (getDiskFree() < config.minFreeDisk) return res.status(507).json({ error: 'Insufficient disk space' });
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      const drop = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
      const { sourceId } = req.body || {};
      if (!validSourceId(sourceId)) {
        drop();
        return res.status(400).json({ error: 'sourceId required (string, max 128 chars)' });
      }
      const existing = findBySource(sourceId);
      if (existing.length) {
        drop();
        return res.status(200).json({ status: 'done', items: existing.map(itemView) });
      }
      if (!req.file) return res.status(400).json({ error: 'No file' });

      const item = addItem(
        { filename: req.file.filename, originalName: sanitizeFilename(req.file.originalname), size: req.file.size },
        {
          subfolder: cleanText(req.body.subfolder),
          source: { kind: 'email', sourceId, sender: cleanText(req.body.sender), subject: cleanText(req.body.subject) },
        },
      );
      res.status(201).json({ status: 'done', items: [itemView(item)] });
    });
  });

  // A share link, downloaded in the background
  router.post('/url', async (req, res) => {
    const b = req.body || {};
    const { status, body } = await addLink({
      url: b.url, sourceId: b.sourceId, sender: b.sender, subject: b.subject, subfolder: b.subfolder,
    });
    res.status(status).json(body);
  });

  router.get('/jobs/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(jobView(job));
  });

  // The control UI's link dialog: the latest jobs, newest first
  function recentJobs(limit = 8) {
    return [...jobs.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit)
      .map((job) => ({
        ...jobView(job),
        url: job.url,
        origin: job.origin,
        sender: job.sender,
        subject: job.subject,
        createdAt: job.createdAt,
        names: job.items.map((i) => i.originalName),
      }));
  }

  return { router, addLink, recentJobs };
}

module.exports = { createIngest, validSourceId };
