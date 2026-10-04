// Do not change this file unless the user explicitly asks to write code here.

import { Prettify } from 'daily-code'
import type { z } from 'zod'
import type {
  accountUsageResultSchema,
  providerBaseOptions,
  usageResourceSchema,
} from './schema'

export type ProviderAccount = Prettify<
  Record<string, unknown> & {
    __type: 'account'
  }
>

export type ProviderOptions = Prettify<
  Record<string, unknown> & z.infer<typeof providerBaseOptions>
>

export type AccountSubscriptionConsumptionUsage = Extract<
  z.infer<typeof usageResourceSchema>,
  { kind: 'consumption' }
>

export type AccountSubscriptionBalanceUsage = Extract<
  z.infer<typeof usageResourceSchema>,
  { kind: 'balance' }
>

export type AccountUsageResult = Prettify<
  z.infer<typeof accountUsageResultSchema>
>

// Safe, live source metadata for providers whose accounts can change while
// usage is cached. Never include credentials in this result.
export type AccountMetadata = {
  cacheIdentity?: string
  sourceName?: string
  sourceActive?: boolean
  error?: string
}

export type ProviderEntry = {
  name: string
  color: string
  optionsSchema: z.ZodType<ProviderOptions>
  accountSchema: z.ZodType<ProviderAccount>
  detectDefaults: () => Promise<ProviderAccount[]>
  readAccountMetadata?: (
    account: ProviderAccount
  ) => Promise<AccountMetadata | undefined>
  fetchAccount: (
    account: ProviderAccount,
    options: ProviderOptions
  ) => Promise<AccountUsageResult>
}
