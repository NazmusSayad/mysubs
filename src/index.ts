#!/usr/bin/env node
import { Command } from '@commander-js/extra-typings'
import readline from 'node:readline'
import { resolveAccounts, type ResolvedAccount } from './accounts'
import { configPath, loadConfig } from './config'
import { fetchProviderUsages } from './fetch'
import { render } from './render'
import { getKey, setKey } from './utils/keyring'

function select(
  all: ResolvedAccount[],
  subs: string | undefined
): ResolvedAccount[] {
  if (subs === undefined) return all

  const selected: ResolvedAccount[] = []
  for (const raw of subs.split(',')) {
    const token = raw.trim()
    if (token === '') continue

    const separator = token.indexOf(':')
    const provider = separator === -1 ? token : token.slice(0, separator)
    const account = separator === -1 ? null : token.slice(separator + 1)

    const matches = all.filter((target) => {
      if (target.provider !== provider) return false
      if (account === null) return true
      return target.name === account
    })

    if (matches.length === 0) {
      const configured = all
        .map((target) => `${target.provider}:${target.name}`)
        .join(', ')
      throw new Error(
        `no configured account matches "${token}". configured: ${configured === '' ? '(none)' : configured}`
      )
    }

    for (const match of matches) {
      if (!selected.includes(match)) selected.push(match)
    }
  }

  return selected
}

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
  const all = resolveAccounts(config)

  if (all.length === 0) {
    process.stderr.write(
      `no accounts configured and none detected.\n\ncreate ${configPath()}:\n\n${JSON.stringify(
        {
          codex: { accounts: [{ name: 'personal', configDir: '~/.codex' }] },
          openrouter: {
            accounts: [{ name: 'personal', apiKey: 'env:OPENROUTER_API_KEY' }],
          },
        },
        null,
        2
      )}\n`
    )
    return 1
  }

  const report = await fetchProviderUsages(select(all, options.subs), config, {
    force: options.force,
  })

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(`${render(report)}\n`)
  }

  if (
    report.subscriptions.some(
      (subscription) => subscription.error !== undefined
    )
  ) {
    return 1
  }
  return 0
}

const program = new Command('mysubs')
  .description('check usage across multiple accounts')
  .option(
    '--subs <list>',
    'filter providers/accounts, e.g. codex,openrouter:work'
  )
  .option('--json', 'JSON-only output')
  .option('--force', 'ignore cache and refetch')
  .action(async (options) => {
    process.exitCode = await runUsage(options)
  })

const key = program.command('key').description('manage keyring secrets')

key
  .command('set <name>')
  .description('store a secret in the OS keyring')
  .action(async (name: string) => {
    const secret = await readSecret(`secret for ${name}: `)
    if (secret === '') {
      process.stderr.write('mysubs: empty secret, nothing stored\n')
      process.exitCode = 1
      return
    }
    setKey(name, secret)
    process.stderr.write(`stored ${name}\n`)
  })

key
  .command('get <name>')
  .description('read a secret from the OS keyring')
  .action((name: string) => {
    const value = getKey(name)
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
