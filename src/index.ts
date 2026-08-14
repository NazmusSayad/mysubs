#!/usr/bin/env node
import { Command } from '@commander-js/extra-typings'
import readline from 'node:readline'
import { configPath, loadConfig } from './core/config'
import { render } from './core/render'
import type {
  AccountUsageResult,
  ProviderAccount,
  ProviderOptions,
} from './core/types'
import { cacheKey } from './lib/crypto'
import { getKeyringEntrySecret, setKeyringEntrySecret } from './lib/keyring'
import { providers } from './providers'
import { parseTTL, readCache, writeCache } from './utils/cache'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function readSecret(prompt: string): Promise<string> {
  process.stderr.write(prompt)

  const input = readline.createInterface({ input: process.stdin })
  const hidden = process.stdin.isTTY === true
  if (hidden) process.stdin.setRawMode(true)

  return new Promise((resolve) => {
    let value = ''

    if (!hidden) {
      input.on('line', (line) => {
        input.close()
        process.stderr.write('\n')
        resolve(line)
      })
      return
    }

    process.stdin.on('data', function onData(chunk: Buffer) {
      for (const byte of chunk) {
        if (byte === 3) {
          process.stdin.setRawMode(false)
          process.stderr.write('\n')
          process.exit(130)
        }
        if (byte === 13 || byte === 10) {
          process.stdin.setRawMode(false)
          process.stdin.removeListener('data', onData)
          input.close()
          process.stderr.write('\n')
          resolve(value)
          return
        }
        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1)
          continue
        }
        value += String.fromCharCode(byte)
      }
    })
  })
}

async function runUsage(options: {
  subs?: string
  json?: boolean
  force?: boolean
}): Promise<number> {
  const config = loadConfig()
  const accountTargets: {
    provider: string
    account: ProviderAccount
    options: ProviderOptions
    sourceName?: string
    sourceType?: 'manual'
  }[] = []

  for (const [provider, entry] of Object.entries(providers)) {
    const configuredAccountNames = new Set<string>()

    for (const account of config.accounts[provider] ?? []) {
      const name = account.name
      if (typeof name === 'string') {
        if (configuredAccountNames.has(name)) {
          throw new Error(`duplicate ${provider} account name: ${name}`)
        }
        configuredAccountNames.add(name)
      }
      accountTargets.push({
        provider,
        account,
        options: config.options[provider],
        ...(typeof name === 'string' ? { sourceName: name } : {}),
        sourceType: 'manual',
      })
    }

    if (!config.detect) continue

    try {
      const detected = await entry.detectDefaults()
      for (const account of detected) {
        accountTargets.push({
          provider,
          account,
          options: config.options[provider],
        })
      }
    } catch {
      continue
    }
  }

  if (accountTargets.length === 0) {
    process.stderr.write(
      `no accounts configured and none detected. create ${configPath()} to add one.\n`
    )
    return 1
  }

  const selectedAccountTargets = [] as typeof accountTargets
  if (options.subs === undefined) {
    selectedAccountTargets.push(...accountTargets)
  } else {
    for (const raw of options.subs.split(',')) {
      const token = raw.trim()
      if (token === '') continue

      const separator = token.indexOf(':')
      const provider = separator === -1 ? token : token.slice(0, separator)
      const account = separator === -1 ? null : token.slice(separator + 1)
      const matches = accountTargets.filter((target) => {
        if (target.provider !== provider) return false
        if (account === null) return true
        return target.sourceName === account
      })

      if (matches.length === 0) {
        throw new Error(`no configured account matches "${token}"`)
      }
      for (const match of matches) {
        if (!selectedAccountTargets.includes(match)) {
          selectedAccountTargets.push(match)
        }
      }
    }
  }

  const ttl = parseTTL(config.cacheTTL)
  const results: AccountUsageResult[] = []
  for (const target of selectedAccountTargets) {
    let accountLabel = target.provider
    if (target.sourceName !== undefined) {
      accountLabel = `${target.provider}:${target.sourceName}`
    }
    const showProgress = options.json !== true && process.stderr.isTTY === true
    let spinnerFrame = 0
    const startedAt = Date.now()
    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    const activities = [
      'connecting',
      'requesting usage',
      'waiting for response',
    ]
    function drawProgress(): void {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
      const activity =
        activities[Math.floor(spinnerFrame / 3) % activities.length]
      process.stderr.write(
        `\r\u001B[2K${spinner[spinnerFrame]} ${activity} ${accountLabel} ${elapsedSeconds}s`
      )
      spinnerFrame = (spinnerFrame + 1) % spinner.length
    }
    let progress: ReturnType<typeof setInterval> | null = null
    let progressVisible = false
    if (showProgress) {
      drawProgress()
      progress = setInterval(drawProgress, 120)
      progressVisible = true
    }

    let resolved: AccountUsageResult | null = null
    try {
      const key = cacheKey(target.provider, target.account)
      if (key !== null && target.options.cache && options.force !== true) {
        const cached = readCache(key, target.provider)
        if (cached !== null) {
          resolved = cached
        }
      }

      if (resolved === null) {
        const result = await providers[target.provider].fetchAccount(
          target.account,
          target.options
        )
        resolved = {
          ...result,
          ...(target.sourceName === undefined
            ? {}
            : { sourceName: target.sourceName }),
          ...(target.sourceType === undefined
            ? {}
            : { sourceType: target.sourceType }),
        }

        if (
          key !== null &&
          target.options.cache &&
          result.error === undefined
        ) {
          try {
            writeCache(key, Date.now() + ttl, resolved)
          } catch {}
        }
      }

      if (progress !== null) {
        clearInterval(progress)
        progress = null
      }
      if (progressVisible) {
        process.stderr.write('\r\u001B[2K')
        progressVisible = false
      }

      results.push(resolved)
      if (options.json !== true) {
        process.stdout.write(`${render([resolved])}\n`)
      }
    } finally {
      if (progress !== null) clearInterval(progress)
      if (progressVisible) process.stderr.write('\r\u001B[2K')
    }
  }

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  }

  if (results.some((result) => result.error !== undefined)) {
    return 1
  }
  return 0
}

const program = new Command('mysubs')
  .description('check usage across multiple accounts')
  .option('--subs <list>', 'filter providers or accounts')
  .option('--json', 'JSON-only output')
  .option('--force', 'ignore cache and refetch')
  .action(async (options) => {
    process.exitCode = await runUsage(options)
  })

const keyCommand = program.command('key').description('manage keyring secrets')

keyCommand
  .command('set <name>')
  .description('store a secret in the OS keyring')
  .action(async (name: string) => {
    const secret = await readSecret(`secret for ${name}: `)
    if (secret === '') {
      process.stderr.write('mysubs: empty secret, nothing stored\n')
      process.exitCode = 1
      return
    }
    setKeyringEntrySecret(name, secret)
    process.stderr.write(`stored ${name}\n`)
  })

keyCommand
  .command('get <name>')
  .description('read a secret from the OS keyring')
  .action((name: string) => {
    const value = getKeyringEntrySecret(name)
    if (value === null) {
      process.stderr.write(`mysubs: no keyring entry named ${name}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(`${value}\n`)
  })

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    process.stderr.write(`mysubs: ${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}

void main()
