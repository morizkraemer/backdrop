/**
 * Event highlights from Zentrale (setup/HIGHLIGHTS.md): polls Zentrale's LED feed
 * (today.json) and keeps one built-in library item, "Highlights", on the video of
 * today's highlights. It goes into the cue list like any clip and is always today's:
 * a new video is downloaded in the background and swapped in once it's complete.
 *
 * Zentrale's contract: docs/led-feed.md on its side.
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ITEM_ID = 'highlights';
const POLL_MS = 60 * 1000;
const FEED_TIMEOUT_MS = 15 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
// With two events on a day, the second one's set takes over this long before its doors
const LEAD_MIN = 120;

// Minutes since midnight in Berlin (the feed's times are Berlin wall-clock times)
function berlinMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * The set to show now: of the sets that have a video, the last one whose doors
 * (or start) time is at most LEAD_MIN away, else the first. "Today" runs until
 * 05:00, so after midnight (before 05:00) it's late evening for the feed.
 */
function pickSet(sets, now = new Date()) {
  const withVideo = (sets || []).filter((s) => s && s.highlightLoop);
  if (!withVideo.length) return null;
  let mins = berlinMinutes(now);
  if (mins < 5 * 60) mins += 24 * 60;
  const timed = withVideo
    .map((s, i) => ({ s, i, t: toMinutes(s.doorsTime) ?? toMinutes(s.startTime) }))
    .sort((a, b) => (a.t ?? -1) - (b.t ?? -1) || a.i - b.i);
  let pick = timed[0];
  for (const x of timed) if (x.t == null || x.t - LEAD_MIN <= mins) pick = x;
  return pick.s;
}

function createHighlights({ config, state, broadcast, enrichMedia, removeThumbnail, onSwap }) {
  const feedUrl = config.ledFeedUrl;
  const status = {
    configured: !!feedUrl,
    lastCheck: null,
    error: null,
    date: null,
    eventName: null,
    video: null, // ready, rendering, failed, empty; null when nothing for today
  };
  let busy = false;

  function item() {
    return state.getState().library.find((m) => m.id === ITEM_ID) || null;
  }

  // Downloads `link` (a path on the feed's host) and puts it into the library item
  async function download(link, set, date) {
    const url = new URL(link, feedUrl);
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (res.status === 202) {
      await res.body?.cancel();
      status.video = 'rendering';
      return;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`video: HTTP ${res.status}`);
    }
    const stamp = (url.searchParams.get('v') || Date.now().toString(36)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const filename = `highlights-${date}-${stamp}.mp4`;
    const filePath = path.join(config.uploadsDir, filename);
    const tmp = `${filePath}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }

    const old = item();
    const next = {
      ...(old || { id: ITEM_ID, originalName: 'Highlights', folderId: null, builtin: true }),
      filename,
      type: 'video',
      size: fs.statSync(filePath).size,
      addedAt: new Date().toISOString(),
      source: link,
      eventName: set.eventName || null,
      date,
    };
    delete next.thumb;
    delete next.duration;
    state.updateState((s) => ({
      ...s,
      library: old ? s.library.map((m) => (m.id === ITEM_ID ? next : m)) : [next, ...s.library],
    }));
    if (old && old.filename !== filename) {
      // mpv may still have it open; on Linux it keeps reading the unlinked file
      fs.rmSync(path.join(config.uploadsDir, old.filename), { force: true });
      removeThumbnail(config.uploadsDir, old);
    }
    broadcast();
    enrichMedia(next);
    onSwap(ITEM_ID);
  }

  async function check() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(feedUrl, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`feed: HTTP ${res.status}${res.status === 410 ? ' (link revoked, make a new one in Zentrale)' : ''}`);
      const feed = await res.json();
      const set = pickSet(feed.sets);
      status.date = feed.date || null;
      status.eventName = set?.eventName ?? null;
      status.video = set?.status ?? null;
      // Nothing for today: the last video stays (it shows upcoming events anyway)
      if (set && set.status === 'ready' && item()?.source !== set.highlightLoop) {
        await download(set.highlightLoop, set, feed.date);
      }
      status.error = null;
    } catch (err) {
      status.error = err.message;
      console.warn('Highlights:', err.message);
    } finally {
      status.lastCheck = new Date().toISOString();
      busy = false;
    }
  }

  function start() {
    if (!feedUrl) return;
    check();
    setInterval(check, POLL_MS).unref();
  }

  return { start, check, status: () => ({ ...status, item: !!item() }), ITEM_ID };
}

module.exports = { createHighlights, pickSet, ITEM_ID };
