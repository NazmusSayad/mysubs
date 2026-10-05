import fs from 'node:fs'
import type {
  AccountUsageResult,
  ProviderAccount,
  ProviderOptions,
} from '../../core/types'
import { fetchUsageResponse, jwtName, mapUsage, usageSchema } from '../codex'
import { opencode2CodexAccountSchema } from './config'
import { opencodeDatabasePath, readOpenCodeCredentials } from './store'

export async function fetchOpenCode2CodexAccount(
  account: ProviderAccount,
  _options: ProviderOptions
): Promise<AccountUsageResult> {
  try {
    const parsed = opencode2CodexAccountSchema.parse(account)
    const databasePath = opencodeDatabasePath(parsed.databasePath)
    if (!fs.existsSync(databasePath)) {
      throw new Error(`no opencode database at ${databasePath}`)
    }

    const credential = readOpenCodeCredentials(databasePath).find(
      (item) => item.id === parsed.credentialID
    )
    if (credential === undefined) {
      throw new Error(
        'no codex oauth login in opencode, sign in via `opencode auth login`'
      )
    }
    if (credential.expires <= Date.now()) {
      throw new Error('session expired, open opencode to refresh it')
    }

    const response = await fetchUsageResponse(
      credential.access,
      credential.accountID
    )
    if (response.status === 401 || response.status === 403) {
      throw new Error('session expired, open opencode to refresh it')
    }
    if (!response.ok) {
      throw new Error(
        `codex usage request failed (HTTP ${String(response.status)})`
      )
    }

    const body = usageSchema.safeParse(await response.json())
    if (!body.success) {
      throw new Error('codex usage response was not in the expected shape')
    }

    const result: AccountUsageResult = {
      ...mapUsage(body.data, response),
      provider: 'opencode2-codex',
    }

    const name = jwtName(credential.access)
    if (name !== null) result.accountInfo = name

    return result
  } catch (error) {
    return {
      provider: 'opencode2-codex',
      cached: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
