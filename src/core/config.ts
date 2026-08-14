import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { providers } from '../providers'
import type { ProviderAccount, ProviderOptions } from './types'

export const configSchema = z.looseObject({
  cacheTTL: z.union([z.number(), z.string()]).default('1m'),
  detect: z.boolean().default(true),
  contrast: z.number().min(0).max(1).default(0.4),
  nerdFont: z.boolean().default(false),
  maxWidth: z.number().min(80).default(120),
})
const providerConfigSchema = z.looseObject({
  accounts: z.unknown().optional(),
})

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg !== undefined && xdg !== '') {
    return path.join(xdg, 'mysubs', 'config.json')
  }
  return path.join(os.homedir(), '.config', 'mysubs', 'config.json')
}

export type Config = {
  cacheTTL: number | string
  detect: boolean
  contrast: number
  nerdFont: boolean
  maxWidth: number
  accounts: Record<string, Record<string, ProviderAccount>>
  options: Record<string, ProviderOptions>
}

export function loadConfig(): Config {
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

  const accounts: Config['accounts'] = {}
  const options: Record<string, ProviderOptions> = {}

  for (const [provider, entry] of Object.entries(providers)) {
    const providerConfig = providerConfigSchema.safeParse(
      parsed.data[provider] ?? {}
    )
    if (!providerConfig.success) {
      throw new Error(`${file} is invalid`)
    }

    const configured = providerConfig.data.accounts
    if (configured === undefined) {
      accounts[provider] = {}
    }
    if (configured !== undefined) {
      const parsedAccounts = z
        .record(z.string().min(1), entry.accountSchema)
        .parse(configured)
      accounts[provider] = parsedAccounts
    }

    options[provider] = entry.optionsSchema.parse(providerConfig.data)
  }

  return {
    cacheTTL: parsed.data.cacheTTL,
    detect: parsed.data.detect,
    contrast: parsed.data.contrast,
    nerdFont: parsed.data.nerdFont,
    maxWidth: parsed.data.maxWidth,
    accounts,
    options,
  }
}
