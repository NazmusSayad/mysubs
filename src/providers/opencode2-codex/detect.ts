import fs from 'node:fs'
import { opencodeDatabasePath, readOpenCodeCredentials } from './store'

export async function detectOpenCode2CodexAccounts() {
  const databasePath = opencodeDatabasePath()
  if (!fs.existsSync(databasePath)) return []

  return readOpenCodeCredentials(databasePath).map((credential) => ({
    credentialID: credential.id,
    __type: 'account' as const,
  }))
}
