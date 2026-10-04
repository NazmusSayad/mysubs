import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { accountBaseSchema } from '../../core/schema'
import { codexAccountSchema } from './config'

describe('Codex adapter configuration', () => {
  it('preserves native and v1 configuration', () => {
    expect(codexAccountSchema.parse({ configDir: '~/.codex' })).toEqual({
      configDir: '~/.codex',
      __type: 'account',
    })
    expect(
      codexAccountSchema.parse({
        adapter: 'opencode-oauth',
        authPath: '~/auth.json',
        name: 'Work',
        info: false,
      })
    ).toEqual({
      adapter: 'opencode-oauth',
      authPath: '~/auth.json',
      name: 'Work',
      info: false,
      __type: 'account',
    })
    expect(
      codexAccountSchema.parse({ adapter: 'opencode-oauth' })
    ).toMatchObject({ adapter: 'opencode-oauth' })
  })

  it.each([
    {
      configDir: '~/.codex',
      adapter: 'opencode-oauth',
      authPath: '~/auth.json',
    },
    { configDir: '~/.codex', adapter: 'unknown-legacy-field' },
    { configDir: '~/.codex', adapter: 42 },
    { configDir: '~/.codex', adapter: null },
  ])(
    'preserves legacy parsing and native routing for mixed fields: %j',
    (account) => {
      const legacySchema = z.union([
        accountBaseSchema.extend({ configDir: z.string().min(1) }),
        accountBaseSchema.extend({
          adapter: z.literal('opencode-oauth'),
          authPath: z.string().min(1).optional(),
        }),
      ])
      expect(codexAccountSchema.parse(account)).toEqual(
        legacySchema.parse(account)
      )
      expect(codexAccountSchema.parse(account)).not.toHaveProperty('adapter')
    }
  )

  it('accepts a pinned separate v2 adapter', () => {
    expect(
      codexAccountSchema.parse({
        adapter: 'opencode-v2-oauth',
        credentialID: 'cred_fixture',
      })
    ).toMatchObject({
      adapter: 'opencode-v2-oauth',
      credentialID: 'cred_fixture',
    })
  })

  it('includes both adapters in the generated configuration schema', () => {
    const schema = JSON.stringify(
      z.toJSONSchema(codexAccountSchema, { io: 'input' })
    )
    expect(schema).toContain('opencode-v2-oauth')
    expect(schema).toContain('opencode-oauth')
    expect(schema).toContain('credentialID')
  })

  it.each([
    { adapter: 'opencode-v2-oauth' },
    { adapter: 'opencode-v2-oauth', configDir: '~/.codex' },
    {
      adapter: 'opencode-v2-oauth',
      credentialID: 'cred_fixture',
      configDir: '~/.codex',
    },
    {
      adapter: 'opencode-v2-oauth',
      credentialID: 'cred_fixture',
      authPath: '~/auth.json',
    },
    {
      adapter: 'opencode-v2-oauth',
      credentialID: 'cred_fixture',
      name: 'private@example.test',
    },
    {
      adapter: 'opencode-v2-oauth',
      credentialID: 'cred_fixture',
      info: 'Bearer fixture-secret',
    },
    {
      adapter: 'opencode-v2-oauth',
      credentialID: 'cred_fixture',
      name: '\u001b[31munsafe',
    },
  ])(
    'rejects invalid v2 configuration without falling through: %j',
    (account) => {
      expect(codexAccountSchema.safeParse(account).success).toBe(false)
    }
  )
})
