import { createHash, randomInt } from 'node:crypto'

const adjectives = ['草莓', '柠檬', '薄荷', '芝士', '焦糖', '海盐', '芒果', '葡萄']
const personas = ['侦探', '饭友', '探店员', '干饭家', '尝鲜官', '筷子手', '寻味者', '食客']
const reservedNicknamePattern = /DopaBite|多巴咬|官方|管理员|高德|客服|系统/i
const genericNicknamePattern = /^(匿名食客|DopaBite 食客)$/i

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 31 || code === 127
  })
}

function fallbackNickname(userId: string) {
  const digest = createHash('sha256').update(userId).digest()
  const adjective = adjectives[digest[0] % adjectives.length]
  const persona = personas[digest[1] % personas.length]
  const suffix = String(digest.readUInt16BE(2) % 1_000).padStart(3, '0')
  return `${adjective}${persona} ${suffix}`
}

export function generateNickname() {
  const adjective = adjectives[randomInt(adjectives.length)]
  const persona = personas[randomInt(personas.length)]
  const suffix = String(randomInt(1_000)).padStart(3, '0')
  return `${adjective}${persona} ${suffix}`
}

export function parseNickname(value: unknown) {
  if (typeof value !== 'string') throw new Error('请输入昵称')
  const nickname = value.trim().replace(/\s+/g, ' ')
  const length = Array.from(nickname).length
  if (length < 2 || length > 16) throw new Error('昵称需要 2 到 16 个字符')
  if (hasControlCharacters(nickname)) throw new Error('昵称包含不可用字符')
  if (reservedNicknamePattern.test(nickname)) throw new Error('这个昵称容易与平台身份混淆，请换一个')
  return nickname
}

export function getPublicNickname(name: unknown, userId: string) {
  if (typeof name !== 'string' || genericNicknamePattern.test(name.trim())) {
    return fallbackNickname(userId)
  }
  try {
    return parseNickname(name)
  } catch {
    return fallbackNickname(userId)
  }
}

export function isGeneratedNickname(name: unknown) {
  return typeof name !== 'string' || genericNicknamePattern.test(name.trim())
}
