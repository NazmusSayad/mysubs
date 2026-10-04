import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function credentialValue(overrides: Record<string, unknown> = {}) {
  return {
    type: 'oauth',
    methodID: 'chatgpt-browser',
    access: 'fixture-access',
    refresh: 'fixture-refresh-never-read',
    expires: Date.now() + 3_600_000,
    metadata: { accountID: 'fixture-account' },
    ...overrides,
  }
}

export function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mysubs-v2-test-'))
  const databasePath = path.join(directory, 'opencode.db')
  const owner = new DatabaseSync(databasePath)
  owner.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE credential (
      id TEXT PRIMARY KEY, integration_id TEXT, label TEXT NOT NULL,
      value TEXT NOT NULL, active INTEGER, time_created INTEGER, time_updated INTEGER
    );
  `)
  return {
    directory,
    databasePath,
    owner,
    add(
      id: string,
      value: unknown = credentialValue(),
      active: number | null = null,
      created = 1,
      label = id,
      integration = 'openai'
    ) {
      owner
        .prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          id,
          integration,
          label,
          typeof value === 'string' ? value : JSON.stringify(value),
          active,
          created,
          created
        )
    },
    snapshot() {
      return owner.prepare('SELECT * FROM credential ORDER BY id').all()
    },
    cleanup() {
      owner.close()
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}
