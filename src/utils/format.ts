export function formatMoney(amount: number): string {
  if (amount !== 0 && Math.abs(amount) < 0.01) {
    return `$${amount.toFixed(4)}`
  }
  return `$${amount.toFixed(2)}`
}

export function formatPercent(value: number): string {
  return `${String(Math.round(value))}%`
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${String(days)}d ${String(hours)}h`
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`
  return `${String(minutes)}m`
}
