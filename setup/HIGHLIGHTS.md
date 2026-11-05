# Event highlights from Zentrale

Zentrale renders a highlight video for each event of the day (the upcoming events of that event's Promo-Gruppen,
2304×768, seamless loop) and publishes it in its LED feed. backdrop polls that feed and keeps one built-in library
item, **Highlights**, on today's video. Put it in the cue list once (Loop on, like any clip) and it's always today's.

Zentrale's side of the contract is `docs/led-feed.md` in the Zentrale repo (branch `feature/led-daily-highlights`
until it's merged).

## Setup

1. In Zentrale (Plakate & LED, Monatsplakat LED tab), copy "Link für die LED-App". It contains the share token.
2. On the box, add the feed link to `/opt/screenview/backdrop/.env`, with the prod VM's LAN address (the feed is
   reachable in the house network without a login):

   ```
   LED_FEED_URL=http://<VM-IP>:3001/s/<token>/led/today.json
   ```

3. `sudo systemctl restart screenview`. Within a minute the Highlights item shows up at the top of the library.

Leave `LED_FEED_URL` empty to turn it off. `GET /api/highlights` shows the last check, the event and any error.
A `410` means the link was revoked in Zentrale ("Neuen Link erzeugen"): put the new one in `.env`.

## What it does

- Every minute it reads `today.json`. With two events on a day, the second one's set takes over two hours before its
  doors (or start) time; before that the first one plays. "Today" runs until 05:00, like in Zentrale.
- When the chosen set's video link changes and its `status` is `ready`, the new MP4 is downloaded next to the
  uploads and swapped in once complete. While Zentrale is still rendering (`202`), the old video keeps playing.
- If the Highlights cue is on the wall when the video is swapped, it starts again with the new one.
- On days without an event (`sets: []`) the last video stays: it still shows upcoming events.
- The item can be renamed and moved into a folder, but not deleted.
