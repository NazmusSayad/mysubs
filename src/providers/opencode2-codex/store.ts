import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { expandHome } from '../../utils/path'

const credentialSchema = z.object({
  type: z.literal('oauth'),
  access: z.string().min(1),
  expires: z.number(),
  metadata: z.object({ accountID: z.string().nullish() }).nullish(),
})

export type OpenCodeCredential = {
  id: string
  access: string
  expires: number
  accountID: string | null
}

export function opencodeDatabasePath(explicit?: string): string {
  if (explicit !== undefined) return expandHome(explicit)

  const xdg = process.env.XDG_DATA_HOME?.trim()
  const data = path.join(
    xdg !== undefined && xdg !== ''
      ? xdg
      : path.join(os.homedir(), '.local', 'share'),
    'opencode'
  )

  const env = process.env.OPENCODE_DB?.trim()
  if (env === undefined || env === '') return path.join(data, 'opencode.db')
  return path.isAbsolute(env) ? env : path.join(data, env)
}

export function readOpenCodeCredentials(
  databasePath: string
): OpenCodeCredential[] {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const rows = db
      .prepare(
        "SELECT id, value FROM credential WHERE integration_id = 'openai' ORDER BY time_created"
      )
      .all()

    const credentials: OpenCodeCredential[] = []
    for (const row of rows) {
      if (typeof row.id !== 'string' || typeof row.value !== 'string') continue

      let value: unknown
      try {
        value = JSON.parse(row.value)
      } catch {
        continue
      }

      const parsed = credentialSchema.safeParse(value)
      if (!parsed.success) continue

      credentials.push({
        id: row.id,
        access: parsed.data.access,
        expires: parsed.data.expires,
        accountID: parsed.data.metadata?.accountID ?? null,
      })
    }
    return credentials
  } finally {
    db.close()
  }
}
