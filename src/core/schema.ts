import { z } from 'zod'

export const usageResourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('consumption'),
      unit: z.union([z.literal('percent'), z.literal('usd')]),
      used: z.number(),
      limit: z.number().optional(),
      remaining: z.number().optional(),
      utilization: z.number().optional(),
      resetsAt: z.string().optional(),
      windowSeconds: z.number().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('balance'),
      unit: z.union([z.literal('usd'), z.literal('credits')]),
      available: z.number(),
    })
    .strict(),
])

export const accountUsageResultSchema = z
  .object({
    provider: z.string(),
    cached: z.boolean(),
    color: z.string(),
    sourceName: z.string().optional(),
    sourceType: z.literal('manual').optional(),
    accountInfo: z.string().optional(),
    accountPlan: z.string().optional(),
    error: z.string().optional(),
    usage: z.record(z.string(), usageResourceSchema).optional(),
  })
  .strict()
