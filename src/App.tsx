import {
  ArrowUp,
  CaretDown,
  Check,
  Crosshair,
  ForkKnife,
  Heart,
  MagnifyingGlass,
  MapPin,
  SlidersHorizontal,
  Sparkle,
  Trash,
  Trophy,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import confetti from 'canvas-confetti'
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AccountDialog } from './components/AccountDialog'
import { AmapCanvas, type LocationInfo, type LocationRequest } from './components/AmapCanvas'
import { RatingDialog } from './components/RatingDialog'
import { RestaurantCard } from './components/RestaurantCard'
import { RestaurantDrawer } from './components/RestaurantDrawer'
import {
  DEMO_CENTER,
  distanceInMeters,
  getDopaScore,
  NEARBY_RADIUS_METERS,
  seedRestaurants,
  type RatingEntry,
  type Restaurant,
} from './data/restaurants'
import { authClient } from './lib/auth-client'
import {
  deleteMyRating,
  fetchPublicRatings,
  fetchRankedRestaurants,
  getAccountState,
  importLocalData,
  isUnauthorized,
  replaceCloudLocations,
  saveMyRating,
  type RatingStore,
  type SavedLocation,
  updateRatedRestaurantSnapshots,
  updateProfile,
} from './lib/api'
import { createNicknameSuggestion } from './lib/nickname'

type SortMode = 'distance' | 'amap' | 'dopa' | 'budget'
type ViewMode = 'nearby' | 'rated' | 'ranking'
type LocationScope = 'all' | 'nearby'

const RATING_STORAGE_KEY = 'dopabite-ratings-v1'
const RATED_RESTAURANT_STORAGE_KEY = 'dopabite-rated-restaurants-v1'
const LOCATION_STORAGE_KEY = 'dopabite-saved-locations-v1'
const CLOUD_SYNC_STORAGE_KEY = 'dopabite-cloud-sync-enabled-v1'

const SORT_OPTIONS: Array<{ value: SortMode; label: string; detail: string }> = [
  { value: 'distance', label: '离我最近', detail: '按当前地点的直线距离' },
  { value: 'dopa', label: '多巴胺最高', detail: '按社区用户的综合评分' },
  { value: 'amap', label: '高德参考分最高', detail: '按高德平台参考评分' },
  { value: 'budget', label: '人均最低', detail: '优先显示人均价格较低的店' },
]

const initialLocationInfo: LocationInfo = {
  label: '正在识别位置',
  detail: '等待浏览器定位结果',
  source: 'locating',
}

function loadRatings(): RatingStore {
  try {
    const value = window.localStorage.getItem(RATING_STORAGE_KEY)
    const parsed = value ? (JSON.parse(value) as RatingStore) : {}
    return Object.fromEntries(
      Object.entries(parsed).map(([poiId, entries]) => [
        poiId,
        entries.map((entry) => ({ ...entry, isMine: true, source: entry.source ?? 'local' })),
      ]),
    )
  } catch {
    return {}
  }
}

function isRestaurant(value: unknown): value is Restaurant {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Restaurant>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.address === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.businessArea === 'string' &&
    (candidate.source === 'amap-live' || candidate.source === 'amap-mcp') &&
    Array.isArray(candidate.location) &&
    candidate.location.length === 2 &&
    candidate.location.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  )
}

function loadRatedRestaurants(): Restaurant[] {
  try {
    const value = window.localStorage.getItem(RATED_RESTAURANT_STORAGE_KEY)
    const parsed = value ? JSON.parse(value) as unknown : []
    return Array.isArray(parsed) ? parsed.filter(isRestaurant) : []
  } catch {
    return []
  }
}

function mergeRatedRestaurants(current: Restaurant[], incoming: Restaurant[]) {
  const merged = new Map(current.map((restaurant) => [restaurant.id, restaurant]))
  for (const restaurant of incoming) {
    const existing = merged.get(restaurant.id)
    merged.set(restaurant.id, {
      ...existing,
      ...restaurant,
      image: restaurant.image ?? existing?.image,
      amapRating: restaurant.amapRating ?? existing?.amapRating,
      averageCost: restaurant.averageCost ?? existing?.averageCost,
      openTime: restaurant.openTime ?? existing?.openTime,
    })
  }
  return Array.from(merged.values())
}

function loadCloudSyncPreference() {
  return window.localStorage.getItem(CLOUD_SYNC_STORAGE_KEY) === 'true'
}

function latestOwnRating(entries: RatingEntry[] = []) {
  return [...entries]
    .filter((entry) => entry.isMine !== false)
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))[0]
}

function mergeOwnRatings(local: RatingStore, cloud: RatingStore): RatingStore {
  const merged: RatingStore = { ...local }
  for (const [poiId, entries] of Object.entries(cloud)) {
    const remote = latestOwnRating(entries.filter((entry) => entry.isMine))
    if (!remote) continue
    const localEntry = latestOwnRating(merged[poiId])
    if (!localEntry || (remote.updatedAt ?? remote.createdAt) >= (localEntry.updatedAt ?? localEntry.createdAt)) {
      merged[poiId] = [{ ...remote, isMine: true, source: 'cloud' }]
    }
  }
  return merged
}

function mergeSavedLocations(local: SavedLocation[], cloud: SavedLocation[]) {
  const merged = new Map<string, SavedLocation>()
  for (const location of [...local, ...cloud]) {
    if (!merged.has(location.id)) merged.set(location.id, location)
  }
  return Array.from(merged.values()).slice(0, 12)
}

