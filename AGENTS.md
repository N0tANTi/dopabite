# DopaBite Web Product Rules

- This is a desktop-first responsive React web product, not a mobile-app shell.
- Visual direction: dopamine candy colors, dark outlines, offset shadows, sticker-like controls, and springy feedback inspired by the user's `dopabite.html` draft.
- Primary workflow: nearby map discovery, restaurant details, user rating, saved feedback.
- Real restaurant identity, address, coordinates, business data, and photos come from AMap POI data. Never present generated food photography as a real restaurant photo.
- AMap ratings are external reference data. DopaBite ratings are user-generated and must remain visually and structurally separate.
- Without AMap browser credentials, the local preview uses real Shanghai Jing'an Temple POIs fetched through the connected AMap MCP on 2026-09-21. The illustrated map is only a clearly labeled layout fallback.
- Keep secrets out of Git. Use `.env.local` for `VITE_AMAP_KEY` and `VITE_AMAP_SECURITY_CODE`.
- Use Phosphor for interface icons. Do not hand-draw SVG icons or add emoji as UI decoration.
- Respect `prefers-reduced-motion` and system color scheme. Preserve keyboard focus styles and usable empty/error states.
- Durable project records live in `CURRENT_STATE.md`, `ROADMAP.md`, `docs/architecture/`, `docs/runbooks/deployment.md`, and `docs/history/`.
- Production is served from the Tencent Cloud host whose operator-local SSH alias is `tengxunyun-anti`, at `https://food.archein.site/`. Never use the unrelated `aliyun-anti` host for this project. Static releases live under `/srv/dopabite/releases/`, with `/srv/dopabite/current` as the active symlink and `/etc/nginx/sites-available/food-archein-site` as the Nginx site config.
