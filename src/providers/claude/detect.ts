import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from '../../utils/path'

export const KEYCHAIN_SERVICE = 'Claude Code-credentials'
export const SECURITY_BIN = '/usr/bin/security'
export const ITEM_NOT_FOUND_EXIT_CODE = 44

function scopedKeychainService(configDir: string): string {
  const suffix = createHash('sha256')
    .update(configDir.normalize('NFC'))
    .digest('hex')
    .slice(0, 8)
  return `${KEYCHAIN_SERVICE}-${suffix}`
}

export function keychainServices(configDir: string): string[] {
  const defaultRoot = path.join(os.homedir(), '.claude')
  const root = claudeConfigRoot()
  const override = process.env.CLAUDE_CONFIG_DIR
  const active = path.resolve(configDir) === path.resolve(root)

  if (active && override !== undefined && override.trim() !== '') {
    return [scopedKeychainService(configDir), KEYCHAIN_SERVICE]
  }
  if (path.resolve(configDir) === path.resolve(defaultRoot)) {
    return [KEYCHAIN_SERVICE]
  }
  return [scopedKeychainService(configDir)]
}

export function claudeConfigRoot(): string {
  const override = process.env.CLAUDE_CONFIG_DIR
  if (override !== undefined && override.trim() !== '') {
    return expandHome(override.trim())
  }
  return path.join(os.homedir(), '.claude')
}

export function credentialsPath(configDir: string): string {
  const secure = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  if (
    path.resolve(configDir) === path.resolve(claudeConfigRoot()) &&
    secure !== undefined &&
    secure.trim() !== ''
  ) {
    return path.join(expandHome(secure.trim()), '.credentials.json')
  }
  return path.join(configDir, '.credentials.json')
}

function hasKeychainCredentials(configDir: string): boolean {
  if (process.platform !== 'darwin') return false

  for (const service of keychainServices(configDir)) {
    const args = [
      'find-generic-password',
      '-s',
      service,
      '-a',
      os.userInfo().username,
    ]
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
  if (hasKeychainCredentials(root)) {
    return [{ configDir: root, __type: 'account' as const }]
  }
  return []
}
