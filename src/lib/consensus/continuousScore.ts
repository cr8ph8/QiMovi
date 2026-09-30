/**
 * Continuous logit-expectation scoring helpers.
 *
 * Contract with the DB (`judge_consensus`):
 * - `score_distributions`: { [dim: string]: number[10] } — probability mass over
 *   quality tiers 1..10 for each rubric dimension. Arrays should sum to 1;
 *   the DB trigger renormalizes defensively.
 * - `expected_scores`: { [dim: string]: number, total: number } — per-dimension
 *   E[s] rescaled to that dim's weight max, plus a total. Written by the
 *   `tg_judge_consensus_expected` trigger; treat as read-only from clients.
 * - `logprob_source`: 'human' | 'elicited' | 'token_logprobs' | 'monte_carlo' | 'discrete_legacy'.
 *   (Verified 2026-07-14: the AI Gateway strips `logprobs` on google/gemini-*
 *   and forbids it on openai/gpt-5-*, so 'monte_carlo' is the production path
 *   for AI-generated distributions — see supabase/functions/_shared/scoreDistribution.ts.)
 * - `total_score`: kept in sync with `expected_scores.total` by the trigger.
 *
 * When a client (human scorecard UI, AI-judge edge fn) has a discrete integer
 * score for a dimension it can either write `dimension_scores` alone (source
 * defaults to 'human') OR call `degeneratePMF` to build a full distribution
 * and also write `score_distributions` for downstream continuous consumers.
 */

export type ScoreDistribution = number[]; // length 10, indexes 0..9 ↔ tiers 1..10
export type DimensionDistributions = Record<string, ScoreDistribution>;

export const TIER_MIN = 1;
export const TIER_MAX = 10;
export const TIER_COUNT = 10;

/** Degenerate PMF concentrated at a single integer tier in [1,10]. */
export function degeneratePMF(tier: number): ScoreDistribution {
  const t = Math.max(TIER_MIN, Math.min(TIER_MAX, Math.round(tier)));
  return Array.from({ length: TIER_COUNT }, (_, i) => (i + 1 === t ? 1 : 0));
}

/** Convert a raw per-dimension score in [0, weight] to a normalized tier in [1,10]. */
export function scoreToTier(score: number, weight: number): number {
  if (!Number.isFinite(score) || weight <= 0) return TIER_MIN;
  const q = Math.max(0, Math.min(1, score / weight));
  return 1 + q * 9;
}

/** Renormalize a distribution to sum to 1. Returns a uniform PMF if input is degenerate/invalid. */
export function normalizePMF(pmf: ScoreDistribution): ScoreDistribution {
  const clean = pmf.slice(0, TIER_COUNT).map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  while (clean.length < TIER_COUNT) clean.push(0);
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum <= 0) return Array(TIER_COUNT).fill(1 / TIER_COUNT);
  return clean.map((p) => p / sum);
}

/** Softmax over an array of logits, restricted to the first 10 entries. */
export function softmax(logits: number[]): ScoreDistribution {
  const l = logits.slice(0, TIER_COUNT);
  while (l.length < TIER_COUNT) l.push(-Infinity);
  const max = Math.max(...l.filter((x) => Number.isFinite(x)));
  const exps = l.map((x) => (Number.isFinite(x) ? Math.exp(x - max) : 0));
  const s = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / s);
}

/**
 * Build a PMF from real per-token top-logprobs returned by a provider.
 * `tokenLogprobs` maps a token string ("1".."10") to its logprob (natural log).
 * Missing tokens are treated as -Infinity (0 probability).
 */
export function pmfFromTokenLogprobs(tokenLogprobs: Record<string, number>): ScoreDistribution {
  const logits: number[] = [];
  for (let t = 1; t <= TIER_COUNT; t++) {
    const key = String(t);
    logits.push(key in tokenLogprobs ? tokenLogprobs[key] : -Infinity);
  }
  return softmax(logits);
}

/** Expected value of a PMF over tiers 1..10 (dot product with [1..10]). */
export function expectedTier(pmf: ScoreDistribution): number {
  const p = normalizePMF(pmf);
  let e = 0;
  for (let i = 0; i < TIER_COUNT; i++) e += (i + 1) * p[i];
  return e;
}

/** Shannon entropy in nats. Higher = less confident. Range [0, ln(10)≈2.3026]. */
export function entropy(pmf: ScoreDistribution): number {
  const p = normalizePMF(pmf);
  let h = 0;
  for (const q of p) if (q > 0) h -= q * Math.log(q);
  return h;
}

/** Rescale an expected tier in [1,10] to a per-dimension score in [0, weight]. */
export function tierToDimensionScore(tier: number, weight: number): number {
  const clamped = Math.max(TIER_MIN, Math.min(TIER_MAX, tier));
  return ((clamped - 1) / 9) * weight;
}

/**
 * Compute the full `expected_scores` payload from a set of dimension PMFs and
 * their weights. Matches the DB trigger's math exactly so a client optimistic
 * write agrees with the eventual server value.
 */
export function computeExpectedScores(
  distributions: DimensionDistributions,
  weights: Record<string, number>,
): Record<string, number> & { total: number } {
  const out: Record<string, number> = {};
  let total = 0;
  for (const [dim, pmf] of Object.entries(distributions)) {
    const e = expectedTier(pmf);
    const w = Number.isFinite(weights[dim]) ? weights[dim] : 10;
    const s = tierToDimensionScore(e, w);
    out[dim] = Math.round(s * 10_000) / 10_000;
    total += s;
  }
  return { ...out, total: Math.round(total * 10_000) / 10_000 };
}

/** Average Shannon entropy across all dimensions — the confidence signal we persist. */
export function averageEntropy(distributions: DimensionDistributions): number {
  const values = Object.values(distributions).map(entropy);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Trimmed-mean panel aggregation, mirroring `finalize_entry_score`:
 * drops the strict min and max total when n ≥ 4, then averages per-dim.
 * Used only for admin previews — the server RPC remains source of truth.
 */
export interface JudgeRowForPreview {
  id: string;
  total_score: number | null;
  expected_scores: Record<string, number> | null;
  is_outlier?: boolean;
}
export function previewTrimmedMean(rows: JudgeRowForPreview[]): {
  total: number;
  per_dim: Record<string, number>;
  trimmed: string[];
  kept: number;
} {
  const eligible = rows.filter(
    (r) => !r.is_outlier && r.total_score != null && r.expected_scores != null,
  );
  const trimmed: string[] = [];
  let pool = eligible;
  if (eligible.length >= 4) {
    const sorted = [...eligible].sort((a, b) => (a.total_score! - b.total_score!) || a.id.localeCompare(b.id));
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    if (lo.id !== hi.id) {
      trimmed.push(lo.id, hi.id);
      pool = eligible.filter((r) => r.id !== lo.id && r.id !== hi.id);
    }
  }
  const acc: Record<string, { sum: number; n: number }> = {};
  for (const r of pool) {
    for (const [dim, v] of Object.entries(r.expected_scores!)) {
      if (dim === "total") continue;
      const cell = (acc[dim] ??= { sum: 0, n: 0 });
      cell.sum += Number(v) || 0;
      cell.n += 1;
    }
  }
  const per_dim: Record<string, number> = {};
  let total = 0;
  for (const [dim, { sum, n }] of Object.entries(acc)) {
    const avg = n > 0 ? sum / n : 0;
    per_dim[dim] = Math.round(avg * 10_000) / 10_000;
    total += avg;
  }
  return { total: Math.round(total * 10_000) / 10_000, per_dim, trimmed, kept: pool.length };
}
