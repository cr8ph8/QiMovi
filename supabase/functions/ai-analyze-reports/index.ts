import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UNCHARGED_REPORT_ANALYSIS_ON_HOLD = true;

const returnAnalysisTool = {
  type: "function" as const,
  function: {
    name: "return_analysis",
    description: "Return structured comparison analysis of AI grading reports",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentence overview of the comparison" },
        consistency_score: { type: "number", description: "How consistent are the models, 0-100" },
        strengths: {
          type: "array",
          items: {
            type: "object",
            properties: {
              dimension: { type: "string" },
              insight: { type: "string" },
            },
            required: ["dimension", "insight"],
          },
          description: "Dimensions where the screenplay excels",
        },
        weaknesses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              dimension: { type: "string" },
              insight: { type: "string" },
            },
            required: ["dimension", "insight"],
          },
          description: "Dimensions needing improvement",
        },
        model_notes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              model: { type: "string" },
              tendency: { type: "string" },
            },
            required: ["model", "tendency"],
          },
          description: "Model-specific tendencies observed",
        },
        recommendation: { type: "string", description: "Which model's evaluation seems most reliable and why" },
        confidence: { type: "number", description: "Confidence in this analysis, 0-100" },
      },
      required: ["summary", "consistency_score", "strengths", "weaknesses", "model_notes", "recommendation", "confidence"],
      additionalProperties: false,
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req, corsHeaders);
  if (auth instanceof Response) return auth;

  if (UNCHARGED_REPORT_ANALYSIS_ON_HOLD) {
    return new Response(JSON.stringify({
      error: "security_maintenance",
      message: "AI report comparison is temporarily paused while secure billing is upgraded.",
    }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  try {
    const { reports } = await req.json();
    if (!Array.isArray(reports) || reports.length < 2 || reports.length > 3) {
      return new Response(JSON.stringify({ error: "Provide 2-3 reports to compare" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reportSummaries = reports.map((r: any, i: number) => {
      const dims = [
        `originality: ${r.originality}`,
        `structure: ${r.structure}`,
        `character_depth: ${r.character_depth}`,
        `dialogue: ${r.dialogue}`,
        `theme: ${r.theme}`,
        `emotion: ${r.emotion}`,
        `format_adherence: ${r.format_adherence}`,
        r.market != null ? `market: ${r.market}` : null,
        r.visual != null ? `visual: ${r.visual}` : null,
      ].filter(Boolean).join(", ");
      return `Report ${i + 1} (${r.model_id || "unknown model"}, total: ${r.total_score}): ${dims}`;
    }).join("\n");

    const systemPrompt = `You are a screenplay evaluation analyst. Compare AI grading reports from different models and provide structured analysis. Be concise and actionable.

You MUST call the return_analysis function with your structured comparison results. Analyze score consistency, identify which dimensions show the most agreement/disagreement, note any model-specific tendencies, and recommend which evaluation is most trustworthy.`;

    const userPrompt = `Compare these ${reports.length} AI grading reports for the same screenplay:\n\n${reportSummaries}`;

    const result = await callAI({
      route: { functionName: "ai-analyze-reports", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_completion_tokens: 2000,
      tools: [returnAnalysisTool],
      tool_choice: { type: "function", function: { name: "return_analysis" } },
      meta: { entryId: reports[0]?.entry_id },
    });

    let analysis;
    try {
      analysis = JSON.parse(result.content);
    } catch {
      analysis = { summary: result.content, confidence: 50 };
    }

    return new Response(JSON.stringify({ analysis, model_used: result.modelId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return aiErrorResponse(error, corsHeaders);
  }
});
