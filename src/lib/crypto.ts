import { createHmac, randomBytes } from 'node:crypto'
import type { ProviderAccount } from '../core/types'
import { getKey, setKey } from '../utils/keyring'

const CACHE_SECRET = 'cache-secret'

export function cacheKey(
  provider: string,
  account: ProviderAccount
): string | null {
  let secret: string | null
  try {
    secret = getKey(CACHE_SECRET)
    if (secret === null) {
      secret = randomBytes(32).toString('base64url')
      setKey(CACHE_SECRET, secret)
    }
  } catch {
    return null
  }

  return createHmac('sha256', secret)
    .update(`${provider}\u0000${JSON.stringify(account)}`)
    .digest('hex')
}
