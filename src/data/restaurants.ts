export type RatingEntry = {
  id?: string
  taste: number
  value: number
  returnIntent: number
  note: string
  createdAt: string
  updatedAt?: string
  authorLabel?: string
  isMine?: boolean
  source?: 'local' | 'cloud'
}

export type Restaurant = {
  id: string
  name: string
  location: [number, number]
  address: string
  businessArea: string
  category: string
  image?: string
  amapRating?: number
  averageCost?: number
  openTime?: string
  source: 'amap-live' | 'amap-mcp'
}

export const DEMO_CENTER: [number, number] = [121.445219, 31.223512]
export const NEARBY_RADIUS_METERS = 2_000

// Seeded from the connected AMap MCP on 2026-09-21. The browser switches to
// live nearby search when VITE_AMAP_KEY and VITE_AMAP_SECURITY_CODE are set.
export const seedRestaurants: Restaurant[] = [
  {
    id: 'B0KD65HDKV',
    name: '无味舒食(静安寺店)',
    location: [121.444985, 31.223944],
    address: '愚园路151号静安福慧楼4层',
    businessArea: '静安寺',
    category: '中餐厅',
    image:
      'https://aos-comment.amap.com/B0KD65HDKV/comment/02B0E80D_F306_40D2_9FC3_E42795351CA3_L0_001_1500_200_1761278114649_60361417.jpg',
    amapRating: 4.6,
    averageCost: 446,
    openTime: '10:30-21:00',
    source: 'amap-mcp',
  },
  {
    id: 'B00157H90O',
    name: '龙记香港茶餐厅(久光百货店)',
    location: [121.446056, 31.223818],
    address: '南京西路1618号久光百货B1楼',
    businessArea: '静安寺',
    category: '茶餐厅',
    image:
      'https://aos-comment.amap.com/comment/content_service__1770264553596_87416716_1770264778426_15637502.jpg',
    amapRating: 4.3,
    averageCost: 85,
    openTime: '10:00-22:00',
    source: 'amap-mcp',
  },
  {
    id: 'B0H17S7JWS',
    name: '富临轩(久光百货店)',
    location: [121.445778, 31.224203],
    address: '南京西路1618号静安久光百货8楼',
    businessArea: '静安寺',
    category: '粤菜',
    image: 'https://store.is.autonavi.com/showpic/5c387788397f98aaffccc183adbf31c3',
    amapRating: 4.6,
    averageCost: 224,
    openTime: '10:00-22:00',
    source: 'amap-mcp',
  },
  {
    id: 'B0JDR7NHDU',
    name: 'GinPork金猪·韩国料理(900食品城店)',
    location: [121.443458, 31.223943],
    address: '万航渡路50号1层沿街',
    businessArea: '静安寺',
    category: '韩国料理',
    image:
      'https://aos-comment.amap.com/B0JDR7NHDU/comment/6408c0383e45d6b07d2aacad2e653e22_2048_2048_80.jpg',
    source: 'amap-mcp',
  },
  {
    id: 'B0I14RCCMD',
    name: '毛头老爹饭店(静安寺店)',
    location: [121.443626, 31.223542],
    address: '愚园路246弄6号',
    businessArea: '静安寺',
    category: '中餐厅',
    image:
      'https://aos-comment.amap.com/B0I14RCCMD/comment/content_media_external_file_100003673_1768995484633_00600156.jpg',
    source: 'amap-mcp',
  },
  {
    id: 'B0K3SCOHF3',
    name: '浩海火烧云傃家菜(静安芮欧店)',
    location: [121.44703, 31.223003],
    address: '南京西路1601号芮欧百货4层',
    businessArea: '静安寺',
    category: '傃菜',
    image:
      'https://aos-comment.amap.com/B0K3SCOHF3/comment/E32D648F_01CF_4951_8F0D_D399FFF6D40A_L0_001_2016_151_1768365676121_93594553.jpg',
    source: 'amap-mcp',
  },
]

export function distanceInMeters(
  [lngA, latA]: [number, number],
  [lngB, latB]: [number, number],
) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadius = 6_371_000
  const latDelta = toRadians(latB - latA)
  const lngDelta = toRadians(lngB - lngA)
  const value =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(lngDelta / 2) ** 2

  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)))
}

export function getDopaScore(entries: RatingEntry[] = []) {
  if (!entries.length) return null

  const total = entries.reduce(
    (sum, rating) => sum + rating.taste * 0.5 + rating.value * 0.25 + rating.returnIntent * 0.25,
    0,
  )

  return Math.round((total / entries.length) * 10) / 10
}