function loadSavedLocations(): SavedLocation[] {
  try {
    const value = window.localStorage.getItem(LOCATION_STORAGE_KEY)
    if (!value) return []
    const parsed = JSON.parse(value) as SavedLocation[]
    return parsed.filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        Array.isArray(item.point) &&
        item.point.length === 2 &&
        item.point.every((coordinate) => typeof coordinate === 'number'),
    )
  } catch {
    return []
  }
}

function App() {
  const reduceMotion = useReducedMotion()
  const { scrollY } = useScroll()
  const { data: session } = authClient.useSession()
  const [restaurants, setRestaurants] = useState<Restaurant[]>(seedRestaurants)
  const [rankedRestaurants, setRankedRestaurants] = useState<Restaurant[]>([])
  const [rankingLoading, setRankingLoading] = useState(true)
  const [rankingError, setRankingError] = useState('')
  const [center, setCenter] = useState<[number, number]>(DEMO_CENTER)
  const [localRatings, setLocalRatings] = useState<RatingStore>(loadRatings)
  const [ratedRestaurants, setRatedRestaurants] = useState<Restaurant[]>(loadRatedRestaurants)
  const [communityRatings, setCommunityRatings] = useState<RatingStore>({})
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [globalRestaurants, setGlobalRestaurants] = useState<Restaurant[]>([])
  const [globalSearchRequest, setGlobalSearchRequest] = useState<{ token: number; keyword: string } | null>(null)
  const [globalSearchState, setGlobalSearchState] = useState<'idle' | 'loading' | 'results' | 'error'>('idle')
  const [category, setCategory] = useState('全部')
  const [sortMode, setSortMode] = useState<SortMode>('distance')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('nearby')
  const [ratedScope, setRatedScope] = useState<LocationScope>('all')
  const [rankingScope, setRankingScope] = useState<LocationScope>('nearby')
  const [showLocationMenu, setShowLocationMenu] = useState(false)
  const [toast, setToast] = useState('')
  const [locationInfo, setLocationInfo] = useState<LocationInfo>(initialLocationInfo)
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(loadSavedLocations)
  const [locationRequest, setLocationRequest] = useState<LocationRequest | null>(null)
  const [resultLimit, setResultLimit] = useState(40)
  const [resultLimitDraft, setResultLimitDraft] = useState('40')
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(loadCloudSyncPreference)
  const [cloudHydrated, setCloudHydrated] = useState(false)
  const [profileName, setProfileName] = useState(createNicknameSuggestion)
  const locationRequestTokenRef = useRef(0)
  const locationSyncTimeoutRef = useRef<number | null>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const localRatingsRef = useRef(localRatings)
  const restaurantsRef = useRef(restaurants)
  const cloudSyncEnabledRef = useRef(cloudSyncEnabled)
  const globalSearchTokenRef = useRef(0)

  const resetGlobalSearch = useCallback(() => {
    setGlobalSearchRequest(null)
    setGlobalSearchState('idle')
    setGlobalRestaurants([])
  }, [])

  const handleGlobalSearchResult = useCallback((found: Restaurant[] | null) => {
    setGlobalRestaurants(found ?? [])
    setGlobalSearchState(found === null ? 'error' : 'results')
  }, [])

  const ratings = useMemo(() => {
    const merged: RatingStore = {}
    const poiIds = new Set([...Object.keys(communityRatings), ...Object.keys(localRatings)])
    for (const poiId of poiIds) {
      const entries = [...(communityRatings[poiId] ?? [])]
      for (const ownRating of localRatings[poiId] ?? []) {
        const matchingIndex = ownRating.id
          ? entries.findIndex((entry) => entry.id === ownRating.id)
          : -1
        if (matchingIndex >= 0) entries[matchingIndex] = ownRating
        else entries.unshift(ownRating)
      }
      merged[poiId] = entries
    }
    return merged
  }, [communityRatings, localRatings])

  useMotionValueEvent(scrollY, 'change', (latest) => {
    const shouldShow = latest > 640
    setShowBackToTop((current) => (current === shouldShow ? current : shouldShow))
  })

  useEffect(() => {
    window.localStorage.setItem(RATING_STORAGE_KEY, JSON.stringify(localRatings))
  }, [localRatings])

  useEffect(() => {
    window.localStorage.setItem(RATED_RESTAURANT_STORAGE_KEY, JSON.stringify(ratedRestaurants))
  }, [ratedRestaurants])

  useEffect(() => {
    localRatingsRef.current = localRatings
  }, [localRatings])

  useEffect(() => {
    restaurantsRef.current = restaurants
  }, [restaurants])

  useEffect(() => {
    cloudSyncEnabledRef.current = cloudSyncEnabled
  }, [cloudSyncEnabled])

  useEffect(() => {
    window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(savedLocations))
  }, [savedLocations])

  useEffect(() => {
    window.localStorage.setItem(CLOUD_SYNC_STORAGE_KEY, String(cloudSyncEnabled))
  }, [cloudSyncEnabled])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3_500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const refreshCommunityRatings = useCallback(async (poiIds: string[]) => {
    if (!poiIds.length) return
    try {
      const nextRatings = await fetchPublicRatings(poiIds)
      setCommunityRatings((current) => ({ ...current, ...nextRatings }))
    } catch {
      // Keep local ratings usable while the API is offline.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchRankedRestaurants()
      .then((nextRestaurants) => {
        if (cancelled) return
        setRankedRestaurants(nextRestaurants)
        setRankingError('')
      })
      .catch(() => {
        if (!cancelled) setRankingError('榜单暂时没能加载，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setRankingLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshRankings = useCallback(async () => {
    try {
      const nextRestaurants = await fetchRankedRestaurants()
      setRankedRestaurants(nextRestaurants)
      setRankingError('')
    } catch {
      setRankingError('榜单暂时没能加载，请稍后重试')
    } finally {
      setRankingLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!sortMenuOpen) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) setSortMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSortMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sortMenuOpen])

  const ratingPoiIds = useMemo(
    () => Array.from(new Set(
      [...restaurants, ...ratedRestaurants, ...rankedRestaurants].map((restaurant) => restaurant.id),
    )),
    [rankedRestaurants, ratedRestaurants, restaurants],
  )

  useEffect(() => {
    let cancelled = false
    void fetchPublicRatings(ratingPoiIds)
      .then((nextRatings) => {
        if (!cancelled) setCommunityRatings((current) => ({ ...current, ...nextRatings }))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [ratingPoiIds])

  useEffect(() => {
    if (!cloudSyncEnabled) return
    let cancelled = false
    void getAccountState()
      .then((state) => {
        if (cancelled) return
        const mergedRatings = mergeOwnRatings(localRatingsRef.current, state.ratings)
        const liveRatedRestaurants = restaurantsRef.current.filter(
          (restaurant) => mergedRatings[restaurant.id]?.length,
        )
        localRatingsRef.current = mergedRatings
        setLocalRatings(mergedRatings)
        setRatedRestaurants((current) => mergeRatedRestaurants(
          current,
          mergeRatedRestaurants(state.ratedRestaurants ?? [], liveRatedRestaurants),
        ))
        if (liveRatedRestaurants.length) {
          void updateRatedRestaurantSnapshots(liveRatedRestaurants)
            .then((snapshots) => {
              if (!cancelled) {
                setRatedRestaurants((current) => mergeRatedRestaurants(current, snapshots))
              }
            })
            .catch(() => undefined)
        }
        setSavedLocations((current) => mergeSavedLocations(current, state.savedLocations))
        setProfileName(state.user.name)
        setCloudHydrated(true)
      })
      .catch((error) => {
        if (cancelled) return
        if (isUnauthorized(error)) {
          setCloudSyncEnabled(false)
          setCloudHydrated(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [cloudSyncEnabled])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    void getAccountState()
      .then((state) => {
        if (!cancelled) setProfileName(state.user.name)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    if (!cloudSyncEnabled || !cloudHydrated) return
    if (locationSyncTimeoutRef.current) window.clearTimeout(locationSyncTimeoutRef.current)
    locationSyncTimeoutRef.current = window.setTimeout(() => {
      void replaceCloudLocations(savedLocations).catch((error) => {
        if (isUnauthorized(error)) setCloudSyncEnabled(false)
      })
    }, 450)
    return () => {
      if (locationSyncTimeoutRef.current) window.clearTimeout(locationSyncTimeoutRef.current)
    }
  }, [cloudHydrated, cloudSyncEnabled, savedLocations])

  const syncLocalData = useCallback(async () => {
    let session = await authClient.getSession()
    if (!session.data) {
      const signIn = await authClient.signIn.anonymous()
      if (signIn.error) throw new Error(signIn.error.message)
      session = await authClient.getSession()
    }
    if (!session.data) throw new Error('无法建立云端身份，请稍后再试')

    const restaurantSnapshots = mergeRatedRestaurants(ratedRestaurants, restaurants)
    const result = await importLocalData(localRatings, savedLocations, restaurantSnapshots)
    setLocalRatings((current) => mergeOwnRatings(current, result.ratings))
    setRatedRestaurants((current) => mergeRatedRestaurants(current, result.ratedRestaurants ?? []))
    setSavedLocations((current) => mergeSavedLocations(current, result.savedLocations))
    setCloudSyncEnabled(true)
    setCloudHydrated(true)
    await refreshCommunityRatings(restaurants.map((restaurant) => restaurant.id))
    await refreshRankings()
  }, [localRatings, ratedRestaurants, refreshCommunityRatings, refreshRankings, restaurants, savedLocations])

  const cacheRatedRestaurantSnapshots = useCallback((snapshots: Restaurant[]) => {
    if (!snapshots.length) return
    setRatedRestaurants((current) => mergeRatedRestaurants(current, snapshots))
    if (!cloudSyncEnabledRef.current) return
    void updateRatedRestaurantSnapshots(snapshots)
      .then((cloudSnapshots) => {
        setRatedRestaurants((current) => mergeRatedRestaurants(current, cloudSnapshots))
      })
      .catch((error) => {
        if (isUnauthorized(error)) setCloudSyncEnabled(false)
      })
  }, [])

  const enrichRestaurantDetails = useCallback((restaurant: Restaurant) => {
    setRankedRestaurants((current) => (
      current.some((item) => item.id === restaurant.id)
        ? mergeRatedRestaurants(current, [restaurant])
        : current
    ))
    if (localRatingsRef.current[restaurant.id]?.length) {
      cacheRatedRestaurantSnapshots([restaurant])
    }
  }, [cacheRatedRestaurantSnapshots])

  const handleRestaurantsLoaded = useCallback(
    (nextRestaurants: Restaurant[], nextCenter: [number, number]) => {
      restaurantsRef.current = nextRestaurants
      setRestaurants(nextRestaurants)
      setRankedRestaurants((current) => {
        const rankedIds = new Set(current.map((restaurant) => restaurant.id))
        const liveRankedRestaurants = nextRestaurants.filter((restaurant) => rankedIds.has(restaurant.id))
        return liveRankedRestaurants.length
          ? mergeRatedRestaurants(current, liveRankedRestaurants)
          : current
      })
      setCenter(nextCenter)
      setCategory('全部')
      const matchingRestaurants = nextRestaurants.filter(
        (restaurant) => localRatingsRef.current[restaurant.id]?.length,
      )
      if (matchingRestaurants.length) {
        cacheRatedRestaurantSnapshots(matchingRestaurants)
      }
    },
    [cacheRatedRestaurantSnapshots],
  )

  const openRestaurant = useCallback((restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant)
    setDrawerOpen(true)
  }, [])

  const openRestaurantFromMap = useCallback(
    (restaurant: Restaurant) => {
      setSelectedRestaurant(restaurant)
      document.getElementById(`restaurant-${restaurant.id}`)?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'center',
      })
      setDrawerOpen(true)
    },
    [reduceMotion],
  )

  const allRatedRestaurants = useMemo(() => {
    const restaurantSnapshots = mergeRatedRestaurants(ratedRestaurants, restaurants)
    return restaurantSnapshots.filter((restaurant) => localRatings[restaurant.id]?.length)
  }, [localRatings, ratedRestaurants, restaurants])

  const nearbyRatedCount = useMemo(
    () => allRatedRestaurants.filter(
      (restaurant) => distanceInMeters(center, restaurant.location) <= NEARBY_RADIUS_METERS,
    ).length,
    [allRatedRestaurants, center],
  )

  const nearbyRankedCount = useMemo(
    () => rankedRestaurants.filter(
      (restaurant) => distanceInMeters(center, restaurant.location) <= NEARBY_RADIUS_METERS,
    ).length,
    [center, rankedRestaurants],
  )

  const sourceRestaurants = viewMode === 'rated'
    ? allRatedRestaurants
    : viewMode === 'ranking'
      ? rankedRestaurants
      : globalSearchState === 'results' ? globalRestaurants : restaurants

  const categories = useMemo(
    () => ['全部', ...Array.from(new Set(sourceRestaurants.map((restaurant) => restaurant.category))).slice(0, 5)],
    [sourceRestaurants],
  )

  const visibleRestaurants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = sourceRestaurants.filter((restaurant) => {
      const matchesQuery =
        (viewMode === 'nearby' && globalSearchState === 'results') ||
        !normalizedQuery ||
        restaurant.name.toLowerCase().includes(normalizedQuery) ||
        restaurant.address.toLowerCase().includes(normalizedQuery) ||
        restaurant.category.toLowerCase().includes(normalizedQuery)
      const matchesCategory = category === '全部' || restaurant.category === category
      const matchesRatedScope =
        viewMode !== 'rated'
        || ratedScope === 'all'
        || distanceInMeters(center, restaurant.location) <= NEARBY_RADIUS_METERS
      const matchesRankingScope =
        viewMode !== 'ranking'
        || rankingScope === 'all'
        || distanceInMeters(center, restaurant.location) <= NEARBY_RADIUS_METERS
      return matchesQuery && matchesCategory && matchesRatedScope && matchesRankingScope
    })

    const activeSort = viewMode === 'ranking' ? 'dopa' : sortMode
    return [...filtered].sort((a, b) => {
      if (activeSort === 'amap') return (b.amapRating ?? -1) - (a.amapRating ?? -1)
      if (activeSort === 'budget') return (a.averageCost ?? Number.MAX_SAFE_INTEGER) - (b.averageCost ?? Number.MAX_SAFE_INTEGER)
      if (activeSort === 'dopa') {
        const scoreDifference = (getDopaScore(ratings[b.id]) ?? -1) - (getDopaScore(ratings[a.id]) ?? -1)
        if (scoreDifference !== 0) return scoreDifference
        const ratingCountDifference = (ratings[b.id]?.length ?? 0) - (ratings[a.id]?.length ?? 0)
        if (ratingCountDifference !== 0) return ratingCountDifference
      }
      return distanceInMeters(center, a.location) - distanceInMeters(center, b.location)
    })
  }, [category, center, globalSearchState, query, rankingScope, ratedScope, ratings, sortMode, sourceRestaurants, viewMode])

  const saveRating = async (restaurant: Restaurant, rating: RatingEntry, nickname: string) => {
    const localRating: RatingEntry = {
      ...rating,
      id: rating.id ?? `local-${crypto.randomUUID()}`,
      authorLabel: nickname,
      isMine: true,
      source: 'local',
    }
    setRatedRestaurants((current) => mergeRatedRestaurants(current, [restaurant]))
    setLocalRatings((current) => ({
      ...current,
      [restaurant.id]: [localRating],
    }))
    setToast(`已保存对「${restaurant.name}」的评分，正在同步…`)
    if (!reduceMotion) {
      void confetti({
        particleCount: 110,
        spread: 78,
        startVelocity: 34,
        origin: { x: 0.76, y: 0.72 },
        colors: ['#ff3377', '#ffd027', '#00c98d', '#1ec8ff', '#7657e8'],
      })
    }

    try {
      const session = await authClient.getSession()
      if (!session.data) {
        const signIn = await authClient.signIn.anonymous()
        if (signIn.error) throw new Error(signIn.error.message)
      }
      const profile = await updateProfile(nickname)
      setProfileName(profile.name)
      const savedRating = await saveMyRating(restaurant, localRating)
      setLocalRatings((current) => ({
        ...current,
        [restaurant.id]: [{ ...savedRating, isMine: true, source: 'cloud' }],
      }))
      await refreshCommunityRatings([restaurant.id])
      await refreshRankings()
      setToast(`已同步对「${restaurant.name}」的评分`)
    } catch {
      setToast(`评分已保存在本机；云端恢复后可在账号里同步`)
    }
  }

  const deleteRating = async (restaurant: Restaurant) => {
    const previousRatings = localRatings[restaurant.id] ?? []
    const previousRestaurant = ratedRestaurants.find((item) => item.id === restaurant.id) ?? restaurant
    setLocalRatings((current) => {
      const next = { ...current }
      delete next[restaurant.id]
      return next
    })
    setCommunityRatings((current) => ({
      ...current,
      [restaurant.id]: (current[restaurant.id] ?? []).filter((rating) => !rating.isMine),
    }))
    setRatedRestaurants((current) => current.filter((item) => item.id !== restaurant.id))
    setToast(`已删除对「${restaurant.name}」的评价`)

    try {
      const session = await authClient.getSession()
      if (!session.data) return
      await deleteMyRating(restaurant.id)
      await refreshCommunityRatings([restaurant.id])
      await refreshRankings()
      setToast(`已从云端删除对「${restaurant.name}」的评价`)
    } catch {
      setLocalRatings((current) => ({ ...current, [restaurant.id]: previousRatings }))
      setRatedRestaurants((current) => mergeRatedRestaurants(current, [previousRestaurant]))
      setToast('删除未能同步，请检查网络后重试')
    }
  }

  const commitResultLimit = () => {
    const parsed = Number.parseInt(resultLimitDraft, 10)
    const nextLimit = Number.isFinite(parsed) ? Math.min(50, Math.max(5, parsed)) : resultLimit
    setResultLimit(nextLimit)
    setResultLimitDraft(String(nextLimit))
  }

  const savedCurrentLocation = useMemo(() => {
    if (!locationInfo.point) return undefined
    return savedLocations.find(
      (item) => distanceInMeters(item.point, locationInfo.point as [number, number]) < 30,
    )
  }, [locationInfo.point, savedLocations])

  const toggleFavoriteLocation = useCallback((location: LocationInfo) => {
    if (!location.point) return
    const point = location.point
    setSavedLocations((current) => {
      const existing = current.find((item) => distanceInMeters(item.point, point) < 30)
      if (existing) {
        setToast(`已取消收藏「${existing.label}」`)
        return current.filter((item) => item.id !== existing.id)
      }
      const next: SavedLocation = {
        id: `${point[0].toFixed(6)}-${point[1].toFixed(6)}`,
        label: location.label,
        point,
      }
      setToast(`已收藏「${location.label}」`)
      return [next, ...current].slice(0, 12)
    })
  }, [])

  const switchToDeviceLocation = () => {
    setShowLocationMenu(false)
    locationRequestTokenRef.current += 1
    setLocationRequest({ token: locationRequestTokenRef.current, kind: 'device' })
  }

  const switchToSavedLocation = (location: SavedLocation) => {
    setShowLocationMenu(false)
    locationRequestTokenRef.current += 1
    setLocationRequest({
      token: locationRequestTokenRef.current,
      kind: 'saved',
      label: location.label,
      point: location.point,
    })
  }

  const activeSortOption = SORT_OPTIONS.find((option) => option.value === sortMode) ?? SORT_OPTIONS[0]
  const rankingScopeCount = rankingScope === 'nearby' ? nearbyRankedCount : rankedRestaurants.length

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="DopaBite 首页">
          <span className="brand-mark" aria-hidden="true">
            <ForkKnife size={23} weight="bold" />
          </span>
          <span className="brand-word">Dopa<span>Bite</span></span>
          <span className="brand-pop">POP</span>
        </a>

        <nav className="main-nav" aria-label="主导航">
          <button
            type="button"
            className={viewMode === 'nearby' ? 'is-active' : ''}
            onClick={() => {
              setViewMode('nearby')
              setCategory('全部')
              resetGlobalSearch()
            }}
            aria-pressed={viewMode === 'nearby'}
          >
            发现附近
          </button>
          <button
            type="button"
            className={viewMode === 'ranking' ? 'is-active' : ''}
            onClick={() => {
              setViewMode('ranking')
              setCategory('全部')
              resetGlobalSearch()
            }}
            aria-pressed={viewMode === 'ranking'}
          >
            多巴胺榜
          </button>
          <button
            type="button"
            className={viewMode === 'rated' ? 'is-active' : ''}
            onClick={() => {
              setViewMode('rated')
              setCategory('全部')
              resetGlobalSearch()
            }}
            aria-pressed={viewMode === 'rated'}
          >
            我评过的
          </button>
        </nav>

        <div className="topbar-actions">
          <button
            type="button"
            className={`location-chip ${locationInfo.source}`}
            onClick={() => setShowLocationMenu((current) => !current)}
            aria-expanded={showLocationMenu}
            aria-controls="location-menu"
          >
            <MapPin size={18} weight="fill" />
            <span>{locationInfo.label}</span>
            <CaretDown size={15} weight="bold" />
          </button>
          <button
            type="button"
            className={`profile-button ${session ? 'has-session' : ''}`}
            aria-label="个人中心"
            title="个人中心"
            onClick={() => setAccountOpen(true)}
          >
            <UserCircle size={27} weight="duotone" />
            {session && <span className="profile-status-dot" aria-label="已建立云端身份" />}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showLocationMenu && (
          <motion.aside
            id="location-menu"
            className="location-menu"
            initial={reduceMotion ? false : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            aria-label="选择探索地点"
          >
            <div className="location-menu-heading">
              <span>
                <MapPin size={18} weight="fill" />
              </span>
              <div>
                <small>当前探索地点</small>
                <strong>{locationInfo.label}</strong>
              </div>
              <button type="button" onClick={() => setShowLocationMenu(false)} aria-label="关闭地点菜单">
                <X size={18} weight="bold" />
              </button>
            </div>

            <button type="button" className="device-location-option" onClick={switchToDeviceLocation}>
              <Crosshair size={20} weight="bold" />
              <span>
                <strong>使用设备定位</strong>
                <small>重新识别你当前所在的位置</small>
              </span>
            </button>

            <div className="saved-location-heading">
              <span><Heart size={16} weight="fill" /> 收藏地点</span>
              <small>{savedLocations.length}/12</small>
            </div>

            <div className="saved-location-list">
              {savedLocations.length ? (
                savedLocations.map((location) => (
                  <div className="saved-location-row" key={location.id}>
                    <button type="button" onClick={() => switchToSavedLocation(location)}>
                      <MapPin size={17} weight="fill" />
                      <span>{location.label}</span>
                    </button>
                    <button
                      type="button"
                      className="remove-saved-location"
                      onClick={() => {
                        setSavedLocations((current) => current.filter((item) => item.id !== location.id))
                        setToast(`已移除收藏地点「${location.label}」`)
                      }}
                      aria-label={`移除收藏地点${location.label}`}
                      title="移除收藏"
                    >
                      <Trash size={15} weight="bold" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="saved-location-empty">
                  <Heart size={20} weight="duotone" />
                  <span>在地图左下角收藏一个地点，之后就能从这里快速切换。</span>
                </div>
              )}
            </div>

            <p className="location-menu-note">
              {cloudSyncEnabled ? '收藏已开启私密云同步；切换地点后，地图和附近店铺会一起刷新。' : '收藏先保存在当前浏览器；登录后可私密同步到其他设备。'}
            </p>
          </motion.aside>
        )}
      </AnimatePresence>

      <main id="main" className="discovery-layout">
        <div className="map-column">
          <div className="map-intro">
            <div>
              <span className="eyebrow">
                {viewMode === 'ranking' ? 'DopaBite 社区榜' : '今天想吃点什么'}
              </span>
              <h1>
                {viewMode === 'rated' ? (
                  <>吃过的每一家，<br />都留在这里。</>
                ) : viewMode === 'ranking' ? (
                  <>大家评出来的，<br />才是真榜单。</>
                ) : (
                  <>附近的真实店，<br />吃完由你打分。</>
                )}
              </h1>
            </div>
            <div className="map-intro-stat">
              <strong>
                {viewMode === 'rated'
                  ? allRatedRestaurants.length
                  : viewMode === 'ranking'
                    ? rankingScopeCount
                    : globalSearchState === 'results' ? globalRestaurants.length : restaurants.length}
              </strong>
              <span>
                {viewMode === 'rated'
                  ? '家已评分店铺'
                  : viewMode === 'ranking'
                    ? rankingScope === 'nearby' ? '家附近上榜' : '家社区上榜'
                    : globalSearchState === 'results' ? '家全部地点结果' : '家附近店铺'}
              </span>
            </div>
          </div>

          <AmapCanvas
            restaurants={visibleRestaurants}
            selectedId={selectedRestaurant?.id}
            onSelect={openRestaurantFromMap}
            onRestaurantsLoaded={handleRestaurantsLoaded}
            onRestaurantEnriched={enrichRestaurantDetails}
            enrichMissingDetails={viewMode === 'rated' || viewMode === 'ranking'}
            onLocationChange={setLocationInfo}
            resultLimit={resultLimit}
            locationRequest={locationRequest}
            isCurrentLocationSaved={Boolean(savedCurrentLocation)}
            onToggleFavorite={toggleFavoriteLocation}
            globalSearchRequest={globalSearchRequest}
            onGlobalSearchResult={handleGlobalSearchResult}
          />
        </div>

        <aside className="results-panel" aria-label={viewMode === 'ranking' ? '多巴胺榜单' : '店铺列表'}>
          <div className="results-header">
            <div>
              <div className="results-title-row">
                {viewMode === 'ranking' ? <Trophy size={25} weight="fill" /> : <Sparkle size={25} weight="fill" />}
                <h2>
                  {viewMode === 'nearby' && '附近好吃的'}
                  {viewMode === 'ranking' && '多巴胺榜'}
                  {viewMode === 'rated' && '我评过的'}
                </h2>
              </div>
              <p>
                {viewMode === 'rated'
                  ? ratedScope === 'all'
                    ? `${visibleRestaurants.length} 个结果，包含所有地点`
                    : `${visibleRestaurants.length} 个结果，当前地点 2 公里内共 ${nearbyRatedCount} 家`
                  : viewMode === 'ranking'
                    ? rankingLoading
                      ? '正在读取社区榜单'
                      : rankingError && !rankedRestaurants.length
                        ? rankingError
                        : rankingScope === 'nearby'
                          ? `${visibleRestaurants.length} 家上榜，当前地点 2 公里内共 ${nearbyRankedCount} 家`
                          : `${visibleRestaurants.length} 家上榜，包含所有地点`
                  : globalSearchState === 'loading'
                    ? '正在搜索全部地点的高德餐饮店'
                    : globalSearchState === 'error'
                      ? '全部地点搜索失败，请重试'
                      : globalSearchState === 'results'
                        ? `${visibleRestaurants.length} 个全部地点搜索结果，数据来自高德`
                        : `${visibleRestaurants.length} 个附近结果，店铺数据来自高德`}
              </p>
            </div>
            {viewMode === 'rated' || viewMode === 'ranking' ? (
              <div
                className="scope-control"
                role="group"
                aria-label={viewMode === 'ranking' ? '榜单地点范围' : '评分店铺范围'}
              >
                <button
                  type="button"
                  className={(viewMode === 'ranking' ? rankingScope === 'nearby' : ratedScope === 'all') ? 'is-active' : ''}
                  onClick={() => {
                    if (viewMode === 'ranking') setRankingScope('nearby')
                    else setRatedScope('all')
                  }}
                  aria-pressed={viewMode === 'ranking' ? rankingScope === 'nearby' : ratedScope === 'all'}
                >
                  {viewMode === 'ranking'
                    ? <MapPin size={14} weight="fill" />
                    : <Sparkle size={14} weight="fill" />}
                  {viewMode === 'ranking' ? `附近 ${nearbyRankedCount}` : `全部 ${allRatedRestaurants.length}`}
                </button>
                <button
                  type="button"
                  className={(viewMode === 'ranking' ? rankingScope === 'all' : ratedScope === 'nearby') ? 'is-active' : ''}
                  onClick={() => {
                    if (viewMode === 'ranking') setRankingScope('all')
                    else setRatedScope('nearby')
                  }}
                  aria-pressed={viewMode === 'ranking' ? rankingScope === 'all' : ratedScope === 'nearby'}
                >
                  {viewMode === 'ranking'
                    ? <Sparkle size={14} weight="fill" />
                    : <MapPin size={14} weight="fill" />}
                  {viewMode === 'ranking' ? `全部 ${rankedRestaurants.length}` : `附近 ${nearbyRatedCount}`}
                </button>
              </div>
            ) : globalSearchState === 'results' ? (
              <span className="global-search-limit">最多显示 50 家</span>
            ) : (
              <form
                className="result-limit-control"
                onSubmit={(event) => {
                  event.preventDefault()
                  commitResultLimit()
                }}
              >
                <span>加载</span>
                <input
                  type="number"
                  min="5"
                  max="50"
                  step="5"
                  value={resultLimitDraft}
                  onChange={(event) => setResultLimitDraft(event.target.value)}
                  onBlur={commitResultLimit}
                  aria-label="附近店铺加载数量"
                />
                <span>家</span>
              </form>
            )}
          </div>

          <label className="search-box">
            <span className="sr-only">搜索店名、地址或品类</span>
            <MagnifyingGlass size={20} weight="bold" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                resetGlobalSearch()
              }}
              placeholder="搜店名、地址或品类"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(''); resetGlobalSearch() }} aria-label="清空搜索">
                <X size={16} weight="bold" />
              </button>
            )}
          </label>

          {viewMode === 'nearby' && query.trim() && visibleRestaurants.length === 0 && (
            <div className="global-search-action" role="status">
              <span>
                {globalSearchState === 'loading' ? '正在搜索全部地点…'
                  : globalSearchState === 'results' ? '全部地点也没有找到餐饮店，试试补充城市或店名。'
                    : globalSearchState === 'error' ? '搜索暂时失败，可以重试。'
                      : '附近没有匹配的店，去全部地点找找。'}
              </span>
              {globalSearchState !== 'loading' && (
                <button
                  type="button"
                  onClick={() => {
                    setCategory('全部')
                    setGlobalSearchState('loading')
                    setGlobalSearchRequest({ token: ++globalSearchTokenRef.current, keyword: query.trim() })
                  }}
                >
                  {globalSearchState === 'idle' ? '搜索全部地点' : '重新搜索'}
                </button>
              )}
            </div>
          )}
          {viewMode === 'nearby' && globalSearchState === 'results' && visibleRestaurants.length > 0 && (
            <div className="global-search-action" role="status">
              <span>正在显示全部地点的餐饮店</span>
              <button type="button" onClick={resetGlobalSearch}>返回附近结果</button>
            </div>
          )}

          <div className="filter-row">
            <div className="category-chips" aria-label="按菜系筛选">
              {categories.map((item) => (
                <button
                  type="button"
                  className={category === item ? 'is-active' : ''}
                  onClick={() => setCategory(item)}
                  aria-pressed={category === item}
                  key={item}
                >
                  {item}
                </button>
              ))}
            </div>

            {viewMode === 'ranking' ? (
              <div className="ranking-sort-badge" aria-label="榜单按多巴胺分从高到低排列">
                <Trophy size={17} weight="fill" aria-hidden="true" />
                <span>多巴胺分排行</span>
              </div>
            ) : (
              <div className="sort-menu" ref={sortMenuRef}>
                <button
                  type="button"
                  className="sort-menu-trigger"
                  onClick={() => setSortMenuOpen((current) => !current)}
                  aria-haspopup="menu"
                  aria-expanded={sortMenuOpen}
                >
                  <SlidersHorizontal size={17} weight="bold" aria-hidden="true" />
                  <span>{activeSortOption.label}</span>
                  <CaretDown
                    className={sortMenuOpen ? 'is-open' : ''}
                    size={14}
                    weight="bold"
                    aria-hidden="true"
                  />
                </button>
                <AnimatePresence>
                  {sortMenuOpen && (
                    <motion.div
                      className="sort-menu-popover"
                      role="menu"
                      aria-label="选择店铺排序方式"
                      initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -5, scale: 0.98 }}
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <div className="sort-menu-heading">
                        <span>怎么排</span>
                        <small>选一个更合口味的顺序</small>
                      </div>
                      {SORT_OPTIONS.map((option) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={sortMode === option.value}
                          className={sortMode === option.value ? 'is-active' : ''}
                          onClick={() => {
                            setSortMode(option.value)
                            setSortMenuOpen(false)
                          }}
                          key={option.value}
                        >
                          <span>
                            <strong>{option.label}</strong>
                            <small>{option.detail}</small>
                          </span>
                          <span className="sort-check" aria-hidden="true">
                            {sortMode === option.value && <Check size={14} weight="bold" />}
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div className="restaurant-list">
            {viewMode === 'ranking' && rankingLoading ? (
              <div className="ranking-loading" aria-live="polite" aria-label="正在加载多巴胺榜">
                {[0, 1, 2].map((item) => (
                  <span className="ranking-loading-row" aria-hidden="true" key={item}>
                    <i />
                    <b />
                  </span>
                ))}
              </div>
            ) : visibleRestaurants.length > 0 ? (
              visibleRestaurants.map((restaurant, index) => (
                <RestaurantCard
                  key={restaurant.id}
                  index={index}
                  restaurant={restaurant}
                  center={center}
                  ratings={ratings[restaurant.id] ?? []}
                  selected={selectedRestaurant?.id === restaurant.id}
                  onOpen={openRestaurant}
                />
              ))
            ) : (
              <div className="empty-state">
                <span aria-hidden="true">
                  <ForkKnife size={34} weight="duotone" />
                </span>
                <h3>
                  {viewMode === 'ranking'
                    ? rankingError && !rankedRestaurants.length
                      ? '榜单暂时走丢了'
                      : !rankedRestaurants.length
                        ? '榜单还在等第一条评价'
                        : rankingScope === 'nearby' && !nearbyRankedCount
                          ? '附近暂时没有上榜店铺'
                          : '这个筛选没有上榜店铺'
                    : viewMode !== 'rated'
                      ? '这个条件没找到店'
                      : !allRatedRestaurants.length
                      ? '你还没打过分'
                      : ratedScope === 'nearby' && !nearbyRatedCount
                        ? '附近还没有你评过的店'
                        : '这个筛选没有结果'}
                </h3>
                <p>
                  {viewMode === 'ranking'
                    ? rankingError && !rankedRestaurants.length
                      ? '网络恢复后再试一次，社区评价不会丢失。'
                      : !rankedRestaurants.length
                        ? '去发现附近写下第一条评价，这家店就会加入榜单。'
                        : rankingScope === 'nearby' && !nearbyRankedCount
                          ? '切换到“全部”，看看其他地点的社区高分店。'
                          : '换个关键词或清除品类筛选试试。'
                    : viewMode !== 'rated'
                      ? '换个关键词或清除品类筛选试试。'
                      : !allRatedRestaurants.length
                      ? '先去发现附近的店，吃完再回来写真话。'
                      : ratedScope === 'nearby' && !nearbyRatedCount
                        ? '你的历史评分都还在，切回“全部”就能看到。'
                        : '换个关键词或清除品类筛选试试。'}
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setQuery('')
                    resetGlobalSearch()
                    setCategory('全部')
                    if (viewMode === 'ranking' && rankingError && !rankedRestaurants.length) {
                      setRankingLoading(true)
                      void refreshRankings()
                    } else if (viewMode === 'ranking' && rankedRestaurants.length) {
                      setRankingScope('all')
                    } else if (viewMode === 'rated' && allRatedRestaurants.length) {
                      setRatedScope('all')
                    } else {
                      setViewMode('nearby')
                    }
                  }}
                >
                  {viewMode === 'ranking'
                    ? rankingError && !rankedRestaurants.length
                      ? '重新加载'
                      : rankedRestaurants.length
                        ? '查看全部榜单'
                        : '去发现附近'
                    : viewMode === 'rated' && allRatedRestaurants.length
                      ? '显示全部评价'
                      : '重置筛选'}
                </button>
              </div>
            )}
          </div>
        </aside>
      </main>

      <AnimatePresence>
        {showBackToTop && (
          <motion.button
            type="button"
            className="back-to-top-button"
            onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })}
            aria-label="返回页面顶部"
            title="返回顶部"
            initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.92 }}
          >
            <ArrowUp size={22} weight="bold" />
          </motion.button>
        )}
      </AnimatePresence>

      <RestaurantDrawer
        key={selectedRestaurant?.id ?? 'none'}
        restaurant={selectedRestaurant}
        ratings={selectedRestaurant ? ratings[selectedRestaurant.id] ?? [] : []}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onRate={(restaurant) => {
          setSelectedRestaurant(restaurant)
          setDrawerOpen(false)
          window.setTimeout(() => setRatingOpen(true), reduceMotion ? 0 : 140)
        }}
        onDeleteRating={(restaurant) => {
          void deleteRating(restaurant)
        }}
      />

      <RatingDialog
        key={ratingOpen ? `${selectedRestaurant?.id ?? 'none'}-open` : 'closed'}
        open={ratingOpen}
        restaurant={selectedRestaurant}
        nickname={profileName}
        initialRating={selectedRestaurant ? localRatings[selectedRestaurant.id]?.[0] : undefined}
        onOpenChange={setRatingOpen}
        onSubmit={saveRating}
      />

      <AccountDialog
        open={accountOpen}
        onOpenChange={setAccountOpen}
        nickname={profileName}
        localRatingCount={Object.keys(localRatings).length}
        savedLocationCount={savedLocations.length}
        syncEnabled={cloudSyncEnabled}
        onSync={syncLocalData}
        onProfileChange={setProfileName}
        onSignedOut={() => {
          setCloudSyncEnabled(false)
          setCloudHydrated(false)
          setLocalRatings({})
          setRatedRestaurants([])
          setSavedLocations([])
          setToast('已退出账号；云端数据仍然保留')
        }}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            className="success-toast"
            role="status"
            initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
          >
            <Sparkle size={20} weight="fill" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
