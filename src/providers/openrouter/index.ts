import { z } from 'zod'
import type { BaseProvider } from '../../core/provider'
import type { ProviderResult, UsageResource } from '../../core/usage'
import { resolveSecret } from '../../utils/secret'
import {
  openrouterAccountSchema,
  type OpenRouterAccount,
} from './config'

const CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
const KEY_URL = 'https://openrouter.ai/api/v1/key'

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
  | { kind: 'data'; data: Record<string, unknown> }
  | { kind: 'auth' }
  | { kind: 'failed'; error: Error }

export class OpenRouterProvider implements BaseProvider {
  private readonly account: OpenRouterAccount

  constructor(account: unknown) {
    this.account = openrouterAccountSchema.parse(account)
  }

  get accountKey() {
    return this.account.apiKey
  }

  get name() {
    return this.account.name
  }

  get accountColor() {
    return this.account.color
  }

  async fetchUsage(): Promise<ProviderResult> {
    const apiKey = resolveSecret(this.account.apiKey)

    const [credits, key] = await Promise.all([
      this.load(CREDITS_URL, apiKey),
      this.load(KEY_URL, apiKey),
    ])

    const usage: Record<string, UsageResource> = {}
    let plan: string | null = null
    let label: string | null = null

    if (credits.kind === 'data') {
      const parsed = creditsSchema.safeParse(credits.data)
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

    if (key.kind === 'data') {
      const parsed = keySchema.safeParse(key.data)
      if (parsed.success) {
        this.assignSpend(usage, 'today', parsed.data.usage_daily)
        this.assignSpend(usage, 'week', parsed.data.usage_weekly)
        this.assignSpend(usage, 'month', parsed.data.usage_monthly)

        const limit = parsed.data.limit
        if (typeof limit === 'number' && limit > 0) {
          const used = this.keyLimitUsed(parsed.data, limit)
          if (used !== null) {
            usage[this.keyLimitName(parsed.data.limit_reset)] = {
              kind: 'consumption',
              unit: 'usd',
              used,
              limit,
              remaining: Math.max(0, limit - used),
              utilization: used / limit,
            }
          }
        }

        if (parsed.data.is_free_tier === true) plan = 'Free tier'
        if (parsed.data.is_free_tier === false) plan = 'Pay as you go'

        const raw = parsed.data.label
        if (typeof raw === 'string' && raw.trim() !== '') label = raw.trim()
      }
    }

    if (Object.keys(usage).length > 0) {
      const result: ProviderResult = { usage }
      if (plan !== null) result.plan = plan
      if (label !== null) result.label = label
      return result
    }

    if (credits.kind === 'auth' && key.kind === 'auth') {
      throw new Error('api key invalid, check your key at openrouter.ai/keys')
    }
    if (credits.kind === 'failed') throw credits.error
    if (key.kind === 'failed') throw key.error
    throw new Error('openrouter usage data unavailable, try again later')
  }

  private async load(url: string, apiKey: string): Promise<Outcome> {
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

    const data = (body as Record<string, unknown>).data
    if (typeof data !== 'object' || data === null) {
      return {
        kind: 'failed',
        error: new Error('openrouter response was not in the expected shape'),
      }
    }

    return { kind: 'data', data: data as Record<string, unknown> }
  }

  private keyLimitUsed(
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

  private keyLimitName(reset: string | null | undefined): string {
    if (reset === 'daily') return 'dailyLimit'
    if (reset === 'weekly') return 'weeklyLimit'
    if (reset === 'monthly') return 'monthlyLimit'
    return 'keyLimit'
  }

  private assignSpend(
    usage: Record<string, UsageResource>,
    key: string,
    amount: number | null | undefined
  ): void {
    if (typeof amount !== 'number') return
    usage[key] = {
      kind: 'consumption',
      unit: 'usd',
      used: Math.max(0, amount),
    }
  }
}
