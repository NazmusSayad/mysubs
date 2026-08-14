import { Chalk, type ChalkInstance } from 'chalk'
import { formatDuration, formatMoney, formatPercent } from '../utils/format'
import type {
  AccountSubscriptionBalanceUsage,
  AccountSubscriptionConsumptionUsage,
  AccountUsageResult,
} from './types'

type UsageResource =
  AccountSubscriptionBalanceUsage | AccountSubscriptionConsumptionUsage

function createChalk(): ChalkInstance {
  const noColor = process.env.NO_COLOR
  if (noColor !== undefined && noColor !== '') return new Chalk({ level: 0 })
  return new Chalk()
}

const chalk = createChalk()

const PADDING = 1
const ACCOUNT_INDENT = 2
const ROW_INDENT = 4
const GAP = 2
const MIN_BAR_WIDTH = 10

type Row =
  | {
      kind: 'bar'
      label: string
      ratio: number
      used: number
      value: string
      detail: string
    }
  | {
      kind: 'text'
      label: string
      text: string
      tone: 'normal' | 'dim' | 'error'
    }

function labelText(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
}

function resetDetail(resource: UsageResource): string {
  if (resource.kind !== 'consumption') return ''
  if (resource.resetsAt === undefined) return ''

  const at = Date.parse(resource.resetsAt)
  if (Number.isNaN(at)) return ''
  return formatDuration(at - Date.now())
}

function barRow(label: string, resource: UsageResource): Row | null {
  if (resource.kind !== 'consumption') return null
  if (resource.limit === undefined) return null
  if (resource.limit <= 0) return null

  const ratio = resource.used / resource.limit

  let detail = resetDetail(resource)
  if (detail === '' && resource.unit === 'usd') {
    if (resource.remaining !== undefined) {
      detail = `${formatMoney(resource.remaining)} left`
    }
  }

  return {
    kind: 'bar',
    label,
    ratio,
    used: resource.used,
    value: formatPercent(ratio * 100),
    detail,
  }
}

function spendRow(usage: Record<string, UsageResource>): Row | null {
  const parts: string[] = []

  for (const key of ['today', 'week', 'month']) {
    const resource = usage[key]
    if (resource === undefined) continue
    if (resource.kind !== 'consumption') continue
    parts.push(`${key} ${formatMoney(resource.used)}`)
  }

  if (parts.length === 0) return null
  return { kind: 'text', label: 'spend', text: parts.join('   '), tone: 'dim' }
}

function rowsFor(subscription: AccountUsageResult): Row[] {
  if (subscription.error !== undefined) {
    return [
      { kind: 'text', label: 'error', text: subscription.error, tone: 'error' },
    ]
  }

  const usage = subscription.usage ?? {}
  const rows: Row[] = []
  const spend = spendRow(usage)

  for (const [key, resource] of Object.entries(usage)) {
    if (key === 'today' || key === 'week' || key === 'month') continue
    if (key === 'creditValue') continue

    if (key === 'balance') {
      const credits = usage.credits
      if (credits !== undefined && credits.kind === 'consumption') continue
    }

    if (key === 'credits' && resource.kind === 'balance') {
      const value = usage.creditValue
      if (value !== undefined && value.kind === 'balance') {
        rows.push({
          kind: 'text',
          label: 'credits',
          text: formatMoney(value.available),
          tone: 'normal',
        })
        continue
      }
    }

    const bar = barRow(labelText(key), resource)
    if (bar !== null) {
      rows.push(bar)
      continue
    }

    if (resource.kind === 'balance') {
      const text =
        resource.unit === 'credits'
          ? `${String(resource.available)} credits`
          : formatMoney(resource.available)
      rows.push({ kind: 'text', label: labelText(key), text, tone: 'normal' })
      continue
    }

    rows.push({
      kind: 'text',
      label: labelText(key),
      text: formatMoney(resource.used),
      tone: 'normal',
    })
  }

  if (spend !== null) rows.push(spend)

  if (rows.length === 0) {
    rows.push({ kind: 'text', label: '', text: 'no usage data', tone: 'dim' })
  }

  return rows
}

function drawBar(row: Row, width: number, color: string): string {
  if (row.kind !== 'bar') return ''

  let fill = Math.round(Math.min(1, Math.max(0, row.ratio)) * width)
  if (fill === 0 && row.used > 0) fill = 1

  return (
    chalk.hex(color)('█'.repeat(fill)) + chalk.dim('░'.repeat(width - fill))
  )
}

export function render(results: AccountUsageResult[]): string {
  if (results.length === 0) return ''

  const rows = results.flatMap(rowsFor)
  const labelWidth = Math.max(...rows.map((row) => row.label.length))
  const bars = rows.filter((row) => row.kind === 'bar')

  const valueWidth =
    bars.length === 0 ? 0 : Math.max(...bars.map((row) => row.value.length))
  const detailWidth =
    bars.length === 0 ? 0 : Math.max(...bars.map((row) => row.detail.length))

  const available = (process.stdout.columns ?? 80) - PADDING * 2
  const fixedRowWidth =
    ROW_INDENT +
    labelWidth +
    GAP +
    GAP +
    valueWidth +
    (detailWidth === 0 ? 0 : GAP + detailWidth)
  const barWidth = Math.max(MIN_BAR_WIDTH, available - fixedRowWidth)

  const pad = ' '.repeat(PADDING)
  const lines: string[] = []
  let provider: string | null = null

  for (const result of results) {
    const heading = result.provider !== provider
    if (heading) {
      provider = result.provider
      lines.push('')
      lines.push(pad + chalk.bold.hex(result.color)(result.provider))
    }

    if (!heading) lines.push('')

    const name = result.sourceName ?? result.accountInfo ?? result.provider
    const label = result.accountInfo ?? ''
    const plan = result.accountPlan ?? ''

    let head: string
    if (label === '') {
      head = chalk.hex(result.color)(name)
    } else if (result.sourceName !== undefined) {
      head = chalk.hex(result.color)(name) + ' '.repeat(GAP) + chalk.dim(label)
    } else {
      head = chalk.hex(result.color)(label)
    }

    lines.push(
      pad +
        ' '.repeat(ACCOUNT_INDENT) +
        head +
        (plan === '' ? '' : chalk.dim(` · ${plan}`))
    )

    for (const row of rowsFor(result)) {
      const label = row.label.padEnd(labelWidth)
      const prefix = pad + ' '.repeat(ROW_INDENT)

      if (row.kind === 'bar') {
        const detail =
          row.detail === '' ? '' : ' '.repeat(GAP) + chalk.dim(row.detail)
        lines.push(
          prefix +
            label +
            ' '.repeat(GAP) +
            drawBar(row, barWidth, result.color) +
            ' '.repeat(GAP) +
            row.value.padStart(valueWidth) +
            detail
        )
        continue
      }

      if (row.tone === 'error') {
        lines.push(
          prefix + chalk.red(label) + ' '.repeat(GAP) + chalk.red(row.text)
        )
        continue
      }

      if (row.tone === 'dim') {
        lines.push(prefix + label + ' '.repeat(GAP) + chalk.dim(row.text))
        continue
      }

      lines.push(prefix + label + ' '.repeat(GAP) + row.text)
    }
  }

  lines.push('')
  return lines.join('\n')
}
