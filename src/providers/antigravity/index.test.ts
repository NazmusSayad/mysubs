import { describe, expect, it } from 'vitest'
import { parseQuota } from '.'

const summary = {
  response: {
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          {
            bucketId: 'gemini-weekly',
            window: 'weekly',
            remainingFraction: 0.25,
            resetTime: '2026-08-26T04:47:08Z',
          },
          { bucketId: 'gemini-5h', window: '5h', remainingFraction: 1 },
        ],
      },
      {
        displayName: 'Claude and GPT models',
        buckets: [
          { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.5 },
          { bucketId: '3p-5h', window: '5h', remainingFraction: 0 },
        ],
      },
    ],
  },
}

describe('Antigravity provider', () => {
  it('maps the four quota buckets in display order', () => {
    const usage = parseQuota(JSON.stringify(summary))

    expect(Object.keys(usage ?? {})).toEqual([
      'geminiSession',
      'geminiWeekly',
      'otherSession',
      'otherWeekly',
    ])
    expect(usage?.geminiWeekly).toEqual({
      kind: 'consumption',
      unit: 'percent',
      used: 75,
      limit: 100,
      remaining: 25,
      utilization: 0.75,
      windowSeconds: 604800,
      resetsAt: '2026-08-26T04:47:08.000Z',
    })
    expect(usage?.geminiSession?.used).toBe(0)
    expect(usage?.otherSession?.used).toBe(100)
    expect(usage?.geminiSession?.windowSeconds).toBe(18000)
  })

  it('drops buckets without a usable fraction and unknown bucket ids', () => {
    const usage = parseQuota(
      JSON.stringify({
        response: {
          groups: [
            {
              buckets: [
                { bucketId: 'gemini-5h', remainingFraction: 0.5 },
                { bucketId: 'gemini-weekly' },
                { bucketId: 'gemini-image-5h', remainingFraction: 0.1 },
              ],
            },
          ],
        },
      })
    )

    expect(Object.keys(usage ?? {})).toEqual(['geminiSession'])
  })

  it('rejects a response that carries no quota groups', () => {
    expect(parseQuota('{"userStatus":{}}')).toBeNull()
    expect(parseQuota('not json')).toBeNull()
  })
})
