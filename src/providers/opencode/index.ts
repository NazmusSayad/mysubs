import { z } from 'zod'
import type {
  AccountSubscriptionConsumptionUsage,
  AccountUsageResult,
  ProviderAccount,
  ProviderOptions,
} from '../../core/types'
import { resolveSecret } from '../../lib/secret'
import { opencodeAccountSchema } from './config'

const GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const SERVER_URL = 'https://opencode.ai/_server'
const WORKSPACES_FUNCTION_ID =
  'def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f'
const SUBSCRIPTION_FUNCTION_ID =
  '7abeebee372f304e050aaaf92be863f4a86490e382f8c79db68fd94040d691b4'

const goUsageSchema = z.object({
  usage: z.object({
    rolling: z.object({ percent: z.number(), resetsAt: z.string().optional() }),
    weekly: z.object({ percent: z.number(), resetsAt: z.string().optional() }),
    monthly: z.object({ percent: z.number(), resetsAt: z.string().optional() }),
  }),
})

type UsageResource = AccountSubscriptionConsumptionUsage

function percentageResource(percent: number, resetsAt?: string): UsageResource {
  const used = Math.max(0, Math.min(100, percent))
  const resource: UsageResource = {
    kind: 'consumption',
    unit: 'percent',
    used,
    limit: 100,
    remaining: 100 - used,
    utilization: used / 100,
  }
  if (resetsAt !== undefined) resource.resetsAt = resetsAt
  return resource
}

async function fetchGoUsage(
  apiKey: string
): Promise<Record<string, UsageResource>> {
  let response: Response
  try {
    response = await fetch(GO_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })
  } catch {
    throw new Error("couldn't reach opencode, check your connection")
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('OpenCode Go API key is invalid')
  }
  if (!response.ok) {
    throw new Error(
      `opencode go request failed (HTTP ${String(response.status)})`
    )
  }

  const parsed = goUsageSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error('opencode go response was not in the expected shape')
  }

  return {
    rolling: percentageResource(
      parsed.data.usage.rolling.percent,
      parsed.data.usage.rolling.resetsAt
    ),
    weekly: percentageResource(
      parsed.data.usage.weekly.percent,
      parsed.data.usage.weekly.resetsAt
    ),
    monthly: percentageResource(
      parsed.data.usage.monthly.percent,
      parsed.data.usage.monthly.resetsAt
    ),
  }
}

function serverHeaders(
  cookie: string,
  functionID: string,
  referer: string
): Record<string, string> {
  return {
    Cookie: cookie,
    'X-Server-Id': functionID,
    'X-Server-Instance': `server-fn:${crypto.randomUUID()}`,
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    Origin: 'https://opencode.ai',
    Referer: referer,
    Accept: 'text/javascript, application/json;q=0.9, */*;q=0.8',
  }
}

async function fetchServer(
  cookie: string,
  functionID: string,
  referer: string,
  args: string[]
): Promise<string> {
  const params = new URLSearchParams({ id: functionID })
  if (args.length > 0) params.set('args', JSON.stringify(args))

  let response: Response
  try {
    response = await fetch(`${SERVER_URL}?${params.toString()}`, {
      headers: serverHeaders(cookie, functionID, referer),
    })
  } catch {
    throw new Error("couldn't reach opencode, check your connection")
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('OpenCode Zen cookie is invalid or expired')
  }
  if (!response.ok) {
    throw new Error(
      `opencode zen request failed (HTTP ${String(response.status)})`
    )
  }
  return response.text()
}

function workspaceIDFrom(text: string): string | null {
  const match = /id\s*:\s*["'](wrk_[^"']+)["']/.exec(text)
  if (match?.[1] !== undefined) return match[1]

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = z.unknown().safeParse(body)

  const queue: unknown[] = [parsed.data]
  while (queue.length > 0) {
    const value = queue.shift()
    if (typeof value === 'string' && value.startsWith('wrk_')) return value
    if (Array.isArray(value)) queue.push(...value)
    if (typeof value === 'object' && value !== null)
      queue.push(...Object.values(value))
  }
  return null
}

function subscriptionWindow(
  text: string,
  name: string
): {
  percent: number
  resetInSec?: number
} | null {
  const block = new RegExp(
    `["']?${name}["']?\\s*[:=]\\s*\\{([\\s\\S]*?)\\}`
  ).exec(text)
  if (block?.[1] === undefined) return null
  const percent = /["']?usagePercent["']?\s*[:=]\s*([0-9.]+)/.exec(
    block[1]
  )?.[1]
  if (percent === undefined) return null
  const reset = /["']?resetInSec["']?\s*[:=]\s*([0-9.]+)/.exec(block[1])?.[1]
  return {
    percent: Number(percent),
    resetInSec: reset === undefined ? undefined : Number(reset),
  }
}

function subscriptionWindows(text: string): {
  rolling: { percent: number; resetInSec?: number }
  weekly: { percent: number; resetInSec?: number } | null
} {
  const rolling = subscriptionWindow(text, 'rollingUsage')
  if (rolling === null || !Number.isFinite(rolling.percent)) {
    throw new Error('opencode zen response was not in the expected shape')
  }
  const weekly = subscriptionWindow(text, 'weeklyUsage')
  if (weekly !== null && !Number.isFinite(weekly.percent)) {
    throw new Error('opencode zen response was not in the expected shape')
  }
  return { rolling, weekly }
}

async function fetchZenUsage(
  cookie: string,
  workspaceID: string | undefined
): Promise<Record<string, UsageResource>> {
  let workspace = workspaceID
  if (workspace === undefined) {
    const text = await fetchServer(
      cookie,
      WORKSPACES_FUNCTION_ID,
      'https://opencode.ai',
      []
    )
    workspace = workspaceIDFrom(text) ?? undefined
  }
  if (workspace === undefined) {
    throw new Error('could not determine an OpenCode Zen workspace')
  }

  const windows = subscriptionWindows(
    await fetchServer(
      cookie,
      SUBSCRIPTION_FUNCTION_ID,
      `https://opencode.ai/workspace/${workspace}/billing`,
      [workspace]
    )
  )
  const usage: Record<string, UsageResource> = {
    rolling: percentageResource(
      windows.rolling.percent,
      windows.rolling.resetInSec === undefined
        ? undefined
        : new Date(Date.now() + windows.rolling.resetInSec * 1000).toISOString()
    ),
  }
  if (windows.weekly !== null) {
    usage.weekly = percentageResource(
      windows.weekly.percent,
      windows.weekly.resetInSec === undefined
        ? undefined
        : new Date(Date.now() + windows.weekly.resetInSec * 1000).toISOString()
    )
  }
  return usage
}

export async function fetchOpenCodeAccount(
  account: ProviderAccount,
  _options: ProviderOptions
): Promise<AccountUsageResult> {
  try {
    const parsed = opencodeAccountSchema.parse(account)
    const usage =
      parsed.product === 'go'
        ? await fetchGoUsage(resolveSecret(parsed.apiKey))
        : await fetchZenUsage(resolveSecret(parsed.cookie), parsed.workspaceID)
    return {
      provider: 'opencode',
      cached: false,
      usage,
    }
  } catch (error) {
    return {
      provider: 'opencode',
      cached: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
