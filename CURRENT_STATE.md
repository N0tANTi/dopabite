# DopaBite current state

Last verified: 2026-09-22

## Product

- Desktop-first React/Vite restaurant discovery and rating prototype.
- Production: `https://food.archein.site/`.
- Live AMap Web JS integration supplies POI identity, address, coordinates, photos, price, and AMap reference rating.
- The discovery page supports geolocation, manual address search, map picking, saved locations, adjustable result count, category markers, marker-to-list selection, list search and sorting, restaurant details, local ratings, and a scroll-triggered back-to-top control.
- Nearby discovery uses an AMap dining-type pool instead of the biased keyword “餐厅”, then reserves at most one nearby result each for McDonald's, KFC, and Pizza Hut. Results are deduplicated and distance-sorted while preserving the requested total count.
- AMap categories come from the POI `type` field. Marker icon groups are a DopaBite presentation mapping over those source categories and restaurant names.
- DopaBite ratings are shared through a same-origin Node.js/Hono API. A first rating creates an anonymous Better Auth session without asking for email; the same user updates the existing rating for that POI.
- The profile button opens a real account panel. Users can explicitly merge existing browser ratings and private saved locations into the cloud, bind a Passkey, sign in on another device, and sign out. WeChat login remains a later integration.
- Saved locations are private to the authenticated account. Live/current location history is not stored. `localStorage` remains an offline fallback and migration source.
- The API uses SQLite WAL at `/srv/dopabite-data/dopabite.sqlite3`; code releases cannot overwrite it.

## Source control

- Public repository: `https://github.com/N0tANTi/dopabite`.
- The public history starts from a clean snapshot so the deleted local QA document and its machine-specific paths are not exposed.
- The pre-public commits remain available only in the local archive branch `archive/pre-public-history-20260922`.
- `.env.local`, build output, dependencies, unused local assets, databases, uploads, and runtime data are excluded from Git.

## Production deployment

- Host: Tencent Cloud anti server, Ubuntu 24.04, Nginx 1.24.
- Active web release: `/srv/dopabite/releases/20260922113221`.
- Active symlink: `/srv/dopabite/current`.
- Active API release: `/srv/dopabite-api/releases/20260922110335`, linked from `/srv/dopabite-api/current`.
- `dopabite-api.service` is enabled and binds only to `127.0.0.1:8787`; Nginx proxies `/api/` on the public HTTPS origin.
- `dopabite-backup.timer` creates and integrity-checks daily SQLite snapshots under `/srv/dopabite-data/backups/`, retaining seven.
- The first verified production snapshot was also copied off-host to `D:\anti\backups\dopabite`. Automated COS replication is not configured yet.
- Nginx site: `/etc/nginx/sites-available/food-archein-site`.
- TLS: Let's Encrypt certificate for `food.archein.site`, valid through 2026-12-20 with Certbot automatic renewal enabled.
- The host has one 40 GB ext4 root filesystem and no separate data disk. At deployment it used 24% of bytes and 7% of inodes. `/srv` is the established release location for this host.

## Validation

- `npm run lint`: passed.
- `npm run build`: passed.
- `npm audit --omit=dev --audit-level=high`: zero known vulnerabilities.
- Two independent local API sessions submitted ratings for the same POI and both appeared in the public result; each account saw one owned rating and only its own saved locations. Re-rating performed an update, and an empty local import preserved existing cloud favorites.
- Local browser QA verified the account panel, store drawer, rating dialog, 40 live AMap POIs, and a clean console after fixing marker-root teardown.
- Local browser QA at the Hangzhou Wangjiang test point verified a 40-item result set containing KFC (about 1.2 km), McDonald's (about 1.3 km), and Pizza Hut (about 1.5 km), with no browser errors.
- Nginx configuration test: passed.
- HTTP redirects to HTTPS; HTTPS homepage and `/api/health` return 200; the certificate SAN matches `food.archein.site`; untrusted cross-origin writes return 403.
- The first production SQLite snapshot passed its checksum and `PRAGMA integrity_check`; the post-deploy system disk remains at 25% byte use and 8% inode use.
- Back-to-top visibility and return behavior were verified locally; its production presence was verified after scrolling.
- Chain-discovery release `20260922113221` is active; HTTPS and API health return 200, the served page references the new `index-CA7OjXyB.js` asset, and post-deploy storage remains at 25% byte use and 8% inode use.

## Known limitations and blockers

- The AMap result set can still contain adjacent non-food POIs such as tourism or beauty listings. Tightening the source filtering is the next data-quality fix.
- The production JavaScript bundle is about 620 kB minified and triggers Vite's chunk-size warning after adding the auth client.
- Ratings publish immediately with fixed-window write limiting; there is no moderation console, custom nickname, account deletion UI, or content-reporting flow yet.
- Daily server-local backups are active and the first snapshot has an off-host copy, but continuous off-host COS replication still needs credentials and a restore drill.
- Production Passkey enrollment was not completed during automated QA because that would create a persistent credential; the user-facing flow still needs one manual real-device enrollment test.
