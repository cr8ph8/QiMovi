// Verifier-based best-of-K ranking for rewrite variants.
//
// Runs pairwise LLM preference judgments across all K*(K-1)/2 unordered pairs,
// each in BOTH orderings (position-swap debias), with N Monte-Carlo repeats per
// ordering. Aggregates into a preference-probability matrix and fits a
// Bradley–Terry model to produce a full ranking with confidence.
//
// Request body:
//   {
//     original: string,             // the source passage (for context/criterion)
//     variants: string[],           // K >= 2 candidate rewrites
//     criterion?: string,           // free-form judgment criterion (default: overall quality)
//     entry_id?: string,
//     samples_per_ordering?: number // Monte-Carlo repeats per ordering (default 2, max 5)
//   }
//
// Response:
//   {
//     ranking: RankedVariant[],
//     preference_matrix: number[][],
//     counts_matrix: number[][],
//     top_confidence: number,
//     top_margin: number,
//     entropy_avg: number,
//     total_judgments: number,
//     correlation_id: string
//   }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";
import { emitGovernanceEvents } from "../_shared/governance.ts";
import { requireEntryOwner, requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID_VARIANT_RANKING_ON_HOLD = true;

const VERIFIER_MODEL = "google/gemini-3-flash-preview";

interface Judgment {
  pick: "A" | "B" | "TIE";
  raw: string;
}

async function judgeOnce(params: {
  original: string;
  a: string;
  b: string;
  criterion: string;
  entryId?: string;
  userId?: string;
  correlationId: string;
}): Promise<Judgment> {
  const { original, a, b, criterion, entryId, userId, correlationId } = params;

  const system =
    "You are a strict screenplay verifier. Compare two candidate rewrites of a passage and pick the one that better satisfies the stated criterion. Ignore length, ordering, and labels. Output ONLY a compact JSON object of shape {\"pick\":\"A\"|\"B\"|\"TIE\",\"why\":\"<=15 words\"} and NOTHING else.";

  const user = [
    `CRITERION: ${criterion}`,
    "",
    "ORIGINAL PASSAGE:",
    original.slice(0, 4000),
    "",
    "CANDIDATE A:",
    a.slice(0, 4000),
    "",
    "CANDIDATE B:",
    b.slice(0, 4000),
    "",
    "Return JSON only.",
  ].join("\n");

  const result = await callAI({
    route: { functionName: "rank-variants", modelHint: VERIFIER_MODEL },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // Temperature > 0 so Monte-Carlo repeats produce a real distribution.
    temperature: 1.0,
    meta: {
      entryId: entryId || undefined,
      userId: userId || undefined,
      correlationId,
    },
  });

  const raw = (result.content || "").trim();
  let pick: "A" | "B" | "TIE" = "TIE";
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const parsed = jsonStart >= 0 ? JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) : null;
    const p = String(parsed?.pick || "").toUpperCase();
    if (p === "A" || p === "B" || p === "TIE") pick = p;
  } catch {
    // Fallback: token-level scan.
    const upper = raw.toUpperCase();
    if (/\bA\b/.test(upper) && !/\bB\b/.test(upper)) pick = "A";
    else if (/\bB\b/.test(upper) && !/\bA\b/.test(upper)) pick = "B";
  }
  return { pick, raw };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const user_id = auth.userId;

    if (PAID_VARIANT_RANKING_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI variant ranking is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const original: string = String(body?.original || "").trim();
    const variants: string[] = Array.isArray(body?.variants)
      ? body.variants.map((v: unknown) => String(v || "")).filter((v: string) => v.trim().length > 0)
      : [];
    const criterion: string =
      typeof body?.criterion === "string" && body.criterion.trim().length > 0
        ? body.criterion.trim()
        : "Overall screenplay quality: clarity, character voice, dramatic impact, and formatting fidelity.";
    const entry_id: string | undefined = body?.entry_id || undefined;
    const samplesPerOrdering = Math.max(
      1,
      Math.min(5, Number(body?.samples_per_ordering ?? 2) | 0),
    );
    if (entry_id) {
      const ownerCheck = await requireEntryOwner(
        auth.admin,
        user_id,
        entry_id,
        corsHeaders,
      );
      if (ownerCheck instanceof Response) return ownerCheck;
    }

    if (!original || variants.length < 2 || variants.length > 8) {
      return new Response(
        JSON.stringify({ error: "original + variants[2..8] are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const K = variants.length;
    const correlationId = crypto.randomUUID();

    // wins[i][j] += fractional score from judgments where i beat j (ties = 0.5 each).
    const wins: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
    const counts: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));

    const pairJobs: Array<Promise<void>> = [];
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        for (let s = 0; s < samplesPerOrdering; s++) {
          // Ordering 1: A = i, B = j
          pairJobs.push(
            judgeOnce({
              original,
              a: variants[i],
              b: variants[j],
              criterion,
              entryId: entry_id,
              userId: user_id,
              correlationId,
            })
              .then((jd) => {
                if (jd.pick === "A") wins[i][j] += 1;
                else if (jd.pick === "B") wins[j][i] += 1;
                else {
                  wins[i][j] += 0.5;
                  wins[j][i] += 0.5;
                }
                counts[i][j] += 1;
                counts[j][i] += 1;
              })
              .catch(() => {
                // Judgment failure: leave counts unchanged for this trial.
              }),
          );
          // Ordering 2 (swap): A = j, B = i — position debias.
          pairJobs.push(
            judgeOnce({
              original,
              a: variants[j],
              b: variants[i],
              criterion,
              entryId: entry_id,
              userId: user_id,
              correlationId,
            })
              .then((jd) => {
                if (jd.pick === "A") wins[j][i] += 1;
                else if (jd.pick === "B") wins[i][j] += 1;
                else {
                  wins[i][j] += 0.5;
                  wins[j][i] += 0.5;
                }
                counts[i][j] += 1;
                counts[j][i] += 1;
              })
              .catch(() => {}),
          );
        }
      }
    }

    await Promise.all(pairJobs);

    // Preference probability with Laplace smoothing per pair.
    const prefMatrix: number[][] = Array.from({ length: K }, () => new Array(K).fill(0.5));
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) {
        if (i === j) continue;
        const n = counts[i][j];
        prefMatrix[i][j] = (wins[i][j] + 1) / (n + 2);
      }
    }

    // Bradley–Terry (MM iterations). Duplicated from client to avoid cross-import.
    const strengths = fitBradleyTerry(
      // Reconstruct fractional wins from the smoothed matrix so BT sees the
      // same signal the client would compute from prefMatrix × counts.
      Array.from({ length: K }, (_, i) =>
        Array.from({ length: K }, (_, j) => (i === j ? 0 : prefMatrix[i][j] * counts[i][j])),
      ),
    );
    const probs = softmax(strengths);

    let entSum = 0;
    let entCount = 0;
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        const p = prefMatrix[i][j];
        if (p > 0 && p < 1) {
          entSum += -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
        }
        entCount++;
      }
    }
    const entropyAvg = entCount > 0 ? entSum / entCount : 0;

    const ranking = strengths
      .map((s, i) => {
        let winSum = 0;
        let cnt = 0;
        for (let j = 0; j < K; j++) {
          if (i === j) continue;
          winSum += prefMatrix[i][j];
          cnt++;
        }
        return {
          index: i,
          strength: s,
          prob_best: probs[i],
          avg_win_prob: cnt > 0 ? winSum / cnt : 0.5,
          judgment_count: counts[i].reduce((a, b) => a + b, 0),
        };
      })
      .sort((a, b) => b.prob_best - a.prob_best);

    const topConfidence = ranking[0]?.prob_best ?? 1 / K;
    const topMargin = ranking.length >= 2 ? ranking[0].prob_best - ranking[1].prob_best : topConfidence;
    const totalJudgments = counts.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0) / 2;

    // Governance event (fire-and-forget).
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, serviceKey);
      await emitGovernanceEvents(sb, [
        {
          entryId: entry_id || null,
          eventType: "model_output_received",
          eventStatus: "recorded",
          provider: "lovable",
          modelName: VERIFIER_MODEL,
          metadata: {
            action: "rank_variants",
            correlation_id: correlationId,
            k: K,
            samples_per_ordering: samplesPerOrdering,
            top_confidence: topConfidence,
            top_margin: topMargin,
            entropy_avg: entropyAvg,
            total_judgments: totalJudgments,
          },
        },
      ]);
    } catch (govErr) {
      console.error("rank-variants governance error (non-fatal):", govErr);
    }

    return new Response(
      JSON.stringify({
        ranking,
        preference_matrix: prefMatrix,
        counts_matrix: counts,
        top_confidence: topConfidence,
        top_margin: topMargin,
        entropy_avg: entropyAvg,
        total_judgments: totalJudgments,
        correlation_id: correlationId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("rank-variants error:", e);
    return aiErrorResponse(e, corsHeaders);
  }
});

