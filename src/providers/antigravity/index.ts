import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import { z } from 'zod'
import type {
  AccountSubscriptionConsumptionUsage,
  AccountUsageResult,
  ProviderAccount,
  ProviderOptions,
} from '../../core/types'
import { expandHome } from '../../utils/path'
import { antigravityAccountSchema } from './config'
import { resolveCliPath } from './detect'

const LS_SERVICE = 'exa.language_server_pb.LanguageServerService'
const LS_METADATA = {
  metadata: {
    ideName: 'antigravity',
    extensionName: 'antigravity',
    ideVersion: 'unknown',
    locale: 'en',
  },
}
const REQUEST_TIMEOUT_MS = 5000
const READY_TIMEOUT_MS = 30000
const POLL_INTERVAL_MS = 300
const PROCESS_TIMEOUT_MS = 5000
const SESSION_WINDOW_SECONDS = 18000
const WEEKLY_WINDOW_SECONDS = 604800

const BUCKETS = [
  { id: 'gemini-5h', key: 'session', windowSeconds: SESSION_WINDOW_SECONDS },
  { id: 'gemini-weekly', key: 'weekly', windowSeconds: WEEKLY_WINDOW_SECONDS },
  { id: '3p-5h', key: 'other', windowSeconds: SESSION_WINDOW_SECONDS },
  { id: '3p-weekly', key: 'otherWeekly', windowSeconds: WEEKLY_WINDOW_SECONDS },
]

const quotaSummarySchema = z.object({
  response: z
    .object({
      groups: z
        .array(
          z.object({
            buckets: z
              .array(
                z.object({
                  bucketId: z.string().nullish(),
                  remainingFraction: z.number().nullish(),
                  resetTime: z.string().nullish(),
                })
              )
              .nullish(),
          })
        )
        .nullish(),
    })
    .nullish(),
})

const userStatusSchema = z.object({
  userStatus: z
    .object({
      userTier: z.object({ name: z.string().nullish() }).nullish(),
      planStatus: z
        .object({
          planInfo: z.object({ planName: z.string().nullish() }).nullish(),
        })
        .nullish(),
    })
    .nullish(),
})

type Endpoint = { scheme: 'http' | 'https'; port: number }
type LocalResponse = { status: number; body: string }

function postLocal(
  endpoint: Endpoint,
  method: string
): Promise<LocalResponse | null> {
  const body = JSON.stringify(LS_METADATA)
  const options = {
    host: '127.0.0.1',
    port: endpoint.port,
    method: 'POST',
    path: `/${LS_SERVICE}/${method}`,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'Content-Length': Buffer.byteLength(body),
    },
    // The language server serves loopback-only HTTPS with a self-signed cert.
    rejectUnauthorized: false,
  }

  return new Promise((resolve) => {
    const client = endpoint.scheme === 'https' ? https : http
    const request = client.request(options, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    request.on('error', () => resolve(null))
    request.on('timeout', () => {
      request.destroy()
      resolve(null)
    })
    request.end(body)
  })
}

function processTable(): { pid: number; parent: number; command: string }[] {
  const result = spawnSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    timeout: PROCESS_TIMEOUT_MS,
  })
  if (result.status !== 0) return []

  const rows: { pid: number; parent: number; command: string }[] = []
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (match === null) continue
    rows.push({
      pid: Number(match[1]),
      parent: Number(match[2]),
      command: match[3] ?? '',
    })
  }
  return rows
}

function descendants(root: number): number[] {
  const rows = processTable()
  const found = [root]

  for (let index = 0; index < found.length; index += 1) {
    const parent = found[index]
    for (const row of rows) {
      if (row.parent === parent && !found.includes(row.pid)) {
        found.push(row.pid)
      }
    }
  }
  return found
}

function listeningPorts(pid: number): number[] {
  const result = spawnSync(
    'lsof',
    ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)],
    { encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS }
  )
  if (result.status !== 0) return []

  const ports: number[] = []
  for (const match of result.stdout.matchAll(/:(\d+)\s+\(LISTEN\)/g)) {
    const port = Number(match[1])
    if (!ports.includes(port)) ports.push(port)
  }
  return ports
}

async function quotaEndpoint(pids: number[]): Promise<Endpoint | null> {
  for (const pid of pids) {
    for (const port of listeningPorts(pid)) {
      for (const scheme of ['https', 'http'] as const) {
        const endpoint = { scheme, port }
        const response = await postLocal(endpoint, 'RetrieveUserQuotaSummary')
        if (response === null) continue
        if (response.status !== 200) continue
        if (parseQuota(response.body) !== null) return endpoint
      }
    }
  }
  return null
}

function runningCliPids(cliPath: string): number[] {
  const pids: number[] = []
  for (const row of processTable()) {
    if (row.command.includes(cliPath)) pids.push(row.pid)
  }
  return pids
}

