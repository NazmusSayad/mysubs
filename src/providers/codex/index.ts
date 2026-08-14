import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { BaseProvider } from '../../core/provider'
import type { ProviderResult, UsageResource } from '../../core/usage'
import { expandHome, shortenHome } from '../../utils/path'
import { codexAccountSchema, type CodexAccount } from './config'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const KEYCHAIN_SERVICE = 'Codex Auth'
const SECURITY_BIN = '/usr/bin/security'
const ITEM_NOT_FOUND_EXIT_CODE = 44
const REFRESH_WINDOW_MS = 5 * 60 * 1000
const LAST_REFRESH_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000
const SESSION_WINDOW_SECONDS = 18000
const WEEKLY_WINDOW_SECONDS = 604800
const CREDIT_USD_RATE = 0.04

const authSchema = z.object({
  auth_mode: z.string().nullish(),
  OPENAI_API_KEY: z.string().nullish(),
  tokens: z
    .object({
      id_token: z.string().nullish(),
      access_token: z.string().nullish(),
      refresh_token: z.string().nullish(),
      account_id: z.string().nullish(),
    })
    .nullish(),
  last_refresh: z.string().nullish(),
})

const windowSchema = z
  .object({
    used_percent: z.number().nullish(),
    limit_window_seconds: z.number().nullish(),
    reset_after_seconds: z.number().nullish(),
    reset_at: z.number().nullish(),
  })
  .nullish()

const usageSchema = z.object({
  plan_type: z.string().nullish(),
  rate_limit: z
    .object({
      primary_window: windowSchema,
      secondary_window: windowSchema,
    })
    .nullish(),
  additional_rate_limits: z.array(z.unknown()).nullish(),
  credits: z
    .object({
      has_credits: z.boolean().nullish(),
      unlimited: z.boolean().nullish(),
      balance: z.union([z.number(), z.string()]).nullish(),
    })
    .nullish(),
})

type Auth = z.infer<typeof authSchema>
type Window = NonNullable<z.infer<typeof windowSchema>>
type AuthSource = { kind: 'file'; path: string } | { kind: 'keychain' }
type AuthState = {
  raw: Record<string, unknown>
  auth: Auth
  source: AuthSource
}
type Candidate = {
  window: Window
  usedPercent: number | null
  slot: 'session' | 'weekly'
}

export class CodexProvider implements BaseProvider {
  private readonly account: CodexAccount

  constructor(account: unknown) {
    const parsed = codexAccountSchema.parse(account)
    this.account = { ...parsed, configDir: expandHome(parsed.configDir) }
  }

  get accountKey() {
    return path.resolve(this.account.configDir)
  }

  get name() {
    return this.account.name
  }

  get accountColor() {
    return this.account.color
  }

  private readAuthText(configDir: string): {
    text: string
    source: AuthSource
  } {
    const file = path.join(configDir, 'auth.json')
    if (fs.existsSync(file)) {
      return {
        text: fs.readFileSync(file, 'utf8'),
        source: { kind: 'file', path: file },
      }
    }

    if (process.platform !== 'darwin') {
      throw new Error(`no auth.json at ${file}, run \`codex\` to sign in`)
    }

    const result = spawnSync(
      SECURITY_BIN,
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', timeout: 5000 }
    )
    if (result.error !== undefined) {
      throw new Error(
        `no auth.json at ${file} and reading the keychain failed: ${result.error.message}`
      )
    }
    if (result.status === ITEM_NOT_FOUND_EXIT_CODE) {
      throw new Error(`no auth.json at ${file}, run \`codex\` to sign in`)
    }
    if (result.status !== 0) {
      throw new Error(
        `no auth.json at ${file} and the "${KEYCHAIN_SERVICE}" keychain item could not be read, the keychain may be locked or access denied (security exit ${String(result.status)})`
      )
    }
    return { text: result.stdout.trim(), source: { kind: 'keychain' } }
  }

  private loadAuth(configDir: string): AuthState {
    const { text, source } = this.readAuthText(configDir)

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('codex auth data is not valid JSON')
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('codex auth data is not an object')
    }

