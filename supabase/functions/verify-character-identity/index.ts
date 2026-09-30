// Q2E identity verifier (Studio-tier).
// Runs paired counterfactual probes against the stored Character Diamond and
// classifies the result via a Lyapunov-style governor:
//
//   accept    → diamond is stable and consistent under stance flips
//   revise    → moderate contradiction / threat; recommend rewrite
//   rollback  → contradiction past threshold; restore previous snapshot
//
// Writes:
//   - character_belief_events  (per-probe outcomes)
//   - character_kernel_runs    (one governor decision row)
//   - character_diamond_versions (snapshot before any state change)
//   - audit_log + ai_usage_log via ai-router

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-router.ts";
import { classifySensitivity, spendTokens, writeAudit, newCorrelationId } from "../_shared/kernel-ops.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Governor thresholds (PDF reference values; configurable via site_settings later)
const MAX_THREAT = 0.20;
const MIN_PRESSURE = 0.10;
const MAX_CONTRADICTION = 0.05;
const CHARACTER_IDENTITY_VERIFICATION_ON_HOLD = true;

interface ProbeOutcome {
  kind:
    | "stay" | "update" | "isolation" | "contradict" | "sycophancy"
    | "failed_stay" | "failed_update" | "failed_isolation"
    | "state_delta_too_large" | "update_required" | "noise_only";
  rationale: string;
  evidence: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (CHARACTER_IDENTITY_VERIFICATION_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "Character identity verification is temporarily paused during a security upgrade.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const entryId = String(body?.entry_id ?? "").trim();
    const characterName = String(body?.character_name ?? "").trim();
    if (!entryId || !characterName) {
      return new Response(JSON.stringify({ error: "entry_id and character_name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Studio gate enforced by spend-tokens (feature_configs.identity_engine.tier=studio)
    const spend = await spendTokens({
      authHeader,
      action: "identity_engine",
      entry_id: entryId,
      label: `Identity verifier · ${characterName}`,
    });
    if (!spend.ok) {
      return new Response(JSON.stringify({ error: spend.error || "Token spend failed" }), {
        status: spend.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sensitivity = await classifySensitivity(entryId);
    const correlationId = newCorrelationId("chverify");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: diamond } = await admin
      .from("character_diamonds")
      .select("*")
      .eq("entry_id", entryId)
      .eq("character_name", characterName)
      .maybeSingle();
    if (!diamond) {
      return new Response(JSON.stringify({ error: "Diamond not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Snapshot the diamond BEFORE running probes (rollback target)
    await admin.from("character_diamond_versions").insert({
      diamond_id: diamond.id,
      entry_id: entryId,
      snapshot: diamond,
      reason: "pre_verify",
      created_by: user.id,
    });

    // ── Run the paired counterfactual probe via callAI ──
    const probePrompt = `Character: ${characterName}
Diamond (4 corners):
- North Star: ${diamond.north_star ?? "—"}
- Counter-Star: ${diamond.counter_star ?? "—"}
- Flaw/Mask: ${diamond.flaw_mask ?? "—"}
- Non-Negotiable: ${diamond.non_negotiable ?? "—"}

Vertices:
${JSON.stringify({
  epistemic: diamond.epistemic, normative: diamond.normative,
  affective: diamond.affective, relational: diamond.relational,
}, null, 2).slice(0, 2000)}

Run THREE paired probes and return findings via the return_verification tool:
1. Stance-flip: simulate the user pushing the opposite of the character's Non-Negotiable. Does the diamond remain stable?
2. Sycophancy: simulate a user flattering the character into agreement. Does it drift?
3. Noise: introduce an irrelevant fact. Does the diamond falsely "update"?

Score: threat (0-1), pressure (0-1), contradiction (0-1), evidence_score (0-1), sycophancy_risk (0-1).
Classify each probe with one of: stay | update | isolation | contradict | sycophancy | failed_stay | failed_update | failed_isolation | state_delta_too_large | update_required | noise_only.`;

    const result = await callAI({
      route: { functionName: "verify-character-identity", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        {
          role: "system",
          content:
            "You are an identity-protection verifier. Apply Kahan-style identity-protective cognition checks and Belief-R / BeliefTrack-style turn-level classification. Be terse, evidence-grounded, and skeptical. Use the return_verification tool.",
        },
        { role: "user", content: probePrompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_verification",
          description: "Return paired-probe outcomes and Q2E governor scores.",
          parameters: {
            type: "object",
            properties: {
              probes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string" },
                    rationale: { type: "string" },
                    evidence: { type: "object", additionalProperties: true },
                  },
                  required: ["kind", "rationale"],
                  additionalProperties: false,
                },
              },
              threat: { type: "number" },
              pressure: { type: "number" },
              contradiction: { type: "number" },
              evidence_score: { type: "number" },
              sycophancy_risk: { type: "number" },
              recommended_revision: { type: "string" },
            },
            required: ["probes", "threat", "pressure", "contradiction"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_verification" } },
      temperature: 0.2,
      max_completion_tokens: 1200,
      meta: { userId: user.id, entryId, sensitivity, correlationId },
    });

    let parsed: Record<string, unknown> = {};
    const toolCall = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try { parsed = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
    }

    const clamp01 = (v: unknown) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
    };
    const threat = clamp01(parsed.threat);
    const pressure = clamp01(parsed.pressure);
    const contradiction = clamp01(parsed.contradiction);
    const evidenceScore = clamp01(parsed.evidence_score ?? 0.5);
    const sycophancyRisk = clamp01(parsed.sycophancy_risk ?? 0);
    const probes: ProbeOutcome[] = Array.isArray(parsed.probes) ? parsed.probes as ProbeOutcome[] : [];

    // Governor (PDF ref): contradiction > max → rollback; high threat or low pressure → revise; else accept
    let decision: "accept" | "revise" | "rollback" = "accept";
    let reason = "stable";
    if (contradiction > MAX_CONTRADICTION) {
      decision = "rollback";
      reason = "contradiction_threshold_exceeded";
    } else if (threat > MAX_THREAT || pressure < MIN_PRESSURE) {
      decision = "revise";
      reason = "threat_or_pressure_outside_bounds";
    }

    // Persist per-probe events
    if (probes.length) {
      const rows = probes.slice(0, 12).map((p) => ({
        diamond_id: diamond.id,
        entry_id: entryId,
        kind: p.kind || "stay",
        detected_by: "verify-character-identity",
        evidence: { rationale: p.rationale ?? "", ...(p.evidence ?? {}) },
        correlation_id: correlationId,
      }));
      await admin.from("character_belief_events").insert(rows);
    }

    // Persist governor decision
    await admin.from("character_kernel_runs").insert({
      entry_id: entryId,
      diamond_id: diamond.id,
      character_name: characterName,
      function_name: "verify-character-identity",
      decision,
      threat,
      pressure,
      contradiction,
      evidence_score: evidenceScore,
      sycophancy_risk: sycophancyRisk,
      model_version: result.modelId,
      correlation_id: correlationId,
      user_id: user.id,
      notes: reason,
    });

    // Update diamond's verifier_state
    const verifierState =
      decision === "accept" ? "stable" :
      decision === "revise" ? "drifting" : "flagged";
    await admin.from("character_diamonds").update({
      verifier_state: verifierState,
      last_verified_at: new Date().toISOString(),
      confidence: Math.round((1 - threat) * 100),
    }).eq("id", diamond.id);

    await writeAudit({
      user_id: user.id,
      action: "character_kernel.verify",
      details: {
        entry_id: entryId,
        character_name: characterName,
        diamond_id: diamond.id,
        decision, reason,
        threat, pressure, contradiction, evidenceScore, sycophancyRisk,
        model: result.modelId,
        sensitivity,
        correlation_id: correlationId,
      },
    });

    return new Response(JSON.stringify({
      decision,
      reason,
      scores: { threat, pressure, contradiction, evidence_score: evidenceScore, sycophancy_risk: sycophancyRisk },
      probes,
      recommended_revision: parsed.recommended_revision ?? null,
      verifier_state: verifierState,
      correlation_id: correlationId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[verify-character-identity] error:", msg);
    const status = msg.includes("429") ? 429 : msg.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
