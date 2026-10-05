import { z } from 'zod'
import { accountBaseSchema, providerBaseOptions } from '../../core/schema'

export const opencode2CodexAccountSchema = accountBaseSchema.extend({
  credentialID: z.string().min(1),
  databasePath: z.string().min(1).optional(),
})

export const opencode2CodexOptionsSchema = providerBaseOptions.extend({})
