import { z } from 'zod'
import { accountBaseSchema, providerBaseOptions } from '../../core/schema'
import { secretRefSchema } from '../../lib/secret'

export const opencodeAccountSchema = z.discriminatedUnion('product', [
  z.object({
    ...accountBaseSchema.shape,
    product: z.literal('go'),
    apiKey: secretRefSchema,
  }),
  z.object({
    ...accountBaseSchema.shape,
    product: z.literal('zen'),
    cookie: secretRefSchema,
    workspaceID: z.string().min(1).optional(),
  }),
])

export const opencodeOptionsSchema = providerBaseOptions.extend({})
