export type ConsumptionResource = {
  kind: 'consumption'
  unit: 'percent' | 'usd'
  used: number
  limit?: number
  remaining?: number
  utilization?: number
  resetsAt?: string
  windowSeconds?: number
}

export type BalanceResource = {
  kind: 'balance'
  unit: 'usd' | 'credits'
  available: number
}

export type UsageResource = ConsumptionResource | BalanceResource

export type ProviderResult = {
  plan?: string
  label?: string
  usage: Record<string, UsageResource>
}
