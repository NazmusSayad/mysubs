#!/usr/bin/env node
import { Command } from '@commander-js/extra-typings'
import readline from 'node:readline'
import { runUsage } from './app'
import { getKeyringEntrySecret, setKeyringEntrySecret } from './lib/keyring'

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

const program = new Command('mysubs')
  .description('check usage across multiple accounts')
  .option('-s, --subs <list>', 'filter providers or accounts')
  .option('-j, --json', 'JSON-only output')
  .option('-f, --force', 'ignore cache and refetch')
  .option('-v, --verbose', 'show sanitized provider request details')
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
