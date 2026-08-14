import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCopilotAccount } from '.'
import type { ProviderAccount, ProviderOptions } from '../../core/types'

const options: ProviderOptions = { cache: true, __type: 'options' }
const account: ProviderAccount = {
  source: 'token',
  token: 'env:COPILOT_TEST_TOKEN',
  __type: 'account',
}

function snapshot(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    overage_count: 0,
    overage_permitted: false,
    quota_remaining: 0,
    has_quota: true,
    quota_reset_at: 0,
    token_based_billing: true,
    credits_used: 0,
    overage_entitlement: 0,
    ...fields,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Copilot provider', () => {
  it('maps the credit pool and hides unlimited buckets', async () => {
    vi.stubEnv('COPILOT_TEST_TOKEN', 'gho_test')
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          login: 'octocat',
          copilot_plan: 'individual',
          token_based_billing: true,
          quota_reset_date: '2026-09-01',
          quota_reset_date_utc: '2026-09-01T00:00:00.000Z',
          quota_snapshots: {
            chat: snapshot({
              percent_remaining: 100,
              unlimited: true,
              remaining: 0,
              entitlement: 0,
            }),
            completions: snapshot({
              percent_remaining: 100,
              unlimited: true,
              remaining: 0,
              entitlement: 0,
            }),
            premium_interactions: snapshot({
              percent_remaining: 99.6,
              unlimited: false,
              remaining: 199,
              entitlement: 200,
            }),
          },
        })
      )
    )
    vi.stubGlobal('fetch', fetch)

    const result = await fetchCopilotAccount(account, options)

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'token gho_test',
          'X-Github-Api-Version': '2025-04-01',
        }),
      })
    )
    expect(result.accountInfo).toBe('octocat')
    expect(result.accountPlan).toBe('Individual')
    expect(Object.keys(result.usage ?? {})).toEqual(['credits'])
    expect(result.usage?.credits).toMatchObject({
      kind: 'consumption',
      unit: 'percent',
      used: expect.closeTo(0.4, 10),
      limit: 100,
      remaining: expect.closeTo(99.6, 10),
      resetsAt: '2026-09-01T00:00:00.000Z',
    })
  })

  it('maps free-tier chat and completions quotas', async () => {
    vi.stubEnv('COPILOT_TEST_TOKEN', 'gho_test')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            copilot_plan: 'free',
            limited_user_reset_date: '2026-09-01',
            limited_user_quotas: { chat: 30, completions: 1000 },
            monthly_quotas: { chat: 50, completions: 2000 },
          })
        )
      )
    )

    const result = await fetchCopilotAccount(account, options)

    expect(result.accountPlan).toBe('Free')
    expect(result.usage).toMatchObject({
      chat: { used: 40, remaining: 60, resetsAt: '2026-09-01T00:00:00.000Z' },
      completions: { used: 50, remaining: 50 },
    })
  })

  it('keeps the plan when an org-managed seat reports no quota', async () => {
    vi.stubEnv('COPILOT_TEST_TOKEN', 'gho_test')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            copilot_plan: 'copilot_enterprise_seat',
            token_based_billing: true,
            quota_snapshots: {
              premium_interactions: snapshot({
                percent_remaining: 100,
                remaining: 0,
                entitlement: 0,
              }),
            },
          })
        )
      )
    )

    const result = await fetchCopilotAccount(account, options)

    expect(result.error).toBeUndefined()
    expect(result.accountPlan).toBe('Copilot Enterprise Seat')
    expect(result.usage).toEqual({})
  })

  it('reports an invalid token instead of throwing', async () => {
    vi.stubEnv('COPILOT_TEST_TOKEN', 'gho_test')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    )

    const result = await fetchCopilotAccount(account, options)

    expect(result.error).toBe(
      'github token invalid or expired, run `gh auth login`'
    )
    expect(result.usage).toBeUndefined()
  })
})
