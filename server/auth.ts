import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { anonymous } from 'better-auth/plugins'
import { database } from './database.js'

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
  advanced: {
    cookiePrefix: 'dopabite',
    useSecureCookies: appOrigin.startsWith('https://'),
    database: {
      joins: true,
    },
  },
  plugins: [
    anonymous({
      generateName: () => '匿名食客',
    }),
    passkey({
      rpID,
      rpName: 'DopaBite',
      origin: appOrigin,
    }),
  ],
})