// ── Local math (kept in sync with src/lib/ranking/bestOfK.ts) ──

function fitBradleyTerry(winsMatrix: number[][], maxIter = 200, tol = 1e-6): number[] {
  const K = winsMatrix.length;
  if (K === 0) return [];
  if (K === 1) return [0];
  let pi = new Array(K).fill(1);
  const W = winsMatrix.map((row) => row.reduce((a, b) => a + b, 0));
  const N: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) N[i][j] = winsMatrix[i][j] + winsMatrix[j][i];
  }
  for (let iter = 0; iter < maxIter; iter++) {
    const newPi = new Array(K).fill(0);
    for (let i = 0; i < K; i++) {
      let denom = 0;
      for (let j = 0; j < K; j++) {
        if (i === j || N[i][j] === 0) continue;
        denom += N[i][j] / (pi[i] + pi[j]);
      }
      newPi[i] = denom > 0 ? W[i] / denom : pi[i];
    }
    const logMean = newPi.reduce((s, v) => s + Math.log(Math.max(v, 1e-12)), 0) / K;
    const scale = Math.exp(-logMean);
    for (let i = 0; i < K; i++) newPi[i] *= scale;
    let delta = 0;
    for (let i = 0; i < K; i++) delta = Math.max(delta, Math.abs(newPi[i] - pi[i]));
    pi = newPi;
    if (delta < tol) break;
  }
  return pi.map((v) => Math.log(Math.max(v, 1e-12)));
}

function softmax(xs: number[]): number[] {
  if (xs.length === 0) return [];
  const max = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}
