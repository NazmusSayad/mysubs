import { z } from 'zod'
import { providerBaseOptions } from '../../core/schema'
import { secretRefSchema } from '../../lib/secret'

export const openrouterAccountSchema = z.object({
  name: z.string().min(1).optional(),
  apiKey: secretRefSchema,
  __type: z.literal('account').default('account'),
})

export const openrouterOptionsSchema = providerBaseOptions.extend({})
