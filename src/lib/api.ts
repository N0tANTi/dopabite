import type { RatingEntry, Restaurant } from '../data/restaurants'

export type SavedLocation = {
  id: string
  label: string
  point: [number, number]
}

export type RatingStore = Record<string, RatingEntry[]>

export type AccountState = {
  user: {
    id: string
    name: string
    email?: string
    isAnonymous: boolean
    passkeyCount: number
  }
  ratings: RatingStore
  ratedRestaurants?: Restaurant[]
  savedLocations: SavedLocation[]
}

export type PublicConfig = {
  emailOtpEnabled: boolean
}

export type ImportResult = {
  importedRatings: number
  ratings: RatingStore
  ratedRestaurants?: Restaurant[]
  savedLocations: SavedLocation[]
}

class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new ApiError(payload.error ?? '服务暂时不可用', response.status)
  return payload as T
}

export async function fetchPublicRatings(poiIds: string[]) {
  if (!poiIds.length) return {} as RatingStore
  const uniquePoiIds = Array.from(new Set(poiIds))
  const batches: string[][] = []
  for (let index = 0; index < uniquePoiIds.length; index += 50) {
    batches.push(uniquePoiIds.slice(index, index + 50))
  }
  const responses = await Promise.all(batches.map((batch) => {
    const query = new URLSearchParams({ poiIds: batch.join(',') })
    return requestJson<{ ratings: RatingStore }>(`/api/ratings?${query}`)
  }))
  return Object.assign({}, ...responses.map((response) => response.ratings)) as RatingStore
}

export async function saveMyRating(restaurant: Restaurant, rating: RatingEntry) {
  const response = await requestJson<{ rating: RatingEntry }>(
    `/api/restaurants/${encodeURIComponent(restaurant.id)}/my-rating`,
    {
      method: 'PUT',
      body: JSON.stringify({ restaurant, rating }),
    },
  )
  return response.rating
}

export async function deleteMyRating(poiId: string) {
  return requestJson<{ ok: boolean }>(`/api/restaurants/${encodeURIComponent(poiId)}/my-rating`, {
    method: 'DELETE',
  })
}

export function getAccountState() {
  return requestJson<AccountState>('/api/me/state')
}

export function getPublicConfig() {
  return requestJson<PublicConfig>('/api/config')
}

export async function updateProfile(name: string) {
  return requestJson<{ name: string }>('/api/me/profile', {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
}

export function importLocalData(
  ratings: RatingStore,
  savedLocations: SavedLocation[],
  restaurants: Restaurant[],
) {
  return requestJson<ImportResult>('/api/me/import-local', {
    method: 'POST',
    body: JSON.stringify({ ratings, savedLocations, restaurants }),
  })
}

export async function replaceCloudLocations(locations: SavedLocation[]) {
  const response = await requestJson<{ savedLocations: SavedLocation[] }>('/api/me/locations', {
    method: 'PUT',
    body: JSON.stringify({ locations }),
  })
  return response.savedLocations
}

export async function updateRatedRestaurantSnapshots(restaurants: Restaurant[]) {
  const response = await requestJson<{ ratedRestaurants: Restaurant[] }>('/api/me/restaurant-snapshots', {
    method: 'PUT',
    body: JSON.stringify({ restaurants }),
  })
  return response.ratedRestaurants
}

export function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401
}
