import { z } from 'zod'
import type {
  AccountSubscriptionBalanceUsage,
  AccountSubscriptionConsumptionUsage,
  AccountUsageResult,
  ProviderAccount,
  ProviderOptions,
} from '../../core/types'
import { resolveSecret } from '../../lib/secret'
import { openrouterAccountSchema } from './config'

const CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
const KEY_URL = 'https://openrouter.ai/api/v1/key'
const DEFAULT_COLOR = '#6467f2'

const creditsSchema = z.object({
  total_credits: z.number().nullish(),
  total_usage: z.number().nullish(),
})

const keySchema = z.object({
  label: z.string().nullish(),
  limit: z.number().nullish(),
  limit_reset: z.string().nullish(),
  limit_remaining: z.number().nullish(),
  usage: z.number().nullish(),
  usage_daily: z.number().nullish(),
  usage_weekly: z.number().nullish(),
  usage_monthly: z.number().nullish(),
  is_free_tier: z.boolean().nullish(),
})

type Outcome =
  | { kind: 'data'; data: unknown }
  | { kind: 'auth' }
  | { kind: 'failed'; error: Error }
type UsageResource =
  AccountSubscriptionBalanceUsage | AccountSubscriptionConsumptionUsage

async function fetchEndpointData(
  url: string,
  apiKey: string
): Promise<Outcome> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })
  } catch {
    return {
      kind: 'failed',
      error: new Error("couldn't reach openrouter, check your connection"),
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: 'auth' }
  }
  if (!response.ok) {
    return {
      kind: 'failed',
      error: new Error(
        `openrouter request failed (HTTP ${String(response.status)})`
      ),
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return {
      kind: 'failed',
      error: new Error('openrouter response was not valid JSON'),
    }
  }

  if (typeof body !== 'object' || body === null) {
    return {
      kind: 'failed',
      error: new Error('openrouter response was not in the expected shape'),
    }
  }

  const parsed = z.object({ data: z.unknown() }).safeParse(body)
  if (
    !parsed.success ||
    typeof parsed.data.data !== 'object' ||
    parsed.data.data === null
  ) {
    return {
      kind: 'failed',
      error: new Error('openrouter response was not in the expected shape'),
    }
  }

  return { kind: 'data', data: parsed.data.data }
}

function keyLimitUsed(
  data: z.infer<typeof keySchema>,
  limit: number
): number | null {
  const remaining = data.limit_remaining
  if (typeof remaining === 'number') {
    return limit - Math.min(limit, Math.max(0, remaining))
  }

  const reset = data.limit_reset
  if (reset === 'daily' && typeof data.usage_daily === 'number') {
    return Math.max(0, data.usage_daily)
  }
  if (reset === 'weekly' && typeof data.usage_weekly === 'number') {
    return Math.max(0, data.usage_weekly)
  }
  if (reset === 'monthly' && typeof data.usage_monthly === 'number') {
    return Math.max(0, data.usage_monthly)
  }

  if (typeof data.usage === 'number') return Math.max(0, data.usage)
  return null
}

function keyLimitName(reset: string | null | undefined): string {
  if (reset === 'daily') return 'dailyLimit'
  if (reset === 'weekly') return 'weeklyLimit'
  if (reset === 'monthly') return 'monthlyLimit'
  return 'keyLimit'
}

function assignSpend(
  usage: Record<string, UsageResource>,
  usageKey: string,
  amount: number | null | undefined
): void {
  if (typeof amount !== 'number') return
  usage[usageKey] = {
    kind: 'consumption',
    unit: 'usd',
    used: Math.max(0, amount),
  }
}

export async function fetchOpenRouterAccount(
  account: ProviderAccount,
  _options: ProviderOptions
): Promise<AccountUsageResult> {
  try {
    const parsedAccount = openrouterAccountSchema.parse(account)
    const apiKey = resolveSecret(parsedAccount.apiKey)
    const [creditsOutcome, keyOutcome] = await Promise.all([
      fetchEndpointData(CREDITS_URL, apiKey),
      fetchEndpointData(KEY_URL, apiKey),
    ])

    const usage: Record<string, UsageResource> = {}
    let accountPlan: string | null = null
    let accountInfo: string | null = null

    if (creditsOutcome.kind === 'data') {
      const parsed = creditsSchema.safeParse(creditsOutcome.data)
      if (parsed.success && typeof parsed.data.total_usage === 'number') {
        const used = Math.max(0, parsed.data.total_usage)
        const total = Math.max(0, parsed.data.total_credits ?? 0)

        if (total > 0) {
          usage.credits = {
            kind: 'consumption',
            unit: 'usd',
            used,
            limit: total,
            remaining: Math.max(0, total - used),
            utilization: used / total,
          }
        }
        usage.balance = {
          kind: 'balance',
          unit: 'usd',
          available: Math.max(0, total - used),
        }
      }
    }

    if (keyOutcome.kind === 'data') {
      const parsed = keySchema.safeParse(keyOutcome.data)
      if (parsed.success) {
        assignSpend(usage, 'today', parsed.data.usage_daily)
        assignSpend(usage, 'week', parsed.data.usage_weekly)
        assignSpend(usage, 'month', parsed.data.usage_monthly)

        const limit = parsed.data.limit
        if (typeof limit === 'number' && limit > 0) {
          const used = keyLimitUsed(parsed.data, limit)
          if (used !== null) {
            usage[keyLimitName(parsed.data.limit_reset)] = {
              kind: 'consumption',
              unit: 'usd',
              used,
              limit,
              remaining: Math.max(0, limit - used),
              utilization: used / limit,
            }
          }
        }

        if (parsed.data.is_free_tier === true) accountPlan = 'Free tier'
        if (parsed.data.is_free_tier === false) accountPlan = 'Pay as you go'

        const raw = parsed.data.label
        if (typeof raw === 'string' && raw.trim() !== '')
          accountInfo = raw.trim()
      }
    }

    if (Object.keys(usage).length > 0) {
      const result: AccountUsageResult = {
        provider: 'openrouter',
        cached: false,
        color: parsedAccount.color ?? DEFAULT_COLOR,
        usage,
      }
      if (accountPlan !== null) result.accountPlan = accountPlan
      if (accountInfo !== null) result.accountInfo = accountInfo
      return result
    }

    if (creditsOutcome.kind === 'auth' && keyOutcome.kind === 'auth') {
      throw new Error('api key invalid, check your key at openrouter.ai/keys')
    }
    if (creditsOutcome.kind === 'failed') throw creditsOutcome.error
    if (keyOutcome.kind === 'failed') throw keyOutcome.error
    throw new Error('openrouter usage data unavailable, try again later')
  } catch (error) {
    return {
      provider: 'openrouter',
      cached: false,
      color: typeof account.color === 'string' ? account.color : DEFAULT_COLOR,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
