import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { expandHome } from '../../utils/path'

const methodSchema = z.enum(['chatgpt-browser', 'chatgpt-headless'])
const accessSchema = z.object({
  access: z
    .string()
    .min(1)
    .regex(/^[\x21-\x7e]+$/),
  expires: z.int().nonnegative(),
  accountID: z
    .string()
    .regex(/^[\x21-\x7e]*$/)
    .nullable(),
})

export class OpenCodeV2Error extends Error {
  readonly account?: OpenCodeV2Account

  constructor(message: string, account?: OpenCodeV2Account) {
    super(message)
    if (account !== undefined) {
      this.account = {
        id: account.id,
        label: account.label,
        active: account.active,
        invalid: account.invalid,
      }
    }
  }
}

export function opencodeV2FallbackLabel(id: string): string {
  return `OpenCode ${createHash('sha256').update(id).digest('hex').slice(0, 8)}`
}

export function safeOpenCodeDisplay(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  // External labels and user overrides must not expose addresses, terminal
  // controls, bearer/JWT material, or typical opaque token strings.
  if (
    text === '' ||
    text.length > 120 ||
    /[@\p{Cc}\p{Cf}]|bearer\s|\b(?:sk-|eyJ)|[A-Za-z0-9_-]{32,}/iu.test(value)
  )
    return undefined
  return text
}

function dataDirectory(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim()
  return path.resolve(
    xdg ? expandHome(xdg) : path.join(os.homedir(), '.local', 'share'),
    'opencode'
  )
}

export function opencodeV2DatabasePath(explicit?: string): string {
  const filename = explicit ?? process.env.OPENCODE_DB?.trim() ?? 'opencode.db'
  if (filename === ':memory:') {
    throw new OpenCodeV2Error(
      'OpenCode v2 in-memory storage cannot be read by mysubs'
    )
  }
  const resolved =
    explicit !== undefined
      ? path.resolve(expandHome(filename))
      : path.resolve(dataDirectory(), expandHome(filename || 'opencode.db'))
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export function opencodeV2Identity(
  databasePath: string | undefined,
  id: string
): string {
  let canonical = opencodeV2DatabasePath(databasePath)
  if (process.platform === 'win32') canonical = canonical.toLowerCase()
  return JSON.stringify(['opencode-v2-oauth', canonical, id])
}

export type OpenCodeV2Account = {
  id: string
  label: string
  active: boolean
  invalid: boolean
}

export type OpenCodeV2Credential = OpenCodeV2Account &
  z.infer<typeof accessSchema>

type Store = {
  databasePath: string
  accounts: OpenCodeV2Account[]
  rows: Record<string, unknown>[]
}

// CASE guards isolate malformed JSON; refresh tokens never cross this boundary.
const projection = `
  SELECT id, label, json_valid(value) AS valid,
    CASE WHEN json_valid(value) THEN json_extract(value, '$.type') END AS type,
    CASE WHEN json_valid(value) THEN json_extract(value, '$.methodID') END AS methodID,
    CASE WHEN json_valid(value) THEN json_extract(value, '$.access') END AS access,
    CASE WHEN json_valid(value) THEN json_extract(value, '$.expires') END AS expires,
    CASE WHEN json_valid(value) THEN json_extract(value, '$.metadata.accountID') END AS accountID
  FROM credential WHERE integration_id = 'openai'
  ORDER BY active DESC, time_created DESC, id DESC
`

async function openStore(databasePath: string): Promise<DatabaseSync> {
  let sqlite: typeof import('node:sqlite')
  try {
    sqlite = await import('node:sqlite')
  } catch {
    throw new OpenCodeV2Error(
      'OpenCode v2 usage requires Node.js 24 or newer with node:sqlite enabled'
    )
  }
  try {
    return new sqlite.DatabaseSync(databasePath, { readOnly: true })
  } catch {
    throw new OpenCodeV2Error(
      'OpenCode v2 database is missing, busy, or unreadable; no legacy fallback was used'
    )
  }
}

async function readStore(explicit?: string): Promise<Store | null> {
  const databasePath = opencodeV2DatabasePath(explicit)
  const db = await openStore(databasePath)
  try {
    const table = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'credential'"
      )
      .get()
    if (table === undefined) return null
    const statement = db.prepare(projection)
    // A malformed oversized JSON integer must not make SQLite's JS conversion
    // abort the entire account list. Validate each credential independently.
    statement.setReadBigInts(true)
    const rows = statement.all() as Record<string, unknown>[]
    const activeID = rows[0]?.id
    const accounts: OpenCodeV2Account[] = []
    for (const row of rows) {
      if (typeof row.id !== 'string' || row.id === '') continue
      const invalid = row.valid !== BigInt(1)
      if (
        !invalid &&
        (row.type !== 'oauth' || !methodSchema.safeParse(row.methodID).success)
      )
        continue
      const label =
        row.label === row.access ? undefined : safeOpenCodeDisplay(row.label)
      accounts.push({
        id: row.id,
        label: label ?? opencodeV2FallbackLabel(row.id),
        active: row.id === activeID,
        invalid,
      })
    }
    return { databasePath, accounts, rows }
  } catch {
    throw new OpenCodeV2Error(
      'OpenCode v2 credential schema is incompatible or unreadable; no legacy fallback was used'
    )
  } finally {
    db.close()
  }
}

