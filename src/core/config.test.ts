import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from './config'

let configRoot: string | undefined

afterEach(() => {
  vi.unstubAllEnvs()
  if (configRoot !== undefined) fs.rmSync(configRoot, { recursive: true })
  configRoot = undefined
})

describe('loadConfig', () => {
  it('keeps account keys separate from display names', () => {
    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mysubs-'))
    vi.stubEnv('XDG_CONFIG_HOME', configRoot)
    const configDir = path.join(configRoot, 'mysubs')
    fs.mkdirSync(configDir)
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        codex: {
          accounts: {
            sayad: { name: 'Personal', configDir: '~/.codex' },
          },
        },
      })
    )

    expect(loadConfig().accounts.codex).toEqual({
      sayad: {
        name: 'Personal',
        configDir: '~/.codex',
        __type: 'account',
      },
    })
  })
})
