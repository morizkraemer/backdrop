/**
 * Event highlights from Zentrale (setup/HIGHLIGHTS.md): polls Zentrale's LED feed
 * (today.json) and keeps one built-in library item per event of the day, each on
 * that event's highlight video. The control page shows them above the cue list (not
 * in the library); they go into the cue list like any clip.
 *
 * Items are slots in the day's time order: "highlights" is the day's first event,
 * "highlights-2" the second, and so on, so a cue keeps working from day to day.
 * A new video is downloaded in the background and swapped in once complete.
 *
 * Zentrale's contract: docs/led-feed.md on its side.
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const POLL_MS = 60 * 1000;
const FEED_TIMEOUT_MS = 15 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SLOTS = 4;

const slotId = (i) => (i === 0 ? 'highlights' : `highlights-${i + 1}`);
const isHighlightsId = (id) => /^highlights(-\d+)?$/.test(id || '');

function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// The day's sets in time order (doors, else start; untimed last)
function sortSets(sets) {
  const t = (s) => toMinutes(s.doorsTime) ?? toMinutes(s.startTime) ?? Infinity;
  return (sets || []).filter(Boolean).map((s, i) => ({ s, i }))
    .sort((a, b) => t(a.s) - t(b.s) || a.i - b.i).map((x) => x.s)
    .slice(0, MAX_SLOTS);
}

function createHighlights({ config, state, broadcast, enrichMedia, removeThumbnail, getDiskFree, remove, onSwap }) {
  const feedUrl = config.ledFeedUrl;
  const status = {
    configured: !!feedUrl,
    lastCheck: null,
    error: null,
    date: null,
    events: [], // per slot: { id, eventName, doorsTime, video: ready|rendering|failed|empty }
  };
  let busy = false;

  const item = (id) => state.getState().library.find((m) => m.id === id) || null;

  // Downloads the slot's video and puts it into its library item
  async function download(id, slot, set, date) {
    if (getDiskFree() < config.minFreeDisk) throw new Error(`${set.eventName}: not enough disk space`);
    const url = new URL(set.highlightLoop, feedUrl);
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (res.status === 202) {
      await res.body?.cancel();
      return;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`${set.eventName}: video HTTP ${res.status}`);
    }
    const stamp = (url.searchParams.get('v') || Date.now().toString(36)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    const filename = `${id}-${date}-${stamp}.mp4`;
    const filePath = path.join(config.uploadsDir, filename);
    const tmp = `${filePath}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }

    const old = item(id);
    const next = {
      ...(old || { id, folderId: null }),
      builtin: true,
      slot,
      originalName: set.eventName ? `Highlights for ${set.eventName}` : `Highlights ${date}`,
      filename,
      type: 'video',
      size: fs.statSync(filePath).size,
      addedAt: new Date().toISOString(),
      source: set.highlightLoop,
      eventName: set.eventName || null,
      date,
    };
    delete next.thumb;
    delete next.duration;
    state.updateState((s) => ({
      ...s,
      library: old ? s.library.map((m) => (m.id === id ? next : m)) : [next, ...s.library],
    }));
    if (old && old.filename !== filename) {
      // mpv may still have it open; on Linux it keeps reading the unlinked file
      fs.rmSync(path.join(config.uploadsDir, old.filename), { force: true });
      removeThumbnail(config.uploadsDir, old);
    }
    broadcast();
    enrichMedia(next);
    onSwap(id);
  }

  async function check() {
    if (busy) return;
    busy = true;
    const errors = [];
    try {
      const res = await fetch(feedUrl, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`feed: HTTP ${res.status}${res.status === 410 ? ' (link revoked, make a new one in Zentrale)' : ''}`);
      const feed = await res.json();
      const sets = sortSets(feed.sets);
      status.date = feed.date || null;
      status.events = sets.map((s, i) => ({
        id: slotId(i), eventName: s.eventName, doorsTime: s.doorsTime ?? null, video: s.status,
      }));

      for (const [i, set] of sets.entries()) {
        const id = slotId(i);
        if (set.status !== 'ready' || !set.highlightLoop || item(id)?.source === set.highlightLoop) continue;
        try {
          await download(id, i + 1, set, feed.date);
        } catch (err) {
          errors.push(err.message);
        }
      }

      // Fewer events than yesterday: the extra items (and their cues) go. The
      // first one stays on a day without events: it still shows upcoming events.
      const extra = state.getState().library
        .filter((m) => isHighlightsId(m.id) && m.id !== slotId(0) && (m.slot ?? 1) > sets.length)
        .map((m) => m.id);
      if (extra.length) remove(extra);
    } catch (err) {
      errors.push(err.message);
    } finally {
      status.error = errors.join('; ') || null;
      if (status.error) console.warn('Highlights:', status.error);
      status.lastCheck = new Date().toISOString();
      busy = false;
    }
  }

  function start() {
    if (!feedUrl) return;
    check();
    setInterval(check, POLL_MS).unref();
  }

  return { start, check, status: () => ({ ...status }) };
}

module.exports = { createHighlights, sortSets, slotId, isHighlightsId };
