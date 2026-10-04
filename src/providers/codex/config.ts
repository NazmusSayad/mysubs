import { z } from 'zod'
import { accountBaseSchema, providerBaseOptions } from '../../core/schema'
import { safeOpenCodeDisplay } from './opencode-v2-auth'

const safeDisplaySchema = z
  .string()
  .min(1)
  .refine(
    (value) => safeOpenCodeDisplay(value) !== undefined,
    'Use a display label without email addresses, secrets, or control characters'
  )

export const opencodeV2AccountSchema = accountBaseSchema.extend({
  adapter: z.literal('opencode-v2-oauth'),
  databasePath: z.string().min(1).optional(),
  credentialID: z.string().min(1),
  name: safeDisplaySchema.optional(),
  info: z.union([safeDisplaySchema, z.literal(false)]).optional(),
  configDir: z.never().optional(),
  authPath: z.never().optional(),
})

export const codexAccountSchema = z.union([
  opencodeV2AccountSchema,
  accountBaseSchema
    .extend({
      configDir: z.string().min(1),
      // Legacy native accounts historically ignored this field. Only the new
      // v2 discriminant must be prevented from falling through to this branch.
      adapter: z.unknown().optional(),
    })
    .refine((account) => account.adapter !== 'opencode-v2-oauth')
    .transform(({ adapter: _adapter, ...account }) => account),
  accountBaseSchema.extend({
    adapter: z.literal('opencode-oauth'),
    authPath: z.string().min(1).optional(),
  }),
])

export type CodexAccount = z.infer<typeof codexAccountSchema>

export const codexOptionsSchema = providerBaseOptions.extend({})
