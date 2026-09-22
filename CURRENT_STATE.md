# DopaBite current state

Last verified: 2026-09-22

## Product

- Desktop-first React/Vite restaurant discovery and rating prototype.
- Production: `https://food.archein.site/`.
- Live AMap Web JS integration supplies POI identity, address, coordinates, photos, price, and AMap reference rating.
- The discovery page supports geolocation, manual address search, map picking, saved locations, adjustable result count, category markers, marker-to-list selection, list search and sorting, restaurant details, local ratings, and a scroll-triggered back-to-top control.
- AMap categories come from the POI `type` field. Marker icon groups are a DopaBite presentation mapping over those source categories and restaurant names.
- DopaBite ratings and saved locations persist only in browser `localStorage`; there is no shared account or backend yet.
- A shared-rating backend has been designed but not implemented. The accepted direction is a same-origin Node.js API, Better Auth progressive identity, and SQLite WAL; see `docs/architecture/shared-ratings.md`.

## Source control

- Public repository: `https://github.com/N0tANTi/dopabite`.
- The public history starts from a clean snapshot so the deleted local QA document and its machine-specific paths are not exposed.
- The pre-public commits remain available only in the local archive branch `archive/pre-public-history-20260922`.
- `.env.local`, build output, dependencies, unused local assets, databases, uploads, and runtime data are excluded from Git.

## Production deployment

- Host: Tencent Cloud anti server, Ubuntu 24.04, Nginx 1.24.
- Active release: `/srv/dopabite/releases/20260921191049`.
- Active symlink: `/srv/dopabite/current`.
- Nginx site: `/etc/nginx/sites-available/food-archein-site`.
- TLS: Let's Encrypt certificate for `food.archein.site`, valid through 2026-12-20 with Certbot automatic renewal enabled.
- The host has one 40 GB ext4 root filesystem and no separate data disk. At deployment it used 24% of bytes and 7% of inodes. `/srv` is the established release location for this host.

## Validation

- `npm run lint`: passed.
- `npm run build`: passed.
- Nginx configuration test: passed.
- HTTP redirects to HTTPS; HTTPS homepage returns 200; the certificate SAN matches `food.archein.site`.
- Public-browser smoke test loaded the live AMap, 40 POIs, store photos and ratings, with no browser console errors.
- Back-to-top visibility and return behavior were verified locally; its production presence was verified after scrolling.

## Known limitations and blockers

- The AMap result set can still contain adjacent non-food POIs such as tourism or beauty listings. Tightening the source filtering is the next data-quality fix.
- The production JavaScript bundle is about 548 kB minified and triggers Vite's chunk-size warning.
- User ratings and favorites are device-local and do not sync across browsers.
