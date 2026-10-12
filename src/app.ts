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
  alias?: string
  sourceName?: string
  sourceType?: 'manual'
}

async function detectAccounts(provider: string): Promise<ProviderAccount[]> {
  const entry = providers[provider]
  if (entry === undefined) {
    throw new Error(`unknown provider ${provider}`)
  }

  try {
    return await entry.detectDefaults()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      `mysubs: could not detect ${provider} accounts: ${reason}\n`
    )
    return []
  }
}

function providerOptions(provider: string, cache: boolean): ProviderOptions {
  const entry = providers[provider]
  if (entry === undefined) {
    throw new Error(`unknown provider ${provider}`)
  }
  return entry.optionsSchema.parse({ cache })
}

async function collectAccountTargets(config: Config): Promise<AccountTarget[]> {
  const targets: AccountTarget[] = []

  for (const item of config.accounts) {
    const options = providerOptions(item.provider, item.cache ?? config.cache)

    if (item.auto) {
      for (const account of await detectAccounts(item.provider)) {
        targets.push({
          provider: item.provider,
          account:
            item.info === undefined ? account : { ...account, info: item.info },
          options,
          alias: item.alias,
          sourceName: item.name,
        })
      }
      continue
    }

    const name = item.account.name
    targets.push({
      provider: item.provider,
      account: item.account,
      options,
      alias: item.alias,
      sourceType: 'manual',
      sourceName: typeof name === 'string' && name !== '' ? name : undefined,
    })
  }

  if (config.detect) {
    const listed = new Set(config.accounts.map((item) => item.provider))
    for (const provider of Object.keys(providers)) {
      if (listed.has(provider)) continue
      if (config.skipDetect.includes(provider)) continue
      const options = providerOptions(provider, config.cache)
      for (const account of await detectAccounts(provider)) {
        targets.push({ provider, account, options })
      }
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

    const matches = targets.filter((target) => {
      if (token.endsWith(':')) {
        return (
          target.provider === token.slice(0, -1) &&
          target.sourceType !== 'manual'
        )
      }
      return target.alias === token || target.provider === token
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

  const info = target.account.info
  if (typeof info === 'string') resolved.accountInfo = info
  if (info === false) delete resolved.accountInfo

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
  config?: boolean
}): Promise<number> {
  const config = loadConfig(options.config !== false)
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

  for (const [index, target] of selected.entries()) {
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
          render(
            [resolved],
            config.contrast,
            config.nerdFont,
            config.maxWidth,
            index
          )
        )
      }
    } finally {
      if (stopProgress !== null) stopProgress()
    }
  }

  if (options.json === true) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n')
  }

  return 0
}
