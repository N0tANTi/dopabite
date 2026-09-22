# DopaBite current state

Last verified: 2026-09-22

## Product

- Desktop-first React/Vite restaurant discovery and rating prototype.
- Production: `https://food.archein.site/`.
- Live AMap Web JS integration supplies POI identity, address, coordinates, photos, price, and AMap reference rating.
- The discovery page supports geolocation, manual address search, map picking, saved locations, adjustable result count, category markers, marker-to-list selection, list search and sorting, restaurant details, local ratings, and a scroll-triggered back-to-top control.
- “多巴胺榜”是独立的社区榜单，只收录至少有一条公开 DopaBite 评价的店铺；默认显示当前选址 2 公里内的上榜店，可切换到全部地点，并固定按社区综合分从高到低排列，同分时优先评价数更多的店。
- 发现页和个人历史页的排序不再使用浏览器原生下拉框，已替换为与页面一致的贴纸式菜单，包含明确选中态、点击外部和 Esc 关闭、键盘焦点及减少动效适配。
- “我评过的”默认加载当前账号在所有地点评过的店，而不是只检查当前附近的高德结果；用户可以切换为仅显示当前选址 2 公里内的评分记录。远距离评分店铺保留地图标点和列表联动，点击列表会将地图移动并放大到对应店铺。
- Historical rated-store cards automatically refill missing photos, AMap score, and average cost from the live AMap POI when available, then save the richer snapshot to the account for later devices and locations.
- Nearby discovery uses an AMap dining-type pool instead of the biased keyword “餐厅”, then reserves at most one nearby result each for McDonald's, KFC, and Pizza Hut. Results are deduplicated and distance-sorted while preserving the requested total count.
- AMap categories come from the POI `type` field. Marker icon groups are a DopaBite presentation mapping over those source categories and restaurant names.
- DopaBite ratings are shared through a same-origin Node.js/Hono API. A first rating creates an anonymous Better Auth session without asking for email; the same user updates the existing rating for that POI.
- The profile button opens a real account panel. Users can set a public nickname, explicitly merge browser ratings and private saved locations into the cloud, use passwordless email-code login when mail delivery is configured, optionally bind a Passkey on supported devices, and sign out. WeChat login is deferred.
- Public rating cards show the author's nickname, date, composite score, three score dimensions, note, and ownership marker. Email addresses, authentication methods, internal IDs, and saved locations stay private.
- A user can edit their own score and note with the existing values prefilled, or delete the rating after an inline confirmation. Other users' ratings remain read-only.
- Saved locations are private to the authenticated account. Live/current location history is not stored. `localStorage` remains an offline fallback and migration source.
- The API uses SQLite WAL at `/srv/dopabite-data/dopabite.sqlite3`; code releases cannot overwrite it.

## Source control

- Public repository: `https://github.com/N0tANTi/dopabite`.
- The public history starts from a clean snapshot so the deleted local QA document and its machine-specific paths are not exposed.
- The pre-public commits remain available only in the local archive branch `archive/pre-public-history-20260922`.
- `.env.local`, build output, dependencies, unused local assets, databases, uploads, and runtime data are excluded from Git.

## Production deployment

