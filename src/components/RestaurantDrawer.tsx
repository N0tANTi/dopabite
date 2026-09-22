import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowSquareOut,
  Clock,
  ForkKnife,
  MapPin,
  Sparkle,
  Star,
  X,
} from '@phosphor-icons/react'
import { useState } from 'react'
import type { RatingEntry, Restaurant } from '../data/restaurants'
import { getDopaScore } from '../data/restaurants'

type RestaurantDrawerProps = {
  restaurant: Restaurant | null
  ratings: RatingEntry[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRate: (restaurant: Restaurant) => void
}

export function RestaurantDrawer({
  restaurant,
  ratings,
  open,
  onOpenChange,
  onRate,
}: RestaurantDrawerProps) {
  const [imageFailed, setImageFailed] = useState(false)
  if (!restaurant) return null

  const dopaScore = getDopaScore(ratings)
  const amapUrl = `https://uri.amap.com/marker?position=${restaurant.location.join(',')}&name=${encodeURIComponent(restaurant.name)}&callnative=0`

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="restaurant-drawer" aria-describedby="drawer-description">
          <Dialog.Close className="drawer-close" aria-label="关闭店铺详情">
            <X size={22} weight="bold" />
          </Dialog.Close>

          <div className="drawer-hero">
            {!imageFailed && restaurant.image ? (
              <img
                src={restaurant.image}
                alt={`${restaurant.name}的高德店铺图片`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="drawer-photo-fallback">
                <ForkKnife size={54} weight="duotone" />
                <span>暂无店铺图片</span>
              </div>
            )}
          </div>

          <div className="drawer-body">
            <div className="drawer-heading">
              <span className="source-badge">高德真实 POI</span>
              <Dialog.Title>{restaurant.name}</Dialog.Title>
              <Dialog.Description id="drawer-description">
                {restaurant.category} / {restaurant.businessArea}
              </Dialog.Description>
            </div>

            <div className="score-duo">
              <section className="score-panel dopa">
                <span>
                  <Sparkle size={18} weight="fill" />
                  多巴胺分
                </span>
                {dopaScore ? <strong>{dopaScore.toFixed(1)}</strong> : <strong className="is-empty">待打分</strong>}
                <small>{ratings.length ? `${ratings.length} 人参与` : '来做第一个评分的人'}</small>
              </section>
              <section className="score-panel amap">
                <span>
                  <Star size={18} weight="fill" />
                  高德参考分
                </span>
                <strong>{restaurant.amapRating?.toFixed(1) ?? '暂无'}</strong>
                <small>外部数据，不纳入本站评分</small>
              </section>
            </div>

            <div className="restaurant-facts">
              <p>
                <MapPin size={20} weight="fill" />
                <span>{restaurant.address}</span>
              </p>
              {restaurant.openTime && (
                <p>
                  <Clock size={20} weight="fill" />
                  <span>营业时间 {restaurant.openTime}</span>
                </p>
              )}
              <p>
                <ForkKnife size={20} weight="fill" />
                <span>{restaurant.averageCost ? `人均约 ¥${Math.round(restaurant.averageCost)}` : '人均消费待补充'}</span>
              </p>
            </div>

            {ratings.length > 0 && (
              <section className="recent-ratings" aria-label="最近评分">
                <h3>最近评分</h3>
                {ratings.slice(0, 3).map((rating) => (
                  <article key={rating.createdAt}>
                    <strong>{getDopaScore([rating])?.toFixed(1)}</strong>
                    <p>{rating.note || '这次只打分，没有留评语。'}</p>
                  </article>
                ))}
              </section>
            )}

            <div className="drawer-actions">
              <a href={amapUrl} target="_blank" rel="noreferrer" className="secondary-button">
                <ArrowSquareOut size={18} weight="bold" />
                高德中查看
              </a>
              <button type="button" className="primary-button" onClick={() => onRate(restaurant)}>
                <Sparkle size={19} weight="fill" />
                给这家打分
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
