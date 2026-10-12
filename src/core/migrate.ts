import fs from 'node:fs'
import { z } from 'zod'
import { providers } from '../providers'

const legacyProviderSchema = z.looseObject({
  accounts: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  detect: z.boolean().optional(),
  cache: z.boolean().optional(),
})

export function isLegacyConfig(raw: unknown): raw is Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false
  }
  return Object.keys(providers).some((provider) => provider in raw)
}

export function migrateLegacyConfig(
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

export function writeMigratedConfig(file: string, migrated: unknown): void {
  const backup = `${file}.bak`
  if (fs.existsSync(backup)) {
    throw new Error(
      `${file} uses the old format, but ${backup} already exists; move it so mysubs can migrate`
    )
  }
  fs.copyFileSync(file, backup)
  fs.writeFileSync(file, `${JSON.stringify(migrated, null, 2)}\n`)
  process.stderr.write(
    `mysubs: migrated ${file} to the accounts list (backup at ${backup})\n`
  )
}
