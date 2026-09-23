import { serve } from '@hono/node-server'
import { getMigrations } from 'better-auth/db/migration'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { auth, appOrigin, emailOtpEnabled } from './auth.js'
import { createProductTables, database } from './database.js'
import { getPublicNickname, parseNickname } from './nicknames.js'

type Session = typeof auth.$Infer.Session
type AppEnv = {
  Variables: {
    session: Session
  }
}

type RatingInput = {
  taste: number
  value: number
  returnIntent: number
  note: string
  createdAt?: string
}

type RestaurantInput = {
  id: string
  name: string
  address: string
  category: string
  location: [number, number]
  businessArea: string
  image?: string
  amapRating?: number
  averageCost?: number
  openTime?: string
  source: 'amap-live' | 'amap-mcp'
}

type SavedLocationInput = {
  id: string
  label: string
  point: [number, number]
}

type RatingRow = {
  id: string
  userId: string
  poiId: string
  taste: number
  value: number
  returnIntent: number
  note: string
  createdAt: string
  updatedAt: string
  authorName: string
}

type RatingImageRow = { id: string; ratingId: string }

const MAX_RATING_IMAGES = 3
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

function imageMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

async function parseRatingImages(files: (string | File)[]) {
  if (files.length > MAX_RATING_IMAGES) throw jsonError('每条评价最多上传 3 张图片')
  const parsed: { id: string; mime: string; bytes: Uint8Array }[] = []
  for (const file of files) {
    if (!(file instanceof File) || !file.size || file.size > MAX_IMAGE_BYTES) {
      throw jsonError('每张图片须小于 2 MB')
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = imageMime(bytes)
    if (!mime || mime !== file.type) throw jsonError('仅支持 JPEG、PNG 或 WebP 图片')
    parsed.push({ id: crypto.randomUUID(), mime, bytes })
  }
  return parsed
}

type LocationRow = {
  id: string
  label: string
  longitude: number
  latitude: number
}

type RatedRestaurantRow = {
  id: string
  name: string
  address: string
  category: string
  longitude: number
  latitude: number
  businessArea: string
  image?: string
  amapRating?: number
  averageCost?: number
  openTime?: string
  source: 'amap-live' | 'amap-mcp'
}

const writeWindows = new Map<string, { count: number; resetAt: number }>()

function jsonError(message: string, status: 400 | 401 | 403 | 404 | 409 | 429 | 500 = 400) {
  return new HTTPException(status, { message })
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function optionalNumber(value: unknown, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined
}

function optionalHttpUrl(value: unknown) {
  const candidate = cleanText(value, 1_000)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function parseRating(value: unknown): RatingInput {
  if (!value || typeof value !== 'object') throw jsonError('评分内容无效')
  const input = value as Record<string, unknown>
  const taste = Number(input.taste)
  const costValue = Number(input.value)
  const returnIntent = Number(input.returnIntent)
  if (![taste, costValue, returnIntent].every((score) => Number.isInteger(score) && score >= 1 && score <= 5)) {
    throw jsonError('三个评分维度都必须是 1 到 5 的整数')
  }
  return {
    taste,
    value: costValue,
    returnIntent,
    note: cleanText(input.note, 160),
    createdAt:
      typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt))
        ? input.createdAt
        : undefined,
  }
}

function parseRestaurant(value: unknown, expectedId: string): RestaurantInput {
  if (!value || typeof value !== 'object') throw jsonError('缺少店铺信息')
  const input = value as Record<string, unknown>
  const location = input.location
  if (
    input.id !== expectedId ||
    typeof input.name !== 'string' ||
    !Array.isArray(location) ||
    location.length !== 2 ||
    !location.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  ) {
    throw jsonError('店铺信息无效')
  }
  return {
    id: expectedId,
    name: cleanText(input.name, 120),
    address: cleanText(input.address, 240),
    category: cleanText(input.category, 80),
    location: [location[0], location[1]],
    businessArea: cleanText(input.businessArea, 120),
    image: optionalHttpUrl(input.image),
    amapRating: optionalNumber(input.amapRating, 0, 5),
    averageCost: optionalNumber(input.averageCost, 0, 100_000),
    openTime: cleanText(input.openTime, 160) || undefined,
    source: input.source === 'amap-mcp' ? 'amap-mcp' : 'amap-live',
  }
}

function parseSavedLocation(value: unknown): SavedLocationInput {
  if (!value || typeof value !== 'object') throw jsonError('收藏地点无效')
  const input = value as Record<string, unknown>
  const point = input.point
  const id = cleanText(input.id, 160)
  const label = cleanText(input.label, 120)
  if (
    !id ||
    !label ||
    !Array.isArray(point) ||
    point.length !== 2 ||
    !point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  ) {
    throw jsonError('收藏地点无效')
  }
  return { id, label, point: [point[0], point[1]] }
}

function parsePublicNickname(value: unknown) {
  try {
    return parseNickname(value)
  } catch (error) {
    throw jsonError(error instanceof Error ? error.message : '昵称无效')
  }
}

function upsertRestaurant(restaurant: RestaurantInput) {
  database.prepare(`
    INSERT INTO restaurants (
      amap_poi_id, name, address, category, longitude, latitude, last_seen_at,
      business_area, image_url, amap_rating, average_cost, open_time, source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(amap_poi_id) DO UPDATE SET
      name = excluded.name,
      address = excluded.address,
      category = excluded.category,
      longitude = excluded.longitude,
      latitude = excluded.latitude,
      last_seen_at = excluded.last_seen_at,
      business_area = CASE
        WHEN excluded.business_area <> '' THEN excluded.business_area
        ELSE restaurants.business_area
      END,
      image_url = COALESCE(excluded.image_url, restaurants.image_url),
      amap_rating = COALESCE(excluded.amap_rating, restaurants.amap_rating),
      average_cost = COALESCE(excluded.average_cost, restaurants.average_cost),
      open_time = COALESCE(excluded.open_time, restaurants.open_time),
      source = excluded.source
  `).run(
    restaurant.id,
    restaurant.name,
    restaurant.address,
    restaurant.category,
    restaurant.location[0],
    restaurant.location[1],
    new Date().toISOString(),
    restaurant.businessArea,
    restaurant.image ?? null,
    restaurant.amapRating ?? null,
    restaurant.averageCost ?? null,
    restaurant.openTime ?? null,
    restaurant.source,
  )
}

function upsertRating(userId: string, poiId: string, rating: RatingInput) {
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO ratings (
      id, user_id, amap_poi_id, taste_score, value_score, return_score, note, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
    ON CONFLICT(user_id, amap_poi_id) DO UPDATE SET
      taste_score = excluded.taste_score,
      value_score = excluded.value_score,
      return_score = excluded.return_score,
      note = excluded.note,
      status = 'published',
      updated_at = excluded.updated_at
  `).run(
    crypto.randomUUID(),
    userId,
    poiId,
    rating.taste,
    rating.value,
    rating.returnIntent,
    rating.note,
    rating.createdAt ?? now,
    now,
  )
}

function toPublicRating(row: RatingRow, images: RatingImageRow[], currentUserId?: string) {
  return {
    id: row.id,
    taste: row.taste,
    value: row.value,
    returnIntent: row.returnIntent,
    note: row.note,
    images: images.map((image) => ({ id: image.id, url: `/api/rating-images/${image.id}` })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    authorLabel: getPublicNickname(row.authorName, row.userId),
    isMine: row.userId === currentUserId,
    source: 'cloud' as const,
  }
}

function listRatings(poiIds: string[], currentUserId?: string) {
  if (!poiIds.length) return {}
  const placeholders = poiIds.map(() => '?').join(', ')
  const rows = database.prepare(`
    SELECT
      r.id,
      r.user_id AS userId,
      r.amap_poi_id AS poiId,
      r.taste_score AS taste,
      r.value_score AS value,
      r.return_score AS returnIntent,
      r.note,
      r.created_at AS createdAt,
      r.updated_at AS updatedAt,
      u.name AS authorName
    FROM ratings r
    JOIN "user" u ON u.id = r.user_id
    WHERE r.status = 'published' AND r.amap_poi_id IN (${placeholders})
    ORDER BY r.updated_at DESC
  `).all(...poiIds) as unknown as RatingRow[]

  const imagesByRating = new Map<string, RatingImageRow[]>()
  if (rows.length) {
    const imageRows = database.prepare(`
      SELECT id, rating_id AS ratingId FROM rating_images
      WHERE rating_id IN (${rows.map(() => '?').join(', ')})
      ORDER BY position
    `).all(...rows.map((row) => row.id)) as unknown as RatingImageRow[]
    for (const image of imageRows) {
      const entries = imagesByRating.get(image.ratingId) ?? []
      entries.push(image)
      imagesByRating.set(image.ratingId, entries)
    }
  }

  const grouped: Record<string, ReturnType<typeof toPublicRating>[]> = {}
  for (const poiId of poiIds) grouped[poiId] = []
  for (const row of rows) grouped[row.poiId]?.push(toPublicRating(row, imagesByRating.get(row.id) ?? [], currentUserId))
  return grouped
}

function listOwnRatings(poiIds: string[], userId: string) {
  const publicRatings = listRatings(poiIds, userId)
  return Object.fromEntries(
    Object.entries(publicRatings).map(([poiId, entries]) => [
      poiId,
      entries.filter((entry) => entry.isMine),
    ]),
  )
}

function mapRestaurantRows(rows: RatedRestaurantRow[]) {
  return rows
    .filter((row) => Number.isFinite(row.longitude) && Number.isFinite(row.latitude))
    .map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      category: row.category,
      location: [row.longitude, row.latitude] as [number, number],
      businessArea: row.businessArea,
      ...(row.image ? { image: row.image } : {}),
      ...(Number.isFinite(row.amapRating) ? { amapRating: row.amapRating } : {}),
      ...(Number.isFinite(row.averageCost) ? { averageCost: row.averageCost } : {}),
      ...(row.openTime ? { openTime: row.openTime } : {}),
      source: row.source === 'amap-mcp' ? 'amap-mcp' as const : 'amap-live' as const,
    }))
}

function listRatedRestaurants(userId: string) {
  const rows = database.prepare(`
    SELECT
      s.amap_poi_id AS id,
      s.name,
      s.address,
      s.category,
      s.longitude,
      s.latitude,
      s.business_area AS businessArea,
      s.image_url AS image,
      s.amap_rating AS amapRating,
      s.average_cost AS averageCost,
      s.open_time AS openTime,
      s.source
    FROM ratings r
    JOIN restaurants s ON s.amap_poi_id = r.amap_poi_id
    WHERE r.user_id = ?
    ORDER BY r.updated_at DESC
  `).all(userId) as unknown as RatedRestaurantRow[]

  return mapRestaurantRows(rows)
}

function listRankedRestaurants() {
  const rows = database.prepare(`
    SELECT
      s.amap_poi_id AS id,
      s.name,
      s.address,
      s.category,
      s.longitude,
      s.latitude,
      s.business_area AS businessArea,
      s.image_url AS image,
      s.amap_rating AS amapRating,
      s.average_cost AS averageCost,
      s.open_time AS openTime,
      s.source
    FROM restaurants s
    JOIN ratings r ON r.amap_poi_id = s.amap_poi_id
    WHERE r.status = 'published'
    GROUP BY s.amap_poi_id
    ORDER BY
      AVG((r.taste_score + r.value_score + r.return_score) / 3.0) DESC,
      COUNT(r.id) DESC,
      MAX(r.updated_at) DESC
  `).all() as unknown as RatedRestaurantRow[]

  return mapRestaurantRows(rows)
}

function listMyLocations(userId: string) {
  const rows = database.prepare(`
    SELECT id, label, longitude, latitude
    FROM saved_locations
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 12
  `).all(userId) as unknown as LocationRow[]
  return rows.map((row) => ({ id: row.id, label: row.label, point: [row.longitude, row.latitude] }))
}

function replaceSavedLocations(userId: string, locations: SavedLocationInput[]) {
  const now = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare('DELETE FROM saved_locations WHERE user_id = ?').run(userId)
    const insert = database.prepare(`
      INSERT INTO saved_locations (id, user_id, label, longitude, latitude, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const location of locations.slice(0, 12)) {
      insert.run(location.id, userId, location.label, location.point[0], location.point[1], now, now)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const app = new Hono<AppEnv>()

app.use('*', secureHeaders())

app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin')
    if (origin && origin !== appOrigin) throw jsonError('请求来源不受信任', 403)
  }
  await next()
})

app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    const routeGroup = c.req.path.startsWith('/api/auth/')
      ? 'auth'
      : c.req.path.includes('/my-rating')
        ? 'rating'
        : 'account'
    const key = `${forwarded ?? 'local'}:${routeGroup}`
    const now = Date.now()
    if (writeWindows.size > 1_000) {
      for (const [storedKey, storedWindow] of writeWindows) {
        if (now >= storedWindow.resetAt) writeWindows.delete(storedKey)
      }
    }
    const window = writeWindows.get(key)
    if (!window || now >= window.resetAt) {
      writeWindows.set(key, { count: 1, resetAt: now + 5 * 60_000 })
    } else if (window.count >= 40) {
      throw jsonError('操作太频繁，请稍后再试', 429)
    } else {
      window.count += 1
    }
  }
  await next()
})

