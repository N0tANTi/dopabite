import {
  ArrowUpRight,
  ForkKnife,
  MapPin,
  Sparkle,
  Star,
} from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import type { RatingEntry, Restaurant } from '../data/restaurants'
import { distanceInMeters, getDopaScore } from '../data/restaurants'

type RestaurantCardProps = {
  index: number
  restaurant: Restaurant
  center: [number, number]
  ratings: RatingEntry[]
  selected: boolean
  onOpen: (restaurant: Restaurant) => void
}

function formatDistance(distance: number) {
  return distance < 1_000 ? `${distance} m` : `${(distance / 1_000).toFixed(1)} km`
}

export function RestaurantCard({
  index,
  restaurant,
  center,
  ratings,
  selected,
  onOpen,
}: RestaurantCardProps) {
  const reduceMotion = useReducedMotion()
  const [imageFailed, setImageFailed] = useState(false)
  const dopaScore = getDopaScore(ratings)
  const distance = distanceInMeters(center, restaurant.location)

  return (
    <motion.article
      id={`restaurant-${restaurant.id}`}
      data-restaurant-id={restaurant.id}
      className={`restaurant-card ${selected ? 'is-selected' : ''}`}
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.055, 0.25), ease: [0.16, 1, 0.3, 1] }}
    >
      <button type="button" className="restaurant-card-main" onClick={() => onOpen(restaurant)}>
        <div className="restaurant-photo-wrap">
          {!imageFailed && restaurant.image ? (
            <img
              className="restaurant-photo"
              src={restaurant.image}
              alt={`${restaurant.name}的高德店铺图片`}
              loading={index < 2 ? 'eager' : 'lazy'}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="restaurant-photo-fallback" aria-label="暂无店铺图片">
              <ForkKnife size={36} weight="duotone" />
              <span>暂无图片</span>
            </div>
          )}
          <span className="restaurant-index" aria-hidden="true">
            {index + 1}
          </span>
        </div>

        <div className="restaurant-copy">
          <div className="restaurant-title-row">
            <div>
              <p className="restaurant-category">{restaurant.category}</p>
              <h2>{restaurant.name}</h2>
            </div>
            <ArrowUpRight className="card-arrow" size={22} weight="bold" aria-hidden="true" />
          </div>

          <p className="restaurant-address">
            <MapPin size={16} weight="fill" aria-hidden="true" />
            <span>{restaurant.address}</span>
          </p>

          <div className="restaurant-meta">
            <span>{formatDistance(distance)}</span>
            {restaurant.averageCost ? <span>人均 ¥{Math.round(restaurant.averageCost)}</span> : <span>人均待补充</span>}
            {restaurant.amapRating ? (
              <span className="amap-rating">
                <Star size={15} weight="fill" aria-hidden="true" />
                高德 {restaurant.amapRating.toFixed(1)}
              </span>
            ) : (
              <span>高德评分待补充</span>
            )}
          </div>

          <div className="dopa-score-row">
            <span className="dopa-score-label">
              <Sparkle size={17} weight="fill" aria-hidden="true" />
              多巴胺分
            </span>
            {dopaScore ? (
              <strong>{dopaScore.toFixed(1)}</strong>
            ) : (
              <span className="unrated">还没人打分</span>
            )}
            {ratings.length > 0 && <small>{ratings.length} 条真实评分</small>}
          </div>
        </div>
      </button>
    </motion.article>
  )
}
