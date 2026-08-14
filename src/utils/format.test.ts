import { describe, expect, it } from 'vitest'
import { formatDuration, formatMoney, formatPercent } from './format'

describe('formatMoney', () => {
  it('uses two decimals for ordinary amounts', () => {
    expect(formatMoney(25.18)).toBe('$25.18')
    expect(formatMoney(1.5)).toBe('$1.50')
    expect(formatMoney(13.648550753)).toBe('$13.65')
  })

  it('uses two decimals for exactly zero', () => {
    expect(formatMoney(0)).toBe('$0.00')
  })

  it('uses four decimals for non-zero amounts below a cent', () => {
    expect(formatMoney(0.005)).toBe('$0.0050')
    expect(formatMoney(0.000088)).toBe('$0.0001')
  })

  it('keeps the four decimal rule for small negative amounts', () => {
    expect(formatMoney(-0.005)).toBe('$-0.0050')
    expect(formatMoney(-2.5)).toBe('$-2.50')
  })
})

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(78.83945619689923)).toBe('79%')
    expect(formatPercent(3.9088813)).toBe('4%')
  })

  it('rounds half upward', () => {
    expect(formatPercent(99.5)).toBe('100%')
  })
})

describe('formatDuration', () => {
  it('reports minutes under an hour', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(23 * 60_000)).toBe('23m')
  })

  it('reports hours and minutes under a day', () => {
    expect(formatDuration(90 * 60_000)).toBe('1h 30m')
    expect(formatDuration(23 * 60 * 60_000)).toBe('23h 0m')
  })

  it('reports days and hours beyond a day', () => {
    expect(formatDuration(8940 * 60_000)).toBe('6d 5h')
    expect(formatDuration(4 * 24 * 60 * 60_000 + 18 * 60 * 60_000)).toBe(
      '4d 18h'
    )
  })

  it('clamps negative durations to zero', () => {
    expect(formatDuration(-5000)).toBe('0m')
  })
})
