import { serve } from '@hono/node-server'
import { getMigrations } from 'better-auth/db/migration'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { auth, appOrigin } from './auth.js'
import { createProductTables, database } from './database.js'

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
  hasPasskey: number
}

type LocationRow = {
  id: string
  label: string
  longitude: number
  latitude: number
}

const writeWindows = new Map<string, { count: number; resetAt: number }>()

function jsonError(message: string, status: 400 | 401 | 403 | 404 | 409 | 429 | 500 = 400) {
  return new HTTPException(status, { message })
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
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

function upsertRestaurant(restaurant: RestaurantInput) {
  database.prepare(`
    INSERT INTO restaurants (amap_poi_id, name, address, category, longitude, latitude, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(amap_poi_id) DO UPDATE SET
      name = excluded.name,
      address = excluded.address,
      category = excluded.category,
      longitude = excluded.longitude,
      latitude = excluded.latitude,
      last_seen_at = excluded.last_seen_at
  `).run(
    restaurant.id,
    restaurant.name,
    restaurant.address,
    restaurant.category,
    restaurant.location[0],
    restaurant.location[1],
    new Date().toISOString(),
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

function toPublicRating(row: RatingRow, currentUserId?: string) {
  return {
    id: row.id,
    taste: row.taste,
    value: row.value,
    returnIntent: row.returnIntent,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    authorLabel: row.hasPasskey ? '已登录食客' : '匿名食客',
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
      EXISTS(SELECT 1 FROM passkey p WHERE p.userId = r.user_id) AS hasPasskey
    FROM ratings r
    WHERE r.status = 'published' AND r.amap_poi_id IN (${placeholders})
    ORDER BY r.updated_at DESC
  `).all(...poiIds) as unknown as RatingRow[]

  const grouped: Record<string, ReturnType<typeof toPublicRating>[]> = {}
  for (const poiId of poiIds) grouped[poiId] = []
  for (const row of rows) grouped[row.poiId]?.push(toPublicRating(row, currentUserId))
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

app.put('/api/restaurants/:poiId/my-rating', async (c) => {
  const poiId = c.req.param('poiId').slice(0, 120)
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) throw jsonError('请求内容不是有效的 JSON')
  const restaurant = parseRestaurant(body.restaurant, poiId)
  const rating = parseRating(body.rating)
  const userId = c.get('session').user.id
  upsertRestaurant(restaurant)
  upsertRating(userId, poiId, rating)
  return c.json({ rating: listRatings([poiId], userId)[poiId]?.find((entry) => entry.isMine) }, 200)
})

app.delete('/api/restaurants/:poiId/my-rating', (c) => {
  database.prepare('DELETE FROM ratings WHERE user_id = ? AND amap_poi_id = ?')
    .run(c.get('session').user.id, c.req.param('poiId'))
  return c.json({ ok: true })
})

app.get('/api/me/state', (c) => {
  const session = c.get('session')
  const ratingRows = database.prepare('SELECT amap_poi_id AS poiId FROM ratings WHERE user_id = ?')
    .all(session.user.id) as unknown as { poiId: string }[]
  const poiIds = ratingRows.map((row) => row.poiId)
  const passkeyCount = Number(
    (database.prepare('SELECT COUNT(*) AS count FROM passkey WHERE userId = ?').get(session.user.id) as { count: number }).count,
  )
  return c.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      isAnonymous: Boolean((session.user as Session['user'] & { isAnonymous?: boolean }).isAnonymous),
      passkeyCount,
    },
    ratings: listOwnRatings(poiIds, session.user.id),
    savedLocations: listMyLocations(session.user.id),
  })
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
