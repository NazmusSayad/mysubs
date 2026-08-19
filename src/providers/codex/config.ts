import { z } from 'zod'
import { accountBaseSchema, providerBaseOptions } from '../../core/schema'

export const codexAccountSchema = accountBaseSchema.extend({
  configDir: z.string().min(1),
})

export const codexOptionsSchema = providerBaseOptions.extend({})
