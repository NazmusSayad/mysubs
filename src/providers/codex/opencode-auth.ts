import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { expandHome } from '../../utils/path'

const OPENCODE_AUTH_PROVIDER = 'openai'

const opencodeAuthEntrySchema = z.object({
  type: z.literal('oauth'),
  access: z.string().min(1),
  refresh: z.string().min(1),
  expires: z.number().nullish(),
  accountId: z.string().nullish(),
})

export type OpenCodeAuth = z.infer<typeof opencodeAuthEntrySchema>

export type OpenCodeAuthState = {
  raw: Record<string, unknown>
  auth: OpenCodeAuth
  file: string
}

export function opencodeAuthPath(explicit?: string): string {
  if (explicit !== undefined && explicit !== '') return expandHome(explicit)

  const xdg = process.env.XDG_DATA_HOME
  if (xdg !== undefined && xdg.trim() !== '') {
    return path.join(xdg.trim(), 'opencode', 'auth.json')
  }
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json')
}

export function loadOpenCodeAuth(explicit?: string): OpenCodeAuthState {
  const file = opencodeAuthPath(explicit)
  if (!fs.existsSync(file)) {
    throw new Error(
      `no opencode auth at ${file}, sign in via \`opencode auth login\``
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error('opencode auth data is not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('opencode auth data is not an object')
  }

  const entries = raw as Record<string, unknown>
  const entry = entries[OPENCODE_AUTH_PROVIDER]

  if (
    typeof entry === 'object' &&
    entry !== null &&
    !Array.isArray(entry) &&
    (entry as Record<string, unknown>).type === 'api'
  ) {
    throw new Error('usage is not available for API key auth')
  }

  const parsed = opencodeAuthEntrySchema.safeParse(entry)
  if (!parsed.success) {
    throw new Error(
      `no codex oauth entry in opencode auth at ${file}, sign in via \`opencode auth login\``
    )
  }

  return {
    raw: entries,
    auth: parsed.data,
    file,
  }
}

export function hasOpenCodeOAuth(explicit?: string): boolean {
  try {
    loadOpenCodeAuth(explicit)
    return true
  } catch {
    return false
  }
}

export function saveOpenCodeAuth(state: OpenCodeAuthState): void {
  let reread: Record<string, unknown> | null = null
  try {
    const text = fs.readFileSync(state.file, 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      reread = parsed as Record<string, unknown>
    }
  } catch {
    reread = null
  }

  const merged = reread ?? state.raw

  const current = merged[OPENCODE_AUTH_PROVIDER]
  const currentEntry =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {}
  merged[OPENCODE_AUTH_PROVIDER] = { ...currentEntry, ...state.auth }

  fs.writeFileSync(state.file, JSON.stringify(merged, null, 2), {
    mode: 0o600,
  })
  fs.chmodSync(state.file, 0o600)
}
