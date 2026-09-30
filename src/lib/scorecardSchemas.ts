// Runtime schemas for the canonical scorecard bundle.
// ----------------------------------------------------------------------------
// The unified scorecard merges three inputs:
//   1. `v_entry_scorecard` (finalized > panel_consensus > grading_reports_avg)
//   2. per-tier `DimensionBreakdown` (finalized/panel/reports)
//   3. `structured_reviews` (qualitative rows)
//
// Every consumer (Insights, Leaderboard, Judges Console) reads through
// `useScorecard`, which pipes each of those inputs through the schemas
// below. Bad rows are dropped (never coerced into `NaN` or `undefined`),
// which prevents the merged shape from silently drifting when a new
// column, tier, or reviewer field is added upstream.
import { z } from "zod";

/** Literal union of every quantitative dimension on the scorecard. */
export const DIMENSION_KEYS = [
  "originality",
  "structure",
  "character_depth",
  "dialogue",
  "theme",
  "emotion",
  "format_adherence",
  "market",
  "visual",
  "narrative",
  "character_score",
  "emotional",
  "franchise",
  "production",
  "audience",
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** `source` column on `v_entry_scorecard`. */
export const scorecardSourceSchema = z.enum([
  "finalized",
  "panel_consensus",
  "grading_reports_avg",
  "none",
]);
export type ScorecardSource = z.infer<typeof scorecardSourceSchema>;

// A nullable number that also accepts numeric strings (PostgREST returns
// numeric columns as strings under some settings) and coerces empty
// strings / NaN back to null instead of leaking corrupt data.
const nullableNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  })
  .pipe(z.number().nullable());

const dimensionRecord = z.record(
  z.enum(DIMENSION_KEYS),
  z.number(),
);
export type DimensionRecord = z.infer<typeof dimensionRecord>;

/** Row shape produced by `readScorecardResult` for one entry. */
export const entryScorecardSchema = z.object({
  entry_id: z.string().min(1),
  source: scorecardSourceSchema.catch("none"),
  total_score: nullableNumber,
  originality: nullableNumber,
  structure: nullableNumber,
  character_depth: nullableNumber,
  dialogue: nullableNumber,
  theme: nullableNumber,
  emotion: nullableNumber,
  format_adherence: nullableNumber,
  market: nullableNumber,
  visual: nullableNumber,
  narrative: nullableNumber,
  character_score: nullableNumber,
  emotional: nullableNumber,
  franchise: nullableNumber,
  production: nullableNumber,
  audience: nullableNumber,
  finalized_model_id: z.string().nullable().catch(null),
  judge_count: nullableNumber,
  panel_model_count: nullableNumber,
  grading_report_count: nullableNumber,
  rubric_preset: z.string().nullable().catch(null),
  rubric_version: nullableNumber,
  updated_at: z.string().nullable().catch(null),
});
export type EntryScorecardValidated = z.infer<typeof entryScorecardSchema>;

/** Per-tier dimension breakdown returned by `readScorecardBreakdown`. */
export const dimensionBreakdownSchema = z.object({
  finalized: dimensionRecord.nullable(),
  panel: z
    .object({ averages: dimensionRecord, contributors: z.number().int().nonnegative() })
    .nullable(),
  reports: z
    .object({ averages: dimensionRecord, contributors: z.number().int().nonnegative() })
    .nullable(),
});
export type DimensionBreakdownValidated = z.infer<typeof dimensionBreakdownSchema>;

/** One qualitative review from `public.structured_reviews`. */
export const structuredReviewRowSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  reviewer_id: z.string().min(1),
  version_id: z.string().nullable().catch(null),
  visibility: z.string().catch("private"),
  strengths: z.string().catch(""),
  concerns: z.string().catch(""),
  narrative_observations: z.string().catch(""),
  clarity_signals: z.string().catch(""),
  overall_notes: z.string().catch(""),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ScorecardReviewRow = z.infer<typeof structuredReviewRowSchema>;

/** Full merged bundle rendered by `UnifiedScorecard`. */
export const scorecardBundleSchema = z.object({
  entryId: z.string().min(1),
  scorecard: entryScorecardSchema.nullable(),
  breakdown: dimensionBreakdownSchema,
  reviews: z.array(structuredReviewRowSchema),
});
export type ScorecardBundle = z.infer<typeof scorecardBundleSchema>;

// ---------------------------------------------------------------------------
// Safe parsers — drop invalid rows instead of throwing.
// ---------------------------------------------------------------------------

/**
 * Validate an array of `structured_reviews` rows fetched from PostgREST.
 * Invalid rows are dropped and a single console warning is emitted per batch
 * so drift is visible in dev without breaking the render.
 */
export function parseStructuredReviews(input: unknown): ScorecardReviewRow[] {
  if (!Array.isArray(input)) return [];
  const out: ScorecardReviewRow[] = [];
  let dropped = 0;
  for (const raw of input) {
    const res = structuredReviewRowSchema.safeParse(raw);
    if (res.success) out.push(res.data);
    else dropped++;
  }
  if (dropped > 0 && typeof console !== "undefined") {
    console.warn(
      `[scorecard] dropped ${dropped}/${input.length} structured_reviews row(s) that failed schema validation`,
    );
  }
  return out;
}

/** Validate one merged `EntryScorecard` row. Returns null on total failure. */
export function parseEntryScorecard(input: unknown): EntryScorecardValidated | null {
  if (input == null) return null;
  const res = entryScorecardSchema.safeParse(input);
  if (!res.success) {
    if (typeof console !== "undefined") {
      console.warn("[scorecard] EntryScorecard row failed schema validation", res.error.issues);
    }
    return null;
  }
  return res.data;
}

/** Validate the per-tier breakdown. Falls back to fully-null tiers. */
export function parseDimensionBreakdown(input: unknown): DimensionBreakdownValidated {
  const res = dimensionBreakdownSchema.safeParse(input);
  if (res.success) return res.data;
  if (typeof console !== "undefined") {
    console.warn("[scorecard] DimensionBreakdown failed schema validation", res.error?.issues);
  }
  return { finalized: null, panel: null, reports: null };
}
