import { z } from 'zod'
import { colorSchema } from '../../utils/color'

export const codexConfigSchema = z.object({
  accounts: z.array(
    z.object({
      name: z.string().min(1).optional(),
      configDir: z.string().min(1),
      color: colorSchema.optional(),
    })
  ),
})

export type CodexConfig = z.infer<typeof codexConfigSchema>
export type CodexAccount = CodexConfig['accounts'][number]
