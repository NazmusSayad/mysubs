import { afterEach, describe, expect, it, vi } from 'vitest'
import { startProgress } from './progress'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function spyOnStderr() {
  return vi.spyOn(process.stderr, 'write').mockReturnValue(true)
}

describe('startProgress', () => {
  it('draws once immediately and again on every tick', () => {
    vi.useFakeTimers()
    const write = spyOnStderr()

    const stop = startProgress('codex')
    expect(write).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(360)
    expect(write).toHaveBeenCalledTimes(4)

    stop()
  })

  it('includes the label and the elapsed seconds', () => {
    vi.useFakeTimers()
    const write = spyOnStderr()

    const stop = startProgress('claude:work')
    vi.advanceTimersByTime(2500)
    stop()

    const frames = write.mock.calls.map((call) => String(call[0]))
    expect(frames[0]).toContain('connecting claude:work 0s')
    expect(frames.join('')).toContain('claude:work 1s')
    expect(frames.join('')).toContain('claude:work 2s')
  })

  it('cycles through the activity labels', () => {
    vi.useFakeTimers()
    const write = spyOnStderr()

    const stop = startProgress('codex')
    vi.advanceTimersByTime(120 * 8)
    stop()

    const output = write.mock.calls.map((call) => String(call[0])).join('')
    expect(output).toContain('connecting')
    expect(output).toContain('requesting usage')
    expect(output).toContain('waiting for response')
  })

  it('wraps frame and activity indexes without throwing', () => {
    vi.useFakeTimers()
    spyOnStderr()

    const stop = startProgress('codex')
    expect(() => vi.advanceTimersByTime(120 * 40)).not.toThrow()
    stop()
  })

  it('stops drawing and clears the line once stopped', () => {
    vi.useFakeTimers()
    const write = spyOnStderr()

    const stop = startProgress('codex')
    vi.advanceTimersByTime(240)
    stop()

    const callsAtStop = write.mock.calls.length
    expect(String(write.mock.calls.at(-1)?.[0])).toBe(
      `\r${String.fromCharCode(27)}[2K`
    )

    vi.advanceTimersByTime(5000)
    expect(write).toHaveBeenCalledTimes(callsAtStop)
  })
})
