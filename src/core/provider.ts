import type { ProviderResult } from './usage'

export declare class BaseProvider {
  constructor(account: unknown)
  readonly accountKey: string
  readonly name: string | undefined
  readonly accountColor: string | undefined
  fetchUsage(): Promise<ProviderResult>
}
