const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createResolvers, wetransfer, dropbox, gdrive, filenameFromDisposition, filenameFromUrl,
  isPrivateAddress, assertPublicHost,
} = require('../ingest-links');

const ALLOWED = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v'];
const r = createResolvers(ALLOWED);
const providerOf = (url) => r.match(url)?.provider.name ?? null;

test('WeTransfer download links', () => {
  assert.deepEqual(r.match('https://wetransfer.com/downloads/abc123def456/0011aabb').parsed,
    { transferId: 'abc123def456', securityHash: '0011aabb' });
  assert.deepEqual(r.match('https://wetransfer.com/downloads/abc123def456/rcpt9999/0011aabb?utm=x').parsed,
    { transferId: 'abc123def456', recipientId: 'rcpt9999', securityHash: '0011aabb' });
  assert.equal(providerOf('https://bhf.wetransfer.com/downloads/abc123def456/0011aabb'), 'wetransfer');
  assert.deepEqual(r.match('https://we.tl/t-AbCdEf123').parsed, { shortUrl: 'https://we.tl/t-AbCdEf123' });
  assert.equal(providerOf('https://wetransfer.com/'), null);
  assert.equal(providerOf('https://wetransfer.com/downloads/abc'), null);
  assert.equal(providerOf('https://notwetransfer.com/downloads/abc123def456/0011aabb'), null);
});

test('WeTransfer API request', () => {
  const plain = wetransfer.apiRequest({ transferId: 'abc123', securityHash: 'ffff' });
  assert.equal(plain.url, 'https://wetransfer.com/api/v4/transfers/abc123/download');
  assert.equal(plain.init.method, 'POST');
  assert.deepEqual(JSON.parse(plain.init.body), { security_hash: 'ffff', intent: 'entire_transfer' });
  const withRecipient = wetransfer.apiRequest({ transferId: 'abc123', securityHash: 'ffff', recipientId: 'r1' });
  assert.equal(JSON.parse(withRecipient.init.body).recipient_id, 'r1');
});

test('WeTransfer errors', async () => {
  const fakeFetch = (status, data) => async () => ({ status, ok: status < 300, json: async () => data });
  const p = { transferId: 'abc123', securityHash: 'ffff' };
  await assert.rejects(wetransfer.request(p, fakeFetch(404, {})), /Link abgelaufen/);
  await assert.rejects(wetransfer.request(p, fakeFetch(200, {})), /Link abgelaufen/);
  await assert.rejects(wetransfer.request(p, fakeFetch(500, {})), /HTTP 500/);
  const ok = await wetransfer.request(p, fakeFetch(200, { direct_link: 'https://download.wetransfer.com/x/y.zip' }));
  assert.equal(ok.url, 'https://download.wetransfer.com/x/y.zip');
});

test('Dropbox links get dl=1', () => {
  assert.equal(dropbox.match(new URL('https://www.dropbox.com/s/abc/flyer.png?dl=0')).url,
    'https://www.dropbox.com/s/abc/flyer.png?dl=1');
  assert.equal(r.match('https://www.dropbox.com/scl/fi/xyz/clip.mp4?rlkey=k1&dl=0').parsed.url,
    'https://www.dropbox.com/scl/fi/xyz/clip.mp4?rlkey=k1&dl=1');
  assert.equal(r.match('https://www.dropbox.com/scl/fo/xyz/folder?rlkey=k1').parsed.url,
    'https://www.dropbox.com/scl/fo/xyz/folder?rlkey=k1&dl=1');
  assert.equal(providerOf('https://www.dropbox.com/home'), null);
});

test('Google Drive file links', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUv';
  assert.equal(r.match(`https://drive.google.com/file/d/${id}/view?usp=sharing`).parsed.id, id);
  assert.equal(r.match(`https://drive.google.com/open?id=${id}`).parsed.id, id);
  assert.equal(r.match(`https://drive.google.com/uc?id=${id}&export=download`).parsed.id, id);
  assert.equal(gdrive.downloadUrl(id), `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
  assert.equal(providerOf('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv'), null);
});

test('Direct links by extension, http(s) only', () => {
  assert.equal(providerOf('https://example.com/media/Flyer%20A.JPG'), 'direct');
  assert.equal(providerOf('https://example.com/clip.mp4?sig=1'), 'direct');
  assert.equal(providerOf('https://example.com/pack.zip'), 'direct');
  assert.equal(providerOf('https://example.com/page.html'), null);
  assert.equal(providerOf('ftp://example.com/a.jpg'), null);
  assert.equal(providerOf('file:///etc/a.jpg'), null);
  assert.equal(providerOf('not a url'), null);
});

test('File names from Content-Disposition and URL', () => {
  assert.equal(filenameFromDisposition('attachment; filename="Kapa Tula.mp4"'), 'Kapa Tula.mp4');
  assert.equal(filenameFromDisposition("attachment; filename=\"x.mp4\"; filename*=UTF-8''Gr%C3%BC%C3%9Fe.mp4"), 'Grüße.mp4');
  assert.equal(filenameFromDisposition('attachment; filename=plain.png'), 'plain.png');
  assert.equal(filenameFromDisposition(null), null);
  assert.equal(filenameFromUrl('https://x.test/a/b/Bild%201.png?x=1'), 'Bild 1.png');
  assert.equal(filenameFromUrl('https://x.test/'), null);
});

test('Private addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.178.75', '169.254.1.1',
    '100.101.37.10', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', '::ffff:7f00:1', '::ffff:c0a8:b24b']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '151.101.1.1', '2a00:1450:4001::1']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('LAN hosts are refused', async () => {
  const lookup = async (host) => (host === 'evil.test' ? [{ address: '192.168.178.1' }] : [{ address: '93.184.216.34' }]);
  await assert.rejects(assertPublicHost('localhost', lookup), /lokalen Netz/);
  await assert.rejects(assertPublicHost('192.168.178.75', lookup), /lokalen Netz/);
  await assert.rejects(assertPublicHost('[::1]', lookup), /lokalen Netz/);
  await assert.rejects(assertPublicHost('evil.test', lookup), /lokalen Netz/);
  await assertPublicHost('example.com', lookup);
  await assert.rejects(assertPublicHost(new URL('http://[::ffff:127.0.0.1]/a.png').hostname, lookup), /lokalen Netz/);
});
