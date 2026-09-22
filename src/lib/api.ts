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
    isAnonymous: boolean
    passkeyCount: number
  }
  ratings: RatingStore
  savedLocations: SavedLocation[]
}

export type ImportResult = {
  importedRatings: number
  ratings: RatingStore
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
  const query = new URLSearchParams({ poiIds: poiIds.slice(0, 50).join(',') })
  const response = await requestJson<{ ratings: RatingStore }>(`/api/ratings?${query}`)
  return response.ratings
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

export function getAccountState() {
  return requestJson<AccountState>('/api/me/state')
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

export function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401
}
