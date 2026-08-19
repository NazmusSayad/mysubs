import { z } from 'zod'
import { accountBaseSchema, providerBaseOptions } from '../../core/schema'

export const antigravityAccountSchema = accountBaseSchema.extend({
  cliPath: z.string().min(1).optional(),
})

export const antigravityOptionsSchema = providerBaseOptions.extend({})
