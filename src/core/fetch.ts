import { parseTTL, readCache, writeCache } from '../utils/cache'
import type { ResolvedAccount } from './accounts'
import type { Config } from './config'
import type { Report, Subscription } from './report'
import type { ProviderResult } from './usage'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function fetchProviderUsages(
  accounts: ResolvedAccount[],
  config: Config,
  options: { force?: boolean }
): Promise<Report> {
  const ttl = parseTTL(config.cacheTTL)

  const subscriptions = await Promise.all(
    accounts.map(async (target): Promise<Subscription> => {
      const base = {
        provider: target.providerId,
        account: target.name,
        named: target.named,
        source: target.source,
        color: target.color,
      }

      const key = `${target.providerId}:${target.name}`

      if (options.force !== true) {
        const cached = readCache(key, ttl)
        if (cached !== null) {
          const result = cached as ProviderResult
          return {
            ...base,
            plan: result.plan,
            label: result.label,
            usage: result.usage,
          }
        }
      }

      try {
        const result = await target.provider.fetchUsage()
        writeCache(key, result)
        return {
          ...base,
          plan: result.plan,
          label: result.label,
          usage: result.usage,
        }
      } catch (error) {
        return { ...base, error: errorMessage(error) }
      }
    })
  )

  return { subscriptions }
}
