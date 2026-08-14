import { spawnSync } from 'node:child_process'

const GH_BIN = 'gh'
const GH_TIMEOUT_MS = 5000

export type GhTokenResult =
  | { kind: 'token'; token: string }
  | { kind: 'missing' }
  | { kind: 'unauthenticated' }

export function readGhToken(): GhTokenResult {
  const result = spawnSync(GH_BIN, ['auth', 'token'], {
    encoding: 'utf8',
    timeout: GH_TIMEOUT_MS,
  })

  if (result.error !== undefined) return { kind: 'missing' }
  if (result.status !== 0) return { kind: 'unauthenticated' }

  const token = result.stdout.trim()
  if (token === '') return { kind: 'unauthenticated' }
  return { kind: 'token', token }
}

export async function detectCopilotAccounts() {
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN']) {
    const value = process.env[name]
    if (value === undefined || value === '') continue
    return [
      {
        source: 'token' as const,
        token: `env:${name}`,
        __type: 'account' as const,
      },
    ]
  }

  if (readGhToken().kind === 'token') {
    return [{ source: 'gh' as const, __type: 'account' as const }]
  }
  return []
}
