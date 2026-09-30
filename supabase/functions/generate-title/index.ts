import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID_TITLE_GENERATION_ON_HOLD = true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (PAID_TITLE_GENERATION_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI title generation is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { scriptExcerpt, genre, logline } = body as {
      scriptExcerpt?: string;
      genre?: string;
      logline?: string;
    };

    if (!scriptExcerpt && !logline) {
      return new Response(
        JSON.stringify({ error: "At least scriptExcerpt or logline is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let userMessage = "Generate a single compelling title for a screenplay.";
    if (logline) userMessage += `\n\nLogline: "${logline}"`;
    if (genre) userMessage += `\nGenre: ${genre}`;
    if (scriptExcerpt) userMessage += `\n\nScreenplay excerpt:\n${scriptExcerpt.slice(0, 4000)}`;

    const result = await callAI({
      route: { functionName: "generate-title", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        {
          role: "system",
          content:
            "You are a title specialist for screenplays. You produce exactly one title — concise, evocative, and industry-appropriate. Never include explanations, alternatives, or anything beyond the single title. Use the return_title tool to return your result.",
        },
        { role: "user", content: userMessage },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_title",
          description: "Return a single title for a screenplay",
          parameters: {
            type: "object",
            properties: { title: { type: "string", description: "A compelling screenplay title" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_title" } },
      temperature: 0.8,
      max_completion_tokens: 100,
      meta: { userId: user.id },
    });

    let title: string;
    const raw = result.raw;
    const toolCalls = raw?.choices?.[0]?.message?.tool_calls;
    if (toolCalls?.[0]?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCalls[0].function.arguments);
        title = parsed.title?.trim() || "";
      } catch {
        title = result.content?.trim() || "";
      }
    } else {
      title = result.content?.trim() || "";
    }

    // Clean up quotes
    if (title.startsWith('"') && title.endsWith('"')) {
      title = title.slice(1, -1);
    }

    // Truncate to 120 chars (DB limit)
    title = title.slice(0, 120);

    // Log usage
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    await adminClient.from("ai_usage_log").insert({
      function_name: "generate-title",
      model_id: result.modelId,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      estimated_cost_cents: result.estimatedCostCents,
      status: "ok",
      user_id: user.id,
    });

    return new Response(JSON.stringify({ title }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[generate-title] Error:", e);
    const status = e.message?.includes("429") ? 429 : e.message?.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
