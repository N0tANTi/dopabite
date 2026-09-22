import { createHash, createHmac } from 'node:crypto'

const endpoint = 'https://ses.tencentcloudapi.com/'
const host = 'ses.tencentcloudapi.com'
const service = 'ses'
const version = '2020-10-02'
const action = 'SendEmail'
const contentType = 'application/json; charset=utf-8'

export interface TencentSesConfig {
  secretId: string
  secretKey: string
  region: string
  fromEmailAddress: string
  templateId: number
}

interface TencentSesResponse {
  Response?: {
    Error?: {
      Code?: string
      Message?: string
    }
    MessageId?: string
    RequestId?: string
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value).digest()
}

function buildAuthorization(secretId: string, secretKey: string, payload: string, timestamp: number) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(payload),
  ].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp.toString(),
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')
  const secretDate = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, service)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex')

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export async function sendTencentSesTemplateEmail(
  config: TencentSesConfig,
  data: { email: string; otp: string; subject: string },
) {
  const payload = JSON.stringify({
    FromEmailAddress: config.fromEmailAddress,
    Destination: [data.email],
    Subject: data.subject,
    Template: {
      TemplateID: config.templateId,
      TemplateData: JSON.stringify({ code: data.otp }),
    },
    Unsubscribe: '0',
    TriggerType: 1,
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const authorization = buildAuthorization(config.secretId, config.secretKey, payload, timestamp)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      Host: host,
      'X-TC-Action': action,
      'X-TC-Region': config.region,
      'X-TC-Timestamp': timestamp.toString(),
      'X-TC-Version': version,
    },
    body: payload,
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json() as TencentSesResponse
  const apiError = result.Response?.Error

  if (!response.ok || apiError) {
    const code = apiError?.Code ?? `HTTP_${response.status}`
    const requestId = result.Response?.RequestId
    throw new Error(`腾讯云邮件发送失败：${code}${requestId ? ` (${requestId})` : ''}`)
  }
}
