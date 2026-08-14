import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandHome } from './path'

describe('expandHome', () => {
  it('expands a bare tilde to the home directory', () => {
    expect(expandHome('~')).toBe(os.homedir())
  })

  it('expands a tilde prefix', () => {
    expect(expandHome('~/.codex')).toBe(path.join(os.homedir(), '.codex'))
    expect(expandHome('~/a/b/c')).toBe(path.join(os.homedir(), 'a/b/c'))
  })

  it('leaves absolute and relative paths untouched', () => {
    expect(expandHome('/etc/mysubs')).toBe('/etc/mysubs')
    expect(expandHome('./local')).toBe('./local')
  })

  it('does not expand a tilde that is not a home reference', () => {
    expect(expandHome('~someone/dir')).toBe('~someone/dir')
    expect(expandHome('')).toBe('')
  })
})
