import type { ResolvedAccount } from './accounts'
import type { Config } from './config'
import { fetchClaudeUsage } from './providers/claude'
import { fetchCodexUsage } from './providers/codex'
import { fetchOpenRouterUsage } from './providers/openrouter'
import { parseTTL, readCache, writeCache } from './utils/cache'
import type { Report, Subscription } from './utils/report'
import type { ProviderResult } from './utils/usage'

function run(target: ResolvedAccount): Promise<ProviderResult> {
  if (target.provider === 'codex') return fetchCodexUsage(target.account)
  if (target.provider === 'claude') return fetchClaudeUsage(target.account)
  if (target.provider === 'openrouter') {
    return fetchOpenRouterUsage(target.account)
  }
  throw new Error('unknown provider')
}

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
        provider: target.provider,
        account: target.name,
        named: target.named,
        source: target.source,
        color: target.color,
      }

      const key = `${target.provider}:${target.name}`

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
        const result = await run(target)
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
