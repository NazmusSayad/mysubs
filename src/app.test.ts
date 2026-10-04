import { createHash } from 'node:crypto'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectAccountTargets,
  resolveAccount,
  runUsage,
  selectAccountTargets,
} from './app'
import { loadConfig, type Config } from './core/config'
import { render } from './core/render'
import type {
  AccountUsageResult,
  ProviderAccount,
  ProviderOptions,
} from './core/types'
import { readCodexAccountMetadata } from './providers/codex'
import { createFixture, credentialValue } from './providers/codex/test-fixture'

const memory = vi.hoisted(() => ({
  cache: new Map<string, AccountUsageResult>(),
}))
vi.mock('./core/config', async (original) => ({
  ...(await original<typeof import('./core/config')>()),
  loadConfig: vi.fn(),
}))
vi.mock('./providers', async (original) => {
  const { providers } = await original<typeof import('./providers')>()
  return { providers: { codex: providers.codex } }
})
vi.mock('./lib/crypto', () => ({
  cacheKey: (provider: string, account: ProviderAccount) =>
    createHash('sha256')
      .update(provider + JSON.stringify(account))
      .digest('hex'),
}))
vi.mock('./utils/cache', async (original) => ({
  ...(await original<typeof import('./utils/cache')>()),
  readCache: (key: string) => memory.cache.get(key) ?? null,
  writeCache: (key: string, _expires: number, result: AccountUsageResult) =>
    memory.cache.set(key, structuredClone(result)),
}))

const options: ProviderOptions = {
  cache: true,
  detect: true,
  __type: 'options',
}
let fixture: ReturnType<typeof createFixture>
let config: Config
beforeEach(() => {
  fixture = createFixture()
  vi.stubEnv('OPENCODE_DB', fixture.databasePath)
  vi.stubEnv('CODEX_HOME', path.join(fixture.directory, 'no-native'))
  fixture.add('cred_a', credentialValue(), 1, 1, 'Work')
  fixture.add('cred_b', credentialValue(), 0, 2, 'Personal')
  config = {
    detect: true,
    cacheTTL: '1m',
    contrast: 0.4,
    nerdFont: false,
    maxWidth: 120,
    accounts: {},
    options: { codex: options },
  }
  vi.mocked(loadConfig).mockReturnValue(config)
  memory.cache.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            plan_type: 'plus',
            rate_limit: {
              primary_window: {
                used_percent: 25,
                limit_window_seconds: 18000,
              },
            },
          })
        )
    )
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fixture.cleanup()
})

