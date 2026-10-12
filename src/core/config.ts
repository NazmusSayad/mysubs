import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { providers } from '../providers'
import { accountBaseSchema } from './schema'
import type { ProviderAccount } from './types'

export const configSchema = z.looseObject({
  cacheTTL: z.union([z.number(), z.string()]).default('1m'),
  cache: z.boolean().default(true),
  detect: z.boolean().default(true),
  skipDetect: z.array(z.string()).default([]),
  contrast: z.number().min(0).max(1).default(0.4),
  nerdFont: z.boolean().default(false),
  maxWidth: z.number().min(80).default(120),
  accounts: z.array(z.unknown()).default([]),
})
export const accountEntrySchema = z.looseObject({
  provider: z.string().min(1),
  auto: z.literal(true).optional(),
  alias: z
    .string()
    .regex(/^[^:\s]+$/)
    .optional(),
  cache: z.boolean().optional(),
  name: accountBaseSchema.shape.name,
  info: accountBaseSchema.shape.info,
})
const legacyProviderSchema = z.looseObject({
  accounts: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  detect: z.boolean().optional(),
  cache: z.boolean().optional(),
})

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg !== undefined && xdg !== '') {
    return path.join(xdg, 'mysubs', 'config.json')
  }
  return path.join(os.homedir(), '.config', 'mysubs', 'config.json')
}

export type ConfigAccount =
  | {
      provider: string
      alias?: string
      cache?: boolean
      auto: true
      name?: string
      info?: string | false
    }
  | {
      provider: string
      alias?: string
      cache?: boolean
      auto: false
      account: ProviderAccount
    }

export type Config = {
  cacheTTL: number | string
  cache: boolean
  detect: boolean
  skipDetect: string[]
  contrast: number
  nerdFont: boolean
  maxWidth: number
  accounts: ConfigAccount[]
}

function isLegacyConfig(raw: unknown): raw is Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false
  }
  return Object.keys(providers).some((provider) => provider in raw)
}

function migrateLegacyConfig(
  file: string,
  raw: Record<string, unknown>
): Record<string, unknown> {
  if (raw.accounts !== undefined) {
    throw new Error(
      `${file} mixes the "accounts" list with old provider sections`
    )
  }

  const rootDetect = raw.detect
  if (rootDetect !== undefined && typeof rootDetect !== 'boolean') {
    throw new Error(`${file} is invalid`)
  }

  const migrated: Record<string, unknown> = {}
  const sections: Record<string, z.infer<typeof legacyProviderSchema>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (providers[key] === undefined) {
      migrated[key] = value
      continue
    }
    const section = legacyProviderSchema.safeParse(value)
    if (!section.success) {
      throw new Error(`${file} is invalid`)
    }
    sections[key] = section.data
  }

  const keys = Object.values(sections).flatMap((section) =>
    Object.keys(section.accounts ?? {})
  )
  const accounts: Record<string, unknown>[] = []
  const skipDetect: string[] = []

  for (const provider of Object.keys(providers)) {
    const section = sections[provider] ?? {}
    const detect = section.detect ?? rootDetect ?? true
    const cache = section.cache === undefined ? {} : { cache: section.cache }
    const entries = Object.entries(section.accounts ?? {})

    if (detect) accounts.push({ provider, auto: true, ...cache })
    for (const [key, account] of entries) {
      const clashes =
        providers[key] !== undefined ||
        keys.filter((other) => other === key).length > 1
      const alias = clashes ? `${provider}-${key}` : key
      accounts.push({ provider, alias, ...account, ...cache })
    }
    if (!detect && rootDetect !== false) skipDetect.push(provider)
  }

  if (skipDetect.length > 0) migrated.skipDetect = skipDetect
  migrated.accounts = accounts
  return migrated
}

export function loadConfig(readFile = true): Config {
  const file = configPath()
  let raw: unknown = {}

  if (readFile && fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      throw new Error(`${file} is not valid JSON`)
    }
  }

  let legacy = false
  if (isLegacyConfig(raw)) {
    raw = migrateLegacyConfig(file, raw)
    legacy = true
  }

  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`${file} is invalid`)
  }

  const accounts: ConfigAccount[] = []
  const aliases = new Set<string>()
  const autoProviders = new Set<string>()

  for (const [index, item] of parsed.data.accounts.entries()) {
    const label = `${file}: accounts[${index}]`
    const entry = accountEntrySchema.safeParse(item)
    if (!entry.success) {
      throw new Error(`${label} is invalid\n${z.prettifyError(entry.error)}`)
    }

    const { provider, alias, cache } = entry.data
    const providerEntry = providers[provider]
    if (providerEntry === undefined) {
      throw new Error(`${label} has unknown provider "${provider}"`)
    }

    if (alias !== undefined) {
      if (providers[alias] !== undefined) {
        throw new Error(`${label} alias "${alias}" is a provider name`)
      }
      if (aliases.has(alias)) {
        throw new Error(`${label} alias "${alias}" is already used`)
      }
      aliases.add(alias)
    }

    if (entry.data.auto === true) {
      if (autoProviders.has(provider)) {
        throw new Error(`${label} repeats auto detection for ${provider}`)
      }
      autoProviders.add(provider)
      accounts.push({
        provider,
        alias,
        cache,
        auto: true,
        name: entry.data.name,
        info: entry.data.info,
      })
      continue
    }

    const account = providerEntry.accountSchema.safeParse(item)
    if (!account.success) {
      throw new Error(
        `${label} is not a valid ${provider} account\n${z.prettifyError(account.error)}`
      )
    }
    accounts.push({
      provider,
      alias,
      cache,
      auto: false,
      account: account.data,
    })
  }

  for (const provider of parsed.data.skipDetect) {
    if (providers[provider] === undefined) {
      throw new Error(`${file}: skipDetect has unknown provider "${provider}"`)
    }
    if (autoProviders.has(provider)) {
      throw new Error(
        `${file}: skipDetect has ${provider}, but accounts also has an auto entry for it`
      )
    }
  }

  if (legacy) {
    const backup = `${file}.bak`
    if (fs.existsSync(backup)) {
      throw new Error(
        `${file} uses the old format, but ${backup} already exists; move it so mysubs can migrate`
      )
    }
    fs.copyFileSync(file, backup)
    fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`)
    process.stderr.write(
      `mysubs: migrated ${file} to the accounts list (backup at ${backup})\n`
    )
  }

  return {
    cacheTTL: parsed.data.cacheTTL,
    cache: parsed.data.cache,
    detect: parsed.data.detect,
    skipDetect: parsed.data.skipDetect,
    contrast: parsed.data.contrast,
    nerdFont: parsed.data.nerdFont,
    maxWidth: parsed.data.maxWidth,
    accounts,
  }
}
