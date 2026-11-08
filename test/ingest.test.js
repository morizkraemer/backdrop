// The ingest routes end to end, against a local file server (no internet)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const multer = require('multer');
const { createIngest } = require('../ingest');
const { sameToken } = require('../remote-upload');

const ALLOWED = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v'];
const TOKEN = 'test-token-0123456789';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// A minimal zip (stored entries) without a zip library
function makeZip(entries) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-test-'));
  const uploadsDir = path.join(dir, 'uploads');
  fs.mkdirSync(uploadsDir);
  const config = {
    ingestToken: TOKEN,
    ingestJobsPath: path.join(dir, 'jobs.json'),
    uploadsDir,
    maxFileSize: 1024 * 1024,
    minFreeDisk: 0,
  };
  const library = [];
  const upload = multer({
    storage: multer.diskStorage({ destination: uploadsDir, filename: (req, f, cb) => cb(null, `${'a'.repeat(32)}-${f.originalname}`) }),
    limits: { fileSize: config.maxFileSize },
    fileFilter: (req, f, cb) => (ALLOWED.includes(path.extname(f.originalname).slice(1).toLowerCase()) ? cb(null, true) : cb(new Error('Format not allowed'))),
  });
  const ingest = createIngest({
    config,
    allowedExt: ALLOWED,
    upload,
    getDiskFree: () => 1e12,
    sanitizeFilename: (n) => path.basename(n || '') || 'unnamed',
    sameToken,
    findBySource: (id) => library.filter((m) => m.source?.sourceId === id),
    addItem: (file, where) => {
      const item = { id: file.filename.slice(0, 32), ...file, type: /\.(mp4|mov)$/i.test(file.filename) ? 'video' : 'image', folderId: where.subfolder || 'root', source: where.source };
      library.push(item);
      return item;
    },
    assertHost: async () => {},
  });
  const app = express();
  app.use(express.json());
  app.use('/api/ingest', ingest.router);
  return { app, ingest, library, config, dir };
}

const files = express();
files.get('/flyer.png', (req, res) => res.type('png').send(PNG));
files.get('/noext', (req, res) => res.type('image/jpeg').send(PNG));
files.get('/page', (req, res) => res.type('html').send('<html></html>'));
files.get('/gone.png', (req, res) => res.status(404).end());
files.get('/big.png', (req, res) => res.type('png').send(Buffer.alloc(2 * 1024 * 1024)));
files.get('/redirect.png', (req, res) => res.redirect('/flyer.png'));
files.get('/pack', (req, res) => res.type('application/octet-stream')
  .set('content-disposition', 'attachment; filename="pack.zip"')
  .send(makeZip([
    ['Promo/Flyer.png', PNG],
    ['Promo/Rider.pdf', Buffer.from('%PDF')],
    ['__MACOSX/Promo/._Flyer.png', Buffer.from('x')],
    ['Promo/.DS_Store', Buffer.from('x')],
    ['Teaser.mp4', Buffer.from('fake mp4')],
  ])));
// The name comes from Content-Disposition, the zip from its bytes
files.get('/pack.zip', (req, res) => res.redirect('/pack'));
files.get('/junk.zip', (req, res) => res.type('application/zip').send(makeZip([['notes.txt', Buffer.from('hi')]])));

let filesBase;
const servers = [];
async function listen(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
test.before(async () => { filesBase = await listen(files); });
test.after(() => servers.forEach((s) => s.close()));

async function call(base, method, url, body, token = TOKEN) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  return { status: res.status, body: await res.json() };
}

