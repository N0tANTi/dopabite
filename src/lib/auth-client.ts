import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/react'
import { anonymousClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [anonymousClient(), passkeyClient()],
})
