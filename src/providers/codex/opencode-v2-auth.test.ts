import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discoverOpenCodeV2,
  loadOpenCodeV2Credential,
  opencodeV2DatabasePath,
  opencodeV2Identity,
  safeOpenCodeDisplay,
} from './opencode-v2-auth'
import { createFixture, credentialValue } from './test-fixture'

let fixture: ReturnType<typeof createFixture>
beforeEach(() => {
  fixture = createFixture()
  vi.stubEnv('OPENCODE_DB', fixture.databasePath)
})
afterEach(() => {
  vi.unstubAllEnvs()
  fixture.cleanup()
})

describe('OpenCode v2 read-only credential store', () => {
  it('creates fixtures without assuming an OpenCode-specific temporary directory exists', () => {
    const localAppData = path.join(fixture.directory, 'missing-local-app-data')
    vi.stubEnv('LOCALAPPDATA', localAppData)
    const portable = createFixture()
    try {
      expect(fs.existsSync(portable.databasePath)).toBe(true)
      expect(fs.existsSync(localAppData)).toBe(false)
    } finally {
      portable.cleanup()
    }
  })
  it('enumerates supported methods and never returns refresh material', async () => {
    fixture.add('browser')
    fixture.add('headless', credentialValue({ methodID: 'chatgpt-headless' }))
    fixture.add(
      'sharing',
      credentialValue({ methodID: 'chatgpt-token-sharing' })
    )
    fixture.add('unknown', credentialValue({ methodID: 'custom' }))
    fixture.add('key', { type: 'key', key: 'fixture-key' })
    fixture.add('other', credentialValue(), null, 1, 'Other', 'anthropic')
    const snapshot = fixture.snapshot()
    const store = await discoverOpenCodeV2()
    expect(store?.accounts.map((item) => item.id).sort()).toEqual([
      'browser',
      'headless',
    ])
    const credential = await loadOpenCodeV2Credential(
      fixture.databasePath,
      'browser'
    )
    expect(credential).toMatchObject({
      access: 'fixture-access',
      accountID: 'fixture-account',
    })
    expect(JSON.stringify(credential)).not.toContain('refresh')
    expect(JSON.stringify(store)).not.toContain('fixture-access')
    expect(fixture.snapshot()).toEqual(snapshot)
  })

  it.each([
    ['active', 1, 1, 'active'],
    ['newest', null, 20, 'newest'],
    ['z', null, 1, 'z'],
  ] as const)(
    'mirrors flag/timestamp/ID ordering: %s',
    async (id, active, created, selected) => {
      fixture.add('a', credentialValue(), null, 1)
      fixture.add(id, credentialValue(), active, created)
      expect(
        (await discoverOpenCodeV2())?.accounts.find((item) => item.active)?.id
      ).toBe(selected)
    }
  )

  it('selects across all rows before supported-method filtering', async () => {
    fixture.add('supported', credentialValue(), 0, 10)
    fixture.add('unsupported', { type: 'key', key: 'fixture-key' }, 1, 1)
    expect((await discoverOpenCodeV2())?.accounts).toMatchObject([
      { id: 'supported', active: false },
    ])
  })

  it('treats NULL as older than an explicit inactive flag, as SQLite does', async () => {
    fixture.add('imported', credentialValue(), null, 50)
    fixture.add('inactive', credentialValue(), 0, 1)
    expect(
      (await discoverOpenCodeV2())?.accounts.find((item) => item.active)?.id
    ).toBe('inactive')
  })

  it('isolates malformed rows, missing access, and unsafe labels', async () => {
    fixture.add('valid', credentialValue(), 1, 1, 'private@example.test')
    fixture.add('malformed', '{not-json fixture-refresh-secret')
    fixture.add('incomplete', credentialValue({ access: '' }))
    expect((await discoverOpenCodeV2())?.accounts).toHaveLength(3)
    const valid = await loadOpenCodeV2Credential(fixture.databasePath, 'valid')
    expect(valid.label).toMatch(/^OpenCode [a-f0-9]{8}$/)
    await expect(
      loadOpenCodeV2Credential(fixture.databasePath, 'malformed')
    ).rejects.toThrow('invalid JSON')
    await expect(
      loadOpenCodeV2Credential(fixture.databasePath, 'incomplete')
    ).rejects.toThrow('invalid or missing access metadata')
  })

  it('isolates oversized credential integers rather than failing all accounts', async () => {
    fixture.add('valid')
    fixture.add(
      'overflow',
      '{"type":"oauth","methodID":"chatgpt-browser","access":"fixture-access","expires":9223372036854775807}'
    )
    fixture.add(
      'invalid-scope',
      '{"type":"oauth","methodID":"chatgpt-headless","access":"fixture-access","expires":9999999999999,"metadata":{"accountID":9223372036854775807}}'
    )
    expect((await discoverOpenCodeV2())?.accounts).toHaveLength(3)
    expect(
      (await loadOpenCodeV2Credential(fixture.databasePath, 'valid')).access
    ).toBe('fixture-access')
    await expect(
      loadOpenCodeV2Credential(fixture.databasePath, 'overflow')
    ).rejects.toThrow('invalid or missing access metadata')
    await expect(
      loadOpenCodeV2Credential(fixture.databasePath, 'invalid-scope')
    ).rejects.toThrow('invalid or missing access metadata')
  })

  it('preserves missing scope and observes committed owner replacements in WAL mode', async () => {
    fixture.add('account', credentialValue({ metadata: {} }))
    expect(
      (await loadOpenCodeV2Credential(fixture.databasePath, 'account'))
        .accountID
    ).toBeNull()
    fixture.owner.exec('BEGIN IMMEDIATE')
    fixture.owner
      .prepare('UPDATE credential SET value = ? WHERE id = ?')
      .run(
        JSON.stringify(credentialValue({ access: 'owner-new-access' })),
        'account'
      )
    expect(
      (await loadOpenCodeV2Credential(fixture.databasePath, 'account')).access
    ).toBe('fixture-access')
    fixture.owner.exec('COMMIT')
    expect(
      (await loadOpenCodeV2Credential(fixture.databasePath, 'account')).access
    ).toBe('owner-new-access')
  })

  it('distinguishes authoritative empty stores from legacy databases', async () => {
    expect((await discoverOpenCodeV2())?.accounts).toEqual([])
    fixture.owner.exec('DROP TABLE credential')
    expect(await discoverOpenCodeV2()).toBeNull()
  })

  it('fails closed for incompatible or corrupt stores', async () => {
    fixture.owner.exec(
      'DROP TABLE credential; CREATE TABLE credential (id TEXT)'
    )
    await expect(discoverOpenCodeV2()).rejects.toThrow(
      'incompatible or unreadable'
    )
    const corrupt = path.join(fixture.directory, 'corrupt.db')
    fs.writeFileSync(corrupt, 'not-a-database')
    vi.stubEnv('OPENCODE_DB', corrupt)
    await expect(discoverOpenCodeV2()).rejects.toThrow('unreadable')
  })

  it('does not create missing databases or fall back from configured missing stores', async () => {
    const missing = path.join(fixture.directory, 'missing.db')
    vi.stubEnv('OPENCODE_DB', missing)
    await expect(discoverOpenCodeV2()).rejects.toThrow(
      'Configured OpenCode v2 database is missing'
    )
    await expect(loadOpenCodeV2Credential(missing, 'account')).rejects.toThrow(
      'unreadable'
    )
    expect(fs.existsSync(missing)).toBe(false)
  })

  it('fails closed when channel stores are ambiguous', async () => {
    vi.stubEnv('OPENCODE_DB', '')
    vi.stubEnv('XDG_DATA_HOME', fixture.directory)
    fs.mkdirSync(path.join(fixture.directory, 'opencode'))
    fs.writeFileSync(
      path.join(fixture.directory, 'opencode', 'opencode-custom.db'),
      ''
    )
    await expect(discoverOpenCodeV2()).rejects.toThrow(
      'channel storage is ambiguous'
    )
  })

  it('does not use legacy fallback when a default legacy database sits beside channel stores', async () => {
    vi.stubEnv('OPENCODE_DB', '')
    vi.stubEnv('XDG_DATA_HOME', fixture.directory)
    const directory = path.join(fixture.directory, 'opencode')
    fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, 'opencode-custom.db'), '')
    // A default database without credentials is a v1 session store, not proof
    // that a channel's imported auth.json is still authoritative.
    const legacy = new DatabaseSync(path.join(directory, 'opencode.db'))
    legacy.exec('CREATE TABLE session (id TEXT)')
    legacy.close()
    await expect(discoverOpenCodeV2()).rejects.toThrow(
      'channel storage is ambiguous'
    )
  })

  it('resolves explicit, environment, XDG, default, and memory paths', () => {
    vi.stubEnv('XDG_DATA_HOME', fixture.directory)
    vi.stubEnv('OPENCODE_DB', 'custom.db')
    expect(opencodeV2DatabasePath()).toBe(
      path.join(fixture.directory, 'opencode', 'custom.db')
    )
    expect(opencodeV2DatabasePath(fixture.databasePath)).toBe(
      fs.realpathSync.native(fixture.databasePath)
    )
    vi.stubEnv('OPENCODE_DB', '')
    expect(opencodeV2DatabasePath()).toBe(
      path.join(fixture.directory, 'opencode', 'opencode.db')
    )
    vi.stubEnv('XDG_DATA_HOME', '')
    expect(opencodeV2DatabasePath()).toBe(
      path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
    )
    expect(opencodeV2DatabasePath('~/fixture.db')).toBe(
      path.join(os.homedir(), 'fixture.db')
    )
    expect(() => opencodeV2DatabasePath(':memory:')).toThrow('in-memory')
    expect(opencodeV2Identity(fixture.databasePath, 'id')).toBe(
      opencodeV2Identity(path.join(fixture.directory, '.', 'opencode.db'), 'id')
    )
  })

  it.each([
    'private@example.test',
    '\u001b[31mred',
    'eyJfixture.payload.signature',
    'Bearer private',
    'a'.repeat(40),
  ])('rejects sensitive display material', (value) => {
    expect(safeOpenCodeDisplay(value)).toBeUndefined()
  })
})
