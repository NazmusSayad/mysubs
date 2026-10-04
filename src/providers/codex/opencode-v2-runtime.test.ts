import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCodexAccount } from '.'
import { detectCodexAccounts } from './detect'
import { discoverOpenCodeV2 } from './opencode-v2-auth'

vi.mock('node:sqlite', () => {
  throw new Error('SQLite is disabled in this fixture runtime')
})

const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('optional SQLite runtime', () => {
  it('loads native/v1 code without SQLite and fails closed for potential v2 stores', async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mysubs-v2-runtime-')
    )
    directories.push(directory)
    const databasePath = path.join(directory, 'opencode.db')
    fs.writeFileSync(databasePath, '')
    fs.mkdirSync(path.join(directory, 'opencode'))
    fs.writeFileSync(
      path.join(directory, 'opencode', 'auth.json'),
      JSON.stringify({
        openai: {
          type: 'oauth',
          access: 'legacy',
          refresh: 'legacy-refresh',
          expires: Date.now() + 3_600_000,
        },
      })
    )
    fs.writeFileSync(
      path.join(directory, 'auth.json'),
      JSON.stringify({ tokens: { access_token: 'native' } })
    )
    vi.stubEnv('OPENCODE_DB', databasePath)
    vi.stubEnv('CODEX_HOME', directory)
    vi.stubEnv('XDG_DATA_HOME', directory)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await expect(discoverOpenCodeV2()).rejects.toThrow('node:sqlite enabled')
    expect(await detectCodexAccounts()).toEqual([
      { configDir: directory, __type: 'account' },
    ])
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('node:sqlite enabled')
    )
    const options = { cache: false, detect: false, __type: 'options' as const }
    expect(
      (
        await fetchCodexAccount(
          { configDir: directory, __type: 'account' },
          options
        )
      ).error
    ).toBeUndefined()
    fetch.mockResolvedValue(new Response('{}'))
    expect(
      (
        await fetchCodexAccount(
          {
            adapter: 'opencode-oauth',
            authPath: path.join(directory, 'opencode', 'auth.json'),
            __type: 'account',
          },
          options
        )
      ).error
    ).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
