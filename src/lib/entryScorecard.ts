/**
 * Canonical scorecard read path.
 *
 * Reads from `v_entry_scorecard`, a database view that returns exactly one
 * authoritative row per entry by resolving in this precedence:
 *   1. finalized `scores` row (superseded_at IS NULL)
 *   2. active `judge_consensus` panel average
 *   3. averaged `grading_reports`
 *
 * Do NOT read totals directly from `scores`, `judge_consensus`, or
 * `grading_reports` for display — always go through this helper so every
 * surface renders the same number.
 */
import { supabase } from "@/integrations/supabase/client";

export type ScorecardSource =
  | "finalized"
  | "panel_consensus"
  | "grading_reports_avg"
  | "none";

export interface EntryScorecard {
  entry_id: string;
  source: ScorecardSource;
  total_score: number | null;
  originality: number | null;
  structure: number | null;
  character_depth: number | null;
  dialogue: number | null;
  theme: number | null;
  emotion: number | null;
  format_adherence: number | null;
  market: number | null;
  visual: number | null;
  narrative: number | null;
  character_score: number | null;
  emotional: number | null;
  franchise: number | null;
  production: number | null;
  audience: number | null;
  finalized_model_id: string | null;
  judge_count: number | null;
  panel_model_count: number | null;
  grading_report_count: number | null;
  rubric_preset: string | null;
  rubric_version: number | null;
  updated_at: string | null;
}

const SCORECARD_COLUMNS =
  "entry_id, source, total_score, originality, structure, character_depth, dialogue, theme, emotion, format_adherence, market, visual, narrative, character_score, emotional, franchise, production, audience, finalized_model_id, judge_count, panel_model_count, grading_report_count, rubric_preset, rubric_version, updated_at";

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function normalize(row: Record<string, unknown>): EntryScorecard {
  return {
    entry_id: String(row.entry_id),
    source: (row.source as ScorecardSource) ?? "none",
    total_score: numOrNull(row.total_score),
    originality: numOrNull(row.originality),
    structure: numOrNull(row.structure),
    character_depth: numOrNull(row.character_depth),
    dialogue: numOrNull(row.dialogue),
    theme: numOrNull(row.theme),
    emotion: numOrNull(row.emotion),
    format_adherence: numOrNull(row.format_adherence),
    market: numOrNull(row.market),
    visual: numOrNull(row.visual),
    narrative: numOrNull(row.narrative),
    character_score: numOrNull(row.character_score),
    emotional: numOrNull(row.emotional),
    franchise: numOrNull(row.franchise),
    production: numOrNull(row.production),
    audience: numOrNull(row.audience),
    finalized_model_id: (row.finalized_model_id as string | null) ?? null,
    judge_count: numOrNull(row.judge_count),
    panel_model_count: numOrNull(row.panel_model_count),
    grading_report_count: numOrNull(row.grading_report_count),
    rubric_preset: (row.rubric_preset as string | null) ?? null,
    rubric_version: numOrNull(row.rubric_version),
    updated_at: (row.updated_at as string | null) ?? null,
  };
}

/** Read one canonical scorecard. Returns null when no data exists yet. */
export async function readScorecard(
  entryId: string,
  signal?: AbortSignal,
): Promise<EntryScorecard | null> {
  let q: any = (supabase as any)
    .from("v_entry_scorecard")
    .select(SCORECARD_COLUMNS)
    .eq("entry_id", entryId)
    .maybeSingle();
  if (signal && typeof q.abortSignal === "function") q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error || !data) return null;
  return normalize(data as Record<string, unknown>);
}

export interface ScorecardReadResult {
  scorecard: EntryScorecard | null;
  error: string | null;
  aborted?: boolean;
}

/**
 * Read one canonical scorecard and distinguish "no data yet" from a real
 * read error, so UI can render empty vs. error states appropriately.
 * Pass an AbortSignal to cancel the request when the caller navigates away.
 */
export async function readScorecardResult(
  entryId: string,
  signal?: AbortSignal,
): Promise<ScorecardReadResult> {
  let q: any = (supabase as any)
    .from("v_entry_scorecard")
    .select(SCORECARD_COLUMNS)
    .eq("entry_id", entryId)
    .maybeSingle();
  if (signal && typeof q.abortSignal === "function") q = q.abortSignal(signal);
  const { data, error } = await q;
  if (signal?.aborted) return { scorecard: null, error: null, aborted: true };
  if (error) {
    const msg = (error as { message?: string }).message ?? "";
    // PostgREST surfaces aborts as an error — treat as cancellation, not a UI error.
    if (/abort/i.test(msg)) return { scorecard: null, error: null, aborted: true };
    return { scorecard: null, error: msg || "read_failed" };
  }
  if (!data) return { scorecard: null, error: null };
  // Keep the scorecard row even when source is "none" so callers can tell
  // "entry exists, no scorecard yet" apart from "no entry/scorecard at all".
  return { scorecard: normalize(data as Record<string, unknown>), error: null };
}

