/**
 * Continuous per-criterion decomposition of the current consensus.
 *
 * Reads active (non-outlier) `judge_consensus` rows for an entry plus the
 * `rubric_versions` definition they were scored against, then aggregates the
 * continuous `expected_scores` PMFs across judges into one row per criterion.
 *
 * This is what powers:
 *   • the CriterionDecompositionCard UI in the judges scorecard
 *   • the `rubric_decomposition` block in the evidence bundle
 *
 * Server and client share this shape; keep them in sync with the
 * `EvidenceBundleRubricBlock` type in `src/lib/evidence-schema.ts`.
 */

import { supabase } from "@/integrations/supabase/client";

export interface JudgeCriterionContribution {
  /** Judge / model identifier (matches `judge_consensus.model_id`). */
  model_id: string;
  /** Continuous expected score this judge assigned (0–10). */
  expected: number | null;
  /** This judge's own 10-tier PMF, if available. */
  pmf: number[] | null;
  /** This judge's per-criterion (or averaged) PMF entropy in bits. */
  entropy: number | null;
  /** Share this judge contributes to the consensus mean μ: x_i / N. */
  mu_contribution: number;
  /** Share this judge contributes to consensus variance σ²: (x_i − μ)² / N. */
  var_contribution: number;
  /** Share this judge contributes to consensus average entropy H̄: H_i / N. */
  entropy_contribution: number;
  /** Source used for the log-prob PMF ("monte_carlo", "elicited", …). */
  method: string | null;
  /** Which field on `judge_consensus` provided x_i for this judge. */
  value_source: "expected_scores" | "dimension_scores" | null;
}

export interface CriterionDecomposition {
  key: string;
  label: string;
  weight: number;
  /** Mean of per-judge expected scores (0–10 continuous). */
  expected_mean: number | null;
  /** Population std of per-judge expected scores. */
  expected_stddev: number | null;
  /** Average per-judge PMF entropy (bits over the 10 tiers). */
  entropy_avg: number | null;
  /** Averaged PMF over the 10 score tiers (index 0 → score 1, index 9 → score 10). */
  pmf_avg: number[] | null;
  /** How many judges contributed a valid 10-tier PMF to `pmf_avg`. */
  pmf_source_count: number;
  /** Number of non-outlier judges that contributed a value to this criterion. */
  judge_count: number;
  /** Distinct `logprob_source` values ("monte_carlo", "elicited", …) that produced these scores. */
  methods: string[];
  /** Distinct value_source fields used across judges. */
  value_sources: ("expected_scores" | "dimension_scores")[];
  /** Per-judge decomposition of μ, σ, and H̄ for this criterion. */
  judges: JudgeCriterionContribution[];
}

export interface RubricDecomposition {
  entry_id: string;
  rubric_preset: string | null;
  rubric_version: number | null;
  rubric_version_id: string | null;
  rubric_label: string | null;
  rubric_created_at: string | null;
  /** Normalized rubric definition used to build this decomposition. */
  rubric_dimensions: { key: string; label: string; weight: number }[];
  criteria: CriterionDecomposition[];
  /** Sum(weight * expected_mean) / sum(weight) — matches finalize_entry_score. */
  weighted_total: number | null;
  panel_size: number;
  /** How the per-criterion PMF was aggregated across judges (short human label). */
  pmf_aggregation: string;
  generated_at: string;
}

export interface RubricVersionSummary {
  preset: string;
  version: number;
  version_id: string;
  label: string | null;
  created_at: string | null;
  dimensions: { key: string; label: string; weight: number }[];
}

export interface RubricCriterionChange {
  key: string;
  kind: "added" | "removed" | "unchanged" | "modified";
  label_from: string | null;
  label_to: string | null;
  label_changed: boolean;
  weight_from: number | null;
  weight_to: number | null;
  weight_changed: boolean;
  weight_delta: number | null;
}

