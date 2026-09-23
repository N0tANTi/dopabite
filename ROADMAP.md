# DopaBite roadmap

## P1: verify mobile discovery on a physical phone

- Current: web release `20260923022901` is live with the all-location search, three narrow-screen views, and explicit mobile map touch mode. Build and production smoke checks passed.
- Next action: test a physical phone for view switching, vertical scrolling over the map, map interaction toggle, cross-location result selection, and search reset; collect any device-specific issues for a follow-up fix.
- Acceptance: all three views are usable on mobile, a swipe starting over the map scrolls the page until map interaction is enabled, a distant restaurant can be found and opened, and production health/assets pass the deployment checks.

## P0: durable database backups

- Current: `/srv/dopabite-data/` is persistent, daily verified SQLite snapshots retain seven copies, and the first production snapshot has a checksum-verified operator-machine copy.
- Next action: configure automated Tencent COS replication with at least 30-day retention, then perform and document a restore drill.
- Dependency: COS bucket, least-privilege credentials, and retention policy.
- Acceptance: a scheduled off-host copy and a verified restore test can recover users, ratings, and saved locations without touching code releases.

## P1: account and moderation controls

- Public nicknames, detailed community-rating cards, and user edit/delete controls for their own rating are implemented.
- Next action: add account deletion, content reporting, moderation queue, and an operator review surface.
- Acceptance: users can remove their content and account, and reported public notes can be reviewed without direct database edits.

## P0: production email delivery

- Current: passwordless email OTP, 30-day sessions, anonymous-account linking, conflict-safe rating/favorite merge, and Tencent SES API template delivery are implemented and enabled. The least-privilege CAM credential, configured template ID, and verified sender address are stored server-side.
- Next action: test real-inbox delivery and second-device sign-in, then rotate the CAM key that was disclosed during setup and replace it directly on the server.
- Acceptance: a real inbox receives a code, and the user's nickname, ratings, and private favorites appear on a second device after verification.

## P2: WeChat login

- Deferred because a WeChat Open Platform website application requires additional qualification and review.
- Re-evaluate after the core account, moderation, and recovery flows are stable; do not make it a launch dependency.

## P0: tighten restaurant-only results

- Next action: filter live AMap results by restaurant-specific type codes and add name/category exclusions for clearly unrelated POIs.
- Acceptance: repeated searches around Jing'an Temple return dining businesses only while retaining cafés, tea houses, bakeries, bars, and food-court counters.

## P1: performance pass

- Split map, account, and detail code and reduce the initial JavaScript bundle below the current Vite warning threshold (currently about 647 kB minified).
- Add pagination or server-side ranking summaries before the community-rated restaurant set becomes large; the current early-stage endpoint returns every rated restaurant and the client fetches rating details in 50-POI batches.
- Acceptance: `npm run build` completes without the >500 kB chunk warning, a large ranking does not require downloading every public review up front, and the production smoke test still passes.
