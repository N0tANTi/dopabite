import {
  BowlFood,
  BowlSteam,
  Bread,
  Campfire,
  Coffee,
  CookingPot,
  Crosshair,
  FishSimple,
  ForkKnife,
  Hamburger,
  Leaf,
  MagnifyingGlass,
  MapPinArea,
  Minus,
  Heart,
  Pepper,
  PintGlass,
  Pizza,
  Plus,
  PushPin,
  WarningCircle,
} from '@phosphor-icons/react'
import AMapLoader from '@amap/amap-jsapi-loader'
import { createRoot, type Root } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import { DEMO_CENTER, distanceInMeters, NEARBY_RADIUS_METERS, type Restaurant } from '../data/restaurants'

type MapMode = 'demo' | 'loading' | 'live' | 'error'

export type LocationInfo = {
  label: string
  detail: string
  source: 'locating' | 'device' | 'manual' | 'fallback' | 'error'
  accuracy?: number
  point?: [number, number]
}

export type LocationRequest =
  | { token: number; kind: 'device' }
  | { token: number; kind: 'saved'; label: string; point: [number, number] }

type AMapLngLat = {
  lng?: number
  lat?: number
  getLng?: () => number
  getLat?: () => number
}

type AMapPoi = {
  id?: string
  name?: string
  address?: string | string[]
  type?: string
  location?: AMapLngLat
  photos?: Array<{ url?: string }> | { url?: string } | string
  rating?: string | number
  cost?: string | number
  biz_ext?: { rating?: string | number; cost?: string | number }
  bizExt?: { rating?: string | number; cost?: string | number }
  business?: { rating?: string | number; cost?: string | number }
}

type AMapSearchResult = {
  poiList?: { pois?: AMapPoi[] }
}

type AMapRegeocodeResult = {
  info?: string
  regeocode?: {
    formattedAddress?: string
    addressComponent?: {
      district?: string
      township?: string
      street?: string
      streetNumber?: string
    }
  }
}

type AMapGeocodeResult = {
  info?: string
  geocodes?: Array<{
    formattedAddress?: string
    location?: AMapLngLat
  }>
}

type AMapConvertResult = {
  info?: string
  locations?: AMapLngLat[]
}

type AMapMap = {
  destroy: () => void
  clearMap: () => void
  setCenter: (center: [number, number]) => void
  setZoomAndCenter: (zoom: number, center: [number, number]) => void
  getZoom: () => number
  zoomIn: () => void
  zoomOut: () => void
  on: (event: string, callback: (event: AMapMapClickEvent) => void) => void
  off: (event: string, callback: (event: AMapMapClickEvent) => void) => void
}

type AMapMapClickEvent = {
  lnglat?: AMapLngLat
}

type AMapMarker = {
  on: (event: string, callback: () => void) => void
  setContent: (content: string | HTMLElement) => void
  getPosition?: () => AMapLngLat
}

type AMapMarkerCluster = {
  setMap: (map: AMapMap | null) => void
  on: (event: string, callback: (event: AMapClusterClickEvent) => void) => void
}

type AMapClusterClickEvent = {
  lnglat?: AMapLngLat
  marker?: unknown[]
}

type AMapClusterRenderContext = {
  count: number
  marker: AMapMarker
}

type AMapMarkerRenderContext = {
  marker: AMapMarker
}

type AMapPlaceSearch = {
  search: (
    keyword: string,
    callback: (status: string, result: AMapSearchResult | string) => void,
  ) => void
  searchNearBy: (
    keyword: string,
    center: [number, number],
    radius: number,
    callback: (status: string, result: AMapSearchResult | string) => void,
  ) => void
}

type AMapGeocoder = {
  getAddress: (
    center: [number, number],
    callback: (status: string, result: AMapRegeocodeResult | string) => void,
  ) => void
  getLocation: (
    keyword: string,
    callback: (status: string, result: AMapGeocodeResult | string) => void,
  ) => void
}

type AMapModule = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap
  Marker: new (options: Record<string, unknown>) => AMapMarker
  MarkerCluster: new (
    map: AMapMap,
    points: Array<{ lnglat: [number, number]; weight?: number }>,
    options: {
      gridSize?: number
      maxZoom?: number
      averageCenter?: boolean
      renderClusterMarker?: (context: AMapClusterRenderContext) => void
      renderMarker?: (context: AMapMarkerRenderContext) => void
    },
  ) => AMapMarkerCluster
  PlaceSearch: new (options: Record<string, unknown>) => AMapPlaceSearch
  Geocoder: new (options?: Record<string, unknown>) => AMapGeocoder
  convertFrom: (
    point: [number, number],
    source: 'gps',
    callback: (status: string, result: AMapConvertResult) => void,
  ) => void
}

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode: string }
  }
}

