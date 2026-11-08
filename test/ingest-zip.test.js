const test = require('node:test');
const assert = require('node:assert/strict');
const { zipEntryDecision } = require('../ingest-zip');

const ALLOWED = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v'];
const d = (name) => zipEntryDecision(name, ALLOWED);

test('media files are extracted flat', () => {
  assert.deepEqual(d('Promo/Videos/Teaser.MP4'), { action: 'extract', name: 'Teaser.MP4' });
  assert.deepEqual(d('flyer.jpg'), { action: 'extract', name: 'flyer.jpg' });
  assert.deepEqual(d('a\\b\\c.png'), { action: 'extract', name: 'c.png' });
});

test('junk is ignored', () => {
  assert.deepEqual(d('Promo/'), { action: 'ignore' });
  assert.deepEqual(d('__MACOSX/Promo/._flyer.jpg'), { action: 'ignore' });
  assert.deepEqual(d('Promo/.DS_Store'), { action: 'ignore' });
  assert.deepEqual(d('.hidden/flyer.jpg'), { action: 'ignore' });
  assert.deepEqual(d('Promo/Thumbs.db'), { action: 'ignore' });
});

test('non-media is listed as skipped', () => {
  assert.deepEqual(d('Promo/Rider.pdf'), { action: 'skip', name: 'Rider.pdf', reason: 'Kein Bild oder Video' });
  assert.deepEqual(d('logo.eps'), { action: 'skip', name: 'logo.eps', reason: 'Kein Bild oder Video' });
});

test('path traversal never leaves the folder', () => {
  assert.deepEqual(d('../../etc/evil.jpg'), { action: 'skip', name: 'evil.jpg', reason: 'Ungültiger Pfad' });
  assert.deepEqual(d('/abs/evil.png'), { action: 'extract', name: 'evil.png' });
});
