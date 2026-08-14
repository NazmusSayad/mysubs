import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from '../../utils/path'

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

export async function detectCodexAccounts() {
  for (const home of codexHomes()) {
    if (fs.existsSync(path.join(home, 'auth.json'))) {
      return [{ configDir: home, __type: 'account' as const }]
    }
  }
  return []
}
