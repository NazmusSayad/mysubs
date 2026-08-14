import { z } from 'zod'
import type { BaseProvider } from '../core/provider'
import { ClaudeProvider } from './claude'
import { claudeAccountSchema } from './claude/config'
import { detectClaudeAccounts } from './claude/detect'
import { CodexProvider } from './codex'
import { codexAccountSchema } from './codex/config'
import { detectCodexAccounts } from './codex/detect'
import { OpenRouterProvider } from './openrouter'
import { openrouterAccountSchema } from './openrouter/config'
import { detectOpenRouterAccounts } from './openrouter/detect'

type ProviderEntry = {
  accountSchema: z.ZodType
  Provider: typeof BaseProvider
  detectDefaultAccounts: () => unknown[]
}

export const providers: Record<string, ProviderEntry> = {
  codex: {
    Provider: CodexProvider,
    accountSchema: codexAccountSchema,
    detectDefaultAccounts: detectCodexAccounts,
  },
  claude: {
    Provider: ClaudeProvider,
    accountSchema: claudeAccountSchema,
    detectDefaultAccounts: detectClaudeAccounts,
  },
  openrouter: {
    Provider: OpenRouterProvider,
    accountSchema: openrouterAccountSchema,
    detectDefaultAccounts: detectOpenRouterAccounts,
  },
}
