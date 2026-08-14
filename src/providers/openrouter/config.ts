import { z } from 'zod'
import { secretRefSchema } from '../../lib/secret'

export const openrouterAccountSchema = z.object({
  name: z.string().min(1).optional(),
  apiKey: secretRefSchema,
  __type: z.literal('account').default('account'),
})

export const openrouterOptionsSchema = z.object({
  cache: z.boolean().default(true),
  __type: z.literal('options').default('options'),
})
