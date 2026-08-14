import { z } from 'zod'

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like "#72317b"')
