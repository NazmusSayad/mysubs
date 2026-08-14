import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { providers } from '../providers'

const configSchema = z.object({
  cacheTTL: z.union([z.number(), z.string()]).default('5m'),
  detect: z.boolean().default(true),
  ...Object.fromEntries(
    Object.entries(providers).map(([id, provider]) => [
      id,
      z.object({ accounts: z.array(provider.accountSchema) }).optional(),
    ])
  ),
})

export type Config = {
  cacheTTL: number | string
  detect: boolean
  accounts: Record<string, unknown[]>
}

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg !== undefined && xdg !== '') {
    return path.join(xdg, 'mysubs', 'config.json')
  }
  return path.join(os.homedir(), '.config', 'mysubs', 'config.json')
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
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`${file} is invalid:\n${issues}`)
  }

  const values: Record<string, unknown> = parsed.data
  const accounts: Record<string, unknown[]> = {}
  for (const [id, provider] of Object.entries(providers)) {
    const providerConfig = values[id]
    if (providerConfig === undefined) {
      accounts[id] = []
      continue
    }
    accounts[id] = (providerConfig as { accounts: unknown[] }).accounts
  }

  return {
    cacheTTL: parsed.data.cacheTTL,
    detect: parsed.data.detect,
    accounts,
  }
}
