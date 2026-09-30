// SignalCheck — analyze text for AI-writing signals, claim discipline, and editorial risk.
// NOT a binary "AI vs human" detector. Returns editorial risk signals only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-router.ts";
import { logGovernanceAction } from "../_shared/audit.ts";
import { requireProjectOwner } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODE_HINTS: Record<string, string> = {
  general: "General prose. Apply standard editorial-rigor heuristics.",
  wikipedia: "Encyclopedia style. Require neutral tone, named sources, no promotional language, no synthesis without citation.",
  academic: "Academic paper. Require mechanism, methodology, sources, bounded claims. Flag unsupported novelty claims.",
  linkedin: "Public thought leadership / LinkedIn. Heavily flag synthetic authority, performance of importance, vague abstractions.",
  q2e: "Q2E technical claim review. Treat every sentence as a proposed state update. Demand mechanism, evidence, and verification before ACCEPT.",
};

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "signalcheck_report",
    description: "Structured editorial-risk report for the submitted text.",
    parameters: {
      type: "object",
      properties: {
        scores: {
          type: "object",
          description: "Editorial risk scores 0-100. Not certainty. ai_signal_density is how AI-style the prose reads.",
          properties: {
            ai_signal_density: { type: "integer", minimum: 0, maximum: 100 },
            specificity: { type: "integer", minimum: 0, maximum: 100 },
            evidence_quality: { type: "integer", minimum: 0, maximum: 100 },
            claim_discipline: { type: "integer", minimum: 0, maximum: 100 },
            human_texture: { type: "integer", minimum: 0, maximum: 100 },
            overclaim_risk: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: ["ai_signal_density","specificity","evidence_quality","claim_discipline","human_texture","overclaim_risk"],
          additionalProperties: false,
        },
        signals: {
          type: "array",
          description: "Flagged phrases. Include exact substring from the source for span matching.",
          items: {
            type: "object",
            properties: {
              phrase: { type: "string" },
              signal_type: { type: "string", enum: ["synthetic_authority","mechanism_weak","boundary_failure","ai_structure","overclaim","needs_source","vague"] },
              severity: { type: "string", enum: ["low","medium","high"] },
              explanation: { type: "string" },
              replacement_suggestion: { type: "string" },
              color: { type: "string", enum: ["yellow","orange","red","blue","green"] },
            },
            required: ["phrase","signal_type","severity","explanation","color"],
            additionalProperties: false,
          },
        },
        claims: {
          type: "array",
          description: "Major factual claims extracted from the text.",
          items: {
            type: "object",
            properties: {
              claim_text: { type: "string" },
              claim_type: { type: "string", enum: ["observed","implemented","prototype","hypothesis","analogy","unsupported","needs_source","overclaimed"] },
              evidence_status: { type: "string", enum: ["present","partial","missing"] },
              risk_level: { type: "string", enum: ["low","medium","high"] },
              action: { type: "string", enum: ["ACCEPT","REVISE","ESCALATE","REJECT"] },
              suggested_rewrite: { type: "string" },
            },
            required: ["claim_text","claim_type","evidence_status","risk_level","action"],
            additionalProperties: false,
          },
        },
        summary: { type: "string", description: "One-paragraph editorial verdict. No 'this is AI' language." },
      },
      required: ["scores","signals","claims","summary"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { text, mode = "general", title, project_id } = await req.json() as {
      text?: string; mode?: string; title?: string; project_id?: string;
    };

    if (!text || text.trim().length < 40) {
      return new Response(JSON.stringify({ error: "Provide at least 40 characters of text." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (text.length > 20000) {
      return new Response(JSON.stringify({ error: "Text too long. Limit 20,000 characters." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // A project id opts this request into project-backed context. Authorize that
    // anchor before charging, building context, or invoking the model. Invalid
    // and foreign ids must fail closed instead of silently degrading to a
    // free-form analysis.
    if (project_id) {
      const projectAccess = await requireProjectOwner(
        admin,
        user.id,
        project_id,
        corsHeaders,
      );
      if (projectAccess instanceof Response) return projectAccess;
    }

    // Charge tokens via spend-tokens (server-to-server, propagate user JWT).
    const spendResp = await fetch(`${supabaseUrl}/functions/v1/spend-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: anonKey },
      body: JSON.stringify({ action: "signalcheck_analyze", label: "SignalCheck · Analyze" }),
    });
    if (!spendResp.ok) {
      const err = await spendResp.text();
      return new Response(JSON.stringify({ error: `Token charge failed: ${err}` }), {
        status: spendResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const spendData = await spendResp.json().catch(() => ({}));
    const tokensSpent = spendData?.amount ?? 25;

    const modeHint = MODE_HINTS[mode] ?? MODE_HINTS.general;

    const system = `You are SignalCheck, an editorial-risk reviewer. You DO NOT make verdicts about whether text was written by AI. You identify signals associated with AI-polished, over-smoothed, under-sourced, or inflated prose.

CORE PRINCIPLES (Q2E):
- Fluency is not evidence.
- Every claim is a proposed state update. ACCEPT only when bounded, specific, and supported.
- Mechanism over hype. Evidence over fluency. Boundary over bravado. Provenance over polish.

REVIEW MODE: ${mode}
${modeHint}

FOR SIGNALS:
- yellow=vague/inflated, orange=unsupported, red=overclaim/misleading, blue=needs source, green=strong+grounded
- Quote the exact substring as it appears in the source for "phrase".
- Only flag synthetic_authority phrases when unsupported by mechanism or example.

FOR CLAIMS:
- Extract substantive factual/causal claims (not transitions).
- ACCEPT: specific, bounded, supported. REVISE: needs clearer wording/evidence. ESCALATE: strong claim needing human verification. REJECT: unsupported/inflated/misleading.

NEVER write "this was written by AI". Use "signals associated with AI-polished writing".`;

    // Optional canonical ContentContext when the analyzer is invoked from a project.
    // SignalCheck can also analyze free-form text with no project anchor, so this stays optional.
    let contextRef: { bundle_id: string; payload_hash: string } | undefined;
    let contextEntryId: string | undefined;
    let contextSensitivity: string | undefined;
    if (project_id) {
      try {
        const { buildContentContext } = await import("../_shared/content-context.ts");
        const built = await buildContentContext(admin, project_id, {
          mode: "diagnostic",
          task: "signalcheck.analyze",
          scope: "script",
          constraints: { review_mode: mode },
          model_hint: "google/gemini-2.5-flash",
        }, user.id);
        contextRef = { bundle_id: built.bundle_id, payload_hash: built.context_hash };
        contextEntryId = built.context.entry_id ?? undefined;
        contextSensitivity = built.context.sensitivity;
      } catch (ctxErr) {
        console.error("[signalcheck-analyze] context bundle build failed:", ctxErr);
        return new Response(JSON.stringify({ error: "Project context could not be built" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const result = await callAI({
      route: { functionName: "signalcheck-analyze", modelHint: "google/gemini-2.5-flash" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: `TITLE: ${title || "(untitled)"}\n\nTEXT:\n${text}` },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "signalcheck_report" } },
      temperature: 0.2,
      max_completion_tokens: 4000,
      context_ref: contextRef,
      meta: {
        userId: user.id,
        projectId: project_id,
        entryId: contextEntryId,
        sensitivity: contextSensitivity,
      },
    });

    const toolCall = result.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured report");
    }
    const report = JSON.parse(toolCall.function.arguments);

    // Persist analysis
    const { data: analysis, error: insertErr } = await admin
      .from("signalcheck_analyses")
      .insert({
        user_id: user.id,
        title: title || null,
        mode,
        original_text: text,
        scores: report.scores,
        model: result.modelId,
        tokens_spent: tokensSpent,
      })
      .select("id")
      .single();
    if (insertErr || !analysis) throw new Error(`Persist failed: ${insertErr?.message}`);

    // Locate spans by first occurrence (best-effort).
    const findSpan = (needle: string): [number | null, number | null] => {
      if (!needle) return [null, null];
      const idx = text.indexOf(needle);
      if (idx < 0) return [null, null];
      return [idx, idx + needle.length];
    };

    const signalRows = (report.signals ?? []).slice(0, 200).map((s: any) => {
      const [start, end] = findSpan(s.phrase);
      return {
        analysis_id: analysis.id,
        phrase: s.phrase,
        signal_type: s.signal_type,
        severity: s.severity,
        explanation: s.explanation ?? null,
        replacement_suggestion: s.replacement_suggestion ?? null,
        span_start: start,
        span_end: end,
        color: s.color ?? "yellow",
      };
    });
    if (signalRows.length) await admin.from("signalcheck_signals").insert(signalRows);

    const claimRows = (report.claims ?? []).slice(0, 200).map((c: any, i: number) => {
      const [start, end] = findSpan(c.claim_text);
      return {
        analysis_id: analysis.id,
        claim_text: c.claim_text,
        claim_type: c.claim_type,
        evidence_status: c.evidence_status,
        risk_level: c.risk_level,
        action: c.action,
        suggested_rewrite: c.suggested_rewrite ?? null,
        span_start: start,
        span_end: end,
        ordinal: i,
      };
    });
    if (claimRows.length) await admin.from("signalcheck_claims").insert(claimRows);

    await admin.from("ai_usage_log").insert({
      function_name: "signalcheck-analyze",
      model_id: result.modelId,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      estimated_cost_cents: result.estimatedCostCents,
      status: "ok",
      user_id: user.id,
    });

    await logGovernanceAction({
      userId: user.id,
      action: "signalcheck.analyze",
      target: { analysis_id: analysis.id, mode },
      details: { model: result.modelId, tokens_spent: tokensSpent, signal_count: signalRows.length, claim_count: claimRows.length },
    });

    return new Response(JSON.stringify({ analysis_id: analysis.id, summary: report.summary, tokensSpent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[signalcheck-analyze] Error:", e);
    const status = e.message?.includes("429") ? 429 : e.message?.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