type AmapCanvasProps = {
  restaurants: Restaurant[]
  selectedId?: string
  onSelect: (restaurant: Restaurant) => void
  onRestaurantsLoaded: (restaurants: Restaurant[], center: [number, number]) => void
  onRestaurantEnriched: (restaurant: Restaurant) => void
  enrichMissingDetails: boolean
  onLocationChange: (location: LocationInfo) => void
  resultLimit: number
  locationRequest: LocationRequest | null
  isCurrentLocationSaved: boolean
  onToggleFavorite: (location: LocationInfo) => void
  globalSearchRequest: { token: number; keyword: string } | null
  onGlobalSearchResult: (restaurants: Restaurant[] | null) => void
}

const fallbackPositions = [
  { left: '49%', top: '38%' },
  { left: '61%', top: '32%' },
  { left: '58%', top: '21%' },
  { left: '37%', top: '36%' },
  { left: '39%', top: '51%' },
  { left: '71%', top: '49%' },
]

const initialLocation: LocationInfo = {
  label: '正在识别位置',
  detail: '等待浏览器定位结果',
  source: 'locating',
}

const AMAP_SEARCH_POOL_SIZE = 50
const AMAP_BRAND_POOL_SIZE = 5
const DISCOVERY_BRAND_KEYWORDS = ['麦当劳', '肯德基', '必胜客'] as const

function getCoordinates(point?: AMapLngLat): [number, number] | null {
  if (!point) return null
  const lng = point.getLng?.() ?? point.lng
  const lat = point.getLat?.() ?? point.lat
  return typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : null
}

function fetchNearbyPoiPool(
  amap: AMapModule,
  center: [number, number],
  type: string,
  pageSize: number,
  keyword = '',
) {
  const service = new amap.PlaceSearch({
    pageSize,
    pageIndex: 1,
    type,
    extensions: 'all',
  })

  return new Promise<AMapPoi[] | null>((resolve) => {
    service.searchNearBy(keyword, center, NEARBY_RADIUS_METERS, (status, result) => {
      if (status !== 'complete' || typeof result === 'string') {
        resolve(null)
        return
      }
      resolve(result.poiList?.pois ?? [])
    })
  })
}

function fetchRestaurantDetails(amap: AMapModule, restaurant: Restaurant) {
  const service = new amap.PlaceSearch({
    pageSize: 5,
    pageIndex: 1,
    type: '050000',
    extensions: 'all',
  })

  return new Promise<Restaurant | null>((resolve) => {
    service.searchNearBy(restaurant.name, restaurant.location, 500, (status, result) => {
      if (status !== 'complete' || typeof result === 'string') {
        resolve(null)
        return
      }
      const poi = result.poiList?.pois?.find((candidate) => candidate.id === restaurant.id)
      if (!poi) {
        resolve(null)
        return
      }
      resolve({
        ...restaurant,
        name: poi.name ?? restaurant.name,
        address: poi.address ? normalizeAddress(poi.address) : restaurant.address,
        category: poi.type?.split(';').at(-1) ?? restaurant.category,
        location: getCoordinates(poi.location) ?? restaurant.location,
        image: getPhotoUrl(poi.photos) ?? restaurant.image,
        amapRating: getPoiNumber(poi, 'rating') ?? restaurant.amapRating,
        averageCost: getPoiNumber(poi, 'cost') ?? restaurant.averageCost,
      })
    })
  })
}

function normalizeAddress(address?: string | string[]) {
  return Array.isArray(address) ? address.join('') : address ?? '地址待补充'
}

function getPhotoUrl(photos?: AMapPoi['photos']) {
  if (typeof photos === 'string') return photos || undefined
  if (Array.isArray(photos)) return photos.find((photo) => photo?.url)?.url
  return photos?.url
}

function getLocationLabel(result: AMapRegeocodeResult) {
  const address = result.regeocode?.addressComponent
  const compact = [address?.district, address?.township, address?.street, address?.streetNumber]
    .filter(Boolean)
    .join('')
  return compact || result.regeocode?.formattedAddress || '已识别当前位置'
}

function isDiningPoi(poi: AMapPoi) {
  if (!poi.type) return true
  return poi.type.includes('餐饮服务') || /餐厅|小吃|饮品|咖啡|茶馆|甜品|面包/.test(poi.type)
}

