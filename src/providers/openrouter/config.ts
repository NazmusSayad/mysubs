import { accountBaseSchema, providerBaseOptions } from '../../core/schema'
import { secretRefSchema } from '../../lib/secret'

export const openrouterAccountSchema = accountBaseSchema.extend({
  apiKey: secretRefSchema,
})

export const openrouterOptionsSchema = providerBaseOptions.extend({})
