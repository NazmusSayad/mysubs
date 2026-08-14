import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { claudeConfigSchema } from './providers/claude/config'
import { codexConfigSchema } from './providers/codex/config'
import { openrouterConfigSchema } from './providers/openrouter/config'
import { expandHome } from './utils/path'

export const configSchema = z.object({
  cacheTTL: z.union([z.number(), z.string()]).default('5m'),
  detect: z.boolean().default(true),
  codex: codexConfigSchema.optional(),
  claude: claudeConfigSchema.optional(),
  openrouter: openrouterConfigSchema.optional(),
})

export type Config = z.infer<typeof configSchema>

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg !== undefined && xdg !== '') {
    return path.join(xdg, 'mysubs', 'config.json')
  }
  return path.join(os.homedir(), '.config', 'mysubs', 'config.json')
}

export function loadConfig(): Config {
  const file = configPath()
  if (!fs.existsSync(file)) {
    return { cacheTTL: '5m', detect: true }
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`${file} is not valid JSON`)
  }

  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`${file} is invalid:\n${issues}`)
  }

  const config = parsed.data
  if (config.codex !== undefined) {
    config.codex.accounts = config.codex.accounts.map((account) => ({
      ...account,
      configDir: expandHome(account.configDir),
    }))
  }

  if (config.claude !== undefined) {
    config.claude.accounts = config.claude.accounts.map((account) => ({
      ...account,
      configDir: expandHome(account.configDir),
    }))
  }

  return config
}
