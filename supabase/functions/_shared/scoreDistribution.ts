/**
 * Score-token distribution estimators for continuous judging.
 *
 * Verified 2026-07-14 against the Lovable AI Gateway:
 *   - google/gemini-* returns 200 OK but the `logprobs` field is stripped
 *     (silently dropped, not surfaced to callers).
 *   - openai/gpt-5* rejects `logprobs` with 403 ("You are not allowed to
 *     request logprobs from this model"); openai/gpt-5.4-mini caps
 *     `top_logprobs` at 5, which is insufficient for a 10-tier distribution.
 *
 * Because real token-level logprobs are not usable on any of our routes,
 * `getScorePMF` sits on a Monte Carlo estimator by default and only tries
 * the logprobs path when explicitly enabled (so the day the gateway lifts
 * the restriction, we auto-upgrade with no code changes downstream).
 *
 * Consumers must persist the returned `source` verbatim into
 * `judge_consensus.logprob_source` — the DB CHECK constraint accepts:
 *   'human' | 'elicited' | 'token_logprobs' | 'monte_carlo' | 'discrete_legacy'
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const TIER_COUNT = 10;

export type PMFSource = "token_logprobs" | "monte_carlo" | "elicited";
export interface PMFResult {
  /** length-10 array over quality tiers 1..10, sums to 1 */
  pmf: number[];
  source: PMFSource;
  meta: {
    model: string;
    samples: number;
    latency_ms: number;
    notes?: string;
  };
}

export interface ScoreCallInput {
  /** Full model id, e.g. "google/gemini-3.5-flash" */
  model: string;
  /** System message defining the rubric dimension + scoring instructions */
  system: string;
  /** User message with the material being scored (the screenplay excerpt, etc.) */
  user: string;
  /** Sampling temperature for MC. Higher = wider distribution. Default 1.0 */
  temperature?: number;
  /** Number of MC samples to draw. Default 12. */
  samples?: number;
  /** Try `logprobs: true` first, even though we've verified it currently fails. */
  tryLogprobs?: boolean;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

function apiKey(): string {
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) throw new Error("LOVABLE_API_KEY missing");
  return k;
}

function normalize(counts: number[]): number[] {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return Array(TIER_COUNT).fill(1 / TIER_COUNT);
  return counts.map((c) => c / sum);
}

/** Add-one (Laplace) smoothing so a rare tier never gets exact-zero probability. */
function laplaceSmooth(counts: number[], alpha = 0.5): number[] {
  return normalize(counts.map((c) => c + alpha));
}

function softmax(logits: number[]): number[] {
  const finite = logits.filter((x) => Number.isFinite(x));
  const max = finite.length ? Math.max(...finite) : 0;
  const exps = logits.map((x) => (Number.isFinite(x) ? Math.exp(x - max) : 0));
  const s = exps.reduce((a, b) => a + b, 0);
  return s > 0 ? exps.map((e) => e / s) : Array(TIER_COUNT).fill(1 / TIER_COUNT);
}

/** Parse a single "1".."10" out of arbitrary model text; returns 1..10 or null. */
function extractTier(text: string): number | null {
  if (!text) return null;
  const m = text.match(/\b(10|[1-9])\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 10 ? n : null;
}

async function chatOnce(body: Record<string, unknown>, signal?: AbortSignal) {
  const isOpenAI = String(body.model || "").startsWith("openai/");
  // Model-specific token param naming (OpenAI reasoning models use max_completion_tokens)
  const b: Record<string, unknown> = { ...body };
  if (isOpenAI) {
    if ("max_tokens" in b) { b.max_completion_tokens = b.max_tokens; delete b.max_tokens; }
  }
  const r = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey() },
    body: JSON.stringify(b),
    signal,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j as any };
}

/**
 * Opportunistic path: request logprobs. On success (unlikely on current
 * gateway), build a PMF from the top-logprobs of the first output token,
 * restricted to string tokens "1".."10".
 */
export async function tryPMFFromLogprobs(input: ScoreCallInput): Promise<PMFResult | null> {
  const t0 = Date.now();
  const isOpenAI = input.model.startsWith("openai/");
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: input.system + "\nRespond with exactly one token: an integer 1-10. No words, no punctuation." },
      { role: "user", content: input.user },
    ],
    temperature: 0,
    max_tokens: 4,
    logprobs: true,
    top_logprobs: isOpenAI ? 5 : 10,
  };
  const { status, json } = await chatOnce(body, input.signal);
  if (status !== 200) return null;
  const ch = json?.choices?.[0];
  const lp = ch?.logprobs?.content?.[0];
  const top: Array<{ token: string; logprob: number }> = lp?.top_logprobs || [];
  if (!Array.isArray(top) || top.length === 0) return null;

  // Aggregate: for tiers 1..10, the logit is the max logprob among matching tokens.
  const logits: number[] = Array(TIER_COUNT).fill(-Infinity);
  for (const t of top) {
    const tier = extractTier(String(t.token || ""));
    if (tier == null) continue;
    if (t.logprob > logits[tier - 1]) logits[tier - 1] = t.logprob;
  }
  if (!logits.some((x) => Number.isFinite(x))) return null;
  return {
    pmf: softmax(logits),
    source: "token_logprobs",
    meta: { model: input.model, samples: 1, latency_ms: Date.now() - t0 },
  };
}

