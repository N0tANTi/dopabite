import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const directory = mkdtempSync(join(tmpdir(), 'dopabite-rating-images-'))
const port = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => resolve(address.port))
  })
})
const origin = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['dist-server/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    APP_ORIGIN: origin,
    DOPABITE_DATABASE_PATH: join(directory, 'test.sqlite3'),
    BETTER_AUTH_SECRET: 'rating-image-integration-test-secret-at-least-32-characters',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
child.stdout.on('data', (chunk) => { serverOutput += chunk })
child.stderr.on('data', (chunk) => { serverOutput += chunk })
after(async () => {
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve()
    else child.once('exit', resolve)
  })
  rmSync(directory, { recursive: true, force: true })
})

async function ready() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(serverOutput)
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return
    } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`API did not start: ${serverOutput}`)
}

async function sessionCookie() {
  const response = await fetch(`${origin}/api/auth/sign-in/anonymous`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  })
  await assertStatus(response, 200)
  return response.headers.get('set-cookie').split(';')[0]
}

async function assertStatus(response, expected) {
  assert.equal(response.status, expected, response.status === expected ? undefined : await response.text())
}

const restaurant = {
  id: 'TEST-RATING-IMAGE-POI',
  name: '图片测试店',
  address: '测试地址',
  category: '餐饮',
  location: [121.4, 31.2],
  businessArea: '测试区',
  source: 'amap-live',
}
const rating = { taste: 5, value: 4, returnIntent: 5, note: '有图评价' }
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')

function imageForm({ keep = [], bytes = tinyPng, mime = 'image/png', includeImage = true } = {}) {
  const form = new FormData()
  form.set('restaurant', JSON.stringify(restaurant))
  form.set('rating', JSON.stringify(rating))
  form.set('keepImageIds', JSON.stringify(keep))
  if (includeImage) form.set('images', new File([bytes], 'photo.png', { type: mime }))
  return form
}

test('rating photo upload, visibility, edit, validation and deletion', async () => {
  await ready()
  const cookie = await sessionCookie()
  const url = `${origin}/api/restaurants/${restaurant.id}/my-rating`
  const headers = { cookie, origin }

  let response = await fetch(url, { method: 'PUT', headers, body: imageForm() })
  await assertStatus(response, 200)
  let saved = (await response.json()).rating
  assert.equal(saved.images.length, 1)
  const firstImage = saved.images[0]
  const otherCookie = await sessionCookie()
  response = await fetch(url, {
    method: 'PUT',
    headers: { cookie: otherCookie, origin },
    body: imageForm({ keep: [firstImage.id], includeImage: false }),
  })
  assert.equal(response.status, 400)
  response = await fetch(`${origin}${firstImage.url}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), tinyPng)

  response = await fetch(`${origin}/api/ratings?poiIds=${restaurant.id}`)
  assert.equal((await response.json()).ratings[restaurant.id][0].images[0].id, firstImage.id)

  response = await fetch(url, { method: 'PUT', headers, body: imageForm({ keep: [firstImage.id], includeImage: false }) })
  await assertStatus(response, 200)
  saved = (await response.json()).rating
  assert.equal(saved.images[0].id, firstImage.id)

  response = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ restaurant, rating: { ...rating, note: '纯文字修改保留照片' } }),
  })
  await assertStatus(response, 200)
  assert.equal((await response.json()).rating.images[0].id, firstImage.id)

  response = await fetch(url, { method: 'PUT', headers, body: imageForm({ bytes: Buffer.from('<svg></svg>'), mime: 'image/png' }) })
  assert.equal(response.status, 400)
  assert.equal((await fetch(`${origin}${firstImage.url}`)).status, 200)

  response = await fetch(url, { method: 'PUT', headers, body: imageForm({ includeImage: false }) })
  await assertStatus(response, 200)
  assert.equal((await response.json()).rating.images.length, 0)
  assert.equal((await fetch(`${origin}${firstImage.url}`)).status, 404)

  response = await fetch(url, { method: 'PUT', headers, body: imageForm() })
  await assertStatus(response, 200)
  const secondImage = (await response.json()).rating.images[0]
  response = await fetch(url, { method: 'DELETE', headers })
  assert.equal(response.status, 200)
  assert.equal((await fetch(`${origin}${secondImage.url}`)).status, 404)
})
