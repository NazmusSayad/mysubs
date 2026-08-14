// Do not change this file unless the user explicitly asks to write code here.

import { Prettify } from 'daily-code'
import type { z } from 'zod'

export type ProviderAccount = Prettify<
  Record<string, unknown> & {
    __type: 'account'
  }
>

export type ProviderOptions = Prettify<
  Record<string, unknown> & {
    cache: boolean
    __type: 'options'
  }
>

export type AccountSubscriptionConsumptionUsage = {
  kind: 'consumption'
  unit: 'percent' | 'usd'
  used: number
  limit?: number
  remaining?: number
  utilization?: number
  resetsAt?: string
  windowSeconds?: number
}

export type AccountSubscriptionBalanceUsage = {
  kind: 'balance'
  unit: 'usd' | 'credits'
  available: number
}

export type AccountUsageResult = {
  provider: string
  color: string

  sourceName?: string
  sourceType?: 'manual'

  accountInfo?: string
  accountPlan?: string

  error?: string
  usage?: Record<
    string,
    AccountSubscriptionConsumptionUsage | AccountSubscriptionBalanceUsage
  >
}

export type ProviderEntry = {
  optionsSchema: z.ZodType
  accountSchema: z.ZodType
  detectDefaults: () => Promise<ProviderAccount[]>
  fetchAccount: (
    account: ProviderAccount,
    options: ProviderOptions
  ) => Promise<AccountUsageResult>
}
