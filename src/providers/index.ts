// Do not change this file unless the user explicitly asks to write code here.

import type { ProviderEntry } from '../core/provider'
import { fetchClaudeAccount } from './claude'
import { claudeAccountSchema, claudeOptionsSchema } from './claude/config'
import { detectClaudeAccounts } from './claude/detect'
import { fetchCodexAccount } from './codex'
import { codexAccountSchema, codexOptionsSchema } from './codex/config'
import { detectCodexAccounts } from './codex/detect'
import { fetchOpenRouterAccount } from './openrouter'
import {
  openrouterAccountSchema,
  openrouterOptionsSchema,
} from './openrouter/config'
import { detectOpenRouterAccounts } from './openrouter/detect'

export const providers: Record<string, ProviderEntry> = {
  codex: {
    optionsSchema: codexOptionsSchema,
    accountSchema: codexAccountSchema,
    detectDefaults: detectCodexAccounts,
    fetchAccount: fetchCodexAccount,
  },
  claude: {
    optionsSchema: claudeOptionsSchema,
    accountSchema: claudeAccountSchema,
    detectDefaults: detectClaudeAccounts,
    fetchAccount: fetchClaudeAccount,
  },
  openrouter: {
    optionsSchema: openrouterOptionsSchema,
    accountSchema: openrouterAccountSchema,
    detectDefaults: detectOpenRouterAccounts,
    fetchAccount: fetchOpenRouterAccount,
  },
}
