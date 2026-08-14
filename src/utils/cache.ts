import ms, { type StringValue } from 'ms'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type CacheEntry = { fetchedAt: number; usage: unknown }

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

  const parsed = ms(value as StringValue)
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid cacheTTL: "${value}"`)
  }
  return parsed
}

function readAll(): Record<string, CacheEntry> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath(), 'utf8'))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    return parsed as Record<string, CacheEntry>
  } catch {
    return {}
  }
}

export function readCache(key: string, ttlMs: number): unknown {
  const entry = readAll()[key]
  if (entry === undefined) return null
  if (typeof entry.fetchedAt !== 'number') return null
  if (Date.now() - entry.fetchedAt >= ttlMs) return null
  return entry.usage
}

export function writeCache(key: string, usage: unknown): void {
  const all = readAll()
  all[key] = { fetchedAt: Date.now(), usage }

  const target = cachePath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(all, null, 2))
}
