export async function detectOpenCodeAccounts() {
  const apiKey = process.env.OPENCODE_API_KEY
  if (apiKey === undefined || apiKey === '') return []
  return [
    {
      product: 'go' as const,
      apiKey: 'env:OPENCODE_API_KEY',
      __type: 'account' as const,
    },
  ]
}
