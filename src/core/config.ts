import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { providers } from '../providers'
import type { ProviderAccount, ProviderOptions } from './types'

const configSchema = z
  .object({
    cacheTTL: z.union([z.number(), z.string()]).default('5m'),
    detect: z.boolean().default(true),
  })
  .passthrough()
const providerConfigSchema = z
  .object({ accounts: z.unknown().optional() })
  .passthrough()

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg !== undefined && xdg !== '') {
    return path.join(xdg, 'mysubs', 'config.json')
  }
  return path.join(os.homedir(), '.config', 'mysubs', 'config.json')
}

export function loadConfig() {
  const file = configPath()
  let raw: unknown = {}

  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      throw new Error(`${file} is not valid JSON`)
    }
  }

  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`${file} is invalid`)
  }

  const accounts: Record<string, ProviderAccount[]> = {}
  const options: Record<string, ProviderOptions> = {}

  for (const [provider, entry] of Object.entries(providers)) {
    const providerConfig = providerConfigSchema.safeParse(
      parsed.data[provider] ?? {}
    )
    if (!providerConfig.success) {
      throw new Error(`${file} is invalid`)
    }

    const configured = providerConfig.data.accounts
    accounts[provider] = []
    if (configured !== undefined) {
      const parsedAccounts = z.array(entry.accountSchema).parse(configured)
      for (const parsedAccount of parsedAccounts) {
        if (
          typeof parsedAccount !== 'object' ||
          parsedAccount === null ||
          Array.isArray(parsedAccount) ||
          !('__type' in parsedAccount) ||
          parsedAccount.__type !== 'account'
        ) {
          throw new Error(`${file} is invalid`)
        }
        accounts[provider].push({ ...parsedAccount, __type: 'account' })
      }
    }
    const parsedOptions = entry.optionsSchema.parse(providerConfig.data)
    if (
      typeof parsedOptions !== 'object' ||
      parsedOptions === null ||
      Array.isArray(parsedOptions) ||
      !('cache' in parsedOptions) ||
      typeof parsedOptions.cache !== 'boolean' ||
      !('__type' in parsedOptions) ||
      parsedOptions.__type !== 'options'
    ) {
      throw new Error(`${file} is invalid`)
    }
    options[provider] = {
      ...parsedOptions,
      cache: parsedOptions.cache,
      __type: 'options',
    }
  }

  return {
    cacheTTL: parsed.data.cacheTTL,
    detect: parsed.data.detect,
    accounts,
    options,
  }
}
