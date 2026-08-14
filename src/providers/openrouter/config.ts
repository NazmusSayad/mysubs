import { z } from 'zod'
import { colorSchema } from '../../utils/color'
import { secretRefSchema } from '../../utils/secret'

export const openrouterConfigSchema = z.object({
  accounts: z.array(
    z.object({
      name: z.string().min(1).optional(),
      apiKey: secretRefSchema,
      color: colorSchema.optional(),
    })
  ),
})

export type OpenRouterConfig = z.infer<typeof openrouterConfigSchema>
export type OpenRouterAccount = OpenRouterConfig['accounts'][number]
