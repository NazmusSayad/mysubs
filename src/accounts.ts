import path from 'node:path'
import type { Config } from './config'
import type { CodexAccount } from './providers/codex/config'
import { detectCodexAccounts } from './providers/codex/detect'
import type { OpenRouterAccount } from './providers/openrouter/config'
import { detectOpenRouterAccounts } from './providers/openrouter/detect'

export const DEFAULT_ACCOUNT_NAME = 'default'

export type ResolvedAccount =
  | {
      provider: 'codex'
      name: string
      named: boolean
      color?: string
      source: 'config' | 'detected'
      account: CodexAccount
    }
  | {
      provider: 'openrouter'
      name: string
      named: boolean
      color?: string
      source: 'config' | 'detected'
      account: OpenRouterAccount
    }

function assignName(name: string | undefined, taken: Set<string>): string {
  if (name !== undefined) return name
  if (!taken.has(DEFAULT_ACCOUNT_NAME)) return DEFAULT_ACCOUNT_NAME

  let index = 2
  while (taken.has(`${DEFAULT_ACCOUNT_NAME}-${String(index)}`)) index += 1
  return `${DEFAULT_ACCOUNT_NAME}-${String(index)}`
}

export function resolveAccounts(config: Config): ResolvedAccount[] {
  const resolved: ResolvedAccount[] = []

  const codex = config.codex?.accounts ?? []
  const codexNames = new Set<string>()

  for (const account of codex) {
    const name = assignName(account.name, codexNames)
    codexNames.add(name)
    resolved.push({
      provider: 'codex',
      name,
      named: account.name !== undefined,
      color: account.color,
      source: 'config',
      account,
    })
  }

  if (config.detect) {
    const dirs = new Set(
      codex.map((account) => path.resolve(account.configDir))
    )

    for (const account of detectCodexAccounts()) {
      if (dirs.has(path.resolve(account.configDir))) continue
      const name = assignName(account.name, codexNames)
      codexNames.add(name)
      resolved.push({
        provider: 'codex',
        name,
        named: account.name !== undefined,
        source: 'detected',
        account,
      })
    }
  }

  const openrouter = config.openrouter?.accounts ?? []
  const openrouterNames = new Set<string>()

  for (const account of openrouter) {
    const name = assignName(account.name, openrouterNames)
    openrouterNames.add(name)
    resolved.push({
      provider: 'openrouter',
      name,
      named: account.name !== undefined,
      color: account.color,
      source: 'config',
      account,
    })
  }

  if (config.detect) {
    const keys = new Set(openrouter.map((account) => account.apiKey))

    for (const account of detectOpenRouterAccounts()) {
      if (keys.has(account.apiKey)) continue
      const name = assignName(account.name, openrouterNames)
      openrouterNames.add(name)
      resolved.push({
        provider: 'openrouter',
        name,
        named: account.name !== undefined,
        source: 'detected',
        account,
      })
    }
  }

  return resolved
}
