import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSecret, secretRefSchema } from './secret'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveSecret env references', () => {
  it('returns the environment variable value', () => {
    vi.stubEnv('MYSUBS_TEST_KEY', 'sk-example')
    expect(resolveSecret('env:MYSUBS_TEST_KEY')).toBe('sk-example')
  })

  it('throws when the variable is unset', () => {
    vi.stubEnv('MYSUBS_TEST_KEY', undefined)
    expect(() => resolveSecret('env:MYSUBS_TEST_KEY')).toThrow(
      'environment variable MYSUBS_TEST_KEY is not set'
    )
  })

  it('throws when the variable is empty', () => {
    vi.stubEnv('MYSUBS_TEST_KEY', '')
    expect(() => resolveSecret('env:MYSUBS_TEST_KEY')).toThrow(
      'environment variable MYSUBS_TEST_KEY is empty'
    )
  })
})

describe('resolveSecret invalid references', () => {
  it('rejects an unknown scheme', () => {
    expect(() => resolveSecret('file:/tmp/token')).toThrow(
      'invalid secret reference'
    )
  })

  it('rejects a reference with no scheme', () => {
    expect(() => resolveSecret('sk-raw-secret')).toThrow(
      'invalid secret reference'
    )
  })
})

describe('secretRefSchema', () => {
  it('accepts env and key references', () => {
    expect(secretRefSchema.safeParse('env:OPENROUTER_API_KEY').success).toBe(
      true
    )
    expect(secretRefSchema.safeParse('key:openrouter').success).toBe(true)
  })

  it('rejects raw secrets and unknown schemes', () => {
    expect(secretRefSchema.safeParse('sk-or-v1-abc123').success).toBe(false)
    expect(secretRefSchema.safeParse('file:/tmp/token').success).toBe(false)
    expect(secretRefSchema.safeParse('env:has-dashes').success).toBe(false)
  })
})
