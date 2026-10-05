import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from '../../utils/path'
import { hasOpenCodeOAuth } from './opencode-auth'

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

export async function detectCodexAccounts(): Promise<DetectedCodexAccount[]> {
  const accounts: DetectedCodexAccount[] = []

  for (const home of codexHomes()) {
    if (fs.existsSync(path.join(home, 'auth.json'))) {
      accounts.push({ configDir: home, __type: 'account' })
      break
    }
  }

  if (hasOpenCodeOAuth()) {
    accounts.push({ adapter: 'opencode-oauth', __type: 'account' })
  }

  return accounts
}
