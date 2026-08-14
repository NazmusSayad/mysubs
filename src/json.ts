import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { configSchema } from './core/config'
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

    node.additionalProperties = false
  }

  for (const value of Object.values(node)) clean(value)
}

const root = z.toJSONSchema(configSchema, { io: 'input' }) as JSONObject

const properties = root.properties
if (!isJSONObject(properties)) {
  throw new Error('the config schema did not produce an object with properties')
}

properties.$schema = { type: 'string' }

for (const [name, entry] of Object.entries(providers)) {
  const options = z.toJSONSchema(entry.optionsSchema, {
    io: 'input',
  }) as JSONObject
  const account = z.toJSONSchema(entry.accountSchema, {
    io: 'input',
  }) as JSONObject

  delete options.$schema
  delete account.$schema

  const optionProperties = options.properties
  if (!isJSONObject(optionProperties)) {
    throw new Error(`the ${name} options schema did not produce properties`)
  }

  properties[name] = {
    type: 'object',
    properties: {
      ...optionProperties,
      accounts: { type: 'array', items: account },
    },
  }
}

clean(root)

const outputPath = path.resolve('./schema.json')

if (fs.existsSync(outputPath)) {
  fs.rmSync(outputPath)
}

fs.writeFileSync(outputPath, `${JSON.stringify(root, null, 2)}\n`)