- Host: Tencent Cloud anti server, Ubuntu 24.04, Nginx 1.24.
- Active web release: `/srv/dopabite/releases/20260922171200`.
- Active symlink: `/srv/dopabite/current`.
- Active API release: `/srv/dopabite-api/releases/20260922171200`, linked from `/srv/dopabite-api/current`.
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
- End-to-end account QA created an anonymous user, public nickname, rating, and saved location; a second session saw the public author and note; email OTP linking preserved all data; and a later fresh email login recovered the same nickname, rating, and favorite. Rating conflicts use the most recently updated record.
- Local browser QA verified the account panel, store drawer, rating dialog, 40 live AMap POIs, and a clean console after fixing marker-root teardown.
- Local desktop browser QA verified both the configured and unconfigured email-login states, public nickname editing, optional Passkey disclosure, public rating details, keyboard-accessible controls, and a clean console.
- Local browser QA at the Hangzhou Wangjiang test point verified a 40-item result set containing KFC (about 1.2 km), McDonald's (about 1.3 km), and Pizza Hut (about 1.5 km), with no browser errors.
- Nginx configuration test: passed.
- HTTP redirects to HTTPS; HTTPS homepage and `/api/health` return 200; the certificate SAN matches `food.archein.site`; untrusted cross-origin writes return 403.
- The first production SQLite snapshot passed its checksum and `PRAGMA integrity_check`; the post-deploy system disk remains at 25% byte use and 8% inode use.
- Back-to-top visibility and return behavior were verified locally; its production presence was verified after scrolling.
- Chain-discovery release `20260922113221` previously passed HTTPS, API health, asset-identity, and storage checks before the account release superseded it.
- Web release `20260922130417` remains active; its matching API release was superseded by the SES adapter release below. HTTP redirects to HTTPS, homepage and API health return 200, `/api/config` correctly reports email delivery disabled, the page serves `index-tkIkchOh.js`, cross-origin writes return 403, and Nginx validation passes.
- The pre-deploy snapshot `dopabite-20260922T050158Z.sqlite3` passed `PRAGMA integrity_check`; its off-host copy has matching SHA-256 `1bf447b1a41c609b3873b708d4f53f5ad9ea95734156af27f2d4b2268e19dab8`.
- Tencent SES API template delivery is implemented and deployed in API release `20260922143538`. The least-privilege CAM credential, verified sender `no-reply@notify.archein.site`, and template ID `61514` are stored only in the root-owned production environment file. Email-code login is now advertised as enabled by the production API. The production SSH alias is explicitly `tengxunyun-anti` to prevent confusion with the unrelated `aliyun-anti` host.
- SES request construction, feature detection, lint, production build, and dependency audit passed locally. Production API health remains 200, `/api/config` returns `{"emailOtpEnabled":true}`, and a production send request to an operator-provided QQ inbox returned `{"success":true}` after correcting the optional OTP-generator configuration. The current service log is clean apart from Node's existing SQLite experimental warning, and post-deploy storage is 26% of bytes and 9% of inodes. Inbox receipt and second-device recovery still require manual verification.
- Cross-location rating history passed a local API integration test with a far-away POI: the account state returned its restaurant snapshot, AMap rating, price, and owned rating. Lint, production build, dependency audit, and diff checks passed; the existing bundle-size warning remains.
- Web/API release `20260922155323` is live. HTTPS, API health, served asset identity (`index-C_ezll21.js` and `index-BeMCkW43.css`), email-login feature detection, Nginx configuration, certificate SAN, live database integrity, and the additive restaurant metadata columns all passed. All 8 existing live ratings have matching restaurant snapshots. The pre-migration snapshot `dopabite-20260922T075212Z.sqlite3` was verified by the backup service and copied off-host with matching SHA-256 `d7909f5df7cbaef0245b852aa0abdbe446e28859b5e42b9df7aadfd77e84ad6`. Post-deploy storage is 26% of bytes and 10% of inodes.
- Web/API release `20260922161714` adds historical POI detail enrichment plus own-rating edit/delete controls. Local browser QA verified prefilled editing and the inline delete confirmation. Isolated API tests verified missing-image enrichment and the full create/update/delete lifecycle while preserving the rating ID and original creation time. Production HTTPS, asset identity (`index-BFQVX5wk.js` and `index-BnfDpNuo.css`), API health/config, authentication on snapshot writes, Nginx, service logs, and database integrity passed. Snapshot `dopabite-20260922T081704Z.sqlite3` was copied off-host with matching SHA-256 `1b44b118110e5bdd767ac2e22781e80e54c0839be57e8b5feeddeb42816cb56f`; storage is 27% of bytes and 11% of inodes.
- Web/API release `20260922171200` turns “多巴胺榜” into a real community ranking with nearby/all scope and a public rated-restaurant endpoint. Local API tests verified score order and removal after the last public rating is deleted; desktop browser QA verified the custom sort menu, scope switching, ranking order, map/list counts, and an empty error console. Production HTTPS, asset identity (`index-q2yKtdik.js` and `index-Daop-U0j.css`), API health/config, the 24-store ranking response, write authorization boundaries, certificate SAN, Nginx, service logs, and release retention passed. Snapshot `dopabite-20260922T091556Z.sqlite3` was copied off-host with matching SHA-256 `bd33a93aae110544d15e8053b814809208ba709bf7b71082d940fbc2ad8b7508`; storage remains 27% of bytes and 11% of inodes.

## Known limitations and blockers

- The AMap result set can still contain adjacent non-food POIs such as tourism or beauty listings. Tightening the source filtering is the next data-quality fix.
- The production JavaScript bundle is about 644 kB minified and still triggers Vite's chunk-size warning.
- The early-stage community ranking currently returns all rated restaurant snapshots and fetches public rating details in bounded batches. Add server pagination or summary fields before the number of rated stores becomes large.
- Ratings publish immediately with fixed-window write limiting; there is no moderation console, account deletion UI, or content-reporting flow yet.
- Passwordless email login and Tencent SES API delivery are enabled in production. A real-inbox code delivery and second-device account recovery test are still pending; if Tencent rejects or delays delivery, disable the provider values and return the UI to its safe pending state.
- Daily server-local backups are active and the first snapshot has an off-host copy, but continuous off-host COS replication still needs credentials and a restore drill.
- Production Passkey enrollment was not completed during automated QA because that would create a persistent credential; it remains an optional path and still needs one manual real-device enrollment test.