interface RubricDefinition {
  dimensions?: Array<string | { key: string; label?: string; weight?: number }>;
  labels?: Record<string, string>;
  weights?: Record<string, number>;
}

interface ConsensusRow {
  model_id: string;
  dimension_scores: Record<string, number> | null;
  expected_scores: Record<string, number> | null;
  score_distributions: Record<string, number[]> | null;
  entropy_avg: number | null;
  logprob_source: string | null;
  is_outlier: boolean;
  rubric_preset: string | null;
  rubric_version: number | null;
}

function normalizeDimensions(
  def: RubricDefinition | null,
): { key: string; label: string; weight: number }[] {
  if (!def || !Array.isArray(def.dimensions)) return [];
  const labels = def.labels ?? {};
  const weights = def.weights ?? {};
  return def.dimensions.map((d) => {
    if (typeof d === "string") {
      return {
        key: d,
        label: labels[d] ?? d.charAt(0).toUpperCase() + d.slice(1),
        weight: Number(weights[d] ?? 1),
      };
    }
    return {
      key: d.key,
      label: d.label ?? labels[d.key] ?? d.key,
      weight: Number(d.weight ?? weights[d.key] ?? 1),
    };
  });
}

function meanStd(xs: number[]): { mean: number; std: number } {
  if (xs.length === 0) return { mean: 0, std: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const varr = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(varr) };
}

/** Average a list of PMFs (each length 10). Ignores rows with wrong length. */
function averagePmf(pmfs: number[][]): number[] | null {
  const valid = pmfs.filter((p) => Array.isArray(p) && p.length === 10);
  if (valid.length === 0) return null;
  const acc = new Array(10).fill(0);
  for (const p of valid) for (let i = 0; i < 10; i++) acc[i] += p[i];
  return acc.map((v) => v / valid.length);
}

/** Shannon entropy (bits) of a discrete PMF. Renormalizes if the mass is not exactly 1. */
function pmfEntropyBits(pmf: number[]): number {
  let mass = 0;
  for (const p of pmf) if (Number.isFinite(p) && p > 0) mass += p;
  if (mass <= 0) return 0;
  let h = 0;
  for (const p of pmf) {
    if (!Number.isFinite(p) || p <= 0) continue;
    const q = p / mass;
    h -= q * Math.log2(q);
  }
  return h;
}

/** Fetch a specific rubric version (or the latest for a preset). */
async function fetchRubricVersion(
  preset: string,
  version?: number | null,
): Promise<{
  preset: string;
  version: number | null;
  version_id: string | null;
  label: string | null;
  created_at: string | null;
  dimensions: { key: string; label: string; weight: number }[];
} | null> {
  let q = supabase
    .from("rubric_versions")
    .select("id,preset_id,version,label,definition,created_at")
    .eq("preset_id", preset);
  if (version != null) q = q.eq("version", version);
  const { data: rv } = await q
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rv) return null;
  return {
    preset,
    version: (rv.version as number | null) ?? version ?? null,
    version_id: (rv.id as string | null) ?? null,
    label: (rv.label as string | null) ?? null,
    created_at: (rv.created_at as string | null) ?? null,
    dimensions: normalizeDimensions((rv.definition ?? null) as RubricDefinition | null),
  };
}

/** Fetch the rubric definition attached to an entry. */
async function fetchRubricForEntry(entryId: string) {
  const { data: entry } = await supabase
    .from("v_judge_entry_blind")
    .select("rubric_preset,rubric_version")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry?.rubric_preset) return null;
  return fetchRubricVersion(entry.rubric_preset, entry.rubric_version ?? null);
}

/** List every rubric version for a preset, most recent first. */
export async function loadRubricVersions(
  preset: string,
): Promise<RubricVersionSummary[]> {
  const { data } = await supabase
    .from("rubric_versions")
    .select("id,preset_id,version,label,definition,created_at")
    .eq("preset_id", preset)
    .order("version", { ascending: false });
  return (data ?? []).map((rv: any) => ({
    preset: rv.preset_id,
    version: rv.version,
    version_id: rv.id,
    label: rv.label ?? null,
    created_at: rv.created_at ?? null,
    dimensions: normalizeDimensions((rv.definition ?? null) as RubricDefinition | null),
  }));
}

