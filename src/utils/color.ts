import { z } from 'zod'

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like "#72317b"')

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const lightnessOffset = lightness - chroma / 2

  let red = 0
  let green = 0
  let blue = 0

  if (hue < 60) {
    red = chroma
    green = second
  } else if (hue < 120) {
    red = second
    green = chroma
  } else if (hue < 180) {
    green = chroma
    blue = second
  } else if (hue < 240) {
    green = second
    blue = chroma
  } else if (hue < 300) {
    red = second
    blue = chroma
  } else {
    red = chroma
    blue = second
  }

  const channels = [red, green, blue].map((channel) =>
    Math.round((channel + lightnessOffset) * 255)
      .toString(16)
      .padStart(2, '0')
  )

  return `#${channels.join('')}`
}

export function generateColor(seed: string): string {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  const hue = Math.abs(hash) % 360
  return hslToHex(hue, 0.55, 0.55)
}
