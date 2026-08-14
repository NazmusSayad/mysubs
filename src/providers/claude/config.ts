import { z } from 'zod'
import { colorSchema } from '../../utils/color'

export const claudeConfigSchema = z.object({
  accounts: z.array(
    z.object({
      name: z.string().min(1).optional(),
      configDir: z.string().min(1),
      color: colorSchema.optional(),
    })
  ),
})

export type ClaudeConfig = z.infer<typeof claudeConfigSchema>
export type ClaudeAccount = ClaudeConfig['accounts'][number]
