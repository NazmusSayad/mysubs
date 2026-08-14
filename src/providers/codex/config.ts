import { z } from 'zod'
import { colorSchema } from '../../utils/color'

export const codexAccountSchema = z.object({
  name: z.string().min(1).optional(),
  configDir: z.string().min(1),
  color: colorSchema.optional(),
})

export type CodexAccount = z.infer<typeof codexAccountSchema>