function rejectAmbiguousChannels(): void {
  if (process.env.OPENCODE_DB?.trim()) return
  try {
    if (
      fs
        .readdirSync(dataDirectory())
        .some((name) => /^opencode-.+\.db$/.test(name))
    ) {
      throw new OpenCodeV2Error(
        'Set OPENCODE_DB to the path from `opencode debug paths db`; channel storage is ambiguous'
      )
    }
  } catch (error) {
    if (error instanceof OpenCodeV2Error) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new OpenCodeV2Error(
        'OpenCode storage is unreadable; no legacy fallback was used'
      )
    }
  }
}

export async function discoverOpenCodeV2(): Promise<{
  databasePath: string
  accounts: OpenCodeV2Account[]
} | null> {
  const databasePath = opencodeV2DatabasePath()
  try {
    fs.statSync(databasePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new OpenCodeV2Error(
        'OpenCode v2 database is unreadable; no legacy fallback was used'
      )
    }
    // A configured store is authoritative even if missing. Channel stores are
    // ambiguous: do not revive an imported auth.json or guess which is live.
    if (process.env.OPENCODE_DB?.trim()) {
      throw new OpenCodeV2Error(
        'Configured OpenCode v2 database is missing; no legacy fallback was used'
      )
    }
    rejectAmbiguousChannels()
    return null
  }
  const store = await readStore(databasePath)
  if (store === null) rejectAmbiguousChannels()
  return store === null ? null : { databasePath, accounts: store.accounts }
}

export async function loadOpenCodeV2Credential(
  databasePath: string | undefined,
  credentialID: string
): Promise<OpenCodeV2Credential> {
  const store = await readStore(databasePath)
  const account = store?.accounts.find((item) => item.id === credentialID)
  if (account === undefined) {
    throw new OpenCodeV2Error(
      'OpenCode v2 credential is missing or uses an unsupported authentication method'
    )
  }
  if (account.invalid)
    throw new OpenCodeV2Error(
      'OpenCode v2 credential contains invalid JSON',
      account
    )
  const row = store?.rows.find((item) => item.id === credentialID)
  const parsed = accessSchema.safeParse({
    ...row,
    expires:
      typeof row?.expires === 'bigint' ? Number(row.expires) : row?.expires,
  })
  if (!parsed.success)
    throw new OpenCodeV2Error(
      'OpenCode v2 credential has invalid or missing access metadata',
      account
    )
  return { ...account, ...parsed.data }
}

export function requireFreshOpenCodeV2(credential: OpenCodeV2Credential): void {
  // Declared milliseconds, with no speculative JWT decoding or refresh margin.
  if (credential.expires <= Date.now()) {
    throw new OpenCodeV2Error(
      'Usage unavailable: this OpenCode v2 credential needs renewal by OpenCode. mysubs did not refresh or modify it.',
      credential
    )
  }
}
