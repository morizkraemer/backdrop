# Event highlights from Zentrale

Zentrale renders a highlight video for each event of the day (the upcoming events of that event's Promo-Gruppen,
2304×768, seamless loop) and publishes it in its LED feed. backdrop polls that feed and keeps one built-in library
item per event of the day, **Highlights: <event>**, pinned at the top of the library. Put them in the cue list like any
clip (Loop on); whoever runs the cues picks which one plays.

Zentrale's side of the contract is `docs/led-feed.md` in the Zentrale repo (branch `feature/led-daily-highlights`
until it's merged).

## Setup

1. In Zentrale (Plakate & LED, Monatsplakat LED tab), copy "Link für die LED-App". It contains the share token.
2. On the box, add the feed link to `/opt/screenview/backdrop/.env`, with the prod VM's LAN address (the feed is
   reachable in the house network without a login):

   ```
   LED_FEED_URL=http://<VM-IP>:3001/s/<token>/led/today.json
   ```

3. `sudo systemctl restart screenview`. Within a minute the Highlights items show up at the top of the library.

Leave `LED_FEED_URL` empty to turn it off. `GET /api/highlights` shows the last check, the event and any error.
A `410` means the link was revoked in Zentrale ("Neuen Link erzeugen"): put the new one in `.env`.

## What it does

- Every minute it reads `today.json`. The day's events are slots in time order (doors, else start): the first event's
  item is `highlights`, the second's `highlights-2`, and so on. A cue on a slot keeps working the next day and plays
  that day's event in that slot. "Today" runs until 05:00, like in Zentrale.
- When a set's video link changes and its `status` is `ready`, the new MP4 is downloaded next to the uploads and
  swapped in once complete, and the item is renamed to the event. While Zentrale is still rendering (`202`), the old
  video keeps playing.
- If that item's cue is on the wall when the video is swapped, it starts again with the new one.
- A day with fewer events than the day before: the extra items and their cues go. The first item stays on a day
  without events (`sets: []`), with its last video: it still shows upcoming events.
- The items can't be renamed, moved into a folder or deleted.
