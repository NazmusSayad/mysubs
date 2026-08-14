import { describe, expect, it } from 'vitest'
import { parseTTL } from './cache'

describe('parseTTL', () => {
  it('passes through finite non-negative numbers', () => {
    expect(parseTTL(0)).toBe(0)
    expect(parseTTL(5000)).toBe(5000)
  })

  it('parses duration strings', () => {
    expect(parseTTL('5m')).toBe(300_000)
    expect(parseTTL('1h')).toBe(3_600_000)
    expect(parseTTL('30s')).toBe(30_000)
  })

  it('rejects negative numbers', () => {
    expect(() => parseTTL(-1)).toThrow('invalid cacheTTL')
  })

  it('rejects non-finite numbers', () => {
    expect(() => parseTTL(Number.NaN)).toThrow('invalid cacheTTL')
    expect(() => parseTTL(Number.POSITIVE_INFINITY)).toThrow('invalid cacheTTL')
  })

  it('rejects unparseable strings', () => {
    expect(() => parseTTL('nonsense')).toThrow('invalid cacheTTL')
    expect(() => parseTTL('')).toThrow('invalid cacheTTL')
  })
})
