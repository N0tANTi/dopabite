const adjectives = ['草莓', '柠檬', '薄荷', '芝士', '焦糖', '海盐', '芒果', '葡萄']
const personas = ['侦探', '饭友', '探店员', '干饭家', '尝鲜官', '筷子手', '寻味者', '食客']
const reservedNicknamePattern = /DopaBite|多巴咬|官方|管理员|高德|客服|系统/i

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 31 || code === 127
  })
}

function randomIndex(length: number) {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0] % length
}

export function createNicknameSuggestion() {
  const suffix = String(randomIndex(1_000)).padStart(3, '0')
  return `${adjectives[randomIndex(adjectives.length)]}${personas[randomIndex(personas.length)]} ${suffix}`
}

export function normalizeNickname(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function getNicknameError(value: string) {
  const nickname = normalizeNickname(value)
  const length = Array.from(nickname).length
  if (length < 2 || length > 16) return '昵称需要 2 到 16 个字符'
  if (hasControlCharacters(nickname)) return '昵称包含不可用字符'
  if (reservedNicknamePattern.test(nickname)) return '这个昵称容易与平台身份混淆，请换一个'
  return ''
}