/** Compute label/weight changes between two rubric versions. */
export function diffRubricVersions(
  from: RubricVersionSummary | null,
  to: RubricVersionSummary | null,
): RubricCriterionChange[] {
  const fromMap = new Map((from?.dimensions ?? []).map((d) => [d.key, d]));
  const toMap = new Map((to?.dimensions ?? []).map((d) => [d.key, d]));
  const keys = Array.from(new Set([...fromMap.keys(), ...toMap.keys()]));
  return keys
    .map<RubricCriterionChange>((key) => {
      const a = fromMap.get(key) ?? null;
      const b = toMap.get(key) ?? null;
      const label_from = a?.label ?? null;
      const label_to = b?.label ?? null;
      const weight_from = a?.weight ?? null;
      const weight_to = b?.weight ?? null;
      const label_changed = !!a && !!b && label_from !== label_to;
      const weight_changed = !!a && !!b && weight_from !== weight_to;
      let kind: RubricCriterionChange["kind"];
      if (!a) kind = "added";
      else if (!b) kind = "removed";
      else if (label_changed || weight_changed) kind = "modified";
      else kind = "unchanged";
      return {
        key,
        kind,
        label_from,
        label_to,
        label_changed,
        weight_from,
        weight_to,
        weight_changed,
        weight_delta:
          weight_from != null && weight_to != null ? weight_to - weight_from : null,
      };
    })
    .sort((x, y) => {
      const rank = (k: RubricCriterionChange["kind"]) =>
        k === "modified" ? 0 : k === "added" ? 1 : k === "removed" ? 2 : 3;
      return rank(x.kind) - rank(y.kind) || x.key.localeCompare(y.key);
    });
}

export interface LoadDecompositionOptions {
  /** Override the rubric preset (default: entry's own preset). */
  rubricPreset?: string | null;
  /** Override the rubric version (default: latest for that preset). */
  rubricVersion?: number | null;
  /** When true, only include judge_consensus rows matching the overridden rubric identity. */
  strictRubricMatch?: boolean;
}

