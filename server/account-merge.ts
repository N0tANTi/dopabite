import { database } from './database.js'

type RatingMergeRow = {
  id: string
  poiId: string
  taste: number
  value: number
  returnIntent: number
  note: string
  status: string
  createdAt: string
  updatedAt: string
}

type LocationMergeRow = {
  id: string
  label: string
  longitude: number
  latitude: number
  createdAt: string
  updatedAt: string
}

export function mergeAnonymousAccount(anonymousUserId: string, newUserId: string) {
  if (anonymousUserId === newUserId) return
  database.exec('SAVEPOINT merge_anonymous_account')
  try {
    const sourceRatings = database.prepare(`
      SELECT
        id,
        amap_poi_id AS poiId,
        taste_score AS taste,
        value_score AS value,
        return_score AS returnIntent,
        note,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM ratings
      WHERE user_id = ?
    `).all(anonymousUserId) as unknown as RatingMergeRow[]
    const findTargetRating = database.prepare(`
      SELECT id, updated_at AS updatedAt
      FROM ratings
      WHERE user_id = ? AND amap_poi_id = ?
    `)
    const moveRating = database.prepare('UPDATE ratings SET user_id = ? WHERE id = ?')
    const updateRating = database.prepare(`
      UPDATE ratings
      SET taste_score = ?, value_score = ?, return_score = ?, note = ?, status = ?, updated_at = ?
      WHERE id = ?
    `)
    const deleteRating = database.prepare('DELETE FROM ratings WHERE id = ?')

    for (const rating of sourceRatings) {
      const target = findTargetRating.get(newUserId, rating.poiId) as
        | { id: string; updatedAt: string }
        | undefined
      if (!target) {
        moveRating.run(newUserId, rating.id)
        continue
      }
      if (Date.parse(rating.updatedAt) > Date.parse(target.updatedAt)) {
        updateRating.run(
          rating.taste,
          rating.value,
          rating.returnIntent,
          rating.note,
          rating.status,
          rating.updatedAt,
          target.id,
        )
      }
      deleteRating.run(rating.id)
    }

    const sourceLocations = database.prepare(`
      SELECT id, label, longitude, latitude, created_at AS createdAt, updated_at AS updatedAt
      FROM saved_locations
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(anonymousUserId) as unknown as LocationMergeRow[]
    const upsertLocation = database.prepare(`
      INSERT INTO saved_locations (id, user_id, label, longitude, latitude, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, id) DO UPDATE SET
        label = excluded.label,
        longitude = excluded.longitude,
        latitude = excluded.latitude,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at > saved_locations.updated_at
    `)
    for (const location of sourceLocations) {
      upsertLocation.run(
        location.id,
        newUserId,
        location.label,
        location.longitude,
        location.latitude,
        location.createdAt,
        location.updatedAt,
      )
    }
    database.prepare('DELETE FROM saved_locations WHERE user_id = ?').run(anonymousUserId)

    database.exec('RELEASE SAVEPOINT merge_anonymous_account')
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT merge_anonymous_account')
    database.exec('RELEASE SAVEPOINT merge_anonymous_account')
    throw error
  }
}