async function waitJob(base, jobId) {
  for (let i = 0; i < 100; i++) {
    const { body } = await call(base, 'GET', `/api/ingest/jobs/${jobId}`);
    if (['done', 'failed'].includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('job did not finish');
}

test('token: 401 when wrong, 404 when ingest is off', async () => {
  const { app, config } = setup();
  const base = await listen(app);
  assert.equal((await call(base, 'GET', '/api/ingest/jobs/x', null, null)).status, 401);
  assert.equal((await call(base, 'GET', '/api/ingest/jobs/x', null, 'wrong')).status, 401);
  assert.equal((await call(base, 'GET', '/api/ingest/jobs/x')).status, 404);
  config.ingestToken = null;
  assert.equal((await call(base, 'GET', '/api/ingest/jobs/x')).status, 404);
});

test('attachment: 201, then 200 for the same sourceId', async () => {
  const { app, library } = setup();
  const base = await listen(app);
  const form = () => {
    const f = new FormData();
    f.append('sourceId', 'att-1');
    f.append('sender', 'Kapa Tula <band@example.com>');
    f.append('subject', 'Visuals');
    f.append('subfolder', 'Kapa Tula · 12.11.');
    f.append('file', new Blob([PNG]), 'flyer.png');
    return f;
  };
  const first = await call(base, 'POST', '/api/ingest', form());
  assert.equal(first.status, 201);
  assert.equal(first.body.status, 'done');
  assert.deepEqual(Object.keys(first.body.items[0]).sort(), ['filename', 'folderId', 'id', 'originalName', 'type']);
  assert.deepEqual(library[0].source, { kind: 'email', sourceId: 'att-1', sender: 'Kapa Tula <band@example.com>', subject: 'Visuals' });
  const again = await call(base, 'POST', '/api/ingest', form());
  assert.equal(again.status, 200);
  assert.equal(library.length, 1);

  const noId = new FormData();
  noId.append('file', new Blob([PNG]), 'flyer.png');
  assert.equal((await call(base, 'POST', '/api/ingest', noId)).status, 400);
  const pdf = new FormData();
  pdf.append('sourceId', 'att-2');
  pdf.append('file', new Blob(['%PDF']), 'rider.pdf');
  assert.equal((await call(base, 'POST', '/api/ingest', pdf)).status, 400);
  const big = new FormData();
  big.append('sourceId', 'att-3');
  big.append('file', new Blob([Buffer.alloc(2 * 1024 * 1024)]), 'big.png');
  assert.equal((await call(base, 'POST', '/api/ingest', big)).status, 413);
});

test('url: direct file, idempotent, follows redirects', async () => {
  const { app, library } = setup();
  const base = await listen(app);
  const start = await call(base, 'POST', '/api/ingest/url', { url: `${filesBase}/redirect.png`, sourceId: 'l-1', sender: 'x', subject: 'y' });
  assert.equal(start.status, 202);
  assert.equal(start.body.status, 'queued');
  const job = await waitJob(base, start.body.jobId);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.provider, 'direct');
  assert.equal(job.items[0].originalName, 'flyer.png');
  assert.equal(job.receivedBytes, PNG.length);
  assert.equal(library[0].source.url, `${filesBase}/redirect.png`);
  const again = await call(base, 'POST', '/api/ingest/url', { url: `${filesBase}/redirect.png`, sourceId: 'l-1' });
  assert.equal(again.status, 200);
  assert.equal(again.body.jobId, start.body.jobId);
  assert.equal(library.length, 1);
});

test('url: the same link sent twice at once becomes one job', async () => {
  const { app, library } = setup();
  const base = await listen(app);
  const body = { url: `${filesBase}/noext`, sourceId: 'twice' };
  const [a, b] = await Promise.all([call(base, 'POST', '/api/ingest/url', body), call(base, 'POST', '/api/ingest/url', body)]);
  assert.equal(a.body.jobId, b.body.jobId);
  await waitJob(base, a.body.jobId);
  assert.equal(library.length, 1);
});

test('url: Content-Type decides for links without an extension', async () => {
  const { app } = setup();
  const base = await listen(app);
  const start = await call(base, 'POST', '/api/ingest/url', { url: `${filesBase}/noext`, sourceId: 'l-2' });
  assert.equal(start.status, 202);
  const job = await waitJob(base, start.body.jobId);
  assert.equal(job.items[0].originalName, 'noext.jpg');
  const page = await call(base, 'POST', '/api/ingest/url', { url: `${filesBase}/page`, sourceId: 'l-3' });
  assert.deepEqual(page, { status: 400, body: { error: 'unsupported_link' } });
});

test('url: zip is unpacked, flattened and filtered', async () => {
  const { app, library, config } = setup();
  const base = await listen(app);
  const start = await call(base, 'POST', '/api/ingest/url', { url: `${filesBase}/pack.zip`, sourceId: 'z-2', subfolder: 'Gig' });
  assert.equal(start.status, 202);
  const job = await waitJob(base, start.body.jobId);
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(job.items.map((i) => i.originalName).sort(), ['Flyer.png', 'Teaser.mp4']);
  assert.deepEqual(job.skipped, [{ name: 'Rider.pdf', reason: 'Kein Bild oder Video' }]);
  assert.equal(library.every((m) => m.folderId === 'Gig'), true);
  assert.deepEqual(fs.readdirSync(path.join(config.uploadsDir, '.partial')), []);
});

test('url: failures', async () => {
  const { app } = setup();
  const base = await listen(app);
  const cases = [
    [`${filesBase}/gone.png`, 'Link abgelaufen'],
    [`${filesBase}/big.png`, 'Datei zu groß'],
    [`${filesBase}/junk.zip`, 'Keine Bild- oder Videodateien gefunden'],
  ];
  for (const [url, error] of cases) {
    const start = await call(base, 'POST', '/api/ingest/url', { url, sourceId: url });
    assert.equal(start.status, 202);
    const job = await waitJob(base, start.body.jobId);
    assert.equal(job.status, 'failed');
    assert.equal(job.error, error);
  }
  // A failed job starts again under the same id
  const retry = await call(base, 'POST', '/api/ingest/url', { url: `${filesBase}/gone.png`, sourceId: `${filesBase}/gone.png` });
  assert.equal(retry.status, 202);
  assert.equal((await call(base, 'POST', '/api/ingest/url', { url: 'ftp://x/a.png', sourceId: 'f' })).body.error, 'unsupported_link');
  assert.equal((await call(base, 'POST', '/api/ingest/url', { url: `${filesBase}/a.png` })).status, 400);
});

test('jobs survive a restart; running ones fail', async () => {
  const { config } = setup();
  fs.writeFileSync(config.ingestJobsPath, JSON.stringify({
    jobs: [
      { jobId: 'j1', sourceId: 's1', status: 'downloading', items: [], skipped: [], createdAt: new Date().toISOString() },
      { jobId: 'j2', sourceId: 's2', status: 'done', items: [], skipped: [], createdAt: '2020-01-01T00:00:00Z', finishedAt: '2020-01-01T00:00:00Z' },
    ],
  }));
  const ingest = createIngest({
    config, allowedExt: ALLOWED, upload: null, getDiskFree: () => 1e12, sanitizeFilename: (n) => n, sameToken,
    findBySource: () => [], addItem: () => {}, assertHost: async () => {},
  });
  const app = express();
  app.use('/api/ingest', ingest.router);
  const base = await listen(app);
  const j1 = await call(base, 'GET', '/api/ingest/jobs/j1');
  assert.equal(j1.body.status, 'failed');
  assert.equal(j1.body.error, 'Unterbrochen, bitte erneut senden');
  assert.equal((await call(base, 'GET', '/api/ingest/jobs/j2')).status, 404);
});
