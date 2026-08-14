import { z } from 'zod'
import { colorSchema } from '../../utils/color'

export const claudeAccountSchema = z.object({
  name: z.string().min(1).optional(),
  configDir: z.string().min(1),
  color: colorSchema.optional(),
})

export type ClaudeAccount = z.infer<typeof claudeAccountSchema>
