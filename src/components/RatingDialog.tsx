import * as Dialog from '@radix-ui/react-dialog'
import { Camera, Check, Sparkle, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RatingEntry, Restaurant } from '../data/restaurants'
import { getNicknameError, normalizeNickname } from '../lib/nickname'

type RatingDialogProps = {
  open: boolean
  restaurant: Restaurant | null
  nickname: string
  initialRating?: RatingEntry
  onOpenChange: (open: boolean) => void
  onSubmit: (
    restaurant: Restaurant,
    rating: RatingEntry,
    nickname: string,
    imageUpdate?: { files: File[]; keepImageIds: string[] },
  ) => Promise<boolean>
}

type DimensionProps = {
  label: string
  hint: string
  value: number
  onChange: (score: number) => void
}

const scoreLabels = ['不太行', '一般', '不错', '很香', '封神']
type SelectedImage = { file: File; url: string }

async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) {
    throw new Error('请选择不超过 20 MB 的图片')
  }
  const sourceUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = sourceUrl
    try {
      await image.decode()
    } catch {
      throw new Error('无法读取这张图片，请选择 JPEG、PNG 或 WebP 图片')
    }
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片处理失败，请换一张重试')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob || blob.size > 2 * 1024 * 1024) throw new Error('图片压缩后仍超过 2 MB，请换一张重试')
    return new File([blob], 'rating-photo.jpg', { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

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

export function RatingDialog({ open, restaurant, nickname, initialRating, onOpenChange, onSubmit }: RatingDialogProps) {
  const [taste, setTaste] = useState(initialRating?.taste ?? 4)
  const [value, setValue] = useState(initialRating?.value ?? 4)
  const [returnIntent, setReturnIntent] = useState(initialRating?.returnIntent ?? 4)
  const [note, setNote] = useState(initialRating?.note ?? '')
  const [publicName, setPublicName] = useState(nickname)
  const [nicknameError, setNicknameError] = useState('')
  const [keptImages, setKeptImages] = useState(initialRating?.images ?? [])
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([])
  const selectedImagesRef = useRef<SelectedImage[]>([])
  const [imageError, setImageError] = useState('')
  const [preparingImages, setPreparingImages] = useState(false)
  const [draggingImage, setDraggingImage] = useState(false)
  const imageProcessingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  async function addImages(files: File[]) {
    if (!files.length) return
    if (imageProcessingRef.current || submitting) {
      setImageError('正在处理图片，请稍后再试')
      return
    }
    if (files.length + keptImages.length + selectedImages.length > 3) {
      setImageError('每条评价最多上传 3 张图片')
      return
    }
    imageProcessingRef.current = true
    setPreparingImages(true)
    setImageError('')
    try {
      const prepared = await Promise.all(files.map(prepareImage))
      setSelectedImages((current) => [...current, ...prepared.map((file) => ({ file, url: URL.createObjectURL(file) }))])
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '图片处理失败')
    } finally {
      imageProcessingRef.current = false
      setPreparingImages(false)
    }
  }

  useEffect(() => {
    selectedImagesRef.current = selectedImages
  }, [selectedImages])

  useEffect(() => () => {
    selectedImagesRef.current.forEach(({ url }) => URL.revokeObjectURL(url))
  }, [])

  const score = useMemo(
    () => Math.round((taste * 0.5 + value * 0.25 + returnIntent * 0.25) * 10) / 10,
    [returnIntent, taste, value],
  )

  if (!restaurant) return null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="rating-dialog" aria-describedby="rating-description">
          <div className="dialog-topline">
            <span className="dialog-icon" aria-hidden="true">
              <Sparkle size={23} weight="fill" />
            </span>
            <div>
              <Dialog.Title>{initialRating ? '修改我的评分' : '给这家店打分'}</Dialog.Title>
              <Dialog.Description id="rating-description">
                {restaurant.name}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭评分弹层" disabled={submitting}>
              <X size={22} weight="bold" />
            </Dialog.Close>
          </div>

          <form
            onSubmit={async (event) => {
              event.preventDefault()
              const error = getNicknameError(publicName)
              if (error) {
                setNicknameError(error)
                return
              }
              const normalizedNickname = normalizeNickname(publicName)
              setSubmitting(true)
              setImageError('')
              try {
                const changedImages = selectedImages.length > 0 || keptImages.length !== (initialRating?.images?.length ?? 0)
                const saved = await onSubmit(restaurant, {
                  id: initialRating?.id,
                  images: keptImages,
                  taste,
                  value,
                  returnIntent,
                  note: note.trim(),
                  createdAt: initialRating?.createdAt ?? new Date().toISOString(),
                }, normalizedNickname, changedImages
                  ? { files: selectedImages.map(({ file }) => file), keepImageIds: keptImages.map(({ id }) => id) }
                  : undefined)
                if (saved) onOpenChange(false)
              } catch (error) {
                setImageError(error instanceof Error ? error.message : '保存失败，请重试')
              } finally {
                setSubmitting(false)
              }
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

            <label className="nickname-field">
              <span>公开昵称</span>
              <input
                value={publicName}
                onChange={(event) => {
                  setPublicName(event.target.value)
                  setNicknameError('')
                }}
                maxLength={16}
                autoComplete="nickname"
                aria-invalid={Boolean(nicknameError)}
                aria-describedby="rating-nickname-help"
              />
              <small id="rating-nickname-help" className={nicknameError ? 'is-error' : ''}>
                {nicknameError || '会和评分一起公开展示，也能在账号中心修改。'}
              </small>
            </label>

            <label className="note-field">
              <span>留句真话 <small>选填</small></span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                onPaste={(event) => {
                  const itemImages = Array.from(event.clipboardData.items)
                    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => file !== null)
                  const images = itemImages.length
                    ? itemImages
                    : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
                  if (!images.length) return
                  event.preventDefault()
                  void addImages(images)
                }}
                onDragEnter={(event) => {
                  if (Array.from(event.dataTransfer.types).includes('Files')) {
                    event.preventDefault()
                    setDraggingImage(true)
                  }
                }}
                onDragOver={(event) => {
                  if (Array.from(event.dataTransfer.types).includes('Files')) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                    setDraggingImage(true)
                  }
                }}
                onDragLeave={() => setDraggingImage(false)}
                onDrop={(event) => {
                  setDraggingImage(false)
                  if (!event.dataTransfer.files.length) return
                  event.preventDefault()
                  void addImages(Array.from(event.dataTransfer.files))
                }}
                placeholder="什么最惊喜？什么要避雷？"
                className={draggingImage ? 'is-image-drop-target' : undefined}
                aria-describedby="rating-image-drop-hint"
                maxLength={160}
                rows={3}
              />
              <small>{note.length}/160</small>
            </label>

            <div className="rating-image-field">
              <div className="rating-image-heading">
                <span>晒几张图 <small>选填，最多 3 张</small></span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={preparingImages || submitting || keptImages.length + selectedImages.length >= 3}
                  onClick={() => fileInput.current?.click()}
                >
                  <Camera size={18} weight="bold" />
                  {preparingImages ? '处理图片中…' : '添加图片'}
                </button>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                className="sr-only"
                aria-label="选择评价图片"
                onChange={async (event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  await addImages(files)
                }}
              />
              {(keptImages.length > 0 || selectedImages.length > 0) && (
                <div className="rating-image-previews">
                  {keptImages.map((image, index) => (
                    <div className="rating-image-preview" key={image.id}>
                      <img src={image.url} alt={`已保存的评价图片 ${index + 1}`} />
                      <button type="button" aria-label={`移除第 ${index + 1} 张图片`} disabled={submitting} onClick={() => setKeptImages((current) => current.filter(({ id }) => id !== image.id))}><X size={15} weight="bold" /></button>
                    </div>
                  ))}
                  {selectedImages.map((image, index) => (
                    <div className="rating-image-preview" key={image.url}>
                      <img src={image.url} alt={`待上传的评价图片 ${index + 1}`} />
                      <button type="button" aria-label={`移除待上传的第 ${index + 1} 张图片`} disabled={submitting} onClick={() => {
                        URL.revokeObjectURL(image.url)
                        setSelectedImages((current) => current.filter(({ url }) => url !== image.url))
                      }}><X size={15} weight="bold" /></button>
                    </div>
                  ))}
                </div>
              )}
              <small id="rating-image-drop-hint">也可把图片拖进上方评论框，或在评论框右键粘贴。图片会公开展示，上传时会压缩并去除照片元数据。</small>
              {imageError && <p className="rating-image-error" role="alert">{imageError}</p>}
            </div>

            <div className="dialog-actions">
              <Dialog.Close className="secondary-button" type="button" disabled={submitting}>
                {initialRating ? '取消修改' : '先不评'}
              </Dialog.Close>
              <button className="primary-button" type="submit" disabled={submitting || preparingImages}>
                <Check size={19} weight="bold" />
                {submitting ? '正在保存…' : initialRating ? '保存修改' : '保存评分'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
