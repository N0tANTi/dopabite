import * as Dialog from '@radix-ui/react-dialog'
import { Check, Sparkle, X } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import type { RatingEntry, Restaurant } from '../data/restaurants'

type RatingDialogProps = {
  open: boolean
  restaurant: Restaurant | null
  onOpenChange: (open: boolean) => void
  onSubmit: (restaurant: Restaurant, rating: RatingEntry) => void
}

type DimensionProps = {
  label: string
  hint: string
  value: number
  onChange: (score: number) => void
}

const scoreLabels = ['不太行', '一般', '不错', '很香', '封神']

function RatingDimension({ label, hint, value, onChange }: DimensionProps) {
  return (
    <fieldset className="rating-dimension">
      <div className="rating-dimension-copy">
        <legend>{label}</legend>
        <span>{hint}</span>
      </div>
      <div className="score-options" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            type="button"
            role="radio"
            aria-checked={value === score}
            className={value === score ? 'is-active' : ''}
            onClick={() => onChange(score)}
            key={score}
            title={`${score} 分：${scoreLabels[score - 1]}`}
          >
            {score}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function RatingDialog({ open, restaurant, onOpenChange, onSubmit }: RatingDialogProps) {
  const [taste, setTaste] = useState(4)
  const [value, setValue] = useState(4)
  const [returnIntent, setReturnIntent] = useState(4)
  const [note, setNote] = useState('')

  const score = useMemo(
    () => Math.round((taste * 0.5 + value * 0.25 + returnIntent * 0.25) * 10) / 10,
    [returnIntent, taste, value],
  )

  if (!restaurant) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="rating-dialog" aria-describedby="rating-description">
          <div className="dialog-topline">
            <span className="dialog-icon" aria-hidden="true">
              <Sparkle size={23} weight="fill" />
            </span>
            <div>
              <Dialog.Title>给这家店打分</Dialog.Title>
              <Dialog.Description id="rating-description">
                {restaurant.name}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭评分弹层">
              <X size={22} weight="bold" />
            </Dialog.Close>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit(restaurant, {
                taste,
                value,
                returnIntent,
                note: note.trim(),
                createdAt: new Date().toISOString(),
              })
              onOpenChange(false)
            }}
          >
            <div className="rating-score-preview">
              <div>
                <span>本次多巴胺分</span>
                <strong>{score.toFixed(1)}</strong>
              </div>
              <p>{scoreLabels[Math.round(score) - 1]}</p>
            </div>

            <div className="rating-dimensions">
              <RatingDimension label="味道" hint="这一口值不值" value={taste} onChange={setTaste} />
              <RatingDimension label="性价比" hint="这一顿花得值不值" value={value} onChange={setValue} />
              <RatingDimension label="还想再吃" hint="你会不会为它专程再来" value={returnIntent} onChange={setReturnIntent} />
            </div>

            <label className="note-field">
              <span>留句真话 <small>选填</small></span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="什么最惊喜？什么要避雷？"
                maxLength={160}
                rows={3}
              />
              <small>{note.length}/160</small>
            </label>

            <div className="dialog-actions">
              <Dialog.Close className="secondary-button" type="button">
                先不评
              </Dialog.Close>
              <button className="primary-button" type="submit">
                <Check size={19} weight="bold" />
                保存评分
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
