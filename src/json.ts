import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { accountEntrySchema, configSchema } from './core/config'
import { providers } from './providers'

type JSONObject = Record<string, unknown>

function isJSONObject(value: unknown): value is JSONObject {
  if (value === null) return false
  if (typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  return true
}

function clean(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) clean(item)
    return
  }

  if (!isJSONObject(node)) return

  if (node.type === 'object') {
    const properties = node.properties
    if (isJSONObject(properties)) delete properties.__type

    const required = node.required
    if (Array.isArray(required)) {
      const kept = required.filter((name) => name !== '__type')
      if (kept.length === 0) delete node.required
      if (kept.length > 0) node.required = kept
    }

    if (node.additionalProperties === undefined) {
      node.additionalProperties = false
    }
  }

  for (const value of Object.values(node)) clean(value)
}

const root = z.toJSONSchema(configSchema, { io: 'input' }) as JSONObject

const properties = root.properties
if (!isJSONObject(properties)) {
  throw new Error('the config schema did not produce an object with properties')
}

properties.$schema = { type: 'string' }

const entry = z.toJSONSchema(accountEntrySchema, { io: 'input' }) as JSONObject
const entryProperties = entry.properties
if (!isJSONObject(entryProperties)) {
  throw new Error('the account entry schema did not produce properties')
}
const {
  auto: autoProperty,
  alias: aliasProperty,
  cache: cacheProperty,
  name: nameProperty,
  info: infoProperty,
} = entryProperties

function addEntryProperties(node: JSONObject, provider: string): void {
  if (node.type === 'object') {
    const nodeProperties = node.properties
    if (!isJSONObject(nodeProperties)) {
      throw new Error(`the ${provider} account schema has no properties`)
    }
    node.properties = {
      provider: { const: provider },
      alias: aliasProperty,
      cache: cacheProperty,
      ...nodeProperties,
    }
    const required = Array.isArray(node.required) ? node.required : []
    node.required = ['provider', ...required]
    return
  }

  const variants = node.anyOf ?? node.oneOf
  if (!Array.isArray(variants)) {
    throw new Error(`the ${provider} account schema has an unexpected shape`)
  }
  for (const variant of variants) {
    if (!isJSONObject(variant)) {
      throw new Error(`the ${provider} account schema has an unexpected shape`)
    }
    addEntryProperties(variant, provider)
  }
}

const accountVariants: JSONObject[] = []

for (const [name, provider] of Object.entries(providers)) {
  const account = z.toJSONSchema(provider.accountSchema, {
    io: 'input',
  }) as JSONObject
  delete account.$schema
  addEntryProperties(account, name)

  accountVariants.push(account, {
    type: 'object',
    properties: {
      provider: { const: name },
      auto: autoProperty,
      alias: aliasProperty,
      cache: cacheProperty,
      name: nameProperty,
      info: infoProperty,
    },
    required: ['provider', 'auto'],
  })
}

properties.accounts = {
  type: 'array',
  items: { anyOf: accountVariants },
}

clean(root)

const outputPath = path.resolve('./schema.json')

if (fs.existsSync(outputPath)) {
  fs.rmSync(outputPath)
}

fs.writeFileSync(outputPath, `${JSON.stringify(root, null, 2)}\n`)
