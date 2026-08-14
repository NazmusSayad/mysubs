import { z } from 'zod'
import { colorSchema } from '../../lib/color'
import { secretRefSchema } from '../../lib/secret'

const commonAccountSchema = {
  name: z.string().min(1).optional(),
  color: colorSchema.optional(),
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

export const opencodeOptionsSchema = z.object({
  cache: z.boolean().default(true),
  __type: z.literal('options').default('options'),
})