/** Load the full continuous decomposition for an entry, or null if no panel exists yet. */
export async function loadRubricDecomposition(
  entryId: string,
  opts: LoadDecompositionOptions = {},
): Promise<RubricDecomposition | null> {
  const targetPreset = opts.rubricPreset ?? undefined;
  const targetVersion = opts.rubricVersion ?? undefined;

  const rubricP = targetPreset
    ? fetchRubricVersion(targetPreset, targetVersion ?? null)
    : fetchRubricForEntry(entryId);

  let rowsQ = supabase
    .from("judge_consensus")
    .select(
      "model_id,dimension_scores,expected_scores,score_distributions,entropy_avg,logprob_source,is_outlier,rubric_preset,rubric_version",
    )
    .eq("entry_id", entryId);
  if (opts.strictRubricMatch) {
    if (targetPreset) rowsQ = rowsQ.eq("rubric_preset", targetPreset);
    if (targetVersion != null) rowsQ = rowsQ.eq("rubric_version", targetVersion);
  }

  const [rubric, rowsRes] = await Promise.all([rubricP, rowsQ]);

  const rows = (rowsRes.data ?? []) as ConsensusRow[];
  const active = rows.filter((r) => !r.is_outlier);
  const dims = rubric?.dimensions ?? [];
  if (active.length === 0 && dims.length === 0) return null;

  // Prefer the panel's own rubric identity when the entry lacks one.
  const preset = rubric?.preset ?? active[0]?.rubric_preset ?? null;
  const version = rubric?.version ?? active[0]?.rubric_version ?? null;

  const criteria: CriterionDecomposition[] = dims.map((d) => {
    const values: number[] = [];
    const entropies: number[] = [];
    const pmfs: number[][] = [];
    const methods = new Set<string>();
    const valueSources = new Set<"expected_scores" | "dimension_scores">();
    const perJudge: Array<{
      model_id: string;
      expected: number | null;
      pmf: number[] | null;
      entropy: number | null;
      method: string | null;
      value_source: "expected_scores" | "dimension_scores" | null;
    }> = [];

    for (const row of active) {
      const exp = row.expected_scores?.[d.key];
      const disc = row.dimension_scores?.[d.key];
      let v: number | null = null;
      let value_source: "expected_scores" | "dimension_scores" | null = null;
      if (typeof exp === "number" && Number.isFinite(exp)) {
        v = exp;
        value_source = "expected_scores";
      } else if (typeof disc === "number" && Number.isFinite(disc)) {
        v = disc;
        value_source = "dimension_scores";
      }
      if (v != null) values.push(v);
      if (value_source) valueSources.add(value_source);

      const pmfRaw = row.score_distributions?.[d.key];
      const pmf = Array.isArray(pmfRaw) && pmfRaw.length === 10 ? (pmfRaw as number[]) : null;
      if (pmf) pmfs.push(pmf);

      const judgeEntropy = pmf
        ? pmfEntropyBits(pmf)
        : row.entropy_avg != null
          ? Number(row.entropy_avg)
          : null;
      if (judgeEntropy != null && Number.isFinite(judgeEntropy)) entropies.push(judgeEntropy);
      if (row.logprob_source) methods.add(row.logprob_source);

      perJudge.push({
        model_id: row.model_id,
        expected: v,
        pmf,
        entropy: judgeEntropy,
        method: row.logprob_source ?? null,
        value_source,
      });
    }

    const { mean, std } = meanStd(values);
    const N = values.length;
    const entropyMean = entropies.length
      ? entropies.reduce((a, b) => a + b, 0) / entropies.length
      : null;

    const judges: JudgeCriterionContribution[] = perJudge.map((j) => {
      const mu_contribution = j.expected != null && N > 0 ? j.expected / N : 0;
      const var_contribution =
        j.expected != null && N > 0 ? ((j.expected - mean) ** 2) / N : 0;
      const entropy_contribution =
        j.entropy != null && entropies.length > 0 ? j.entropy / entropies.length : 0;
      return {
        model_id: j.model_id,
        expected: j.expected,
        pmf: j.pmf,
        entropy: j.entropy,
        mu_contribution,
        var_contribution,
        entropy_contribution,
        method: j.method,
        value_source: j.value_source,
      };
    });

    return {
      key: d.key,
      label: d.label,
      weight: d.weight,
      expected_mean: N ? mean : null,
      expected_stddev: N ? std : null,
      entropy_avg: entropyMean,
      pmf_avg: averagePmf(pmfs),
      pmf_source_count: pmfs.length,
      judge_count: N,
      methods: Array.from(methods).sort(),
      value_sources: Array.from(valueSources).sort() as (
        | "expected_scores"
        | "dimension_scores"
      )[],
      judges,
    };
  });

  let wSum = 0;
  let wVal = 0;
  for (const c of criteria) {
    if (c.expected_mean == null) continue;
    wSum += c.weight;
    wVal += c.weight * c.expected_mean;
  }
  const weighted_total = wSum > 0 ? wVal / wSum : null;

  return {
    entry_id: entryId,
    rubric_preset: preset,
    rubric_version: version,
    rubric_version_id: rubric?.version_id ?? null,
    rubric_label: rubric?.label ?? null,
    rubric_created_at: rubric?.created_at ?? null,
    rubric_dimensions: dims,
    criteria,
    weighted_total,
    panel_size: active.length,
    pmf_aggregation:
      "Uniform mean of per-judge 10-tier PMFs (score_distributions); judges lacking a valid PMF are excluded from the average.",
    generated_at: new Date().toISOString(),
  };
}
