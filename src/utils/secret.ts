import { z } from 'zod'
import { getKey } from './keyring'

export const secretRefSchema = z
  .string()
  .regex(
    /^(env|key):[A-Za-z0-9_]+$/,
    'must be "env:<ENV_NAME>" or "key:<KEYRING_NAME>", never a raw secret'
  )

export function resolveSecret(ref: string): string {
  const separator = ref.indexOf(':')
  const scheme = ref.slice(0, separator)
  const name = ref.slice(separator + 1)

  if (scheme === 'env') {
    const value = process.env[name]
    if (value === undefined) {
      throw new Error(`environment variable ${name} is not set`)
    }
    if (value === '') {
      throw new Error(`environment variable ${name} is empty`)
    }
    return value
  }

  if (scheme === 'key') {
    const value = getKey(name)
    if (value === null) {
      throw new Error(
        `no keyring entry named ${name}, run \`mysubs key set ${name}\``
      )
    }
    return value
  }

  throw new Error(
    `invalid secret reference "${ref}", expected "env:<ENV_NAME>" or "key:<KEYRING_NAME>"`
  )
}
