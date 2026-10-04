import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCodexAccount } from '.'
import type { ProviderAccount, ProviderOptions } from '../../core/types'
import { createFixture, credentialValue } from './test-fixture'

const options: ProviderOptions = {
  cache: true,
  detect: true,
  __type: 'options',
}
let fixture: ReturnType<typeof createFixture>
let account: ProviderAccount
beforeEach(() => {
  fixture = createFixture()
  fixture.add('cred_fixture', credentialValue(), 1, 1, 'Work')
  account = {
    adapter: 'opencode-v2-oauth',
    databasePath: fixture.databasePath,
    credentialID: 'cred_fixture',
    __type: 'account',
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  fixture.cleanup()
})

function usageResponse() {
  return new Response(
    JSON.stringify({
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 18000,
          reset_at: 1_800_000_000,
        },
        secondary_window: { used_percent: 10, limit_window_seconds: 604800 },
      },
      additional_rate_limits: [
        {
          limit_name: 'GPT Spark',
          rate_limit: {
            primary_window: { used_percent: 5, limit_window_seconds: 18000 },
          },
        },
      ],
    })
  )
}

describe('OpenCode v2 Codex usage', () => {
  it('uses only a bounded usage GET and maps actual fields without credential mutation', async () => {
    const snapshot = fixture.snapshot()
    const fetch = vi.fn().mockResolvedValue(usageResponse())
    vi.stubGlobal('fetch', fetch)
    const result = await fetchCodexAccount(account, options)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer fixture-access',
          Accept: 'application/json',
          'User-Agent': 'mysubs',
          'ChatGPT-Account-Id': 'fixture-account',
        },
      })
    )
    expect(result).toMatchObject({
      provider: 'codex',
      accountPlan: 'Plus',
      sourceName: 'Work',
      sourceActive: true,
      usage: {
        session: {
          used: 25,
          remaining: 75,
          resetsAt: '2027-01-15T08:00:00.000Z',
        },
        weekly: { used: 10 },
        'gpt-spark': { used: 5 },
      },
    })
    expect(fixture.snapshot()).toEqual(snapshot)
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-access|fixture-refresh|fixture-account/
    )
  })

  it('does not invent missing values or send another account scope', async () => {
    fixture.owner
      .prepare('UPDATE credential SET value = ?')
      .run(JSON.stringify(credentialValue({ metadata: {} })))
    const fetch = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const result = await fetchCodexAccount(account, options)
    expect(fetch.mock.calls[0]?.[1].headers).not.toHaveProperty(
      'ChatGPT-Account-Id'
    )
    expect(result.usage).toEqual({})
    expect(result.accountPlan).toBeUndefined()
  })

  it('never refreshes stale credentials, even with a valid refresh token', async () => {
    fixture.owner
      .prepare('UPDATE credential SET value = ?')
      .run(JSON.stringify(credentialValue({ expires: Date.now() - 1 })))
    const snapshot = fixture.snapshot()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect((await fetchCodexAccount(account, options)).error).toContain(
      'needs renewal by OpenCode'
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(fixture.snapshot()).toEqual(snapshot)
  })

  it.each([401, 403, 429, 500])(
    'does not redeem, write, or echo bodies on HTTP %s',
    async (status) => {
      const snapshot = fixture.snapshot()
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response('private@example.test fixture-access', { status })
        )
      vi.stubGlobal('fetch', fetch)
      const result = await fetchCodexAccount(account, options)
      expect(result.error).toContain(`HTTP ${String(status)}`)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fixture.snapshot()).toEqual(snapshot)
      expect(JSON.stringify(result)).not.toMatch(/@|fixture-access/)
    }
  )

  it('rereads once after 401 and uses only an owner-published replacement', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => {
        fixture.owner
          .prepare('UPDATE credential SET value = ?, active = 0, label = ?')
          .run(
            JSON.stringify(credentialValue({ access: 'owner-new-access' })),
            'Renamed'
          )
        fixture.add('key', { type: 'key', key: 'fixture-key' }, 1)
        return new Response('', { status: 401 })
      })
      .mockResolvedValueOnce(usageResponse())
    vi.stubGlobal('fetch', fetch)
    const result = await fetchCodexAccount(account, options)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[1].headers.Authorization).toBe(
      'Bearer owner-new-access'
    )
    expect(result).toMatchObject({ sourceName: 'Renamed', sourceActive: false })
  })

  it('keeps replacement retries bounded even if a second request fails', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => {
        fixture.owner
          .prepare('UPDATE credential SET value = ?')
          .run(JSON.stringify(credentialValue({ access: 'owner-new-access' })))
        return new Response('', { status: 401 })
      })
      .mockResolvedValue(new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    expect((await fetchCodexAccount(account, options)).error).toContain(
      'HTTP 401'
    )
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['deleted', 'unsupported', 'expired'])(
    'does not recover a %s row from a stale snapshot',
    async (replacement) => {
      const fetch = vi.fn().mockImplementation(() => {
        if (replacement === 'deleted')
          fixture.owner.exec('DELETE FROM credential')
        else
          fixture.owner
            .prepare('UPDATE credential SET value = ?')
            .run(
              JSON.stringify(
                credentialValue(
                  replacement === 'expired'
                    ? { access: 'changed', expires: 0 }
                    : { methodID: 'chatgpt-token-sharing', access: 'changed' }
                )
              )
            )
        return new Response('', { status: 401 })
      })
      vi.stubGlobal('fetch', fetch)
      expect((await fetchCodexAccount(account, options)).error).toBeDefined()
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('never retries 403 even when the owner replaces a token', async () => {
    const fetch = vi.fn().mockImplementation(() => {
      fixture.owner
        .prepare('UPDATE credential SET value = ?')
        .run(JSON.stringify(credentialValue({ access: 'changed' })))
      return new Response('', { status: 403 })
    })
    vi.stubGlobal('fetch', fetch)
    expect((await fetchCodexAccount(account, options)).error).toContain(
      'HTTP 403'
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sanitizes network, parsing, and API display errors', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('Bearer fixture-access private@example.test')
      )
      .mockResolvedValueOnce(new Response('private@example.test'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            plan_type: 'private@example.test',
            additional_rate_limits: [{ limit_name: 'Bearer fixture-access' }],
          })
        )
      )
    vi.stubGlobal('fetch', fetch)
    for (let index = 0; index < 3; index++) {
      expect(
        JSON.stringify(await fetchCodexAccount(account, options))
      ).not.toMatch(/@|fixture-access/)
    }
  })

  it('cannot fall through a malformed v2 config to native/v1 refresh', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(
      (
        await fetchCodexAccount(
          { ...account, configDir: fixture.directory },
          options
        )
      ).error
    ).toContain('invalid configuration')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('existing Codex adapters', () => {
  it('preserves explicit v1 refresh and write-back', async () => {
    const authPath = path.join(fixture.directory, 'auth.json')
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        openai: {
          type: 'oauth',
          access: 'old',
          refresh: 'old-refresh',
          expires: 1,
        },
        other: { keep: true },
      })
    )
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'refreshed-access',
            refresh_token: 'rotated-refresh',
            expires_in: 3600,
          })
        )
      )
      .mockResolvedValueOnce(usageResponse())
    vi.stubGlobal('fetch', fetch)
    const result = await fetchCodexAccount(
      { adapter: 'opencode-oauth', authPath, __type: 'account' },
      options
    )
    expect(result.error).toBeUndefined()
    expect(fetch.mock.calls[0]?.[0]).toBe('https://auth.openai.com/oauth/token')
    expect(JSON.parse(fs.readFileSync(authPath, 'utf8'))).toMatchObject({
      openai: { access: 'refreshed-access', refresh: 'rotated-refresh' },
      other: { keep: true },
    })
  })

  it('preserves native Codex usage', async () => {
    fs.writeFileSync(
      path.join(fixture.directory, 'auth.json'),
      JSON.stringify({
        tokens: {
          access_token: 'native-access',
          refresh_token: 'native-refresh',
        },
      })
    )
    const fetch = vi.fn().mockResolvedValue(usageResponse())
    vi.stubGlobal('fetch', fetch)
    expect(
      (
        await fetchCodexAccount(
          { configDir: fixture.directory, __type: 'account' },
          options
        )
      ).accountPlan
    ).toBe('Plus')
    expect(fetch.mock.calls[0]?.[1].headers.Authorization).toBe(
      'Bearer native-access'
    )
  })
})
