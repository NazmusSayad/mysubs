import { randomUUID } from 'node:crypto'
import os from 'node:os'
import readline from 'node:readline/promises'
import { z } from 'zod'
import { collectAccountTargets, type AccountTarget } from './app'
import { loadConfig } from './core/config'
import {
  consumeCodexResetCredit,
  fetchCodexResetCredits,
} from './providers/codex'
import {
  consumeOpenCode2ResetCredit,
  fetchOpenCode2ResetCredits,
} from './providers/opencode2-codex'

const resetCreditSchema = z.object({
  id: z.string().min(1),
  status: z.string().nullish(),
  title: z.string().nullish(),
  reset_type: z.string().nullish(),
  granted_at: z.union([z.string(), z.number()]).nullish(),
  expires_at: z.union([z.string(), z.number()]).nullish(),
})

const resetCreditsSchema = z.object({
  credits: z.array(resetCreditSchema),
  available_count: z.number().nullish(),
})

const consumeResponseSchema = z.object({
  code: z.string(),
  windows_reset: z.number().nullish(),
})

type ResetCredit = z.infer<typeof resetCreditSchema>

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/

function sourceLabel(target: AccountTarget): string {
  const account = target.account
  if (target.provider === 'opencode2-codex') {
    return `OpenCode 2 (${String(account.label)})`
  }
  if ('adapter' in account) return 'OpenCode'
  const home = os.homedir()
  const configDir = String(account.configDir)
  return `Codex CLI (${configDir.startsWith(home) ? `~${configDir.slice(home.length)}` : configDir})`
}

function accountLabel(target: AccountTarget): string {
  const source = sourceLabel(target)
  const name = target.sourceName ?? target.alias
  const label = name === undefined ? source : `${name} · ${source}`
  if (EMAIL_PATTERN.test(label)) return `Codex account · ${source}`
  return label.replace(/[\r\n\t]+/g, ' ')
}

async function choose(
  title: string,
  labels: string[],
  input: readline.Interface
): Promise<number> {
  if (labels.length === 1) {
    process.stderr.write(`${title}: ${String(labels[0])}\n`)
    return 0
  }

  process.stderr.write(`${title}:\n`)
  for (const entry of labels.entries()) {
    process.stderr.write(`  ${String(entry[0] + 1)}. ${entry[1]}\n`)
  }

  while (true) {
    const answer = (
      await input.question(`Select [1-${String(labels.length)}]: `)
    ).trim()
    const selected = Number(answer)
    if (
      Number.isInteger(selected) &&
      selected >= 1 &&
      selected <= labels.length
    ) {
      return selected - 1
    }
    process.stderr.write('Enter the number of one listed option.\n')
  }
}

function creditExpiry(credit: ResetCredit): string {
  const value = credit.expires_at
  if (value === undefined || value === null) return 'does not expire'
  const timestamp = typeof value === 'number' ? value * 1000 : Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'expiry unavailable'
  return `expires ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))}`
}

function creditLabel(credit: ResetCredit, index: number): string {
  const title = credit.title?.replace(/[\r\n\t]+/g, ' ').trim() ?? ''
  const name =
    title === '' || EMAIL_PATTERN.test(title)
      ? `Reset credit ${String(index + 1)}`
      : title
  return `${name} — ${creditExpiry(credit)}`
}

function fetchCredits(target: AccountTarget): Promise<Response> {
  if (target.provider === 'codex') {
    return fetchCodexResetCredits(target.account)
  }
  if (target.provider === 'opencode2-codex') {
    return fetchOpenCode2ResetCredits(target.account)
  }
  throw new Error(`reset credits are not supported for ${target.provider}`)
}

function consumeCredit(
  target: AccountTarget,
  creditID: string,
  redeemRequestID: string
): Promise<Response> {
  if (target.provider === 'codex') {
    return consumeCodexResetCredit(target.account, creditID, redeemRequestID)
  }
  if (target.provider === 'opencode2-codex') {
    return consumeOpenCode2ResetCredit(
      target.account,
      creditID,
      redeemRequestID
    )
  }
  throw new Error(`reset credits are not supported for ${target.provider}`)
}

async function readCredits(target: AccountTarget): Promise<ResetCredit[]> {
  const response = await fetchCredits(target)
  if (!response.ok) {
    throw new Error(
      `could not list reset credits (HTTP ${String(response.status)})`
    )
  }

  const parsed = resetCreditsSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error('reset credit response was not in the expected shape')
  }
  return parsed.data.credits.filter(
    (credit) =>
      credit.status === undefined ||
      credit.status === null ||
      credit.status === 'available'
  )
}

export async function runCodexReset(): Promise<number> {
  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
    throw new Error('`mysubs codex reset` needs an interactive terminal')
  }

  const targets = (await collectAccountTargets(loadConfig())).filter(
    (target) =>
      target.provider === 'codex' || target.provider === 'opencode2-codex'
  )
  if (targets.length === 0) {
    throw new Error('no Codex accounts configured or detected')
  }

  const input = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  try {
    const target =
      targets[await choose('Account', targets.map(accountLabel), input)]
    if (target === undefined) throw new Error('selected account is unavailable')
    const label = accountLabel(target)

    const credits = await readCredits(target)
    if (credits.length === 0) {
      process.stderr.write(`No reset credits are available for ${label}.\n`)
      return 0
    }

    const credit =
      credits[await choose('Reset credit', credits.map(creditLabel), input)]
    if (credit === undefined) {
      throw new Error('selected reset credit is unavailable')
    }

    process.stderr.write(
      `\nThis immediately resets the Codex usage limits for ${label}.\n` +
        'The selected reset credit will be permanently consumed. This cannot be undone.\n'
    )
    const confirmation = await input.question(
      'Type "reset" to consume this credit: '
    )
    if (confirmation.trim() !== 'reset') {
      process.stderr.write('Reset cancelled.\n')
      return 0
    }

    const currentCredits = await readCredits(target)
    if (!currentCredits.some((candidate) => candidate.id === credit.id)) {
      process.stderr.write(
        'That reset credit is no longer available. Nothing was changed.\n'
      )
      return 1
    }

    const response = await consumeCredit(target, credit.id, randomUUID())
    if (!response.ok) {
      throw new Error(`reset failed (HTTP ${String(response.status)})`)
    }
    const parsed = consumeResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new Error('reset response was not in the expected shape')
    }

    const code = parsed.data.code
    if (code === 'reset' || code === 'already_redeemed') {
      process.stderr.write('Codex usage limits were reset.\n')
      return 0
    }
    if (code === 'nothing_to_reset') {
      process.stderr.write(
        'Codex reports that your usage does not need a reset. The credit was not consumed.\n'
      )
      return 1
    }
    if (code === 'no_credit') {
      process.stderr.write(
        'That reset credit is no longer available. Nothing was changed.\n'
      )
      return 1
    }
    throw new Error(`reset failed with response code "${code}"`)
  } finally {
    input.close()
  }
}
