import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOpenCodeAccount } from '.'
import type { ProviderAccount, ProviderOptions } from '../../core/types'

const options: ProviderOptions = { cache: true, __type: 'options' }

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('OpenCode provider', () => {
  it('maps Go usage with its bearer key', async () => {
    vi.stubEnv('OPENCODE_GO_TEST_KEY', 'go-key')
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            rolling: { percent: 12, resetsAt: '2026-08-15T00:00:00.000Z' },
            weekly: { percent: 8, resetsAt: '2026-08-16T00:00:00.000Z' },
            monthly: { percent: 35, resetsAt: '2026-09-01T00:00:00.000Z' },
          },
        })
      )
    )
    vi.stubGlobal('fetch', fetch)
    const account: ProviderAccount = {
      product: 'go',
      apiKey: 'env:OPENCODE_GO_TEST_KEY',
      __type: 'account',
    }

    const result = await fetchOpenCodeAccount(account, options)

    expect(fetch).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer go-key' }),
      })
    )
    expect(result.usage).toMatchObject({
      rolling: { used: 12, remaining: 88 },
      weekly: { used: 8, remaining: 92 },
      monthly: { used: 35, remaining: 65 },
    })
  })

  it('maps Zen subscription windows with its workspace cookie', async () => {
    vi.stubEnv('OPENCODE_ZEN_TEST_COOKIE', 'session=secret')
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'rollingUsage:{usagePercent:12,resetInSec:300},weeklyUsage:{usagePercent:8,resetInSec:600}'
        )
      )
    vi.stubGlobal('fetch', fetch)
    const account: ProviderAccount = {
      product: 'zen',
      cookie: 'env:OPENCODE_ZEN_TEST_COOKIE',
      workspaceID: 'wrk_test',
      __type: 'account',
    }

    const result = await fetchOpenCodeAccount(account, options)

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('args=%5B%22wrk_test%22%5D'),
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'session=secret' }),
      })
    )
    expect(result.usage).toMatchObject({
      rolling: { used: 12, remaining: 88 },
      weekly: { used: 8, remaining: 92 },
    })
  })
})
