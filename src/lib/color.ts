const HUE_AT_FULL = 130
const LIGHTNESS = 0.48

function channel(hue: number, saturation: number, offset: number): number {
  const amplitude = saturation * Math.min(LIGHTNESS, 1 - LIGHTNESS)
  const position = (offset + hue / 30) % 12
  const shift = Math.max(-1, Math.min(position - 3, 9 - position, 1))
  return Math.round((LIGHTNESS - amplitude * shift) * 255)
}

export function usageColor(ratio: number, contrast: number): string {
  if (!Number.isFinite(ratio)) throw new Error(`invalid usage ratio: ${ratio}`)
  if (!Number.isFinite(contrast))
    throw new Error(`invalid contrast: ${contrast}`)

  const hue = Math.max(0, Math.min(1, ratio)) * HUE_AT_FULL
  const saturation = Math.max(0, Math.min(1, contrast))

  const red = channel(hue, saturation, 0)
  const green = channel(hue, saturation, 8)
  const blue = channel(hue, saturation, 4)

  return `#${[red, green, blue]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')}`
}
