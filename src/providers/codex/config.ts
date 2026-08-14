import { z } from 'zod'

export const codexAccountSchema = z.object({
  name: z.string().min(1).optional(),
  configDir: z.string().min(1),
  __type: z.literal('account').default('account'),
})

export const codexOptionsSchema = z.object({
  cache: z.boolean().default(true),
  __type: z.literal('options').default('options'),
})
