import { z } from 'zod'
import { providerBaseOptions } from '../../core/schema'
import { secretRefSchema } from '../../lib/secret'

const commonAccountSchema = {
  name: z.string().min(1).optional(),
  __type: z.literal('account').default('account'),
}

export const opencodeAccountSchema = z.discriminatedUnion('product', [
  z.object({
    ...commonAccountSchema,
    product: z.literal('go'),
    apiKey: secretRefSchema,
  }),
  z.object({
    ...commonAccountSchema,
    product: z.literal('zen'),
    cookie: secretRefSchema,
    workspaceID: z.string().min(1).optional(),
  }),
])

export const opencodeOptionsSchema = providerBaseOptions.extend({})
