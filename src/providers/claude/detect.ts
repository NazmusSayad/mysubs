import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from '../../utils/path'

export const KEYCHAIN_SERVICE = 'Claude Code-credentials'
export const SECURITY_BIN = '/usr/bin/security'
export const ITEM_NOT_FOUND_EXIT_CODE = 44

export function claudeConfigRoot(): string {
  const override = process.env.CLAUDE_CONFIG_DIR
  if (override !== undefined && override.trim() !== '') {
    return expandHome(override.trim())
  }
  return path.join(os.homedir(), '.claude')
}

export function credentialsPath(configDir: string): string {
  const secure = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  if (secure !== undefined && secure.trim() !== '') {
    return path.join(expandHome(secure.trim()), '.credentials.json')
  }
  return path.join(configDir, '.credentials.json')
}

function hasKeychainCredentials(): boolean {
  if (process.platform !== 'darwin') return false

  for (const account of [os.userInfo().username, null]) {
    const args = ['find-generic-password', '-s', KEYCHAIN_SERVICE]
    if (account !== null) args.push('-a', account)

    const result = spawnSync(SECURITY_BIN, args, {
      encoding: 'utf8',
      timeout: 5000,
    })
    if (result.error !== undefined) return false
    if (result.status === 0) return true
  }

  return false
}

export async function detectClaudeAccounts() {
  const root = claudeConfigRoot()

  if (fs.existsSync(credentialsPath(root))) {
    return [{ configDir: root, __type: 'account' as const }]
  }
  if (hasKeychainCredentials()) {
    return [{ configDir: root, __type: 'account' as const }]
  }
  return []
}
