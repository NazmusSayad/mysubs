import { z } from 'zod'
import { colorSchema } from '../../utils/color'

export const claudeAccountSchema = z.object({
  name: z.string().min(1).optional(),
  configDir: z.string().min(1),
  color: colorSchema.optional(),
  __type: z.literal('account').default('account'),
})

export const claudeOptionsSchema = z.object({
  cache: z.boolean().default(true),
  __type: z.literal('options').default('options'),
})
