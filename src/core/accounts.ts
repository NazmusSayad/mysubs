import type { Config } from './config'
import { providers } from '../providers'
import type { BaseProvider } from './provider'

export const DEFAULT_ACCOUNT_NAME = 'default'

export type ResolvedAccount = {
  providerId: string
  provider: BaseProvider
  name: string
  named: boolean
  color?: string
  source: 'config' | 'detected'
}

function assignName(name: string | undefined, taken: Set<string>): string {
  if (name !== undefined && !taken.has(name)) return name
  if (name !== undefined) throw new Error(`duplicate account name: ${name}`)
  if (!taken.has(DEFAULT_ACCOUNT_NAME)) return DEFAULT_ACCOUNT_NAME

  let index = 2
  while (taken.has(`${DEFAULT_ACCOUNT_NAME}-${String(index)}`)) index += 1
  return `${DEFAULT_ACCOUNT_NAME}-${String(index)}`
}

export function resolveAccounts(config: Config): ResolvedAccount[] {
  const resolved: ResolvedAccount[] = []

  for (const [providerId, registration] of Object.entries(providers)) {
    const configured = config.accounts[providerId] ?? []
    const names = new Set<string>()
    const keys = new Set<string>()

    for (const rawAccount of configured) {
      const provider = new registration.Provider(rawAccount)
      const name = assignName(provider.name, names)
      const key = provider.accountKey
      if (keys.has(key)) {
        throw new Error(`duplicate ${providerId} account: ${name}`)
      }
      names.add(name)
      keys.add(key)
      resolved.push({
        providerId,
        provider,
        name,
        named: provider.name !== undefined,
        color: provider.accountColor,
        source: 'config',
      })
    }

    if (!config.detect) continue

    for (const rawAccount of registration.detectDefaultAccounts()) {
      const provider = new registration.Provider(rawAccount)
      const key = provider.accountKey
      if (keys.has(key)) continue
      keys.add(key)
      const name = assignName(provider.name, names)
      names.add(name)
      resolved.push({
        providerId,
        provider,
        name,
        named: provider.name !== undefined,
        color: provider.accountColor,
        source: 'detected',
      })
    }
  }

  return resolved
}
