import { z } from 'zod'

const translationModeSchema = z.enum(['literal', 'marketing_short', 'transcreate', 'ui_full'])
const translationProviderSchema = z.enum(['kie', 'fal', 'openai'])
const textLengthPolicySchema = z.object({
  headlineMaxChars: z.number().int().positive().max(200).optional(),
  subtitleMaxChars: z.number().int().positive().max(300).optional(),
  allowLineBreaks: z.boolean().optional(),
  shrinkFontLimitPercent: z.number().int().min(0).max(50).optional(),
}).optional()
const perScreenshotInstructionSchema = z.union([
  z.string().max(1000),
  z.object({
    headline: z.string().max(160).optional(),
    subtitle: z.string().max(240).optional(),
    instructions: z.string().max(1000).optional(),
    headlineMaxChars: z.number().int().positive().max(200).optional(),
    subtitleMaxChars: z.number().int().positive().max(300).optional(),
  }),
])

export const startJobSchema = z.object({
  projectId: z.string(),
  targetLocales: z.array(z.string().max(100)).min(1).max(200),
  displayTypes: z.array(z.string().max(100)).max(32).optional(),
  screenshotIds: z.array(z.string().max(200)).max(500).optional(), // Legacy: same screenshots for all locales
  screenshotIdsByLocale: z.record(z.string().max(100), z.array(z.string().max(200)).max(500)).refine(value => Object.keys(value).length <= 200, 'Too many locales').optional(), // New: per-locale filtering
  translateInAppText: z.boolean().optional().default(false),
  preserveInPhoneUI: z.boolean().optional(),
  translateMarketingOnly: z.boolean().optional(),
  translationInstructions: z.string().max(4000).optional(),
  translationMode: translationModeSchema.optional(),
  textLengthPolicy: textLengthPolicySchema,
  provider: translationProviderSchema.optional(),
  model: z.string().min(1).max(100).optional(),
  perScreenshotInstructions: z.record(z.string().max(200), perScreenshotInstructionSchema).refine(value => Object.keys(value).length <= 500, 'Too many screenshot instructions').optional(),
})


export const iapTranslateSchema = z.object({
  projectId: z.string(),
  iapId: z.string(),
  targetLocales: z.array(z.string().max(100)).min(1).max(200),
  force: z.boolean().optional().default(false),
})

