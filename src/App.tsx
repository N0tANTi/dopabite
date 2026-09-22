import {
  ArrowUp,
  CaretDown,
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
import { AmapCanvas, type LocationInfo, type LocationRequest } from './components/AmapCanvas'
import { RatingDialog } from './components/RatingDialog'
import { RestaurantCard } from './components/RestaurantCard'
import { RestaurantDrawer } from './components/RestaurantDrawer'
import {
  DEMO_CENTER,
  distanceInMeters,
  getDopaScore,
  seedRestaurants,
  type RatingEntry,
  type Restaurant,
} from './data/restaurants'

type RatingStore = Record<string, RatingEntry[]>
type SortMode = 'distance' | 'amap' | 'dopa' | 'budget'
type ViewMode = 'nearby' | 'rated' | 'ranking'
type SavedLocation = {
  id: string
  label: string
  point: [number, number]
}

const RATING_STORAGE_KEY = 'dopabite-ratings-v1'
const LOCATION_STORAGE_KEY = 'dopabite-saved-locations-v1'

const initialLocationInfo: LocationInfo = {
  label: '正在识别位置',
  detail: '等待浏览器定位结果',
  source: 'locating',
}

function loadRatings(): RatingStore {
  try {
    const value = window.localStorage.getItem(RATING_STORAGE_KEY)
    return value ? (JSON.parse(value) as RatingStore) : {}
  } catch {
    return {}
  }
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
  const [restaurants, setRestaurants] = useState<Restaurant[]>(seedRestaurants)
  const [center, setCenter] = useState<[number, number]>(DEMO_CENTER)
  const [ratings, setRatings] = useState<RatingStore>(loadRatings)
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [sortMode, setSortMode] = useState<SortMode>('distance')
  const [viewMode, setViewMode] = useState<ViewMode>('nearby')
  const [showLocationMenu, setShowLocationMenu] = useState(false)
  const [toast, setToast] = useState('')
  const [locationInfo, setLocationInfo] = useState<LocationInfo>(initialLocationInfo)
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(loadSavedLocations)
  const [locationRequest, setLocationRequest] = useState<LocationRequest | null>(null)
  const [resultLimit, setResultLimit] = useState(40)
  const [resultLimitDraft, setResultLimitDraft] = useState('40')
  const [showBackToTop, setShowBackToTop] = useState(false)
  const locationRequestTokenRef = useRef(0)

  useMotionValueEvent(scrollY, 'change', (latest) => {
    const shouldShow = latest > 640
    setShowBackToTop((current) => (current === shouldShow ? current : shouldShow))
  })

  useEffect(() => {
    window.localStorage.setItem(RATING_STORAGE_KEY, JSON.stringify(ratings))
  }, [ratings])

  useEffect(() => {
    window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(savedLocations))
  }, [savedLocations])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3_500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const handleRestaurantsLoaded = useCallback(
    (nextRestaurants: Restaurant[], nextCenter: [number, number]) => {
      setRestaurants(nextRestaurants)
      setCenter(nextCenter)
      setCategory('全部')
    },
    [],
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

  const categories = useMemo(
    () => ['全部', ...Array.from(new Set(restaurants.map((restaurant) => restaurant.category))).slice(0, 5)],
    [restaurants],
  )

  const visibleRestaurants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = restaurants.filter((restaurant) => {
      const matchesQuery =
        !normalizedQuery ||
        restaurant.name.toLowerCase().includes(normalizedQuery) ||
        restaurant.address.toLowerCase().includes(normalizedQuery) ||
        restaurant.category.toLowerCase().includes(normalizedQuery)
      const matchesCategory = category === '全部' || restaurant.category === category
      const matchesView = viewMode !== 'rated' || (ratings[restaurant.id]?.length ?? 0) > 0
      return matchesQuery && matchesCategory && matchesView
    })

    const activeSort = viewMode === 'ranking' ? 'dopa' : sortMode
    return [...filtered].sort((a, b) => {
      if (activeSort === 'amap') return (b.amapRating ?? -1) - (a.amapRating ?? -1)
      if (activeSort === 'budget') return (a.averageCost ?? Number.MAX_SAFE_INTEGER) - (b.averageCost ?? Number.MAX_SAFE_INTEGER)
      if (activeSort === 'dopa') {
        return (getDopaScore(ratings[b.id]) ?? -1) - (getDopaScore(ratings[a.id]) ?? -1)
      }
      return distanceInMeters(center, a.location) - distanceInMeters(center, b.location)
    })
  }, [category, center, query, ratings, restaurants, sortMode, viewMode])

  const saveRating = (restaurant: Restaurant, rating: RatingEntry) => {
    setRatings((current) => ({
      ...current,
      [restaurant.id]: [rating, ...(current[restaurant.id] ?? [])],
    }))
    setToast(`已保存对「${restaurant.name}」的评分`)
    if (!reduceMotion) {
      void confetti({
        particleCount: 110,
        spread: 78,
        startVelocity: 34,
        origin: { x: 0.76, y: 0.72 },
        colors: ['#ff3377', '#ffd027', '#00c98d', '#1ec8ff', '#7657e8'],
      })
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
            onClick={() => setViewMode('nearby')}
            aria-pressed={viewMode === 'nearby'}
          >
            发现附近
          </button>
          <button
            type="button"
            className={viewMode === 'ranking' ? 'is-active' : ''}
            onClick={() => setViewMode('ranking')}
            aria-pressed={viewMode === 'ranking'}
          >
            多巴胺榜
          </button>
          <button
            type="button"
            className={viewMode === 'rated' ? 'is-active' : ''}
            onClick={() => setViewMode('rated')}
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
            className="profile-button"
            aria-label="个人中心"
            title="个人中心"
            onClick={() => setToast('账号系统尚未接入；当前评分只保存在这台设备上')}
          >
            <UserCircle size={27} weight="duotone" />
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

            <p className="location-menu-note">收藏仅保存在当前浏览器；切换地点后，地图和附近店铺会一起刷新。</p>
          </motion.aside>
        )}
      </AnimatePresence>

      <main id="main" className="discovery-layout">
        <div className="map-column">
          <div className="map-intro">
            <div>
              <span className="eyebrow">今天想吃点什么</span>
              <h1>附近的真实店，<br />吃完由你打分。</h1>
            </div>
            <div className="map-intro-stat">
              <strong>{restaurants.length}</strong>
              <span>家附近店铺</span>
            </div>
          </div>

          <AmapCanvas
            restaurants={visibleRestaurants}
            selectedId={selectedRestaurant?.id}
            onSelect={openRestaurantFromMap}
            onRestaurantsLoaded={handleRestaurantsLoaded}
            onLocationChange={setLocationInfo}
            resultLimit={resultLimit}
            locationRequest={locationRequest}
            isCurrentLocationSaved={Boolean(savedCurrentLocation)}
            onToggleFavorite={toggleFavoriteLocation}
          />
        </div>

        <aside className="results-panel" aria-label="附近店铺列表">
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
              <p>{visibleRestaurants.length} 个结果，店铺数据来自高德</p>
            </div>
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
          </div>

          <label className="search-box">
            <span className="sr-only">搜索店名、地址或品类</span>
            <MagnifyingGlass size={20} weight="bold" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜店名、地址或品类"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                <X size={16} weight="bold" />
              </button>
            )}
          </label>

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

            <label className="sort-select">
              <SlidersHorizontal size={17} weight="bold" aria-hidden="true" />
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="distance">离我最近</option>
                <option value="dopa">多巴胺最高</option>
                <option value="amap">高德参考分最高</option>
                <option value="budget">人均最低</option>
              </select>
            </label>
          </div>

          <div className="restaurant-list">
            {visibleRestaurants.length > 0 ? (
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
                <h3>{viewMode === 'rated' ? '你还没打过分' : '这个条件没找到店'}</h3>
                <p>{viewMode === 'rated' ? '先去发现附近的店，吃完再回来写真话。' : '换个关键词或清除品类筛选试试。'}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setQuery('')
                    setCategory('全部')
                    setViewMode('nearby')
                  }}
                >
                  重置筛选
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
        restaurant={selectedRestaurant}
        ratings={selectedRestaurant ? ratings[selectedRestaurant.id] ?? [] : []}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onRate={(restaurant) => {
          setSelectedRestaurant(restaurant)
          setDrawerOpen(false)
          window.setTimeout(() => setRatingOpen(true), reduceMotion ? 0 : 140)
        }}
      />

      <RatingDialog
        key={ratingOpen ? `${selectedRestaurant?.id ?? 'none'}-open` : 'closed'}
        open={ratingOpen}
        restaurant={selectedRestaurant}
        onOpenChange={setRatingOpen}
        onSubmit={saveRating}
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
