import { z } from 'zod'
import { colorSchema } from '../../utils/color'
import { secretRefSchema } from '../../utils/secret'

export const openrouterAccountSchema = z.object({
  name: z.string().min(1).optional(),
  apiKey: secretRefSchema,
  color: colorSchema.optional(),
})

export type OpenRouterAccount = z.infer<typeof openrouterAccountSchema>