    const parsed = authSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error('codex auth data is invalid')
    }

    return {
      raw: raw as Record<string, unknown>,
      auth: parsed.data,
      source,
    }
  }

  private saveAuth(state: AuthState): void {
    const text = JSON.stringify(state.raw, null, 2)

    if (state.source.kind === 'file') {
      fs.writeFileSync(state.source.path, text, { mode: 0o600 })
      fs.chmodSync(state.source.path, 0o600)
      return
    }

    if (state.source.kind === 'keychain') {
      const result = spawnSync(
        SECURITY_BIN,
        ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-w', text],
        { encoding: 'utf8', timeout: 5000 }
      )
      if (result.error !== undefined) {
        throw new Error(result.error.message)
      }
      if (result.status !== 0) {
        throw new Error(`security exit ${String(result.status)}`)
      }
      return
    }

    throw new Error('unknown codex auth source')
  }

  private jwtExpiresAt(token: string): number | null {
    const segments = token.split('.')
    if (segments.length !== 3) return null

    try {
      const payload: unknown = JSON.parse(
        Buffer.from(segments[1], 'base64url').toString('utf8')
      )
      if (typeof payload !== 'object' || payload === null) return null

      const exp = (payload as Record<string, unknown>).exp
      if (typeof exp !== 'number') return null
      return exp * 1000
    } catch {
      return null
    }
  }

  private jwtName(token: string | null | undefined): string | null {
    if (token === undefined || token === null || token === '') return null

    const segments = token.split('.')
    if (segments.length !== 3) return null

    try {
      const payload: unknown = JSON.parse(
        Buffer.from(segments[1], 'base64url').toString('utf8')
      )
      if (typeof payload !== 'object' || payload === null) return null

      const name = (payload as Record<string, unknown>).name
      if (typeof name !== 'string') return null
      if (name.trim() === '') return null
      return name.trim()
    } catch {
      return null
    }
  }

  private needsRefresh(auth: Auth): boolean {
    const accessToken = auth.tokens?.access_token
    if (
      accessToken !== undefined &&
      accessToken !== null &&
      accessToken !== ''
    ) {
      const expiresAt = this.jwtExpiresAt(accessToken)
      if (expiresAt !== null) {
        return expiresAt - Date.now() <= REFRESH_WINDOW_MS
      }
    }

    const lastRefresh = auth.last_refresh
    if (
      lastRefresh === undefined ||
      lastRefresh === null ||
      lastRefresh === ''
    ) {
      return false
    }
    const at = Date.parse(lastRefresh)
    if (Number.isNaN(at)) return false
    return Date.now() - at > LAST_REFRESH_MAX_AGE_MS
  }

  private async refreshAccessToken(state: AuthState): Promise<string> {
    const refreshToken = state.auth.tokens?.refresh_token
    if (
      refreshToken === undefined ||
      refreshToken === null ||
      refreshToken === ''
    ) {
      throw new Error('session expired, run `codex` to log in again')
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
    })

    const text = await response.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }

    if (response.status === 400 || response.status === 401) {
      const code = this.refreshErrorCode(body)
      if (code === 'refresh_token_expired') {
        throw new Error('session expired, run `codex` to log in again')
      }
      if (code === 'refresh_token_reused') {
        throw new Error('token conflict, run `codex` to log in again')
      }
      if (code === 'refresh_token_invalidated') {
        throw new Error('token revoked, run `codex` to log in again')
      }
      throw new Error(`token refresh failed (HTTP ${String(response.status)})`)
    }

    if (!response.ok) {
      throw new Error(`token refresh failed (HTTP ${String(response.status)})`)
    }

    const fields = body as Record<string, unknown> | null
    const accessToken = fields?.access_token
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new Error('session expired, run `codex` to log in again')
    }

    const tokens = { ...(state.auth.tokens ?? {}), access_token: accessToken }
    if (typeof fields?.refresh_token === 'string') {
      tokens.refresh_token = fields.refresh_token
    }
    if (typeof fields?.id_token === 'string') {
      tokens.id_token = fields.id_token
    }

    state.auth = {
      ...state.auth,
      tokens,
      last_refresh: new Date().toISOString(),
    }
    state.raw.tokens = { ...(state.raw.tokens as object), ...tokens }
    state.raw.last_refresh = state.auth.last_refresh

    try {
      this.saveAuth(state)
    } catch (error) {
      process.stderr.write(
        `mysubs: could not persist refreshed codex credentials: ${this.errorMessage(error)}\n`
      )
    }

    return accessToken
  }

  private refreshErrorCode(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) return null
    const fields = body as Record<string, unknown>

    if (typeof fields.error === 'string') return fields.error
    if (typeof fields.error === 'object' && fields.error !== null) {
      const nested = fields.error as Record<string, unknown>
      if (typeof nested.code === 'string') return nested.code
      if (typeof nested.error === 'string') return nested.error
    }
    if (typeof fields.code === 'string') return fields.code
    return null
  }

  private fetchUsageResponse(
    accessToken: string,
    accountID: string | null | undefined
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'mysubs',
    }
    if (accountID !== undefined && accountID !== null && accountID !== '') {
      headers['ChatGPT-Account-Id'] = accountID
    }

    return fetch(USAGE_URL, { headers })
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
  }

  async fetchUsage(): Promise<ProviderResult> {
    const state = this.loadAuth(this.account.configDir)

    let accessToken = state.auth.tokens?.access_token ?? ''
    if (accessToken === '') {
      const apiKey = state.auth.OPENAI_API_KEY
      if (apiKey !== undefined && apiKey !== null && apiKey !== '') {
        throw new Error('usage is not available for API key auth')
      }
      throw new Error('not signed in, run `codex` to log in')
    }

    if (this.needsRefresh(state.auth)) {
      const live = this.loadAuth(this.account.configDir)
      const liveToken = live.auth.tokens?.access_token ?? ''
      if (liveToken !== '') {
        state.raw = live.raw
        state.auth = live.auth
        state.source = live.source
        accessToken = liveToken
      }
    }

    if (this.needsRefresh(state.auth)) {
      accessToken = await this.refreshAccessToken(state)
    }

    let response = await this.fetchUsageResponse(
      accessToken,
      state.auth.tokens?.account_id
    )
    if (response.status === 401 || response.status === 403) {
      accessToken = await this.refreshAccessToken(state)
      response = await this.fetchUsageResponse(
        accessToken,
        state.auth.tokens?.account_id
      )
      if (response.status === 401 || response.status === 403) {
        throw new Error('session expired, run `codex` to log in again')
      }
    }

    if (!response.ok) {
      throw new Error(
        `codex usage request failed (HTTP ${String(response.status)})`
      )
    }

    const parsed = usageSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new Error('codex usage response was not in the expected shape')
    }

    const result = this.mapUsage(parsed.data, response)

    const name = this.jwtName(state.auth.tokens?.id_token)
    if (name !== null) result.label = name
    if (name === null) result.label = shortenHome(this.account.configDir)

    return result
  }

  private headerNumber(response: Response, name: string): number | null {
    const raw = response.headers.get(name)
    if (raw === null) return null
    const value = Number(raw)
    if (!Number.isFinite(value)) return null
    return value
  }

  private windowResource(window: Window, usedPercent: number): UsageResource {
    const resource: UsageResource = {
      kind: 'consumption',
      unit: 'percent',
      used: usedPercent,
      limit: 100,
      remaining: Math.max(0, 100 - usedPercent),
      utilization: usedPercent / 100,
    }

    const windowSeconds = window.limit_window_seconds
    if (typeof windowSeconds === 'number') {
      resource.windowSeconds = windowSeconds
    }

    const resetAt = window.reset_at
    if (typeof resetAt === 'number') {
      resource.resetsAt = new Date(resetAt * 1000).toISOString()
    } else if (typeof window.reset_after_seconds === 'number') {
      resource.resetsAt = new Date(
        Date.now() + window.reset_after_seconds * 1000
      ).toISOString()
    }

    return resource
  }

  private candidates(
    rateLimit: { primary_window?: unknown; secondary_window?: unknown } | null,
    headerPercents: { primary: number | null; secondary: number | null }
  ): Candidate[] {
    const found: Candidate[] = []

    const primary = windowSchema.safeParse(rateLimit?.primary_window)
    if (primary.success && primary.data != null) {
      found.push({
        window: primary.data,
        usedPercent: primary.data.used_percent ?? headerPercents.primary,
        slot: 'session',
      })
    }

    const secondary = windowSchema.safeParse(rateLimit?.secondary_window)
    if (secondary.success && secondary.data != null) {
      found.push({
        window: secondary.data,
        usedPercent: secondary.data.used_percent ?? headerPercents.secondary,
        slot: 'weekly',
      })
    }

    return found
  }

  private exactKind(window: Window): 'session' | 'weekly' | null {
    if (window.limit_window_seconds === SESSION_WINDOW_SECONDS) return 'session'
    if (window.limit_window_seconds === WEEKLY_WINDOW_SECONDS) return 'weekly'
    return null
  }

  private classify(
    found: Candidate[],
    kind: 'session' | 'weekly'
  ): Candidate | null {
    const exact = found.find(
      (candidate) => this.exactKind(candidate.window) === kind
    )
    if (exact !== undefined) return exact

    const fallback = found.find(
      (candidate) =>
        this.exactKind(candidate.window) === null && candidate.slot === kind
    )
    if (fallback !== undefined) return fallback

    return null
  }

  private assignWindows(
    usage: Record<string, UsageResource>,
    found: Candidate[],
    keys: { session: string; weekly: string }
  ): void {
    const session = this.classify(found, 'session')
    if (session !== null && session.usedPercent !== null) {
      usage[keys.session] = this.windowResource(
        session.window,
        session.usedPercent
      )
    }

    const weekly = this.classify(found, 'weekly')
    if (weekly !== null && weekly.usedPercent !== null) {
      usage[keys.weekly] = this.windowResource(
        weekly.window,
        weekly.usedPercent
      )
    }
  }

  private mapUsage(
    body: z.infer<typeof usageSchema>,
    response: Response
  ): ProviderResult {
    const usage: Record<string, UsageResource> = {}

    this.assignWindows(
      usage,
      this.candidates(body.rate_limit ?? null, {
        primary: this.headerNumber(response, 'x-codex-primary-used-percent'),
        secondary: this.headerNumber(
          response,
          'x-codex-secondary-used-percent'
        ),
      }),
      { session: 'session', weekly: 'weekly' }
    )

    for (const entry of body.additional_rate_limits ?? []) {
      if (typeof entry !== 'object' || entry === null) continue
      const fields = entry as Record<string, unknown>

      const name = this.extraLimitName(fields)
      if (name === null) continue

      const rateLimit = fields.rate_limit
      if (typeof rateLimit !== 'object' || rateLimit === null) continue

      this.assignWindows(
        usage,
        this.candidates(rateLimit as Record<string, unknown>, {
          primary: null,
          secondary: null,
        }),
        { session: name, weekly: `${name}Weekly` }
      )
    }

    const balance = this.creditBalance(body, response)
    if (balance !== null) {
      const credits = Math.max(0, Math.floor(balance))
      usage.credits = { kind: 'balance', unit: 'credits', available: credits }
      usage.creditValue = {
        kind: 'balance',
        unit: 'usd',
        available: credits * CREDIT_USD_RATE,
      }
    }

    const result: ProviderResult = { usage }

    const plan = this.formatPlan(body.plan_type)
    if (plan !== null) result.plan = plan

    return result
  }

  private extraLimitName(fields: Record<string, unknown>): string | null {
    const raw = fields.limit_name ?? fields.metered_feature
    if (typeof raw !== 'string') return null

    const trimmed = raw.trim()
    if (trimmed === '') return null

    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (slug === '') return null
    return slug
  }

  private creditBalance(
    body: z.infer<typeof usageSchema>,
    response: Response
  ): number | null {
    const credits = body.credits
    if (credits != null) {
      const balance = credits.balance
      if (typeof balance === 'number' && Number.isFinite(balance))
        return balance
      if (typeof balance === 'string') {
        const value = Number(balance)
        if (Number.isFinite(value)) return value
      }
      if (credits.has_credits === false) return 0
    }
    return this.headerNumber(response, 'x-codex-credits-balance')
  }

  private formatPlan(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null

    const raw = value.trim()
    if (raw === '') return null
    if (raw.toLowerCase() === 'prolite') return 'Pro 5x'
    if (raw.toLowerCase() === 'pro') return 'Pro 20x'

    return raw
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }
}