/**
 * Monte Carlo estimator: sample the model `samples` times at temperature≥1
 * asking for a bare integer tier, then Laplace-smooth the empirical counts.
 * This is the current production path — verified as the only reliable way
 * to get a distribution across our gateway routes.
 */
export async function estimatePMFByMonteCarlo(input: ScoreCallInput): Promise<PMFResult> {
  const t0 = Date.now();
  const samples = Math.max(4, Math.min(64, input.samples ?? 12));
  const temperature = input.temperature ?? 1.0;
  const messages = [
    { role: "system", content: input.system + "\nRespond with exactly one token: an integer 1-10. No words, no punctuation." },
    { role: "user", content: input.user },
  ];

  const counts = Array(TIER_COUNT).fill(0);
  let observed = 0;
  const errors: string[] = [];

  const draws = await Promise.all(
    Array.from({ length: samples }, async () => {
      const { status, json } = await chatOnce({
        model: input.model,
        messages,
        temperature,
        max_tokens: 8,
        // Explicit seed omitted — the gateway does not honor OpenAI's `seed`
        // uniformly, and we want genuine variance across samples anyway.
      }, input.signal);
      if (status !== 200) {
        errors.push(`HTTP ${status}: ${String(json?.error?.message || "").slice(0, 80)}`);
        return null;
      }
      const text = json?.choices?.[0]?.message?.content || "";
      return extractTier(text);
    }),
  );
  for (const tier of draws) {
    if (tier != null) { counts[tier - 1] += 1; observed += 1; }
  }

  const latency_ms = Date.now() - t0;
  if (observed === 0) {
    // Total failure — degrade to uniform rather than throw, so consensus math still runs.
    return {
      pmf: Array(TIER_COUNT).fill(1 / TIER_COUNT),
      source: "monte_carlo",
      meta: { model: input.model, samples, latency_ms, notes: `no valid samples; ${errors.slice(0, 2).join("; ")}` },
    };
  }
  return {
    pmf: laplaceSmooth(counts, 0.5),
    source: "monte_carlo",
    meta: { model: input.model, samples: observed, latency_ms, notes: errors.length ? `${errors.length} bad samples` : undefined },
  };
}

/**
 * Elicitation path: ask the model to emit the 10-array directly as JSON.
 * Cheaper than MC but the model's stated distribution is often overconfident
 * and poorly calibrated. Kept as a last-resort fallback.
 */
export async function estimatePMFByElicitation(input: ScoreCallInput): Promise<PMFResult> {
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      {
        role: "system",
        content:
          input.system +
          '\nReturn ONLY a JSON object of the form {"pmf":[p1,p2,...,p10]} where pi is the ' +
          "probability that the correct score for this material is tier i (1=worst, 10=best). " +
          "The 10 numbers must be non-negative and sum to 1.",
      },
      { role: "user", content: input.user },
    ],
    temperature: 0.2,
    max_tokens: 200,
    response_format: { type: "json_object" },
  };
  const { status, json } = await chatOnce(body, input.signal);
  if (status !== 200) {
    return {
      pmf: Array(TIER_COUNT).fill(1 / TIER_COUNT),
      source: "elicited",
      meta: { model: input.model, samples: 1, latency_ms: Date.now() - t0, notes: `HTTP ${status}` },
    };
  }
  const text = json?.choices?.[0]?.message?.content || "";
  let arr: number[] | null = null;
  try {
    const parsed = JSON.parse(text);
    const p = Array.isArray(parsed?.pmf) ? parsed.pmf : (Array.isArray(parsed) ? parsed : null);
    if (Array.isArray(p) && p.length === TIER_COUNT) arr = p.map((x) => Number(x) || 0);
  } catch { /* fall through */ }
  if (!arr) {
    return {
      pmf: Array(TIER_COUNT).fill(1 / TIER_COUNT),
      source: "elicited",
      meta: { model: input.model, samples: 1, latency_ms: Date.now() - t0, notes: "unparsable" },
    };
  }
  return {
    pmf: normalize(arr.map((x) => Math.max(0, x))),
    source: "elicited",
    meta: { model: input.model, samples: 1, latency_ms: Date.now() - t0 },
  };
}

/**
 * Preferred entry point. Tries logprobs (only if `tryLogprobs` is set and the
 * route ever starts honoring them), otherwise Monte Carlo. `elicited` is
 * available as a manual override for callers that explicitly want it.
 */
export async function getScorePMF(input: ScoreCallInput): Promise<PMFResult> {
  if (input.tryLogprobs) {
    try {
      const lp = await tryPMFFromLogprobs(input);
      if (lp) return lp;
    } catch (e) {
      console.warn("[scoreDistribution] logprobs probe failed:", (e as Error).message);
    }
  }
  return await estimatePMFByMonteCarlo(input);
}
