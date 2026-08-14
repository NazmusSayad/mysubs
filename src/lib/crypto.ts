import { createHmac, randomBytes } from 'node:crypto'
import type { ProviderAccount } from '../core/types'
import { getKeyringEntrySecret, setKeyringEntrySecret } from './keyring'

const CACHE_SECRET_KEYRING_ENTRY_NAME = 'cache-secret'

export function cacheKey(
  provider: string,
  account: ProviderAccount
): string | null {
  let secret: string | null
  try {
    secret = getKeyringEntrySecret(CACHE_SECRET_KEYRING_ENTRY_NAME)
    if (secret === null) {
      secret = randomBytes(32).toString('base64url')
      setKeyringEntrySecret(CACHE_SECRET_KEYRING_ENTRY_NAME, secret)
    }
  } catch {
    return null
  }

  return createHmac('sha256', secret)
    .update(`${provider}\u0000${JSON.stringify(account)}`)
    .digest('hex')
}
