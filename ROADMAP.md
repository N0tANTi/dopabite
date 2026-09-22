# DopaBite roadmap

## P0: shared ratings API

- Architecture: `docs/architecture/shared-ratings.md`.
- Next action: add a same-origin Node.js API, SQLite migrations, anonymous Better Auth sessions, Passkey binding, and rating Upsert endpoints.
- Dependencies: choose the public nickname rules and whether anonymous ratings publish immediately or enter a short moderation queue.
- Acceptance: two different browsers can submit ratings for the same AMap POI and both see the same server-calculated community score.

## P0: durable database backups

- Next action: provision `/srv/dopabite-data/`, implement consistent SQLite snapshots, and configure an off-host Tencent COS backup target before accepting production ratings.
- Acceptance: a verified restore test can recover users and ratings without touching code releases.

## P1: account binding

- Start with anonymous sessions and Passkey so initial rating has no email step.
- Add WeChat website QR login after the required Open Platform application is approved; keep email OTP as recovery and compatibility fallback.
- Acceptance: an anonymous user's ratings survive account binding and appear on a second device after login.

## P0: tighten restaurant-only results

- Next action: filter live AMap results by restaurant-specific type codes and add name/category exclusions for clearly unrelated POIs.
- Acceptance: repeated searches around Jing'an Temple return dining businesses only while retaining cafés, tea houses, bakeries, bars, and food-court counters.

## P1: performance pass

- Split the map/detail code and reduce the initial JavaScript bundle below the current Vite warning threshold.
- Acceptance: `npm run build` completes without the >500 kB chunk warning and the production smoke test still passes.
