# Production deployment runbook

## Target

- URL: `https://food.archein.site/`
- Host: Tencent Cloud anti server. SSH target and identity stay in the operator's local configuration and are not committed.
- Release root: `/srv/dopabite/releases/`
- Active symlink: `/srv/dopabite/current`
- Nginx site: `/etc/nginx/sites-available/food-archein-site`
- Checked-in Nginx templates: `deploy/nginx/`

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

Install the checked-in Nginx template as `/etc/nginx/sites-available/food-archein-site`, validate with `sudo nginx -t`, and reload Nginx. TLS is managed by Certbot; verify renewal status instead of replacing certificate files manually.

## Verification

- `curl --noproxy '*' -I http://food.archein.site/` returns a redirect to HTTPS.
- `curl --noproxy '*' -I https://food.archein.site/` returns 200.
- The certificate SAN contains `food.archein.site`.
- In a fresh public browser, verify the AMap canvas, nearby POIs, photos, address search, saved location control, map/list selection, and browser console.
- Recheck filesystem bytes and inodes after activation.

## Rollback and retention

Keep the active release plus the two most recent verified rollback releases. Do not remove a release until its path is confirmed to be under `/srv/dopabite/releases/` and the active symlink target is known.

To roll back, atomically point `/srv/dopabite/current.next` at the selected verified release, move it over `/srv/dopabite/current`, run `sudo nginx -t`, reload Nginx, and repeat the health checks. The first deployment currently has no older DopaBite release to roll back to.