function getPoiNumber(poi: AMapPoi, field: 'rating' | 'cost') {
  const candidates = [poi.biz_ext?.[field], poi.bizExt?.[field], poi.business?.[field], poi[field]]
  for (const value of candidates) {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '')
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function coordinateKey(point: [number, number]) {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`
}

function disposeMarkerRoots(roots: Map<AMapMarker, Root>) {
  const activeRoots = Array.from(roots.values())
  roots.clear()
  window.setTimeout(() => {
    activeRoots.forEach((root) => root.unmount())
  }, 0)
}

function getRestaurantMarkerMeta(category: string, name = '') {
  const value = `${category} ${name}`
  if (/日本|寿司|刺身|拉面/.test(value)) return { icon: FishSimple, tone: 'japanese', label: '日料' }
  if (/咖啡/.test(value)) return { icon: Coffee, tone: 'coffee', label: '咖啡' }
  if (/茶|饮品|奶茶|果汁/.test(value)) return { icon: PintGlass, tone: 'drink', label: '茶饮' }
  if (/火锅|涮/.test(value)) return { icon: CookingPot, tone: 'hotpot', label: '火锅' }
  if (/甜品|蛋糕|面包|烘焙/.test(value)) return { icon: Bread, tone: 'bakery', label: '烘焙甜品' }
  if (/快餐|汉堡/.test(value)) return { icon: Hamburger, tone: 'fastfood', label: '快餐' }
  if (/韩国|韩式/.test(value)) return { icon: BowlFood, tone: 'korean', label: '韩餐' }
  if (/西餐|外国|意大利|法国|披萨/.test(value)) return { icon: Pizza, tone: 'western', label: '西餐' }
  if (/素食|素菜/.test(value)) return { icon: Leaf, tone: 'veggie', label: '素食' }
  if (/川菜|湘菜|麻辣|酸菜鱼/.test(value)) return { icon: Pepper, tone: 'spicy', label: '辣味菜' }
  if (/烧烤|烤肉|串/.test(value)) return { icon: Campfire, tone: 'grill', label: '烧烤' }
  if (/面|粉|馄饨|饺子/.test(value)) return { icon: BowlSteam, tone: 'noodles', label: '面食' }
  return { icon: ForkKnife, tone: 'chinese', label: '中餐' }
}

export function AmapCanvas({
  restaurants,
  selectedId,
  onSelect,
  onRestaurantsLoaded,
  onRestaurantEnriched,
  enrichMissingDetails,
  onLocationChange,
  resultLimit,
  locationRequest,
  isCurrentLocationSaved,
  onToggleFavorite,
  globalSearchRequest,
  onGlobalSearchResult,
}: AmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AMapMap | null>(null)
  const amapRef = useRef<AMapModule | null>(null)
  const clusterRef = useRef<AMapMarkerCluster | null>(null)
  const markerRootsRef = useRef<Map<AMapMarker, Root>>(new Map())
  const requestLocationRef = useRef<(() => void) | null>(null)
  const searchAddressRef = useRef<((query: string) => void) | null>(null)
  const refreshSearchRef = useRef<(() => void) | null>(null)
  const applySavedLocationRef = useRef<((label: string, point: [number, number]) => void) | null>(null)
  const nearbySearchTokenRef = useRef(0)
  const detailEnrichmentAttemptsRef = useRef<Set<string>>(new Set())
  const resultLimitRef = useRef(resultLimit)
  const activeSearchRef = useRef<{
    amap: AMapModule
    center: [number, number]
    location: LocationInfo
  } | null>(null)
  const isPickingRef = useRef(false)
  const [mode, setMode] = useState<MapMode>('demo')
  const [message, setMessage] = useState('配置高德 Web Key 后启用实时地图')
  const [location, setLocation] = useState<LocationInfo>(initialLocation)
  const [locationPoint, setLocationPoint] = useState<[number, number] | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [isPicking, setIsPicking] = useState(false)
  const [addressQuery, setAddressQuery] = useState('')
  const [addressError, setAddressError] = useState('')
  const [isAddressSearching, setIsAddressSearching] = useState(false)
  const [mapInteractionEnabled, setMapInteractionEnabled] = useState(false)

  useEffect(() => {
    if (!globalSearchRequest) {
      const currentCenter = activeSearchRef.current?.center
      if (currentCenter) mapRef.current?.setZoomAndCenter(16, currentCenter)
      return
    }
    const amap = amapRef.current
    if (!amap) {
      onGlobalSearchResult(null)
      return
    }
    let cancelled = false
    let settled = false
    const timeout = window.setTimeout(() => {
      if (cancelled || settled) return
      settled = true
      setMessage('全部地点搜索超时，请重试')
      onGlobalSearchResult(null)
    }, 15_000)
    const service = new amap.PlaceSearch({
      pageSize: 50,
      pageIndex: 1,
      city: '全国',
      citylimit: false,
      type: '050000',
      extensions: 'all',
    })
    service.search(globalSearchRequest.keyword, (status, result) => {
      if (cancelled || settled) return
      settled = true
      window.clearTimeout(timeout)
      if (status === 'no_data') {
        setMessage('全部地点也没有找到餐饮店')
        onGlobalSearchResult([])
        return
      }
      if (status !== 'complete' || typeof result === 'string') {
        setMessage('全部地点搜索暂时失败')
        onGlobalSearchResult(null)
        return
      }
      const found = (result.poiList?.pois ?? []).flatMap((poi): Restaurant[] => {
        const point = getCoordinates(poi.location)
        if (!poi.id || !poi.name || !point || !isDiningPoi(poi)) return []
        return [{
          id: poi.id,
          name: poi.name,
          location: point,
          address: normalizeAddress(poi.address),
          businessArea: '全部地点搜索',
          category: poi.type?.split(';').at(-1) ?? '餐饮服务',
          image: getPhotoUrl(poi.photos),
          amapRating: getPoiNumber(poi, 'rating'),
          averageCost: getPoiNumber(poi, 'cost'),
          source: 'amap-live',
        }]
      })
      const unique = Array.from(new Map(found.map((item) => [item.id, item])).values())
      if (unique.length) mapRef.current?.setZoomAndCenter(13, unique[0].location)
      setMessage(unique.length ? `全部地点找到 ${unique.length} 家餐饮店` : '全部地点也没有找到餐饮店')
      onGlobalSearchResult(unique)
    })
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [globalSearchRequest, onGlobalSearchResult])

  useEffect(() => {
    resultLimitRef.current = resultLimit
    refreshSearchRef.current?.()
  }, [resultLimit])

  useEffect(() => {
    if (!locationRequest) return
    if (locationRequest.kind === 'device') {
      requestLocationRef.current?.()
      return
    }
    applySavedLocationRef.current?.(locationRequest.label, locationRequest.point)
  }, [locationRequest])

  useEffect(() => {
    const key = import.meta.env.VITE_AMAP_KEY
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE
    if (!key || !securityCode || !containerRef.current) return

    let cancelled = false
    let mapClickHandler: ((event: AMapMapClickEvent) => void) | null = null
    const markerRoots = markerRootsRef.current
    setMode('loading')
    setIsLocating(true)
    setMessage('正在定位并加载附近餐厅')
    onLocationChange(initialLocation)
    window._AMapSecurityConfig = { securityJsCode: securityCode }

    const publishLocation = (nextLocation: LocationInfo) => {
      if (cancelled) return
      setLocation(nextLocation)
      onLocationChange(nextLocation)
    }

    const describeLocation = (
      amap: AMapModule,
      center: [number, number],
      baseLocation: LocationInfo,
      syncAddressQuery = false,
    ) => {
      if (baseLocation.source !== 'device' && baseLocation.source !== 'manual') {
        publishLocation(baseLocation)
        return
      }

      const geocoder = new amap.Geocoder({ radius: 800, extensions: 'base' })
      geocoder.getAddress(center, (status, result) => {
        if (cancelled) return
        if (status === 'complete' && typeof result !== 'string' && result.regeocode) {
          const resolvedLabel = getLocationLabel(result)
          if (syncAddressQuery) setAddressQuery(resolvedLabel)
          publishLocation({ ...baseLocation, label: resolvedLabel })
          return
        }
        publishLocation({ ...baseLocation, label: '已识别当前位置' })
      })
    }

    const searchNearby = (
      amap: AMapModule,
      center: [number, number],
      baseLocation: LocationInfo,
    ) => {
      const searchToken = ++nearbySearchTokenRef.current
      setMessage(
        baseLocation.source === 'device'
          ? '正在加载你附近的餐厅'
          : baseLocation.source === 'manual'
            ? '正在加载所选位置附近餐厅'
            : '正在加载默认位置附近餐厅',
      )
      // Use the dining POI type as the primary filter rather than the keyword
      // “餐厅”. That keyword biases AMap toward names/categories containing the
      // word and can hide nearby chains. Small, sequential brand lookups add at
      // most one nearby result per brand without overwhelming the general list
      // or bursting AMap's per-second request limit.
      void (async () => {
        const allDiningPois = await fetchNearbyPoiPool(
          amap,
          center,
          '050000',
          AMAP_SEARCH_POOL_SIZE,
        )
        if (cancelled || searchToken !== nearbySearchTokenRef.current) return
        const brandPoiPools: AMapPoi[][] = []
        for (const keyword of DISCOVERY_BRAND_KEYWORDS) {
          const pois = await fetchNearbyPoiPool(
            amap,
            center,
            '050000',
            AMAP_BRAND_POOL_SIZE,
            keyword,
          )
          if (cancelled || searchToken !== nearbySearchTokenRef.current) return
          brandPoiPools.push(pois ?? [])
        }

        if (cancelled || searchToken !== nearbySearchTokenRef.current) return
        setIsLocating(false)
        if (!allDiningPois && brandPoiPools.every((pois) => pois.length === 0)) {
          setMode('error')
          setMessage('附近店铺暂时加载失败，已保留原有店铺数据')
          return
        }

        const toRestaurant = (poi: AMapPoi): Restaurant | null => {
          const poiLocation = getCoordinates(poi.location)
          if (!poi.id || !poi.name || !poiLocation || !isDiningPoi(poi)) return null
          const rating = getPoiNumber(poi, 'rating')
          const cost = getPoiNumber(poi, 'cost')

          return {
            id: poi.id,
            name: poi.name,
            location: poiLocation,
            address: normalizeAddress(poi.address),
            businessArea:
              baseLocation.source === 'manual'
                ? '手动选点附近'
                : baseLocation.source === 'device'
                  ? '设备位置附近'
                  : baseLocation.label,
            category: poi.type?.split(';').at(-1) ?? '餐饮服务',
            image: getPhotoUrl(poi.photos),
            amapRating: rating,
            averageCost: cost,
            source: 'amap-live',
          }
        }

        const sortByDistance = (first: Restaurant, second: Restaurant) =>
          distanceInMeters(center, first.location) - distanceInMeters(center, second.location)
        const uniqueById = (items: Restaurant[]) =>
          Array.from(new Map(items.map((restaurant) => [restaurant.id, restaurant])).values())

        const diningPool = uniqueById(
          (allDiningPois ?? [])
            .map(toRestaurant)
            .filter((restaurant): restaurant is Restaurant => restaurant !== null),
        ).sort(sortByDistance)
        const nearestBrandRestaurants = brandPoiPools
          .map((pois) =>
            pois
              .map(toRestaurant)
              .filter((restaurant): restaurant is Restaurant => restaurant !== null)
              .sort(sortByDistance)[0],
          )
          .filter((restaurant): restaurant is Restaurant => Boolean(restaurant))

        const requestedLimit = resultLimitRef.current
        const nearestDining = diningPool.slice(0, requestedLimit)
        const nearestIds = new Set(nearestDining.map((restaurant) => restaurant.id))
        const brandSupplement = uniqueById(nearestBrandRestaurants).filter(
          (restaurant) => !nearestIds.has(restaurant.id),
        ).slice(0, requestedLimit)
        const liveRestaurants = [
          ...nearestDining.slice(0, Math.max(0, requestedLimit - brandSupplement.length)),
          ...brandSupplement,
        ].sort(sortByDistance)

        onRestaurantsLoaded(liveRestaurants, center)
        setMode('live')
        setMessage(
          liveRestaurants.length
            ? `已连接高德，找到 ${liveRestaurants.length} 家附近餐厅`
            : '当前 2 公里内暂未找到餐厅',
        )
      })().catch(() => {
        if (cancelled || searchToken !== nearbySearchTokenRef.current) return
        setIsLocating(false)
        setMode('error')
        setMessage('附近店铺暂时加载失败，已保留原有店铺数据')
      })
    }

    const applyLocation = (
      amap: AMapModule,
      center: [number, number],
      nextLocation: LocationInfo,
      syncAddressQuery = false,
    ) => {
      if (cancelled) return
      const located: LocationInfo = { ...nextLocation, point: center }
      isPickingRef.current = false
      setIsPicking(false)
      activeSearchRef.current = { amap, center, location: located }
      mapRef.current?.setZoomAndCenter(16, center)
      setLocationPoint(center)
      setMapInteractionEnabled(false)
      publishLocation(located)
      describeLocation(amap, center, located, syncAddressQuery)
      searchNearby(amap, center, located)
    }

    const applyFallbackLocation = (amap: AMapModule, reason: string) => {
      applyLocation(amap, DEMO_CENTER, {
        label: '静安寺 · 默认探索点',
        detail: reason,
        source: 'fallback',
      })
    }

    const requestDeviceLocation = (amap: AMapModule) => {
      isPickingRef.current = false
      setIsPicking(false)
      setIsLocating(true)
      setMessage('正在重新识别你的位置')
      publishLocation({
        label: '正在识别位置',
        detail: '正在请求设备定位',
        source: 'locating',
      })

      if (!navigator.geolocation) {
        applyFallbackLocation(amap, '当前浏览器不支持精确定位')
        return
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const rawPoint: [number, number] = [position.coords.longitude, position.coords.latitude]
          const accuracy = Math.max(1, Math.round(position.coords.accuracy))
          amap.convertFrom(rawPoint, 'gps', (status, result) => {
            const convertedPoint = status === 'complete' ? getCoordinates(result.locations?.[0]) : null
            applyLocation(
              amap,
              convertedPoint ?? rawPoint,
              {
                label: '正在识别地点',
                detail: `设备定位精度约 ${accuracy} 米${convertedPoint ? '，已匹配高德坐标' : ''}`,
                source: 'device',
                accuracy,
              },
              true,
            )
          })
        },
        (error) => {
          const reason =
            error.code === error.PERMISSION_DENIED
              ? '未获得定位权限，当前展示默认位置'
              : error.code === error.TIMEOUT
                ? '定位超时，当前展示默认位置'
                : '暂时无法定位，当前展示默认位置'
          applyFallbackLocation(amap, reason)
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      )
    }

    AMapLoader.load({
      key,
      version: '2.0',
      plugins: ['AMap.PlaceSearch', 'AMap.Geocoder', 'AMap.MarkerCluster'],
    })
      .then((loaded) => {
        if (cancelled || !containerRef.current) return
        const amap = loaded as unknown as AMapModule
        amapRef.current = amap
        const map = new amap.Map(containerRef.current, {
          center: DEMO_CENTER,
          zoom: 16,
          viewMode: '2D',
          mapStyle: 'amap://styles/normal',
          scrollWheel: true,
        })
        mapRef.current = map
        requestLocationRef.current = () => requestDeviceLocation(amap)
        applySavedLocationRef.current = (label, point) => {
          setAddressQuery(label)
          applyLocation(amap, point, {
            label,
            detail: '已从收藏地点切换，可继续搜索或在地图上微调',
            source: 'manual',
          })
        }
        refreshSearchRef.current = () => {
          const current = activeSearchRef.current
          if (current) searchNearby(current.amap, current.center, current.location)
        }
        searchAddressRef.current = (query) => {
          const keyword = query.trim()
          if (!keyword) {
            setAddressError('请输入地址、商场或地标')
            return
          }
          setAddressError('')
          setIsAddressSearching(true)
          setMessage(`正在搜索“${keyword}”`)
          const geocoder = new amap.Geocoder({ extensions: 'base' })
          geocoder.getLocation(keyword, (status, result) => {
            if (cancelled) return
            setIsAddressSearching(false)
            const match = status === 'complete' && typeof result !== 'string' ? result.geocodes?.[0] : undefined
            const point = getCoordinates(match?.location)
            if (!point) {
              setAddressError('没有找到这个地址，请补充城市或区县后重试')
              setMessage('地址搜索没有结果')
              return
            }
            setAddressQuery(match?.formattedAddress || keyword)
            applyLocation(amap, point, {
              label: match?.formattedAddress || keyword,
              detail: '通过地址搜索选定，仍可在地图上微调',
              source: 'manual',
            })
          })
        }
        mapClickHandler = (event) => {
          if (!isPickingRef.current) return
          const pickedPoint = getCoordinates(event.lnglat)
          if (!pickedPoint) return
          applyLocation(
            amap,
            pickedPoint,
            {
              label: '正在识别所选地点',
              detail: '已在地图上手动校准探索位置',
              source: 'manual',
            },
            true,
          )
        }
        map.on('click', mapClickHandler)
        requestDeviceLocation(amap)
      })
      .catch(() => {
        if (cancelled) return
        setMode('error')
        setIsLocating(false)
        setMessage('高德地图加载失败，已切换到真实店铺演示数据')
        publishLocation({
          label: '静安寺 · 演示位置',
          detail: '地图服务暂时不可用',
          source: 'error',
        })
      })

    return () => {
      cancelled = true
      requestLocationRef.current = null
      searchAddressRef.current = null
      refreshSearchRef.current = null
      applySavedLocationRef.current = null
      activeSearchRef.current = null
      isPickingRef.current = false
      disposeMarkerRoots(markerRoots)
      clusterRef.current?.setMap(null)
      clusterRef.current = null
      if (mapClickHandler) mapRef.current?.off('click', mapClickHandler)
      mapRef.current?.destroy()
      mapRef.current = null
      amapRef.current = null
    }
  }, [onLocationChange, onRestaurantsLoaded])

  useEffect(() => {
    if (mode !== 'live' || !mapRef.current || !amapRef.current) return
    const map = mapRef.current
    const amap = amapRef.current
    disposeMarkerRoots(markerRootsRef.current)
    clusterRef.current?.setMap(null)
    clusterRef.current = null
    map.clearMap()

    if (locationPoint) {
      new amap.Marker({
        map,
        position: locationPoint,
        anchor: 'center',
        zIndex: 200,
        content: `<div class="amap-user-marker ${location.source === 'device' || location.source === 'manual' ? 'is-device' : 'is-fallback'}"><span></span><strong>${location.source === 'manual' ? '你选的位置' : location.source === 'device' && (location.accuracy ?? 0) > 500 ? '大致位置' : location.source === 'device' ? '你在这里' : '默认位置'}</strong></div>`,
      })
    }

    if (!restaurants.length) return

    const restaurantsByCoordinate = new Map(
      restaurants.map((restaurant, index) => [coordinateKey(restaurant.location), { restaurant, index }]),
    )
    const cluster = new amap.MarkerCluster(
      map,
      restaurants.map((restaurant) => ({
        lnglat: restaurant.location,
        weight: restaurant.id === selectedId ? 2 : 1,
      })),
      {
        gridSize: 58,
        maxZoom: 18,
        averageCenter: true,
        renderClusterMarker: ({ count, marker }) => {
          marker.setContent(`<div class="amap-dopa-cluster" aria-label="这里有 ${count} 家店">${count}</div>`)
        },
        renderMarker: ({ marker }) => {
          const point = getCoordinates(marker.getPosition?.())
          const match = point ? restaurantsByCoordinate.get(coordinateKey(point)) : undefined
          if (!match) return
          const markerMeta = getRestaurantMarkerMeta(match.restaurant.category, match.restaurant.name)
          const MarkerIcon = markerMeta.icon
          let root = markerRootsRef.current.get(marker)
          if (!root) {
            const content = document.createElement('div')
            root = createRoot(content)
            markerRootsRef.current.set(marker, root)
            marker.setContent(content)
          }
          root.render(
            <button
              type="button"
              className={`amap-dopa-marker marker-${markerMeta.tone}${match.restaurant.id === selectedId ? ' is-selected' : ''}`}
              title={markerMeta.label}
              aria-label={`${markerMeta.label}，序号 ${match.index + 1}，查看${match.restaurant.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(match.restaurant)
              }}
            >
              <span className="restaurant-marker-icon" aria-hidden="true">
                <MarkerIcon size={22} weight="fill" />
              </span>
              <span className="restaurant-marker-number">{match.index + 1}</span>
            </button>,
          )
        },
      },
    )
    cluster.on('click', (event) => {
      if ((event.marker?.length ?? 0) <= 1) return
      const point = getCoordinates(event.lnglat)
      if (point) map.setZoomAndCenter(Math.min(map.getZoom() + 2, 19), point)
    })
    clusterRef.current = cluster
  }, [location.accuracy, location.source, locationPoint, mode, onSelect, restaurants, selectedId])

  useEffect(() => {
    if (mode !== 'live' || !selectedId || !mapRef.current) return
    const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === selectedId)
    if (!selectedRestaurant) return
    mapRef.current.setZoomAndCenter(Math.max(mapRef.current.getZoom(), 15), selectedRestaurant.location)
  }, [mode, restaurants, selectedId])

  useEffect(() => {
    const amap = amapRef.current
    if (mode !== 'live' || !amap || !enrichMissingDetails) return
    const targets = restaurants
      .filter((restaurant) => (
        !restaurant.image
        || restaurant.amapRating === undefined
        || restaurant.averageCost === undefined
      ))
      .filter((restaurant) => !detailEnrichmentAttemptsRef.current.has(restaurant.id))
      .slice(0, 6)

    for (const restaurant of targets) {
      detailEnrichmentAttemptsRef.current.add(restaurant.id)
      void fetchRestaurantDetails(amap, restaurant)
        .then((enrichedRestaurant) => {
          if (enrichedRestaurant) onRestaurantEnriched(enrichedRestaurant)
        })
        .catch(() => undefined)
    }
  }, [enrichMissingDetails, mode, onRestaurantEnriched, restaurants])

  useEffect(() => {
    if (!enrichMissingDetails) detailEnrichmentAttemptsRef.current.clear()
  }, [enrichMissingDetails])

  const isDemo = mode === 'demo' || mode === 'error'

  return (
    <section className={`map-shell ${mapInteractionEnabled ? 'is-interactive' : ''}`} aria-label="附近餐厅地图">
      <div ref={containerRef} className={`amap-stage ${isDemo ? 'is-demo' : ''}`}>
        {isDemo && <img src="/assets/demo-map.png" alt="静安寺地图演示底图" className="demo-map-image" />}
        {isDemo && (
          <div className="demo-markers" aria-label="真实高德 POI 演示标记">
            {restaurants.slice(0, fallbackPositions.length).map((restaurant, index) => {
              const markerMeta = getRestaurantMarkerMeta(restaurant.category, restaurant.name)
              const MarkerIcon = markerMeta.icon
              return (
                <button
                  type="button"
                  className={`map-marker marker-${markerMeta.tone} ${restaurant.id === selectedId ? 'is-selected' : ''}`}
                  style={fallbackPositions[index]}
                  onClick={() => onSelect(restaurant)}
                  aria-label={`${markerMeta.label}，序号 ${index + 1}，查看${restaurant.name}`}
                  title={markerMeta.label}
                  key={restaurant.id}
                >
                  <span className="restaurant-marker-icon" aria-hidden="true">
                    <MarkerIcon size={22} weight="fill" />
                  </span>
                  <span className="restaurant-marker-number">{index + 1}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        className="map-touch-toggle"
        onClick={() => setMapInteractionEnabled((current) => !current)}
        aria-pressed={mapInteractionEnabled}
      >
        {mapInteractionEnabled ? '完成地图操作' : '操作地图'}
      </button>

      <div className={`map-status ${mode}`} role="status">
        {mode === 'error' ? <WarningCircle size={18} weight="fill" /> : <MapPinArea size={18} weight="fill" />}
        <span>{message}</span>
      </div>

      <form
        className={`map-address-search ${addressError ? 'has-error' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          searchAddressRef.current?.(addressQuery)
        }}
      >
        <MagnifyingGlass size={17} weight="bold" aria-hidden="true" />
        <input
          value={addressQuery}
          onChange={(event) => {
            setAddressQuery(event.target.value)
            setAddressError('')
          }}
          placeholder="输入地址、商场或地标选址"
          aria-label="输入地址选址"
          aria-describedby={addressError ? 'map-address-error' : undefined}
        />
        <button className="map-address-submit" type="submit" disabled={isAddressSearching || mode === 'demo'}>
          {isAddressSearching ? '搜索中' : '去这里'}
        </button>
        <button
          type="button"
          className={`map-favorite-button ${isCurrentLocationSaved ? 'is-saved' : ''}`}
          onClick={() => onToggleFavorite(location)}
          disabled={!location.point || location.source === 'locating'}
          aria-pressed={isCurrentLocationSaved}
          title={isCurrentLocationSaved ? '取消收藏当前地点' : '收藏当前地点'}
        >
          <Heart size={14} weight={isCurrentLocationSaved ? 'fill' : 'bold'} />
          <span>{isCurrentLocationSaved ? '已收藏' : '收藏此处'}</span>
        </button>
        {addressError && <small id="map-address-error">{addressError}</small>}
      </form>

      <div className="map-zoom-controls" aria-label="地图缩放">
        <button type="button" onClick={() => mapRef.current?.zoomIn()} disabled={isDemo} aria-label="放大地图" title="放大地图">
          <Plus size={18} weight="bold" />
        </button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()} disabled={isDemo} aria-label="缩小地图" title="缩小地图">
          <Minus size={18} weight="bold" />
        </button>
      </div>

      <button
        type="button"
        className={`map-pick-button ${isPicking ? 'is-active' : ''}`}
        onClick={() => {
          const next = !isPickingRef.current
          isPickingRef.current = next
          setIsPicking(next)
          if (next) setMapInteractionEnabled(true)
          setMessage(next ? '请在地图上点击你的实际位置' : '已取消地图选点')
        }}
        aria-pressed={isPicking}
      >
        <PushPin size={15} weight="fill" />
        {isPicking ? '取消选点' : '地图选点'}
      </button>

      <button
        type="button"
        className={`locate-button ${isLocating ? 'is-locating' : ''}`}
        onClick={() => requestLocationRef.current?.()}
        disabled={mode === 'demo' || isLocating}
        aria-label={isLocating ? '正在定位' : '重新定位并刷新附近餐厅'}
        title={isLocating ? '正在定位' : '重新定位并刷新附近餐厅'}
      >
        <Crosshair size={22} weight="bold" />
      </button>
    </section>
  )
}
