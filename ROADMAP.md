# DopaBite roadmap

## P0: durable database backups

- Current: `/srv/dopabite-data/` is persistent, daily verified SQLite snapshots retain seven copies, and the first production snapshot has a checksum-verified operator-machine copy.
- Next action: configure automated Tencent COS replication with at least 30-day retention, then perform and document a restore drill.
- Dependency: COS bucket, least-privilege credentials, and retention policy.
- Acceptance: a scheduled off-host copy and a verified restore test can recover users, ratings, and saved locations without touching code releases.

## P1: account and moderation controls

- Add deletion for a user's own rating, account deletion, content reporting, moderation queue, and an operator review surface.
- Decide whether to add public nicknames; current public labels are only “匿名食客” and “已登录食客”.
- Acceptance: users can remove their content and account, and reported public notes can be reviewed without direct database edits.

## P1: WeChat login

- Add website QR login after the required WeChat Open Platform application is approved; keep email OTP as a compatibility/recovery option only if needed.
- Acceptance: an anonymous user's existing ratings and private favorites survive WeChat account linking and appear on a second device.

## P0: tighten restaurant-only results

- Next action: filter live AMap results by restaurant-specific type codes and add name/category exclusions for clearly unrelated POIs.
- Acceptance: repeated searches around Jing'an Temple return dining businesses only while retaining cafés, tea houses, bakeries, bars, and food-court counters.

## P1: performance pass

- Split map, account, and detail code and reduce the initial JavaScript bundle below the current Vite warning threshold (currently about 620 kB minified).
- Acceptance: `npm run build` completes without the >500 kB chunk warning and the production smoke test still passes.
