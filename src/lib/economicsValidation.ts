import { z } from "zod";
import { LENGTH_CATEGORIES } from "@/lib/wallet";
import type { FeeRules, JudgingMode } from "@/components/admin/CompetitionFeeRulesEditor";

/** Hard bounds — kept in one place so client + preview + save all agree. */
export const FEE_MIN = 0;
export const FEE_MAX = 100_000;
export const SURCHARGE_MIN = 0.1;
export const SURCHARGE_MAX = 10;
export const PRIZE_POOL_PCT_MIN = 0;
export const PRIZE_POOL_PCT_MAX = 50;
export const MAX_CUSTOM_SPLITS = 20;

const CATEGORY_KEYS = LENGTH_CATEGORIES.map((c) => c.key) as [string, ...string[]];

const feeNumber = z
  .number({ invalid_type_error: "Must be a number" })
  .finite("Must be finite")
  .min(FEE_MIN, `Cannot be below ${FEE_MIN}`)
  .max(FEE_MAX, `Cannot exceed ${FEE_MAX.toLocaleString()}`);

const baseSchema = z.record(z.enum(CATEGORY_KEYS), feeNumber);
const overrideSchema = z.record(z.enum(CATEGORY_KEYS), feeNumber.optional());

export const feeRulesSchema = z.object({
  base: baseSchema,
  by_mode: z
    .object({
      ai_only: overrideSchema.optional(),
      human_only: overrideSchema.optional(),
      hybrid: overrideSchema.optional(),
    })
    .optional(),
});


const distributionModeEnum = z.enum(["top_1", "top_3", "custom"]);

export const economicsPayloadSchema = z
  .object({
    feeRules: feeRulesSchema,
    surcharges: z.record(
      z.string(),
      z.object({
        multiplier: z
          .number()
          .min(SURCHARGE_MIN, `Multiplier must be ≥ ${SURCHARGE_MIN}`)
          .max(SURCHARGE_MAX, `Multiplier must be ≤ ${SURCHARGE_MAX}`),
        flat: z.number().min(0).max(FEE_MAX),
      }),
    ),
    prizePoolPct: z
      .number()
      .min(PRIZE_POOL_PCT_MIN, `Must be ≥ ${PRIZE_POOL_PCT_MIN}%`)
      .max(PRIZE_POOL_PCT_MAX, `Must be ≤ ${PRIZE_POOL_PCT_MAX}%`),
    distributionMode: distributionModeEnum,
    distributionSplits: z.array(z.number().min(0).max(100)).min(1),
  })
  .superRefine((val, ctx) => {
    // Mode ↔ splits are mutually constrained.
    if (val.distributionMode === "top_1" && val.distributionSplits.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionSplits"],
        message: "Winner-takes-all requires exactly one split of 100%.",
      });
    }
    if (val.distributionMode === "top_3" && val.distributionSplits.length !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionSplits"],
        message: "Top-3 requires exactly three splits.",
      });
    }
    if (val.distributionMode === "custom" && val.distributionSplits.length > MAX_CUSTOM_SPLITS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionSplits"],
        message: `Custom splits cannot exceed ${MAX_CUSTOM_SPLITS} rows.`,
      });
    }

    // Splits must sum to exactly 100.
    const sum = val.distributionSplits.reduce((a, b) => a + b, 0);
    if (Math.round(sum * 100) / 100 !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["distributionSplits"],
        message: `Splits must sum to 100% (currently ${sum}%).`,
      });
    }

    // Overrides must not equal the base (that's noise, not an override).
    const modes: JudgingMode[] = ["ai_only", "human_only", "hybrid"];
    for (const m of modes) {
      const bucket = val.feeRules.by_mode?.[m];
      if (!bucket) continue;
      for (const [cat, v] of Object.entries(bucket)) {
        if (typeof v === "number" && v === val.feeRules.base[cat]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["feeRules", "by_mode", m, cat],
            message: "Override equals base — clear it to inherit.",
          });
        }
      }
    }

    // Prize-pool contribution cannot swallow the entire fee.
    if (val.prizePoolPct >= PRIZE_POOL_PCT_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prizePoolPct"],
        message: `Contribution must stay below ${PRIZE_POOL_PCT_MAX}% to preserve margin.`,
      });
    }
  });

export type EconomicsPayload = z.infer<typeof economicsPayloadSchema>;

/** Flatten zod issues into a { path: message } map for inline field rendering. */
export function flattenIssues(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
