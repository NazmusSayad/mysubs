export async function detectOpenRouterAccounts() {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (apiKey === undefined || apiKey === '') return []
  return [{ apiKey: 'env:OPENROUTER_API_KEY', __type: 'account' as const }]
}
