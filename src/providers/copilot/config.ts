import { z } from 'zod'
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

export const copilotOptionsSchema = z.object({
  cache: z.boolean().default(true),
  __type: z.literal('options').default('options'),
})
