import { z } from 'zod'
import { accountBaseSchema, providerBaseOptions } from '../../core/schema'
import { secretRefSchema } from '../../lib/secret'

export const copilotAccountSchema = z.discriminatedUnion('source', [
  z.object({
    ...accountBaseSchema.shape,
    source: z.literal('token'),
    token: secretRefSchema,
  }),
  z.object({
    ...accountBaseSchema.shape,
    source: z.literal('gh'),
  }),
])

export const copilotOptionsSchema = providerBaseOptions.extend({})
