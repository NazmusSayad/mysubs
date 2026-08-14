import type { OpenRouterAccount } from './config'

export function detectOpenRouterAccounts(): OpenRouterAccount[] {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (apiKey === undefined || apiKey === '') return []
  return [{ apiKey: 'env:OPENROUTER_API_KEY' }]
}
