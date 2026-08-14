import { Chalk, type ChalkInstance } from 'chalk'
import { usageColor } from '../lib/color'
import { providers } from '../providers'
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
const ROW_INDENT = 2
const BAR_MARGIN_LEFT = 2
const BAR_MARGIN_RIGHT = 1
const DETAIL_GAP = 1
const LABEL_WIDTH = 11
const VALUE_WIDTH = 4
const DETAIL_WIDTH = 12
const MIN_BAR_WIDTH = 10
const TRACK_COLOR = '#3f434d'
const BLOCK = '█'
const NERD_BLOCK = '󰝤'

type Row =
  | {
      kind: 'bar'
      label: string
      ratio: number
      remaining: number
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

  const remaining = Math.max(0, resource.limit - resource.used)
  const ratio = remaining / resource.limit

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
    remaining,
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

function drawBar(
  row: Row,
  width: number,
  contrast: number,
  nerdFont: boolean
): string {
  if (row.kind !== 'bar') return ''

  let block = BLOCK
  if (nerdFont) block = NERD_BLOCK

  let fill = Math.round(Math.min(1, Math.max(0, row.ratio)) * width)
  if (fill === 0 && row.remaining > 0) fill = 1

  return (
    chalk.hex(usageColor(row.ratio, contrast))(block.repeat(fill)) +
    chalk.hex(TRACK_COLOR)(block.repeat(width - fill))
  )
}

export function render(
  results: AccountUsageResult[],
  contrast: number,
  nerdFont: boolean
): string {
  if (results.length === 0) return ''

  const rendered = results.map((result) => ({ result, rows: rowsFor(result) }))

  const available = (process.stdout.columns ?? 80) - PADDING * 2
  const fullBarWidth = Math.max(
    MIN_BAR_WIDTH,
    available -
      ROW_INDENT -
      LABEL_WIDTH -
      BAR_MARGIN_LEFT -
      BAR_MARGIN_RIGHT -
      VALUE_WIDTH -
      DETAIL_GAP -
      DETAIL_WIDTH
  )

  const pad = ' '.repeat(PADDING)
  const lines: string[] = []

  for (const { result, rows: resultRows } of rendered) {
    const provider = providers[result.provider]
    if (provider === undefined) {
      throw new Error(`unknown provider ${result.provider}`)
    }

    let head = chalk.bold.hex(provider.color)(provider.name)
    let headWidth = provider.name.length

    if (result.sourceName !== undefined) {
      head += ` ${chalk.dim(result.sourceName)}`
      headWidth += 1 + result.sourceName.length
    }
    if (result.accountInfo !== undefined) {
      head += chalk.dim(' › ') + chalk.hex(provider.color)(result.accountInfo)
      headWidth += 3 + result.accountInfo.length
    }
    if (result.accountPlan !== undefined) {
      head += chalk.dim(` · ${result.accountPlan}`)
      headWidth += 3 + result.accountPlan.length
    }
    if (result.cached) {
      const marker = '♲ cached'
      const spacing = Math.max(
        BAR_MARGIN_LEFT,
        available - headWidth - marker.length
      )
      head += ' '.repeat(spacing) + chalk.dim(marker)
    }

    lines.push('')
    lines.push(pad + head)

    for (const row of resultRows) {
      const rowLabel = row.label.padEnd(LABEL_WIDTH)
      const prefix = pad + ' '.repeat(ROW_INDENT)

      if (row.kind === 'bar') {
        const overflow = Math.max(0, row.label.length - LABEL_WIDTH)
        const barWidth = Math.max(MIN_BAR_WIDTH, fullBarWidth - overflow)
        const detail =
          row.detail === ''
            ? ''
            : ' '.repeat(DETAIL_GAP) + chalk.dim(row.detail)
        lines.push(
          prefix +
            rowLabel +
            ' '.repeat(BAR_MARGIN_LEFT) +
            drawBar(row, barWidth, contrast, nerdFont) +
            ' '.repeat(BAR_MARGIN_RIGHT) +
            chalk.hex(usageColor(row.ratio, contrast))(
              row.value.padStart(VALUE_WIDTH)
            ) +
            detail
        )
        continue
      }

      if (row.tone === 'error') {
        lines.push(
          prefix +
            chalk.red(rowLabel) +
            ' '.repeat(BAR_MARGIN_LEFT) +
            chalk.red(row.text)
        )
        continue
      }

      if (row.tone === 'dim') {
        lines.push(
          prefix + rowLabel + ' '.repeat(BAR_MARGIN_LEFT) + chalk.dim(row.text)
        )
        continue
      }

      lines.push(prefix + rowLabel + ' '.repeat(BAR_MARGIN_LEFT) + row.text)
    }
  }

  lines.push('')
  return lines.join('\n')
}
