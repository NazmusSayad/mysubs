import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { shortenHome } from '../../utils/path'
import type { ProviderResult, UsageResource } from '../../utils/usage'
import type { ClaudeAccount } from './config'
import {
  ITEM_NOT_FOUND_EXIT_CODE,
  KEYCHAIN_SERVICE,
  SECURITY_BIN,
  claudeConfigRoot,
  credentialsPath,
} from './detect'

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const SCOPES =
  'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
const BETA_HEADER = 'oauth-2025-04-20'
const USER_AGENT = 'claude-code/2.1.69'
const REFRESH_WINDOW_MS = 5 * 60 * 1000
const CENTS_PER_USD = 100

const oauthSchema = z.object({
  accessToken: z.string().nullish(),
  refreshToken: z.string().nullish(),
  expiresAt: z.number().nullish(),
  subscriptionType: z.string().nullish(),
  rateLimitTier: z.string().nullish(),
})

const credentialsSchema = z.object({
  claudeAiOauth: oauthSchema.nullish(),
})

const windowSchema = z
  .object({
    utilization: z.number().nullish(),
    resets_at: z.union([z.string(), z.number()]).nullish(),
  })
  .nullish()

const usageSchema = z.object({
  five_hour: windowSchema,
  seven_day: windowSchema,
  seven_day_opus: windowSchema,
  seven_day_sonnet: windowSchema,
  limits: z.array(z.unknown()).nullish(),
  extra_usage: z
    .object({
      is_enabled: z.boolean().nullish(),
      used_credits: z.number().nullish(),
      monthly_limit: z.number().nullish(),
    })
    .nullish(),
})

type Oauth = z.infer<typeof oauthSchema>
type Window = NonNullable<z.infer<typeof windowSchema>>
type CredentialSource =
  { kind: 'file'; path: string } | { kind: 'keychain'; account: string | null }
type AuthState = {
  raw: Record<string, unknown>
  oauth: Oauth
  source: CredentialSource
}

function readFromKeychain(): { text: string; source: CredentialSource } | null {
  if (process.platform !== 'darwin') return null

  for (const account of [os.userInfo().username, null]) {
    const args = ['find-generic-password', '-s', KEYCHAIN_SERVICE]
    if (account !== null) args.push('-a', account)
    args.push('-w')

    const result = spawnSync(SECURITY_BIN, args, {
      encoding: 'utf8',
      timeout: 5000,
    })
    if (result.error !== undefined) {
      throw new Error(`reading the keychain failed: ${result.error.message}`)
    }
    if (result.status === ITEM_NOT_FOUND_EXIT_CODE) continue
    if (result.status !== 0) {
      throw new Error(
        `the "${KEYCHAIN_SERVICE}" keychain item could not be read, the keychain may be locked or access denied (security exit ${String(result.status)})`
      )
    }

    const text = result.stdout.trim()
    if (text === '') continue
    return { text, source: { kind: 'keychain', account } }
  }

  return null
}

function loadAuth(configDir: string): AuthState {
  const file = credentialsPath(configDir)
  const shared = path.resolve(configDir) === path.resolve(claudeConfigRoot())

  let found: { text: string; source: CredentialSource } | null = null
  if (shared) found = readFromKeychain()
  if (found === null && fs.existsSync(file)) {
    found = {
      text: fs.readFileSync(file, 'utf8'),
      source: { kind: 'file', path: file },
    }
  }
  if (found === null) {
    throw new Error('not signed in, run `claude` to log in')
  }

  let raw: unknown
  try {
    raw = JSON.parse(found.text)
  } catch {
    throw new Error('claude credentials are not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('claude credentials are not an object')
  }

  const parsed = credentialsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('claude credentials are invalid')
  }

  return {
    raw: raw as Record<string, unknown>,
    oauth: parsed.data.claudeAiOauth ?? {},
    source: found.source,
  }
}

