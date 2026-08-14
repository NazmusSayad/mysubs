import { describe, expect, it } from 'vitest'
import { usageColor } from './color'

const CONTRAST = 0.4

function channels(hex: string): { red: number; green: number; blue: number } {
  return {
    red: parseInt(hex.slice(1, 3), 16),
    green: parseInt(hex.slice(3, 5), 16),
    blue: parseInt(hex.slice(5, 7), 16),
  }
}

function spread(hex: string): number {
  const { red, green, blue } = channels(hex)
  return Math.max(red, green, blue) - Math.min(red, green, blue)
}

describe('usageColor', () => {
  it('returns a hex color', () => {
    expect(usageColor(0.5, CONTRAST)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('is red when nothing is used', () => {
    const { red, green, blue } = channels(usageColor(0, CONTRAST))
    expect(red).toBeGreaterThan(green)
    expect(red).toBeGreaterThan(blue)
  })

  it('is green when everything is used', () => {
    const { red, green, blue } = channels(usageColor(1, CONTRAST))
    expect(green).toBeGreaterThan(red)
    expect(green).toBeGreaterThan(blue)
  })

  it('is warm and bright in the middle', () => {
    const { red, green, blue } = channels(usageColor(0.5, CONTRAST))
    expect(red).toBeGreaterThan(blue)
    expect(green).toBeGreaterThan(blue)
  })

  it('gets greener as usage climbs', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((ratio) =>
      channels(usageColor(ratio, CONTRAST))
    )
    for (let index = 1; index < steps.length; index++) {
      const previous = steps[index - 1]
      const current = steps[index]
      if (previous === undefined) throw new Error('missing step')
      if (current === undefined) throw new Error('missing step')
      expect(current.green).toBeGreaterThanOrEqual(previous.green)
      expect(current.red).toBeLessThanOrEqual(previous.red)
    }
  })

  it('makes colors bolder as contrast rises', () => {
    expect(spread(usageColor(0, 0.8))).toBeGreaterThan(
      spread(usageColor(0, 0.4))
    )
    expect(spread(usageColor(0, 0.4))).toBeGreaterThan(
      spread(usageColor(0, 0.1))
    )
  })

  it('is grey at zero contrast', () => {
    expect(usageColor(0, 0)).toBe(usageColor(1, 0))
    expect(spread(usageColor(0.5, 0))).toBe(0)
  })

  it('clamps values outside 0..1', () => {
    expect(usageColor(-1, CONTRAST)).toBe(usageColor(0, CONTRAST))
    expect(usageColor(4, CONTRAST)).toBe(usageColor(1, CONTRAST))
    expect(usageColor(0.5, 9)).toBe(usageColor(0.5, 1))
  })

  it('rejects values that are not numbers', () => {
    expect(() => usageColor(Number.NaN, CONTRAST)).toThrow(
      'invalid usage ratio'
    )
    expect(() => usageColor(0.5, Number.NaN)).toThrow('invalid contrast')
  })
})
