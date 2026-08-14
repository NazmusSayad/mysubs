import type { UsageResource } from './usage'

export type Subscription = {
  provider: string
  account: string
  named: boolean
  source: 'config' | 'detected'
  color?: string
  plan?: string
  label?: string
  usage?: Record<string, UsageResource>
  error?: string
}

export type Report = {
  subscriptions: Subscription[]
}