function saveAuth(state: AuthState): void {
  const text = JSON.stringify(state.raw)

  if (state.source.kind === 'file') {
    fs.writeFileSync(state.source.path, text, { mode: 0o600 })
    fs.chmodSync(state.source.path, 0o600)
    return
  }

  if (state.source.kind === 'keychain') {
    const args = ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE]
    if (state.source.account !== null) args.push('-a', state.source.account)
    args.push('-w', text)

    const result = spawnSync(SECURITY_BIN, args, {
      encoding: 'utf8',
      timeout: 5000,
    })
    if (result.error !== undefined) {
      throw new Error(result.error.message)
    }
    if (result.status !== 0) {
      throw new Error(`security exit ${String(result.status)}`)
    }
    return
  }

  throw new Error('unknown claude credential source')
}

function needsRefresh(oauth: Oauth): boolean {
  const expiresAt = oauth.expiresAt
  if (typeof expiresAt !== 'number') return false
  return expiresAt - Date.now() <= REFRESH_WINDOW_MS
}

async function refreshAccessToken(state: AuthState): Promise<string> {
  const refreshToken = state.oauth.refreshToken
  if (
    refreshToken === undefined ||
    refreshToken === null ||
    refreshToken === ''
  ) {
    throw new Error('session expired, run `claude` to log in again')
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      scope: SCOPES,
    }),
  })

  if (response.status === 400 || response.status === 401) {
    throw new Error('session expired, run `claude` to log in again')
  }
  if (!response.ok) {
    throw new Error(`token refresh failed (HTTP ${String(response.status)})`)
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  const fields = body as Record<string, unknown> | null
  const accessToken = fields?.access_token
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error('session expired, run `claude` to log in again')
  }

  const oauth: Record<string, unknown> = {
    ...(state.raw.claudeAiOauth as object),
    accessToken,
  }
  if (typeof fields?.refresh_token === 'string') {
    oauth.refreshToken = fields.refresh_token
  }
  if (typeof fields?.expires_in === 'number') {
    oauth.expiresAt = Date.now() + fields.expires_in * 1000
  }

  state.raw.claudeAiOauth = oauth
  state.oauth = credentialsSchema.parse(state.raw).claudeAiOauth ?? {}

  try {
    saveAuth(state)
  } catch (error) {
    process.stderr.write(
      `mysubs: could not persist refreshed claude credentials: ${errorMessage(error)}\n`
    )
  }

  return accessToken
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function fetchUsage(accessToken: string): Promise<Response> {
  return fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'anthropic-beta': BETA_HEADER,
      'User-Agent': USER_AGENT,
    },
  })
}

function rateLimitMessage(response: Response): string {
  const raw = response.headers.get('retry-after')
  if (raw === null) return 'rate limited by anthropic, try again later'

  const seconds = Number(raw.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'rate limited by anthropic, try again later'
  }

  const minutes = Math.ceil(seconds / 60)
  return `rate limited by anthropic, retry in ~${String(minutes)}m`
}

export async function fetchClaudeUsage(
  account: ClaudeAccount
): Promise<ProviderResult> {
  const state = loadAuth(account.configDir)

  let accessToken = state.oauth.accessToken ?? ''
  if (accessToken === '') {
    throw new Error('not signed in, run `claude` to log in')
  }

  if (needsRefresh(state.oauth)) {
    accessToken = await refreshAccessToken(state)
  }

  let response = await fetchUsage(accessToken)
  if (response.status === 401 || response.status === 403) {
    accessToken = await refreshAccessToken(state)
    response = await fetchUsage(accessToken)
    if (response.status === 401 || response.status === 403) {
      throw new Error('session expired, run `claude` to log in again')
    }
  }

  if (response.status === 429) {
    throw new Error(rateLimitMessage(response))
  }
  if (!response.ok) {
    throw new Error(
      `claude usage request failed (HTTP ${String(response.status)})`
    )
  }

  const parsed = usageSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error('claude usage response was not in the expected shape')
  }

  const result = mapUsage(parsed.data)

  const plan = formatPlan(
    state.oauth.subscriptionType,
    state.oauth.rateLimitTier
  )
  if (plan !== null) result.plan = plan

  const label = accountLabel(account.configDir)
  if (label !== null) result.label = label
  if (label === null) result.label = shortenHome(account.configDir)

  return result
}

function resetTime(value: string | number | null | undefined): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    const at = Date.parse(value)
    if (Number.isNaN(at)) return null
    return new Date(at).toISOString()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 1e10 ? value * 1000 : value
    return new Date(milliseconds).toISOString()
  }

  return null
}

