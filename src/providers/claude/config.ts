import { z } from 'zod'
import { providerBaseOptions } from '../../core/schema'

export const claudeAccountSchema = z.object({
  name: z.string().min(1).optional(),
  configDir: z.string().min(1),
  __type: z.literal('account').default('account'),
})

export const claudeOptionsSchema = providerBaseOptions.extend({})