app.all('/api/auth/*', (c) => auth.handler(c.req.raw))

app.get('/api/health', (c) => {
  database.prepare('SELECT 1').get()
  return c.json({ status: 'ok' })
})

app.get('/api/config', (c) => c.json({ emailOtpEnabled }))

app.get('/api/rankings', (c) => c.json({ restaurants: listRankedRestaurants() }))

app.use('/api/me/*', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) throw jsonError('请先登录', 401)
  c.set('session', session)
  await next()
})

app.use('/api/restaurants/:poiId/my-rating', async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) throw jsonError('请先登录', 401)
  c.set('session', session)
  await next()
})

app.get('/api/ratings', async (c) => {
  const poiIds = (c.req.query('poiIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 50)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  return c.json({ ratings: listRatings(poiIds, session?.user.id) })
})

app.get('/api/rating-images/:imageId', (c) => {
  const imageId = c.req.param('imageId')
  if (!/^[a-f0-9-]{36}$/.test(imageId)) throw jsonError('图片不存在', 404)
  const image = database.prepare(`
    SELECT i.mime_type AS mime, i.image_data AS bytes
    FROM rating_images i
    JOIN ratings r ON r.id = i.rating_id
    WHERE i.id = ? AND r.status = 'published'
  `).get(imageId) as { mime: string; bytes: Uint8Array } | undefined
  if (!image) throw jsonError('图片不存在', 404)
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.mime,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

app.put('/api/restaurants/:poiId/my-rating', async (c) => {
  const poiId = c.req.param('poiId').slice(0, 120)
  const multipart = c.req.header('content-type')?.startsWith('multipart/form-data') ?? false
  let body: Record<string, unknown> | null = null
  let keepImageIds: string[] | null = null
  let newImages: Awaited<ReturnType<typeof parseRatingImages>> = []
  if (multipart) {
    const length = Number(c.req.header('content-length') ?? 0)
    if (length > 8 * 1024 * 1024) throw jsonError('上传内容超过 8 MB')
    const form = await c.req.raw.formData().catch(() => null)
    if (!form) throw jsonError('上传内容无效')
    try {
      body = {
        restaurant: JSON.parse(String(form.get('restaurant'))),
        rating: JSON.parse(String(form.get('rating'))),
      }
      keepImageIds = JSON.parse(String(form.get('keepImageIds')))
    } catch {
      throw jsonError('上传内容无效')
    }
    if (!Array.isArray(keepImageIds) || !keepImageIds.every((id) => typeof id === 'string')) {
      throw jsonError('图片列表无效')
    }
    newImages = await parseRatingImages(form.getAll('images'))
  } else {
    body = await c.req.json<Record<string, unknown>>().catch(() => null)
  }
  if (!body) throw jsonError('请求内容无效')
  const restaurant = parseRestaurant(body.restaurant, poiId)
  const rating = parseRating(body.rating)
  const userId = c.get('session').user.id
  const existing = database.prepare('SELECT id FROM ratings WHERE user_id = ? AND amap_poi_id = ?')
    .get(userId, poiId) as { id: string } | undefined
  const existingIds = existing
    ? (database.prepare('SELECT id FROM rating_images WHERE rating_id = ?').all(existing.id) as { id: string }[])
      .map((image) => image.id)
    : []
  if (keepImageIds && (
    new Set(keepImageIds).size !== keepImageIds.length ||
    keepImageIds.some((id) => !existingIds.includes(id)) ||
    keepImageIds.length + newImages.length > MAX_RATING_IMAGES
  )) throw jsonError('图片列表无效或超过 3 张')

  database.exec('SAVEPOINT save_rating_with_images')
  try {
    upsertRestaurant(restaurant)
    upsertRating(userId, poiId, rating)
    if (keepImageIds) {
      const ratingId = existing?.id ?? (database.prepare('SELECT id FROM ratings WHERE user_id = ? AND amap_poi_id = ?')
        .get(userId, poiId) as { id: string }).id
      const deleteImage = database.prepare('DELETE FROM rating_images WHERE id = ? AND rating_id = ?')
      for (const id of existingIds) {
        if (!keepImageIds.includes(id)) deleteImage.run(id, ratingId)
      }
      const setPosition = database.prepare('UPDATE rating_images SET position = ? WHERE id = ? AND rating_id = ?')
      keepImageIds.forEach((id, index) => setPosition.run(index, id, ratingId))
      const insertImage = database.prepare(`
        INSERT INTO rating_images (id, rating_id, mime_type, image_data, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      newImages.forEach((image, index) => {
        insertImage.run(image.id, ratingId, image.mime, image.bytes, keepImageIds.length + index, new Date().toISOString())
      })
    }
    database.exec('RELEASE SAVEPOINT save_rating_with_images')
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT save_rating_with_images')
    database.exec('RELEASE SAVEPOINT save_rating_with_images')
    throw error
  }
  return c.json({ rating: listRatings([poiId], userId)[poiId]?.find((entry) => entry.isMine) }, 200)
})

app.delete('/api/restaurants/:poiId/my-rating', (c) => {
  database.prepare('DELETE FROM ratings WHERE user_id = ? AND amap_poi_id = ?')
    .run(c.get('session').user.id, c.req.param('poiId'))
  return c.json({ ok: true })
})

app.get('/api/me/state', (c) => {
  const session = c.get('session')
  const isAnonymous = Boolean((session.user as Session['user'] & { isAnonymous?: boolean }).isAnonymous)
  const ratingRows = database.prepare('SELECT amap_poi_id AS poiId FROM ratings WHERE user_id = ?')
    .all(session.user.id) as unknown as { poiId: string }[]
  const poiIds = ratingRows.map((row) => row.poiId)
  const passkeyCount = Number(
    (database.prepare('SELECT COUNT(*) AS count FROM passkey WHERE userId = ?').get(session.user.id) as { count: number }).count,
  )
  return c.json({
    user: {
      id: session.user.id,
      name: getPublicNickname(session.user.name, session.user.id),
      email: isAnonymous ? undefined : session.user.email,
      isAnonymous,
      passkeyCount,
    },
    ratings: listOwnRatings(poiIds, session.user.id),
    ratedRestaurants: listRatedRestaurants(session.user.id),
    savedLocations: listMyLocations(session.user.id),
  })
})

app.put('/api/me/profile', async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)
  if (!body) throw jsonError('请求内容不是有效的 JSON')
  const name = parsePublicNickname(body.name)
  await auth.api.updateUser({
    body: { name },
    headers: c.req.raw.headers,
  })
  return c.json({ name })
})

app.put('/api/me/locations', async (c) => {
  const body = await c.req.json<{ locations?: unknown[] }>().catch(() => null)
  if (!body || !Array.isArray(body.locations) || body.locations.length > 12) {
    throw jsonError('收藏地点最多为 12 个')
  }
  const locations = body.locations.map(parseSavedLocation)
  replaceSavedLocations(c.get('session').user.id, locations)
  return c.json({ savedLocations: listMyLocations(c.get('session').user.id) })
})

app.put('/api/me/restaurant-snapshots', async (c) => {
  const body = await c.req.json<{ restaurants?: unknown[] }>().catch(() => null)
  if (!body || !Array.isArray(body.restaurants) || body.restaurants.length > 100) {
    throw jsonError('店铺快照最多为 100 个')
  }

  const userId = c.get('session').user.id
  const ratedPoiIds = new Set(
    (database.prepare('SELECT amap_poi_id AS poiId FROM ratings WHERE user_id = ?')
      .all(userId) as unknown as { poiId: string }[])
      .map((row) => row.poiId),
  )
  for (const value of body.restaurants) {
    if (!value || typeof value !== 'object') continue
    const id = cleanText((value as { id?: unknown }).id, 120)
    if (!id || !ratedPoiIds.has(id)) continue
    upsertRestaurant(parseRestaurant(value, id))
  }

  return c.json({ ratedRestaurants: listRatedRestaurants(userId) })
})

app.post('/api/me/import-local', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) throw jsonError('请求内容不是有效的 JSON')
  const ratings = body.ratings && typeof body.ratings === 'object'
    ? body.ratings as Record<string, unknown>
    : {}
  const restaurants = Array.isArray(body.restaurants) ? body.restaurants : []
  const restaurantById = new Map<string, RestaurantInput>()
  for (const value of restaurants.slice(0, 100)) {
    if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') continue
    const id = (value as { id: string }).id.slice(0, 120)
    restaurantById.set(id, parseRestaurant(value, id))
  }

  const userId = c.get('session').user.id
  let importedRatings = 0
  for (const [poiId, entries] of Object.entries(ratings).slice(0, 100)) {
    if (!Array.isArray(entries) || !entries.length) continue
    const restaurant = restaurantById.get(poiId)
    if (!restaurant) continue
    const newest = [...entries]
      .filter((entry) => entry && typeof entry === 'object')
      .sort((a, b) => String((b as { createdAt?: unknown }).createdAt ?? '').localeCompare(String((a as { createdAt?: unknown }).createdAt ?? '')))[0]
    if (!newest) continue
    const parsedRating = parseRating(newest)
    const existing = database.prepare(`
      SELECT updated_at AS updatedAt
      FROM ratings
      WHERE user_id = ? AND amap_poi_id = ?
    `).get(userId, poiId) as { updatedAt: string } | undefined
    if (
      existing &&
      parsedRating.createdAt &&
      Date.parse(existing.updatedAt) > Date.parse(parsedRating.createdAt)
    ) {
      continue
    }
    upsertRestaurant(restaurant)
    upsertRating(userId, poiId, parsedRating)
    importedRatings += 1
  }

  const incomingLocations = Array.isArray(body.savedLocations)
    ? body.savedLocations.slice(0, 12).map(parseSavedLocation)
    : []
  const mergedLocations = new Map<string, SavedLocationInput>()
  for (const location of listMyLocations(userId)) mergedLocations.set(location.id, location as SavedLocationInput)
  for (const location of incomingLocations) mergedLocations.set(location.id, location)
  replaceSavedLocations(userId, Array.from(mergedLocations.values()).slice(0, 12))
  const myPoiIds = (database.prepare('SELECT amap_poi_id AS poiId FROM ratings WHERE user_id = ?')
    .all(userId) as unknown as { poiId: string }[]).map((row) => row.poiId)

  return c.json({
    importedRatings,
    ratings: listOwnRatings(myPoiIds, userId),
    ratedRestaurants: listRatedRestaurants(userId),
    savedLocations: listMyLocations(userId),
  })
})

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }
  console.error(error)
  return c.json({ error: '服务暂时不可用' }, 500)
})

const migrations = await getMigrations(auth.options)
await migrations.runMigrations()
createProductTables()

const port = Number(process.env.PORT ?? 8787)
const server = serve({
  fetch: app.fetch,
  hostname: '127.0.0.1',
  port,
})

console.log(`DopaBite API listening on http://127.0.0.1:${port}`)

function shutdown() {
  server.close(() => {
    database.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
