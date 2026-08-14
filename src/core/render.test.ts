import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { render } from './render'
import type { AccountUsageResult } from './types'

const originalColumns = process.stdout.columns

beforeAll(() => {
  Object.defineProperty(process.stdout, 'columns', {
    value: 100,
    configurable: true,
    writable: true,
  })
})

afterAll(() => {
  Object.defineProperty(process.stdout, 'columns', {
    value: originalColumns,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function freezeClock(): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-14T12:00:00.000Z'))
}

const codexResult: AccountUsageResult = {
  provider: 'codex',
  cached: true,
  color: '#72317b',
  accountInfo: 'Theo Bennett',
  accountPlan: 'Plus',
  usage: {
    weekly: {
      kind: 'consumption',
      unit: 'percent',
      used: 20,
      limit: 100,
      remaining: 80,
      utilization: 0.2,
      windowSeconds: 604800,
      resetsAt: '2026-08-20T12:31:37.000Z',
    },
    credits: { kind: 'balance', unit: 'credits', available: 0 },
    creditValue: { kind: 'balance', unit: 'usd', available: 0 },
  },
}

const openrouterResult: AccountUsageResult = {
  provider: 'openrouter',
  cached: false,
  color: '#6467f2',
  accountInfo: 'primary key',
  accountPlan: 'Pay as you go',
  usage: {
    credits: {
      kind: 'consumption',
      unit: 'usd',
      used: 50.851449247,
      limit: 64.5,
      remaining: 13.648550753,
      utilization: 0.7883945619689923,
    },
    balance: { kind: 'balance', unit: 'usd', available: 13.648550753 },
    today: { kind: 'consumption', unit: 'usd', used: 0.039088813 },
    week: { kind: 'consumption', unit: 'usd', used: 0.281608805 },
    month: { kind: 'consumption', unit: 'usd', used: 0.443907683 },
    dailyLimit: {
      kind: 'consumption',
      unit: 'usd',
      used: 0.039088813,
      limit: 1,
      remaining: 0.960911187,
      utilization: 0.039088813,
    },
  },
}

function claudeAccount(sourceName: string, used: number): AccountUsageResult {
  return {
    provider: 'claude',
    cached: false,
    color: '#d97757',
    sourceName,
    accountInfo: 'WebMakker',
    accountPlan: 'Pro',
    sourceType: 'manual',
    usage: {
      session: {
        kind: 'consumption',
        unit: 'percent',
        used,
        limit: 100,
        remaining: 100 - used,
        utilization: used / 100,
      },
    },
  }
}

describe('render', () => {
  it('returns an empty string for no results', () => {
    expect(render([])).toBe('')
  })

  it('renders a consumption bar, reset detail and credit substitution', () => {
    freezeClock()
    expect(render([codexResult])).toMatchInlineSnapshot(`
      "
       codex
         Theo Bennett · Plus ♲ cached
           weekly   ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  20%  6d 0h
           credits  $0.00
      "
    `)
  })

  it('renders balances, a usd bar with remaining, and the spend summary', () => {
    freezeClock()
    expect(render([openrouterResult])).toMatchInlineSnapshot(`
      "
       openrouter
         primary key · Pay as you go
           credits      ██████████████████████████████████████████████████░░░░░░░░░░░░░  79%  $13.65 left
           daily limit  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   4%  $0.96 left
           spend        today $0.04   week $0.28   month $0.44
      "
    `)
  })

  it('renders an error row instead of usage', () => {
    freezeClock()
    expect(
      render([
        {
          provider: 'claude',
          cached: false,
          color: '#d97757',
          error: 'session expired, run `claude` to log in again',
        },
      ])
    ).toMatchInlineSnapshot(`
      "
       claude
         claude
           error  session expired, run \`claude\` to log in again
      "
    `)
  })

  it('renders a placeholder when there is no usage data', () => {
    freezeClock()
    expect(
      render([
        { provider: 'codex', cached: false, color: '#72317b', usage: {} },
      ])
    ).toMatchInlineSnapshot(`
      "
       codex
         codex
             no usage data
      "
    `)
  })

  it('prints one provider heading for several accounts in a single call', () => {
    freezeClock()
    const output = render([
      claudeAccount('work', 40),
      claudeAccount('home', 12),
    ])
    expect(
      output.split('\n').filter((line) => line.trim() === 'claude')
    ).toHaveLength(1)
    expect(output).toMatchInlineSnapshot(`
      "
       claude
         work  WebMakker · Pro
           session  ████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  40%

         home  WebMakker · Pro
           session  ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12%
      "
    `)
  })

  it('repeats the provider heading when no previous provider is passed', () => {
    freezeClock()
    const combined = [
      render([claudeAccount('work', 40)]),
      render([claudeAccount('home', 12)]),
    ].join('\n')
    expect(
      combined.split('\n').filter((line) => line.trim() === 'claude')
    ).toHaveLength(2)
  })

  it('prints one heading when the previous provider is carried between calls', () => {
    freezeClock()
    const combined = [
      render([claudeAccount('work', 40)], null),
      render([claudeAccount('home', 12)], 'claude'),
    ].join('\n')
    expect(
      combined.split('\n').filter((line) => line.trim() === 'claude')
    ).toHaveLength(1)
  })

  it('still prints a heading when the previous provider differs', () => {
    freezeClock()
    const output = render([claudeAccount('work', 40)], 'codex')
    expect(
      output.split('\n').filter((line) => line.trim() === 'claude')
    ).toHaveLength(1)
  })
})
