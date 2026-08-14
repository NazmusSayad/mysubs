import ms, { type StringValue } from 'ms'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { accountUsageResultSchema } from '../core/schema'
import type { AccountUsageResult } from '../core/types'

const cacheEntrySchema = z
  .object({
    expiresAt: z.int().gte(0),
    value: accountUsageResultSchema,
  })
  .strict()
const cacheKeySchema = z.string().regex(/^[a-f0-9]{64}$/)
const cacheRootSchema = z.record(z.string(), z.unknown())

export function cachePath(): string {
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg !== undefined && xdg !== '') {
    return path.join(xdg, 'mysubs', 'cache.json')
  }
  return path.join(os.homedir(), '.cache', 'mysubs', 'cache.json')
}

export function parseTTL(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid cacheTTL: ${value}`)
    }
    return value
  }

  let parsed: number | undefined
  try {
    parsed = ms(value as StringValue)
  } catch {
    throw new Error(`invalid cacheTTL: "${value}"`)
  }

  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid cacheTTL: "${value}"`)
  }
  return parsed
}

function readAll(): Record<
  string,
  { expiresAt: number; value: AccountUsageResult }
> {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(cachePath(), 'utf8'))
  } catch {
    return {}
  }

  const parsed = cacheRootSchema.safeParse(raw)
  if (!parsed.success) return {}

  const entries: Record<
    string,
    { expiresAt: number; value: AccountUsageResult }
  > = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!cacheKeySchema.safeParse(key).success) continue
    const entry = cacheEntrySchema.safeParse(value)
    if (!entry.success) continue
    entries[key] = entry.data
  }
  return entries
}

export function readCache(
  key: string,
  provider: string
): AccountUsageResult | null {
  const entry = readAll()[key]
  if (entry === undefined) return null
  if (entry.expiresAt <= Date.now()) return null
  if (entry.value.provider !== provider) return null
  return entry.value
}

export function writeCache(
  key: string,
  expiresAt: number,
  value: AccountUsageResult
): void {
  const entries = readAll()
  entries[key] = { expiresAt, value }

  const target = cachePath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, target)
}
