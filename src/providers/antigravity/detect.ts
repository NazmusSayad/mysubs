import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from '../../utils/path'

const BIN_NAMES = ['antigravity', 'agy']
const WELL_KNOWN_DIRS = ['~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']

function isExecutable(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.X_OK)
  } catch {
    return false
  }
  return fs.statSync(target).isFile()
}

export function resolveCliPath(): string | null {
  const override = process.env.ANTIGRAVITY_CLI_PATH
  if (override !== undefined && override.trim() !== '') {
    const target = expandHome(override.trim())
    if (isExecutable(target)) return target
    return null
  }

  const searchDirs = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => dir !== '')
    .concat(WELL_KNOWN_DIRS.map(expandHome))

  for (const dir of searchDirs) {
    for (const name of BIN_NAMES) {
      const target = path.join(dir, name)
      if (isExecutable(target)) return target
    }
  }
  return null
}

export async function detectAntigravityAccounts() {
  if (resolveCliPath() === null) return []
  if (!fs.existsSync(path.join(os.homedir(), '.gemini', 'antigravity-cli'))) {
    return []
  }
  return [{ __type: 'account' as const }]
}
