import nodemailer from 'nodemailer'

const smtpHost = process.env.SMTP_HOST?.trim()
const smtpPort = Number(process.env.SMTP_PORT ?? 465)
const smtpSecure = (process.env.SMTP_SECURE ?? 'true').toLowerCase() === 'true'
const smtpUser = process.env.SMTP_USER?.trim()
const smtpPass = process.env.SMTP_PASS
const smtpFrom = process.env.SMTP_FROM?.trim()
const testCode = process.env.NODE_ENV === 'test' ? process.env.EMAIL_OTP_TEST_CODE?.trim() : undefined
const hasValidAuthPair = Boolean(smtpUser) === Boolean(smtpPass)

export const emailOtpEnabled = Boolean(
  testCode || (smtpHost && smtpFrom && Number.isFinite(smtpPort) && hasValidAuthPair),
)

const transport = smtpHost && smtpFrom && hasValidAuthPair
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      ...(smtpUser && smtpPass ? { auth: { user: smtpUser, pass: smtpPass } } : {}),
    })
  : null

const purposeLabels = {
  'sign-in': '登录 DopaBite',
  'email-verification': '验证邮箱',
  'forget-password': '找回账号',
  'change-email': '更换邮箱',
} as const

export function getEmailOtpTestCode() {
  return testCode
}

export async function sendEmailOtp(data: {
  email: string
  otp: string
  type: keyof typeof purposeLabels
}) {
  if (testCode) return
  if (!transport || !smtpFrom) throw new Error('邮箱验证码服务尚未配置')

  const purpose = purposeLabels[data.type]
  await transport.sendMail({
    from: smtpFrom,
    to: data.email,
    subject: `${data.otp} · ${purpose}`,
    text: `你的 DopaBite 验证码是 ${data.otp}，5 分钟内有效。请勿将验证码告诉他人。`,
    html: `
      <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#312832;line-height:1.6">
        <h1 style="font-size:22px">${purpose}</h1>
        <p>你的验证码是：</p>
        <p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#e91e63">${data.otp}</p>
        <p>验证码 5 分钟内有效，请勿将它告诉他人。</p>
      </div>
    `,
  })
}
