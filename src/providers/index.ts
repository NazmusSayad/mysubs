// Do not change this file unless the user explicitly asks to write code here.

import type { ProviderEntry } from '../core/types'
import { fetchAntigravityAccount } from './antigravity'
import {
  antigravityAccountSchema,
  antigravityOptionsSchema,
} from './antigravity/config'
import { detectAntigravityAccounts } from './antigravity/detect'
import { fetchClaudeAccount } from './claude'
import { claudeAccountSchema, claudeOptionsSchema } from './claude/config'
import { detectClaudeAccounts } from './claude/detect'
import { fetchCodexAccount } from './codex'
import { codexAccountSchema, codexOptionsSchema } from './codex/config'
import { detectCodexAccounts } from './codex/detect'
import { fetchCopilotAccount } from './copilot'
import { copilotAccountSchema, copilotOptionsSchema } from './copilot/config'
import { detectCopilotAccounts } from './copilot/detect'
import { fetchOpenCodeAccount } from './opencode'
import { opencodeAccountSchema, opencodeOptionsSchema } from './opencode/config'
import { detectOpenCodeAccounts } from './opencode/detect'
import { fetchOpenCode2CodexAccount } from './opencode2-codex'
import {
  opencode2CodexAccountSchema,
  opencode2CodexOptionsSchema,
} from './opencode2-codex/config'
import { detectOpenCode2CodexAccounts } from './opencode2-codex/detect'
import { fetchOpenRouterAccount } from './openrouter'
import {
  openrouterAccountSchema,
  openrouterOptionsSchema,
} from './openrouter/config'
import { detectOpenRouterAccounts } from './openrouter/detect'

export const providers: Record<string, ProviderEntry> = {
  codex: {
    name: 'Codex',
    color: '#6e5ae6',
    optionsSchema: codexOptionsSchema,
    accountSchema: codexAccountSchema,
    detectDefaults: detectCodexAccounts,
    fetchAccount: fetchCodexAccount,
  },
  'opencode2-codex': {
    name: 'Codex',
    color: '#6e5ae6',
    optionsSchema: opencode2CodexOptionsSchema,
    accountSchema: opencode2CodexAccountSchema,
    detectDefaults: detectOpenCode2CodexAccounts,
    fetchAccount: fetchOpenCode2CodexAccount,
  },
  claude: {
    name: 'Claude',
    color: '#d97757',
    optionsSchema: claudeOptionsSchema,
    accountSchema: claudeAccountSchema,
    detectDefaults: detectClaudeAccounts,
    fetchAccount: fetchClaudeAccount,
  },
  antigravity: {
    name: 'Antigravity',
    color: '#4285f4',
    optionsSchema: antigravityOptionsSchema,
    accountSchema: antigravityAccountSchema,
    detectDefaults: detectAntigravityAccounts,
    fetchAccount: fetchAntigravityAccount,
  },
  copilot: {
    name: 'Copilot',
    color: '#58a6ff',
    optionsSchema: copilotOptionsSchema,
    accountSchema: copilotAccountSchema,
    detectDefaults: detectCopilotAccounts,
    fetchAccount: fetchCopilotAccount,
  },
  openrouter: {
    name: 'OpenRouter',
    color: '#c9ff00',
    optionsSchema: openrouterOptionsSchema,
    accountSchema: openrouterAccountSchema,
    detectDefaults: detectOpenRouterAccounts,
    fetchAccount: fetchOpenRouterAccount,
  },
  opencode: {
    name: 'OpenCode',
    color: '#f2f0e9',
    optionsSchema: opencodeOptionsSchema,
    accountSchema: opencodeAccountSchema,
    detectDefaults: detectOpenCodeAccounts,
    fetchAccount: fetchOpenCodeAccount,
  },
}