function spawnCli(cliPath: string): number | null {
  // The CLI only serves quota while it believes a terminal is attached, so it runs
  // under `script`, which allocates one without a native dependency.
  if (process.platform === 'darwin') {
    const child = spawn('/usr/bin/script', ['-q', '/dev/null', cliPath], {
      stdio: 'ignore',
    })
    return child.pid ?? null
  }
  if (process.platform === 'linux') {
    const child = spawn('script', ['-qec', cliPath, '/dev/null'], {
      stdio: 'ignore',
    })
    return child.pid ?? null
  }
  throw new Error(`antigravity is not supported on ${process.platform}`)
}

function killTree(root: number): void {
  for (const pid of descendants(root).reverse()) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForEndpoint(root: number): Promise<Endpoint> {
  const deadline = Date.now() + READY_TIMEOUT_MS

  while (Date.now() < deadline) {
    const endpoint = await quotaEndpoint(descendants(root))
    if (endpoint !== null) return endpoint
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(
    'the antigravity local server did not become ready, run `antigravity` and sign in, then try again'
  )
}

export function parseQuota(
  body: string
): Record<string, AccountSubscriptionConsumptionUsage> | null {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return null
  }

  const parsed = quotaSummarySchema.safeParse(raw)
  if (!parsed.success) return null

  const groups = parsed.data.response?.groups
  if (groups === undefined || groups === null) return null

  const buckets = groups.flatMap((group) => group.buckets ?? [])
  const usage: Record<string, AccountSubscriptionConsumptionUsage> = {}

  for (const spec of BUCKETS) {
    const bucket = buckets.find((entry) => entry.bucketId === spec.id)
    if (bucket === undefined) continue

    const fraction = bucket.remainingFraction
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) continue

    const remainingPercent = Math.max(0, Math.min(1, fraction)) * 100
    const used = 100 - remainingPercent
    const resource: AccountSubscriptionConsumptionUsage = {
      kind: 'consumption',
      unit: 'percent',
      used,
      limit: 100,
      remaining: remainingPercent,
      utilization: used / 100,
      windowSeconds: spec.windowSeconds,
    }

    const resetTime = bucket.resetTime
    if (typeof resetTime === 'string') {
      const at = Date.parse(resetTime)
      if (!Number.isNaN(at)) resource.resetsAt = new Date(at).toISOString()
    }

    usage[spec.key] = resource
  }

  if (Object.keys(usage).length === 0) return null
  return usage
}

async function fetchPlan(endpoint: Endpoint): Promise<string | null> {
  const response = await postLocal(endpoint, 'GetUserStatus')
  if (response === null) return null
  if (response.status !== 200) return null

  let raw: unknown
  try {
    raw = JSON.parse(response.body)
  } catch {
    return null
  }

  const parsed = userStatusSchema.safeParse(raw)
  if (!parsed.success) return null

  const status = parsed.data.userStatus
  const tier = status?.userTier?.name ?? status?.planStatus?.planInfo?.planName
  if (typeof tier !== 'string') return null

  const trimmed = tier.trim()
  if (trimmed === '') return null
  return trimmed
}

async function fetchUsage(
  account: z.infer<typeof antigravityAccountSchema>
): Promise<AccountUsageResult> {
  const cliPath =
    account.cliPath === undefined
      ? resolveCliPath()
      : expandHome(account.cliPath)
  if (cliPath === null) {
    throw new Error(
      'antigravity CLI not found, install it or set ANTIGRAVITY_CLI_PATH'
    )
  }

  const running = await quotaEndpoint(runningCliPids(cliPath))
  if (running !== null) return await readUsage(running)

  const root = spawnCli(cliPath)
  if (root === null) throw new Error('could not start the antigravity CLI')

  try {
    const endpoint = await waitForEndpoint(root)
    return await readUsage(endpoint)
  } finally {
    killTree(root)
  }
}

async function readUsage(endpoint: Endpoint): Promise<AccountUsageResult> {
  const response = await postLocal(endpoint, 'RetrieveUserQuotaSummary')
  if (response === null || response.status !== 200) {
    throw new Error('the antigravity local server stopped responding')
  }

  const usage = parseQuota(response.body)
  if (usage === null) {
    throw new Error('antigravity quota response was not in the expected shape')
  }

  const result: AccountUsageResult = {
    provider: 'antigravity',
    cached: false,
    usage,
  }

  const plan = await fetchPlan(endpoint)
  if (plan !== null) result.accountPlan = plan

  return result
}

export async function fetchAntigravityAccount(
  account: ProviderAccount,
  _options: ProviderOptions
): Promise<AccountUsageResult> {
  try {
    return await fetchUsage(antigravityAccountSchema.parse(account))
  } catch (error) {
    return {
      provider: 'antigravity',
      cached: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