/** Read canonical scorecards for many entries. Missing entries are omitted. */
export async function readScorecards(
  entryIds: string[],
): Promise<Map<string, EntryScorecard>> {
  const map = new Map<string, EntryScorecard>();
  if (entryIds.length === 0) return map;
  const { data, error } = await (supabase as any)
    .from("v_entry_scorecard")
    .select(SCORECARD_COLUMNS)
    .in("entry_id", entryIds);
  if (error || !data) return map;
  for (const row of data as Record<string, unknown>[]) {
    const card = normalize(row);
    map.set(card.entry_id, card);
  }
  return map;
}

/**
 * Per-dimension values from every subordinate tier, so a Transparency drill-down
 * can show which tier(s) had data for each dimension. Unlike `v_entry_scorecard`
 * (which returns only the winning tier's row), this reads all three source
 * tables so the UI can render shadow values from lower-precedence tiers.
 *
 * - finalized: from active `scores` row (superseded_at IS NULL)
 * - panel:    average across non-outlier `judge_consensus` rows (dimension_scores jsonb)
 * - reports:  average across `grading_reports` rows
 *
 * Contributor counts are returned per tier so the UI can say
 * "avg of 3 panel judges" vs "1 finalized score".
 */
export interface DimensionBreakdown {
  finalized: Record<string, number> | null;
  panel: { averages: Record<string, number>; contributors: number } | null;
  reports: { averages: Record<string, number>; contributors: number } | null;
}

const DIMENSION_COLS = [
  "originality","structure","character_depth","dialogue","theme","emotion",
  "format_adherence","market","visual","narrative","character_score",
  "emotional","franchise","production","audience",
] as const;

function avgDimensions(
  rows: Array<Record<string, unknown>>,
  fromJsonbKey?: string,
): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const src = fromJsonbKey
      ? ((row[fromJsonbKey] as Record<string, unknown> | null) ?? {})
      : row;
    for (const dim of DIMENSION_COLS) {
      const v = (src as Record<string, unknown>)[dim];
      if (v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      sums[dim] = (sums[dim] ?? 0) + n;
      counts[dim] = (counts[dim] ?? 0) + 1;
    }
  }
  const out: Record<string, number> = {};
  for (const dim of Object.keys(sums)) out[dim] = sums[dim] / counts[dim];
  return out;
}

export async function readScorecardBreakdown(
  entryId: string,
  signal?: AbortSignal,
): Promise<DimensionBreakdown> {
  const dimSelect = DIMENSION_COLS.join(",");
  const [finalizedRes, panelRes, reportsRes] = await Promise.all([
    (supabase as any)
      .from("scores")
      .select(dimSelect)
      .eq("entry_id", entryId)
      .is("superseded_at", null)
      .maybeSingle(),
    (supabase as any)
      .from("judge_consensus")
      .select("dimension_scores")
      .eq("entry_id", entryId)
      .eq("is_outlier", false),
    (supabase as any)
      .from("grading_reports")
      .select(dimSelect)
      .eq("entry_id", entryId),
  ]);
  if (signal?.aborted) {
    return { finalized: null, panel: null, reports: null };
  }

  let finalized: Record<string, number> | null = null;
  if (finalizedRes.data) {
    const row = finalizedRes.data as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const dim of DIMENSION_COLS) {
      const v = row[dim];
      if (v == null) continue;
      const n = Number(v);
      if (Number.isFinite(n)) out[dim] = n;
    }
    finalized = Object.keys(out).length ? out : null;
  }

  const panelRows = (panelRes.data ?? []) as Array<Record<string, unknown>>;
  const panel = panelRows.length
    ? { averages: avgDimensions(panelRows, "dimension_scores"), contributors: panelRows.length }
    : null;

  const reportRows = (reportsRes.data ?? []) as Array<Record<string, unknown>>;
  const reports = reportRows.length
    ? { averages: avgDimensions(reportRows), contributors: reportRows.length }
    : null;

  return { finalized, panel, reports };
}
