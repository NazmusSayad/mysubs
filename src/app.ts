import { configPath, loadConfig, type Config } from './core/config'
import { render } from './core/render'
import type {
  AccountUsageResult,
  ProviderAccount,
  ProviderOptions,
} from './core/types'
import { cacheKey } from './lib/crypto'
import { providers } from './providers'
import { parseTTL, readCache, writeCache } from './utils/cache'
import { startProgress } from './utils/progress'

type AccountTarget = {
  provider: string
  account: ProviderAccount
  options: ProviderOptions
  sourceKey?: string
  sourceName?: string
  sourceType?: 'manual'
}

async function collectAccountTargets(config: Config): Promise<AccountTarget[]> {
  const targets: AccountTarget[] = []

  for (const [provider, entry] of Object.entries(providers)) {
    const options = config.options[provider]
    if (options === undefined) {
      throw new Error(`no options were loaded for provider ${provider}`)
    }

    if (config.detect && options.detect) {
      try {
        const detected = await entry.detectDefaults()
        for (const account of detected) {
          targets.push({ provider, account, options })
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        process.stderr.write(
          `mysubs: could not detect ${provider} accounts: ${reason}\n`
        )
      }
    }

    for (const [key, account] of Object.entries(
      config.accounts[provider] ?? {}
    )) {
      const name = account.name
      targets.push({
        provider,
        account,
        options,
        sourceKey: key,
        sourceType: 'manual',
        sourceName: typeof name === 'string' && name !== '' ? name : undefined,
      })
    }
  }

  return targets
}

function selectAccountTargets(
  targets: AccountTarget[],
  subs: string[] | undefined
): AccountTarget[] {
  if (subs === undefined || subs.length === 0) return [...targets]

  const selected: AccountTarget[] = []
  for (const raw of subs) {
    const token = raw.trim()
    if (token === '') continue

    const separator = token.indexOf(':')
    const provider = separator === -1 ? token : token.slice(0, separator)
    const account = separator === -1 ? null : token.slice(separator + 1)

    const matches = targets.filter((target) => {
      if (target.provider !== provider) return false
      if (account === null) return true
      return target.sourceKey === account
    })

    if (matches.length === 0) {
      throw new Error(`no configured account matches "${token}"`)
    }
    for (const match of matches) {
      if (!selected.includes(match)) selected.push(match)
    }
  }

  return selected
}

async function resolveAccount(
  target: AccountTarget,
  ttl: number,
  force: boolean,
  verbose: boolean
): Promise<AccountUsageResult> {
  const entry = providers[target.provider]
  if (entry === undefined) {
    throw new Error(`unknown provider ${target.provider}`)
  }

  const key = cacheKey(target.provider, target.account)
  if (key !== null && target.options.cache && !force) {
    const cached = readCache(key, target.provider)
    if (cached !== null) return { ...cached, cached: true }
  }

  const result = await entry.fetchAccount(target.account, {
    ...target.options,
    ...(verbose ? { verbose: true } : {}),
  })
  const resolved: AccountUsageResult = {
    ...result,
    cached: false,
    ...(target.sourceName === undefined
      ? {}
      : { sourceName: target.sourceName }),
    ...(target.sourceType === undefined
      ? {}
      : { sourceType: target.sourceType }),
  }

  if (key !== null && target.options.cache && result.error === undefined) {
    try {
      writeCache(key, Date.now() + ttl, resolved)
    } catch {}
  }

  return resolved
}

export async function runUsage(options: {
  subs?: string[]
  json?: boolean
  force?: boolean
  verbose?: boolean
}): Promise<number> {
  const config = loadConfig()
  const accountTargets = await collectAccountTargets(config)

  if (accountTargets.length === 0) {
    process.stderr.write(
      `no accounts configured and none detected. create ${configPath()} to add one.\n`
    )
    return 1
  }

  const selected = selectAccountTargets(accountTargets, options.subs)
  const ttl = parseTTL(config.cacheTTL)
  const showProgress = options.json !== true && process.stderr.isTTY === true

  const results: AccountUsageResult[] = []

  for (const target of selected) {
    let label = target.provider
    if (target.sourceName !== undefined) {
      label = `${target.provider}:${target.sourceName}`
    }

    let stopProgress: (() => void) | null = null
    if (showProgress) stopProgress = startProgress(label)

    try {
      const resolved = await resolveAccount(
        target,
        ttl,
        options.force === true || options.verbose === true,
        options.verbose === true
      )

      if (stopProgress !== null) {
        stopProgress()
        stopProgress = null
      }

      results.push(resolved)
      if (options.json !== true) {
        process.stdout.write(
          `${render([resolved], config.contrast, config.nerdFont, config.maxWidth)}\n`
        )
      }
    } finally {
      if (stopProgress !== null) stopProgress()
    }
  }

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  }

  return 0
}