describe('v2 account selection, display, and cache integration', () => {
  it('exposes ID selectors while retaining codex: as all detected accounts', async () => {
    const targets = await collectAccountTargets(config)
    expect(selectAccountTargets(targets, ['codex:'])).toHaveLength(2)
    expect(selectAccountTargets(targets, ['codex:cred_b'])).toMatchObject([
      { sourceKey: 'cred_b', sourceName: 'Personal' },
    ])
    expect(() => selectAccountTargets(targets, ['codex:Personal'])).toThrow(
      'no configured account'
    )
  })

  it('makes manual keys authoritative without changing detected-only selection', async () => {
    config.accounts.codex = {
      cred_a: {
        adapter: 'opencode-v2-oauth',
        credentialID: 'cred_b',
        name: 'Manual',
        __type: 'account',
      },
    }
    const targets = await collectAccountTargets(config)
    expect(selectAccountTargets(targets, ['codex:cred_a'])).toMatchObject([
      { sourceType: 'manual', account: { credentialID: 'cred_b' } },
    ])
    expect(selectAccountTargets(targets, ['codex:'])).toHaveLength(2)
  })

  it('keeps configured accounts additive, as with other providers', async () => {
    config.accounts.codex = {
      work: {
        adapter: 'opencode-v2-oauth',
        credentialID: 'cred_a',
        databasePath: fixture.databasePath,
        name: 'Manual Work',
        info: false,
        __type: 'account',
      },
    }
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runUsage({ json: true })
    const results = JSON.parse(
      String(stdout.mock.calls[0]?.[0])
    ) as AccountUsageResult[]
    expect(results).toHaveLength(3)
    expect(results.find((item) => item.sourceName === 'Work')).toMatchObject({
      sourceActive: true,
    })
    expect(
      results.find((item) => item.sourceName === 'Manual Work')
    ).toMatchObject({ sourceType: 'manual', sourceActive: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('refreshes label and active metadata on usage-cache hits without another GET', async () => {
    const targets = await collectAccountTargets(config)
    const target = targets.find((item) => item.sourceKey === 'cred_a')!
    expect(await resolveAccount(target, 60_000, false, false)).toMatchObject({
      cached: false,
      sourceName: 'Work',
      sourceActive: true,
    })
    fixture.owner
      .prepare('UPDATE credential SET label = ?, active = 0 WHERE id = ?')
      .run('Renamed', 'cred_a')
    fixture.owner
      .prepare('UPDATE credential SET active = 1 WHERE id = ?')
      .run('cred_b')
    const result = await resolveAccount(target, 60_000, false, false)
    expect(result).toMatchObject({
      cached: true,
      sourceName: 'Renamed',
      sourceActive: false,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(render([result], 0.4, false, 120)).not.toContain('[active]')
    expect(
      render([{ ...result, sourceActive: true }], 0.4, false, 120)
    ).toContain('[active]')
  })

  it('keeps cache identity stable across token rotations and presentation overrides', async () => {
    const targets = await collectAccountTargets(config)
    const detected = targets.find((item) => item.sourceKey === 'cred_a')!
    await resolveAccount(detected, 60_000, false, false)
    fixture.owner
      .prepare('UPDATE credential SET value = ? WHERE id = ?')
      .run(
        JSON.stringify(credentialValue({ access: 'owner-rotated' })),
        'cred_a'
      )
    const manual = {
      ...detected,
      sourceName: 'Manual Work',
      sourceType: 'manual' as const,
      account: {
        adapter: 'opencode-v2-oauth',
        credentialID: 'cred_a',
        name: 'Manual Work',
        info: 'Alias',
        __type: 'account' as const,
      },
    }
    expect(await resolveAccount(manual, 60_000, false, false)).toMatchObject({
      cached: true,
      sourceName: 'Manual Work',
      accountInfo: 'Alias',
      sourceType: 'manual',
    })
    expect(
      await resolveAccount(detected, 60_000, false, false)
    ).not.toHaveProperty('accountInfo')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(memory.cache.size).toBe(1)
    expect(JSON.stringify([...memory.cache.values()])).not.toMatch(
      /fixture-access|refresh|@|Manual Work|Alias|sourceActive/
    )
  })

  it.each(['deleted', 'unsupported', 'expired'])(
    'does not serve cached usage for a %s pinned row',
    async (change) => {
      const account: ProviderAccount = {
        adapter: 'opencode-v2-oauth',
        credentialID: 'cred_a',
        name: 'Pinned',
        __type: 'account',
      }
      const target = {
        provider: 'codex',
        account,
        options,
        sourceName: 'Pinned',
        sourceType: 'manual' as const,
      }
      await resolveAccount(target, 60_000, false, false)
      if (change === 'deleted')
        fixture.owner
          .prepare('DELETE FROM credential WHERE id = ?')
          .run('cred_a')
      else
        fixture.owner
          .prepare('UPDATE credential SET value = ? WHERE id = ?')
          .run(
            JSON.stringify(
              credentialValue(
                change === 'expired'
                  ? { expires: 0 }
                  : { methodID: 'chatgpt-token-sharing' }
              )
            ),
            'cred_a'
          )
      const result = await resolveAccount(target, 60_000, false, false)
      expect(result).toMatchObject({
        cached: false,
        sourceName: 'Pinned',
        error: expect.any(String),
      })
      expect(result.usage).toBeUndefined()
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps failed accounts independent and renders safe error labels', async () => {
    fixture.owner
      .prepare('UPDATE credential SET value = ?, label = ? WHERE id = ?')
      .run(
        JSON.stringify(credentialValue({ expires: 0 })),
        'private@example.test',
        'cred_a'
      )
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runUsage({ json: true })
    const text = String(stdout.mock.calls[0]?.[0])
    const results = JSON.parse(text) as AccountUsageResult[]
    expect(results).toHaveLength(2)
    expect(results.filter((item) => item.error === undefined)).toHaveLength(1)
    expect(results.find((item) => item.error !== undefined)).toMatchObject({
      sourceName: expect.stringMatching(/^OpenCode /),
      sourceActive: true,
    })
    expect(text).not.toMatch(/@|fixture-access|fixture-refresh/)
  })

  it('uses fresher provider metadata after a 401 owner replacement', async () => {
    const target = (await collectAccountTargets(config)).find(
      (item) => item.sourceKey === 'cred_a'
    )!
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => {
          fixture.owner
            .prepare(
              'UPDATE credential SET value = ?, label = ?, active = 0 WHERE id = ?'
            )
            .run(
              JSON.stringify(credentialValue({ access: 'changed' })),
              'Owner renamed',
              'cred_a'
            )
          fixture.owner
            .prepare('UPDATE credential SET active = 1 WHERE id = ?')
            .run('cred_b')
          return new Response('', { status: 401 })
        })
        .mockResolvedValueOnce(new Response('{}'))
    )
    expect(await resolveAccount(target, 60_000, true, false)).toMatchObject({
      sourceName: 'Owner renamed',
      sourceActive: false,
    })
  })

  it('does not read metadata for native/v1 targets', async () => {
    expect(
      await readCodexAccountMetadata({
        adapter: 'opencode-oauth',
        __type: 'account',
      })
    ).toBeUndefined()
    expect(
      await readCodexAccountMetadata({
        configDir: fixture.directory,
        __type: 'account',
      })
    ).toBeUndefined()
  })

  it('does not let an inaccessible manually configured source stop other accounts', async () => {
    config.accounts.codex = {
      broken: {
        adapter: 'opencode-v2-oauth',
        databasePath: ':memory:',
        credentialID: 'cred_missing',
        __type: 'account',
      },
    }
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runUsage({ json: true })
    const results = JSON.parse(
      String(stdout.mock.calls[0]?.[0])
    ) as AccountUsageResult[]
    expect(results).toHaveLength(3)
    expect(results.filter((result) => result.error === undefined)).toHaveLength(
      2
    )
    expect(results.find((result) => result.error !== undefined)).toMatchObject({
      sourceName: expect.stringMatching(/^OpenCode /),
      error: expect.stringContaining('in-memory'),
    })
  })

  it('preserves existing cache-hit behavior for adapters without metadata', async () => {
    const account: ProviderAccount = {
      configDir: fixture.directory,
      __type: 'account',
      info: 'Current info',
    }
    const key = createHash('sha256')
      .update('codex' + JSON.stringify(account))
      .digest('hex')
    memory.cache.set(key, {
      provider: 'codex',
      cached: false,
      sourceName: 'Old name',
      accountInfo: 'Old info',
      usage: {},
    })
    expect(
      await resolveAccount(
        {
          provider: 'codex',
          account,
          options,
          sourceName: 'Current name',
          sourceType: 'manual',
        },
        60_000,
        false,
        false
      )
    ).toMatchObject({
      cached: true,
      sourceName: 'Old name',
      accountInfo: 'Old info',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