function windowResource(
  utilization: number,
  resets: string | number | null | undefined
): UsageResource {
  const used = Math.max(0, utilization)
  const resource: UsageResource = {
    kind: 'consumption',
    unit: 'percent',
    used,
    limit: 100,
    remaining: Math.max(0, 100 - used),
    utilization: used / 100,
  }

  const resetsAt = resetTime(resets)
  if (resetsAt !== null) resource.resetsAt = resetsAt
  return resource
}

function assignWindow(
  usage: Record<string, UsageResource>,
  key: string,
  window: Window | null | undefined
): void {
  if (window === undefined || window === null) return
  if (typeof window.utilization !== 'number') return
  usage[key] = windowResource(window.utilization, window.resets_at)
}

function assignScopedLimits(
  usage: Record<string, UsageResource>,
  limits: unknown[]
): void {
  for (const entry of limits) {
    if (typeof entry !== 'object' || entry === null) continue
    const fields = entry as Record<string, unknown>

    if (fields.kind !== 'weekly_scoped') continue
    if (typeof fields.percent !== 'number') continue

    const scope = fields.scope
    if (typeof scope !== 'object' || scope === null) continue
    const model = (scope as Record<string, unknown>).model
    if (typeof model !== 'object' || model === null) continue

    const name = (model as Record<string, unknown>).display_name
    if (typeof name !== 'string' || name.trim() === '') continue

    const key = name.trim().toLowerCase()
    if (usage[key] !== undefined) continue

    usage[key] = windowResource(
      fields.percent,
      fields.resets_at as string | number | null | undefined
    )
  }
}

function mapUsage(body: z.infer<typeof usageSchema>): ProviderResult {
  const usage: Record<string, UsageResource> = {}

  assignWindow(usage, 'session', body.five_hour)
  assignWindow(usage, 'weekly', body.seven_day)
  assignWindow(usage, 'opus', body.seven_day_opus)
  assignWindow(usage, 'sonnet', body.seven_day_sonnet)
  assignScopedLimits(usage, body.limits ?? [])

  const extra = body.extra_usage
  if (
    extra !== undefined &&
    extra !== null &&
    extra.is_enabled === true &&
    typeof extra.used_credits === 'number'
  ) {
    const used = Math.max(0, extra.used_credits) / CENTS_PER_USD
    const limit = extra.monthly_limit

    if (typeof limit === 'number' && limit > 0) {
      const total = limit / CENTS_PER_USD
      usage.extraUsage = {
        kind: 'consumption',
        unit: 'usd',
        used,
        limit: total,
        remaining: Math.max(0, total - used),
        utilization: used / total,
      }
    }
    if (typeof limit !== 'number' || limit <= 0) {
      usage.extraUsage = { kind: 'consumption', unit: 'usd', used }
    }
  }

  return { usage }
}

function formatPlan(
  subscriptionType: string | null | undefined,
  rateLimitTier: string | null | undefined
): string | null {
  if (typeof subscriptionType !== 'string') return null

  const raw = subscriptionType.trim()
  if (raw === '') return null

  const base = raw
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

  if (typeof rateLimitTier !== 'string') return base
  const multiplier = /\d+x/.exec(rateLimitTier)
  if (multiplier === null) return base
  return `${base} ${multiplier[0]}`
}

function accountConfigPaths(configDir: string): string[] {
  const paths = [
    path.join(configDir, '.config.json'),
    path.join(configDir, '.claude.json'),
  ]

  if (path.resolve(configDir) === path.resolve(claudeConfigRoot())) {
    paths.push(path.join(os.homedir(), '.claude.json'))
  }
  return paths
}

function accountLabel(configDir: string): string | null {
  for (const file of accountConfigPaths(configDir)) {
    if (!fs.existsSync(file)) continue

    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    if (typeof raw !== 'object' || raw === null) continue

    const account = (raw as Record<string, unknown>).oauthAccount
    if (typeof account !== 'object' || account === null) continue

    const name = (account as Record<string, unknown>).displayName
    if (typeof name !== 'string') continue
    if (name.trim() === '') continue
    return name.trim()
  }

  return null
}
