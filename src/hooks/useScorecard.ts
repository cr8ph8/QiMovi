import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  readScorecardResult,
  readScorecardBreakdown,
} from "@/lib/entryScorecard";
import {
  parseStructuredReviews,
  parseEntryScorecard,
  parseDimensionBreakdown,
  type ScorecardBundle,
  type ScorecardReviewRow,
  type EntryScorecardValidated,
  type DimensionBreakdownValidated,
} from "@/lib/scorecardSchemas";

// Re-export the canonical, zod-inferred types so every consumer imports the
// same shape and any future drift shows up at the type layer immediately.
export type {
  ScorecardBundle,
  ScorecardReviewRow,
  EntryScorecardValidated as EntryScorecard,
  DimensionBreakdownValidated as DimensionBreakdown,
};

export interface UseScorecardResult {
  bundle: ScorecardBundle | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_BREAKDOWN: DimensionBreakdownValidated = {
  finalized: null,
  panel: null,
  reports: null,
};

/**
 * useScorecard(entryId) — facade over the canonical scorecard read path.
 *
 * Reads (in parallel):
 *   1. `v_entry_scorecard` via `readScorecardResult` (finalized/panel/reports precedence)
 *   2. per-tier dimension breakdown via `readScorecardBreakdown`
 *   3. qualitative `structured_reviews` rows for the same entry
 *
 * Every read is piped through a zod schema in `@/lib/scorecardSchemas` so
 * the merged bundle cannot silently drift when a column, tier, or reviewer
 * field changes upstream. Invalid rows are dropped (with a dev warning)
 * rather than coerced into `NaN`/`undefined`.
 *
 * Consumers must render the returned bundle through `UnifiedScorecard`
 * so numeric totals, per-dimension breakdown, and structured review
 * prose stay visually identical across surfaces.
 */
export function useScorecard(entryId: string | null | undefined): UseScorecardResult {
  const [bundle, setBundle] = useState<ScorecardBundle | null>(null);
  const [loading, setLoading] = useState<boolean>(!!entryId);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!entryId) {
      setBundle(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    try {
      const [scoreRes, breakdownRaw, reviewsRes] = await Promise.all([
        readScorecardResult(entryId, ctrl.signal),
        readScorecardBreakdown(entryId, ctrl.signal),
        (supabase as any)
          .from("structured_reviews")
          .select(
            "id,reviewer_id,version_id,visibility,strengths,concerns,narrative_observations,clarity_signals,overall_notes,created_at,updated_at",
          )
          .eq("entry_id", entryId)
          .order("updated_at", { ascending: false }),
      ]);
      if (scoreRes.error) setError(scoreRes.error);

      const scorecard: EntryScorecardValidated | null = parseEntryScorecard(scoreRes.scorecard);
      const breakdown: DimensionBreakdownValidated = parseDimensionBreakdown(
        breakdownRaw ?? EMPTY_BREAKDOWN,
      );
      const reviews: ScorecardReviewRow[] = parseStructuredReviews((reviewsRes as any)?.data);

      setBundle({
        entryId,
        scorecard,
        breakdown,
        reviews,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "read_failed");
      setBundle({ entryId, scorecard: null, breakdown: EMPTY_BREAKDOWN, reviews: [] });
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { bundle, loading, error, refresh: load };
}
