import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectCodexAccounts } from './detect'
import { createFixture, credentialValue } from './test-fixture'

let fixture: ReturnType<typeof createFixture>
beforeEach(() => {
  fixture = createFixture()
  vi.stubEnv('XDG_DATA_HOME', fixture.directory)
  vi.stubEnv('OPENCODE_DB', fixture.databasePath)
  vi.stubEnv('CODEX_HOME', path.join(fixture.directory, 'native'))
  fs.mkdirSync(path.join(fixture.directory, 'opencode'))
  fs.writeFileSync(
    path.join(fixture.directory, 'opencode', 'auth.json'),
    JSON.stringify({
      openai: {
        type: 'oauth',
        access: 'legacy-access',
        refresh: 'legacy-refresh',
        expires: Date.now() + 3_600_000,
      },
    })
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fixture.cleanup()
})

describe('Codex OpenCode adapter coexistence', () => {
  it('enumerates browser/headless accounts instead of leftover legacy credentials', async () => {
    fixture.add('cred_browser', credentialValue(), 1, 1, 'Same label')
    fixture.add(
      'cred_headless',
      credentialValue({ methodID: 'chatgpt-headless' }),
      null,
      1,
      'Same label'
    )
    fixture.add(
      'sharing',
      credentialValue({ methodID: 'chatgpt-token-sharing' })
    )
    const accounts = await detectCodexAccounts()
    expect(accounts).toHaveLength(2)
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: 'opencode-v2-oauth',
          credentialID: 'cred_browser',
          detectedKey: 'cred_browser',
          detectedName: 'Same label',
        }),
        expect.objectContaining({
          adapter: 'opencode-v2-oauth',
          credentialID: 'cred_headless',
          detectedKey: 'cred_headless',
        }),
      ])
    )
    expect(JSON.stringify(accounts)).not.toMatch(
      /legacy-access|fixture-access|refresh/
    )
  })

  it('does not revive legacy auth from an empty or unsupported-only v2 store', async () => {
    expect(await detectCodexAccounts()).toEqual([])
    fixture.add(
      'sharing',
      credentialValue({ methodID: 'chatgpt-token-sharing' })
    )
    expect(await detectCodexAccounts()).toEqual([])
  })

  it('retains genuine v1 detection with no credential table', async () => {
    fixture.owner.exec('DROP TABLE credential')
    expect(await detectCodexAccounts()).toEqual([
      { adapter: 'opencode-oauth', __type: 'account' },
    ])
  })

  it('retains v1 detection when there is no database', async () => {
    vi.stubEnv('OPENCODE_DB', '')
    expect(await detectCodexAccounts()).toEqual([
      { adapter: 'opencode-oauth', __type: 'account' },
    ])
  })

  it('preserves native detection when v2 fails, without legacy fallback', async () => {
    const native = path.join(fixture.directory, 'native')
    fs.mkdirSync(native)
    fs.writeFileSync(path.join(native, 'auth.json'), '{}')
    fixture.owner.exec(
      'DROP TABLE credential; CREATE TABLE credential (id TEXT)'
    )
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await detectCodexAccounts()).toEqual([
      { configDir: native, __type: 'account' },
    ])
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('no legacy fallback')
    )
  })

  it('fails closed on a configured missing database', async () => {
    vi.stubEnv('OPENCODE_DB', path.join(fixture.directory, 'missing.db'))
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await detectCodexAccounts()).toEqual([])
  })
})
