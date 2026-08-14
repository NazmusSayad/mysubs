import { z } from 'zod'
import { providerBaseOptions } from '../../core/schema'
import { secretRefSchema } from '../../lib/secret'

const commonAccountSchema = {
  name: z.string().min(1).optional(),
  __type: z.literal('account').default('account'),
}

export const copilotAccountSchema = z.discriminatedUnion('source', [
  z.object({
    ...commonAccountSchema,
    source: z.literal('token'),
    token: secretRefSchema,
  }),
  z.object({
    ...commonAccountSchema,
    source: z.literal('gh'),
  }),
])

export const copilotOptionsSchema = providerBaseOptions.extend({})
