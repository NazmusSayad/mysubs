import { z } from 'zod'
import { accountBaseSchema, providerBaseOptions } from '../../core/schema'

export const claudeAccountSchema = accountBaseSchema.extend({
  configDir: z.string().min(1),
})

export const claudeOptionsSchema = providerBaseOptions.extend({})
