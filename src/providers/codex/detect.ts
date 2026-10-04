import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from '../../utils/path'
import { hasOpenCodeOAuth } from './opencode-auth'
import { discoverOpenCodeV2 } from './opencode-v2-auth'

function codexHomes(): string[] {
  const codexHome = process.env.CODEX_HOME
  if (codexHome !== undefined && codexHome.trim() !== '') {
    return [expandHome(codexHome.trim())]
  }
  return [
    path.join(os.homedir(), '.config', 'codex'),
    path.join(os.homedir(), '.codex'),
  ]
}

type DetectedCodexAccount =
  | { configDir: string; __type: 'account' }
  | { adapter: 'opencode-oauth'; __type: 'account' }
  | {
      adapter: 'opencode-v2-oauth'
      databasePath: string
      credentialID: string
      detectedKey: string
      detectedName: string
      __type: 'account'
    }

export async function detectCodexAccounts(): Promise<DetectedCodexAccount[]> {
  const accounts: DetectedCodexAccount[] = []

  for (const home of codexHomes()) {
    if (fs.existsSync(path.join(home, 'auth.json'))) {
      accounts.push({ configDir: home, __type: 'account' })
      break
    }
  }

  try {
    const store = await discoverOpenCodeV2()
    if (store !== null) {
      for (const account of store.accounts) {
        accounts.push({
          adapter: 'opencode-v2-oauth',
          databasePath: store.databasePath,
          credentialID: account.id,
          detectedKey: account.id,
          detectedName: account.label,
          __type: 'account',
        })
      }
    } else if (hasOpenCodeOAuth()) {
      accounts.push({ adapter: 'opencode-oauth', __type: 'account' })
    }
  } catch (error) {
    // Preserve independent native discovery, but never fall back to stale v1.
    const reason =
      error instanceof Error ? error.message : 'OpenCode v2 discovery failed'
    process.stderr.write(`mysubs: ${reason}\n`)
  }

  return accounts
}
