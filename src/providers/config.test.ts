import { describe, expect, it } from 'vitest'
import { claudeOptionsSchema } from './claude/config'
import { codexOptionsSchema } from './codex/config'
import { copilotOptionsSchema } from './copilot/config'
import { opencodeOptionsSchema } from './opencode/config'
import { openrouterOptionsSchema } from './openrouter/config'

describe('provider options', () => {
  it('enables detection by default', () => {
    expect(codexOptionsSchema.parse({}).detect).toBe(true)
    expect(claudeOptionsSchema.parse({}).detect).toBe(true)
    expect(copilotOptionsSchema.parse({}).detect).toBe(true)
    expect(openrouterOptionsSchema.parse({}).detect).toBe(true)
    expect(opencodeOptionsSchema.parse({}).detect).toBe(true)
  })

  it('allows detection to be disabled', () => {
    expect(codexOptionsSchema.parse({ detect: false }).detect).toBe(false)
    expect(claudeOptionsSchema.parse({ detect: false }).detect).toBe(false)
    expect(copilotOptionsSchema.parse({ detect: false }).detect).toBe(false)
    expect(openrouterOptionsSchema.parse({ detect: false }).detect).toBe(false)
    expect(opencodeOptionsSchema.parse({ detect: false }).detect).toBe(false)
  })
})
