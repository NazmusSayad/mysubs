import { z } from 'zod'
import { accountBaseSchema, providerBaseOptions } from '../../core/schema'

export const codexAccountSchema = z.union([
  accountBaseSchema.extend({
    configDir: z.string().min(1),
  }),
  accountBaseSchema.extend({
    adapter: z.literal('opencode-oauth'),
    authPath: z.string().min(1).optional(),
  }),
])

export type CodexAccount = z.infer<typeof codexAccountSchema>

export const codexOptionsSchema = providerBaseOptions.extend({})
