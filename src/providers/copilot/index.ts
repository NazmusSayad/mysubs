import { z } from 'zod'
import type {
  AccountSubscriptionConsumptionUsage,
  AccountUsageResult,
  ProviderAccount,
  ProviderOptions,
} from '../../core/types'
import { resolveSecret } from '../../lib/secret'
import { copilotAccountSchema } from './config'
import { readGhToken } from './detect'

const USAGE_URL = 'https://api.github.com/copilot_internal/user'
const EDITOR_VERSION = 'vscode/1.96.2'
const EDITOR_PLUGIN_VERSION = 'copilot-chat/0.26.7'
const USER_AGENT = 'GitHubCopilotChat/0.26.7'
const API_VERSION = '2025-04-01'
const UNLIMITED_SENTINEL = -1

const snapshotSchema = z
  .object({
    entitlement: z.number().nullish(),
    remaining: z.number().nullish(),
    percent_remaining: z.number().nullish(),
    unlimited: z.boolean().nullish(),
  })
  .nullish()

const usageSchema = z.object({
  login: z.string().nullish(),
  copilot_plan: z.string().nullish(),
  token_based_billing: z.boolean().nullish(),
  quota_reset_date: z.string().nullish(),
  quota_reset_date_utc: z.string().nullish(),
  limited_user_reset_date: z.string().nullish(),
  quota_snapshots: z
    .object({
      premium_interactions: snapshotSchema,
      chat: snapshotSchema,
      completions: snapshotSchema,
    })
    .nullish(),
  limited_user_quotas: z
    .object({
      chat: z.number().nullish(),
      completions: z.number().nullish(),
    })
    .nullish(),
  monthly_quotas: z
    .object({
      chat: z.number().nullish(),
      completions: z.number().nullish(),
    })
    .nullish(),
})

type Snapshot = NonNullable<z.infer<typeof snapshotSchema>>
type UsageResource = AccountSubscriptionConsumptionUsage

function resolveToken(account: z.infer<typeof copilotAccountSchema>): string {
  if (account.source === 'token') return resolveSecret(account.token)

  if (account.source === 'gh') {
    const result = readGhToken()
    if (result.kind === 'token') return result.token
    if (result.kind === 'missing') {
      throw new Error('the GitHub CLI is not installed, or `gh` is not on PATH')
    }
    if (result.kind === 'unauthenticated') {
      throw new Error('not signed in to the GitHub CLI, run `gh auth login`')
    }
  }

  throw new Error('unknown copilot account source')
}

async function fetchUsage(token: string): Promise<z.infer<typeof usageSchema>> {
  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/json',
        'Editor-Version': EDITOR_VERSION,
        'Editor-Plugin-Version': EDITOR_PLUGIN_VERSION,
        'User-Agent': USER_AGENT,
        'X-Github-Api-Version': API_VERSION,
      },
    })
  } catch {
    throw new Error("couldn't reach github, check your connection")
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error('github token invalid or expired, run `gh auth login`')
  }
  if (response.status === 404) {
    throw new Error('this account does not have GitHub Copilot')
  }
  if (!response.ok) {
    throw new Error(
      `copilot usage request failed (HTTP ${String(response.status)})`
    )
  }

  const parsed = usageSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error('copilot usage response was not in the expected shape')
  }
  return parsed.data
}

function percentageResource(
  usedPercent: number,
  resetsAt: string | null
): UsageResource {
  const used = Math.max(0, Math.min(100, usedPercent))
  const resource: UsageResource = {
    kind: 'consumption',
    unit: 'percent',
    used,
    limit: 100,
    remaining: 100 - used,
    utilization: used / 100,
  }
  if (resetsAt !== null) resource.resetsAt = resetsAt
  return resource
}

function snapshotResource(
  snapshot: Snapshot | null | undefined,
  resetsAt: string | null
): UsageResource | null {
  if (snapshot === undefined || snapshot === null) return null

  const entitlement = snapshot.entitlement
  const remaining = snapshot.remaining

  if (snapshot.unlimited === true) return null
  if (entitlement === UNLIMITED_SENTINEL) return null
  if (remaining === UNLIMITED_SENTINEL) return null
  if (entitlement === 0) return null

  const percentRemaining = snapshot.percent_remaining
  if (typeof percentRemaining === 'number') {
    return percentageResource(100 - percentRemaining, resetsAt)
  }
  if (
    typeof entitlement === 'number' &&
    entitlement > 0 &&
    typeof remaining === 'number'
  ) {
    return percentageResource(100 - (remaining / entitlement) * 100, resetsAt)
  }
  return null
}

function limitedResource(
  remaining: number | null | undefined,
  total: number | null | undefined,
  resetsAt: string | null
): UsageResource | null {
  if (typeof total !== 'number' || total <= 0) return null
  if (typeof remaining !== 'number') return null
  return percentageResource(((total - remaining) / total) * 100, resetsAt)
}

function parseReset(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (trimmed === '') return null

  let text = trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) text = `${trimmed}T00:00:00.000Z`

  const at = Date.parse(text)
  if (Number.isNaN(at)) return null
  return new Date(at).toISOString()
}

function formatPlan(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const raw = value.trim()
  if (raw === '') return null

  return raw
    .split(/[_\-\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function mapUsage(body: z.infer<typeof usageSchema>): AccountUsageResult {
  const resetsAt =
    parseReset(body.quota_reset_date_utc) ??
    parseReset(body.quota_reset_date) ??
    parseReset(body.limited_user_reset_date)

  const snapshots = body.quota_snapshots
  const usage: Record<string, UsageResource> = {}

  const credits = snapshotResource(snapshots?.premium_interactions, resetsAt)
  if (credits !== null) usage.credits = credits

  const chat = snapshotResource(snapshots?.chat, resetsAt)
  if (chat !== null) usage.chat = chat

  const completions = snapshotResource(snapshots?.completions, resetsAt)
  if (completions !== null) usage.completions = completions

  if (Object.keys(usage).length === 0) {
    const limitedChat = limitedResource(
      body.limited_user_quotas?.chat,
      body.monthly_quotas?.chat,
      resetsAt
    )
    if (limitedChat !== null) usage.chat = limitedChat

    const limitedCompletions = limitedResource(
      body.limited_user_quotas?.completions,
      body.monthly_quotas?.completions,
      resetsAt
    )
    if (limitedCompletions !== null) usage.completions = limitedCompletions
  }

  if (Object.keys(usage).length === 0 && body.token_based_billing !== true) {
    throw new Error('copilot usage data is unavailable for this account')
  }

  const result: AccountUsageResult = {
    provider: 'copilot',
    cached: false,
    usage,
  }

  const plan = formatPlan(body.copilot_plan)
  if (plan !== null) result.accountPlan = plan

  const login = body.login
  if (typeof login === 'string' && login.trim() !== '') {
    result.accountInfo = login.trim()
  }

  return result
}

export async function fetchCopilotAccount(
  account: ProviderAccount,
  _options: ProviderOptions
): Promise<AccountUsageResult> {
  try {
    const parsed = copilotAccountSchema.parse(account)
    return mapUsage(await fetchUsage(resolveToken(parsed)))
  } catch (error) {
    return {
      provider: 'copilot',
      cached: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
