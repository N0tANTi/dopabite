import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { anonymous, emailOTP } from 'better-auth/plugins'
import { mergeAnonymousAccount } from './account-merge.js'
import { database } from './database.js'
import { emailOtpEnabled, getEmailOtpTestCode, sendEmailOtp } from './email.js'
import { generateNickname } from './nicknames.js'

export const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:5173'
const isProduction = process.env.NODE_ENV === 'production'
const configuredSecret = process.env.BETTER_AUTH_SECRET

if (isProduction && !configuredSecret) {
  throw new Error('BETTER_AUTH_SECRET is required in production')
}

const rpID = new URL(appOrigin).hostname

export const auth = betterAuth({
  appName: 'DopaBite',
  baseURL: appOrigin,
  secret: configuredSecret ?? 'dopabite-local-development-secret-change-me',
  database,
  trustedOrigins: [appOrigin],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: 'dopabite',
    useSecureCookies: appOrigin.startsWith('https://'),
    database: {
      joins: true,
    },
  },
  plugins: [
    anonymous({
      generateName: generateNickname,
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        mergeAnonymousAccount(anonymousUser.user.id, newUser.user.id)
      },
    }),
    emailOTP({
      async sendVerificationOTP(data) {
        await sendEmailOtp(data)
      },
      generateOTP: getEmailOtpTestCode() ? () => getEmailOtpTestCode() : undefined,
      expiresIn: 5 * 60,
      allowedAttempts: 3,
      storeOTP: 'hashed',
      rateLimit: {
        window: 60,
        max: 3,
      },
    }),
    passkey({
      rpID,
      rpName: 'DopaBite',
      origin: appOrigin,
    }),
  ],
})

export { emailOtpEnabled }
