import { randomUUID } from 'node:crypto'
import readline from 'node:readline/promises'
import { z } from 'zod'
import { loadConfig } from './core/config'
import type { ProviderAccount } from './core/types'
import {
  consumeCodexResetCredit,
  fetchCodexResetCredits,
} from './providers/codex'
import { detectCodexAccounts } from './providers/codex/detect'
import {
  consumeOpenCode2ResetCredit,
  fetchOpenCode2ResetCredits,
} from './providers/opencode2-codex'
import { detectOpenCode2CodexAccounts } from './providers/opencode2-codex/detect'

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
type ResetAccount = {
  provider: 'codex' | 'opencode2-codex'
  account: ProviderAccount
  label: string
}

function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim()
}

function safeLabel(value: string, fallback: string): string {
  const label = oneLine(value)
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(label)) return fallback
  if (label === '') return fallback
  return label
}

function configuredLabel(
  account: ProviderAccount,
  key: string,
  fallback: string
): string {
  const name = account.name
  if (typeof name === 'string') return safeLabel(name, fallback)
  return safeLabel(key, fallback)
}

function uniqueLabels(accounts: ResetAccount[]): ResetAccount[] {
  const counts = new Map<string, number>()
  return accounts.map((account) => {
    const count = (counts.get(account.label) ?? 0) + 1
    counts.set(account.label, count)
    if (count === 1) return account
    return { ...account, label: `${account.label} (${String(count)})` }
  })
}

async function collectResetAccounts(): Promise<ResetAccount[]> {
  const config = loadConfig()
  const accounts: ResetAccount[] = []

  if (config.options.codex?.detect === true) {
    try {
      const detected = await detectCodexAccounts()
      for (const account of detected) {
        accounts.push({
          provider: 'codex',
          account,
          label: 'adapter' in account ? 'OpenCode' : 'Codex CLI',
        })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      process.stderr.write(
        `mysubs: could not detect codex accounts: ${reason}\n`
      )
    }
  }

  let configuredNumber = 0
  for (const entry of Object.entries(config.accounts.codex ?? {})) {
    const key = entry[0]
    const account = entry[1]
    configuredNumber++
    accounts.push({
      provider: 'codex',
      account,
      label: configuredLabel(
        account,
        key,
        `Codex configured account ${String(configuredNumber)}`
      ),
    })
  }

  if (config.options['opencode2-codex']?.detect === true) {
    try {
      const detected = await detectOpenCode2CodexAccounts()
      for (const account of detected) {
        accounts.push({
          provider: 'opencode2-codex',
          account,
          label: 'OpenCode 2',
        })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      process.stderr.write(
        `mysubs: could not detect opencode2-codex accounts: ${reason}\n`
      )
    }
  }

  configuredNumber = 0
  for (const entry of Object.entries(
    config.accounts['opencode2-codex'] ?? {}
  )) {
    const key = entry[0]
    const account = entry[1]
    configuredNumber++
    accounts.push({
      provider: 'opencode2-codex',
      account,
      label: configuredLabel(
        account,
        key,
        `OpenCode 2 configured account ${String(configuredNumber)}`
      ),
    })
  }

  return uniqueLabels(accounts)
}

async function chooseIndex(
  prompt: string,
  labels: string[],
  input: readline.Interface
): Promise<number> {
  for (const entry of labels.entries()) {
    const index = entry[0]
    const label = entry[1]
    process.stderr.write(`  ${String(index + 1)}. ${label}\n`)
  }

  while (true) {
    const answer = (
      await input.question(`${prompt} [1-${String(labels.length)}]: `)
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
  const fallback = `Reset credit ${String(index + 1)}`
  const title =
    credit.title === undefined || credit.title === null
      ? fallback
      : safeLabel(credit.title, fallback)
  return `${title} — ${creditExpiry(credit)}`
}

async function fetchCredits(account: ResetAccount): Promise<Response> {
  if (account.provider === 'codex') {
    return fetchCodexResetCredits(account.account)
  }
  if (account.provider === 'opencode2-codex') {
    return fetchOpenCode2ResetCredits(account.account)
  }
  throw new Error('unsupported codex account')
}

async function consumeCredit(
  account: ResetAccount,
  creditID: string,
  redeemRequestID: string
): Promise<Response> {
  if (account.provider === 'codex') {
    return consumeCodexResetCredit(account.account, creditID, redeemRequestID)
  }
  if (account.provider === 'opencode2-codex') {
    return consumeOpenCode2ResetCredit(
      account.account,
      creditID,
      redeemRequestID
    )
  }
  throw new Error('unsupported codex account')
}

async function readCredits(account: ResetAccount) {
  const response = await fetchCredits(account)
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
    (credit) => credit.status === undefined || credit.status === 'available'
  )
}

export async function runCodexReset(): Promise<number> {
  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
    throw new Error('`mysubs codex reset` requires an interactive terminal')
  }

  const accounts = await collectResetAccounts()
  if (accounts.length === 0) {
    throw new Error('no Codex accounts configured or detected')
  }

  const input = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  try {
    process.stderr.write('Which account should be reset?\n')
    const accountIndex = await chooseIndex(
      'Select an account',
      accounts.map((account) => account.label),
      input
    )
    const account = accounts[accountIndex]
    if (account === undefined)
      throw new Error('selected account is unavailable')

    const credits = await readCredits(account)
    if (credits.length === 0) {
      process.stderr.write(
        `No reset credits are available for ${account.label}.\n`
      )
      return 0
    }

    process.stderr.write(`Available reset credits for ${account.label}:\n`)
    const creditIndex = await chooseIndex(
      'Select a reset credit',
      credits.map(creditLabel),
      input
    )
    const credit = credits[creditIndex]
    if (credit === undefined)
      throw new Error('selected reset credit is unavailable')
    const redeemRequestID = randomUUID()

    process.stderr.write(
      `\nThis immediately resets the Codex usage limits for ${account.label}.\n` +
        'The selected reset credit will be permanently consumed. This cannot be undone.\n'
    )
    const confirmation = await input.question(
      'Type "reset" to consume this credit: '
    )
    if (confirmation.trim() !== 'reset') {
      process.stderr.write('Reset cancelled.\n')
      return 0
    }

    const currentCredits = await readCredits(account)
    if (!currentCredits.some((candidate) => candidate.id === credit.id)) {
      process.stderr.write(
        'That reset credit is no longer available. Nothing was changed.\n'
      )
      return 1
    }

    const response = await consumeCredit(account, credit.id, redeemRequestID)
    if (!response.ok) {
      throw new Error(`reset failed (HTTP ${String(response.status)})`)
    }
    const parsed = consumeResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new Error('reset response was not in the expected shape')
    }

    if (
      parsed.data.code === 'reset' ||
      parsed.data.code === 'already_redeemed'
    ) {
      process.stderr.write('Codex usage limits were reset.\n')
      return 0
    }
    if (parsed.data.code === 'nothing_to_reset') {
      process.stderr.write(
        'Codex reports that your usage does not need a reset. The credit was not consumed.\n'
      )
      return 1
    }
    if (parsed.data.code === 'no_credit') {
      process.stderr.write(
        'That reset credit is no longer available. Nothing was changed.\n'
      )
      return 1
    }
    throw new Error(`reset failed with response code "${parsed.data.code}"`)
  } finally {
    input.close()
  }
}
