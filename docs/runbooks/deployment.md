# Production deployment runbook

## Target

- URL: `https://food.archein.site/`
- Host: Tencent Cloud anti server. Its operator-local SSH alias is `tengxunyun-anti`; never deploy this project to the unrelated `aliyun-anti` host. The underlying address and identity stay in local SSH configuration and are not committed.
- Release root: `/srv/dopabite/releases/`
- Active symlink: `/srv/dopabite/current`
- Nginx site: `/etc/nginx/sites-available/food-archein-site`
- Checked-in Nginx templates: `deploy/nginx/`
- API release root: `/srv/dopabite-api/releases/`
- API active symlink: `/srv/dopabite-api/current`
- Persistent database: `/srv/dopabite-data/dopabite.sqlite3`
- Local snapshots: `/srv/dopabite-data/backups/`
- API environment: `/etc/dopabite/api.env` (root-owned, never committed)

The host currently has only `/dev/vda2` mounted at `/`; there is no separate data disk. `/srv` is the established application-release location. Recheck this on every deployment and stop if the mount layout changes unexpectedly.

## Preconditions

1. Confirm DNS for `food.archein.site` still resolves to the target host.
2. Check `findmnt`, `df -hT`, `df -hi`, and `lsblk -f` on the host. Do not deploy if filesystem use is at least 85% or the release, staging copy, and rollback set would leave less than 10% headroom.
3. Confirm `nginx` is active and `sudo nginx -t` passes before making changes.
4. Build locally from the intended Git version. Never upload `.env.local`, `.git`, `node_modules`, caches, or unrelated workspace files.

## Build and release

```powershell
npm ci
npm run lint
npm run build
```

Create a timestamped directory under `/srv/dopabite/releases/`, upload only the contents of `dist/`, and verify that `index.html` and `assets/` are present. Promote atomically by creating `/srv/dopabite/current.next` and moving it over `/srv/dopabite/current` only after the upload is complete.

Create the matching API release under `/srv/dopabite-api/releases/`. Upload only `dist-server/`, `package.json`, and `package-lock.json`; install production dependencies with `npm ci --omit=dev` and a cache under `/srv/dopabite-data/npm-cache`. Promote `/srv/dopabite-api/current` atomically only after `node dist-server/index.js` can start against a staging database.

Install `deploy/systemd/dopabite-api.service` and the backup service/timer under `/etc/systemd/system/`. Generate `BETTER_AUTH_SECRET` directly on the host and write `/etc/dopabite/api.env` with mode `0600`; do not print or copy the secret into logs. The API binds only to `127.0.0.1:8787`, and Nginx proxies same-origin `/api/` requests.

Install the checked-in Nginx template as `/etc/nginx/sites-available/food-archein-site`, validate with `sudo nginx -t`, and reload Nginx. TLS is managed by Certbot; verify renewal status instead of replacing certificate files manually.

## Enabling email-code login

Email login is feature-detected at API startup. Tencent Cloud SES API is the preferred production provider. Add `TENCENTCLOUD_SECRET_ID`, `TENCENTCLOUD_SECRET_KEY`, `TENCENT_SES_REGION`, `TENCENT_SES_FROM`, and `TENCENT_SES_TEMPLATE_ID` to the root-owned `/etc/dopabite/api.env`. The CAM key must belong to a programmatic-only sub-user limited to `ses:SendEmail`. The HTML template is checked in at `deploy/email-templates/dopabite-login-code.html` and uses the single variable `{{code}}`.

SMTP remains available as a fallback through `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. Never put provider credentials in Git, shell history, screenshots, or deployment logs. Incomplete SES or SMTP configuration must leave email login disabled.

Restart `dopabite-api.service`, confirm it is active, and verify that `https://food.archein.site/api/config` returns `{"emailOtpEnabled":true}`. Complete a real inbox test and then a fresh-browser sign-in test; the same public nickname, ratings, and private saved locations must appear. If delivery is delayed, duplicated, or rejected, remove the active provider's SES or SMTP values, restart the API, and confirm the endpoint returns `false` so the UI falls back to its safe pending state.

## Verification

- `curl --noproxy '*' -I http://food.archein.site/` returns a redirect to HTTPS.
- `curl --noproxy '*' -I https://food.archein.site/` returns 200.
- `curl --noproxy '*' https://food.archein.site/api/health` returns `{"status":"ok"}`.
- `curl --noproxy '*' https://food.archein.site/api/config` reflects whether SMTP delivery is actually configured.
- The certificate SAN contains `food.archein.site`.
- In a fresh public browser, verify the AMap canvas, nearby POIs, photos, address search, saved location control, map/list selection, account dialog, and browser console. Do not create or bind a real Passkey during an automated smoke test.
- Run `sudo systemctl start dopabite-backup.service`, verify the newest snapshot with `PRAGMA integrity_check`, and confirm the timer is enabled.
- Recheck filesystem bytes and inodes after activation.

## Rollback and retention

Keep the active release plus the two most recent verified rollback releases. Do not remove a release until its path is confirmed to be under `/srv/dopabite/releases/` and the active symlink target is known.

To roll back the web app, atomically point `/srv/dopabite/current.next` at the selected verified release, move it over `/srv/dopabite/current`, run `sudo nginx -t`, reload Nginx, and repeat the health checks. Roll back the API independently by switching `/srv/dopabite-api/current.next`, restarting `dopabite-api`, and rechecking `/api/health`.

Database migrations are additive. Before a migration, create and verify a snapshot. A code rollback does not automatically restore or delete database data. Local snapshots retain the seven newest verified copies; an off-host COS target is still required for disaster recovery and must never share credentials through Git.

Until COS replication is configured, copy the newest `.sqlite3` snapshot and its `.sha256` sidecar to the operator backup directory outside this Git repository, then compare the SHA-256 digest locally. This manual copy is only a stopgap; it does not replace scheduled off-host replication. Never copy the live WAL database files directly.
