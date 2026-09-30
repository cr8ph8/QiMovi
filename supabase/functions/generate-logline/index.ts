import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID_LOGLINE_GENERATION_ON_HOLD = true;

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

    if (PAID_LOGLINE_GENERATION_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI logline generation is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { title, genre, scriptExcerpt } = body as {
      title?: string;
      genre?: string;
      scriptExcerpt?: string;
    };

    if (!title && !scriptExcerpt) {
      return new Response(
        JSON.stringify({ error: "At least title or scriptExcerpt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build a focused prompt
    let userMessage: string;
    if (scriptExcerpt) {
      userMessage = `Generate a single compelling logline (one sentence, max 200 characters) for the following screenplay.\n\nTitle: "${title || "Untitled"}"${genre ? `\nGenre: ${genre}` : ""}\n\nScreenplay excerpt:\n${scriptExcerpt.slice(0, 4000)}`;
    } else {
      userMessage = `Generate a single compelling logline (one sentence, max 200 characters) for a screenplay titled "${title}"${genre ? ` in the ${genre} genre` : ""}.`;
    }

    const result = await callAI({
      route: { functionName: "generate-logline", modelHint: "google/gemini-3-flash-preview" },
      messages: [
        {
          role: "system",
          content:
            "You are a logline specialist for screenplays. You produce exactly one sentence — a compelling, industry-standard logline. Never include scene descriptions, dialogue, formatting, or anything beyond the single logline sentence. Use the return_logline tool to return your result.",
        },
        { role: "user", content: userMessage },
      ],
      tools: [{
        type: "function",
        function: {
          name: "return_logline",
          description: "Return a single-sentence logline for a screenplay",
          parameters: {
            type: "object",
            properties: { logline: { type: "string", description: "A compelling one-sentence logline" } },
            required: ["logline"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_logline" } },
      temperature: 0.7,
      max_completion_tokens: 200,
      meta: { userId: user.id },
    });

    // The AI router returns raw content — parse tool call if present
    let logline: string;
    const raw = result.raw;
    const toolCalls = raw?.choices?.[0]?.message?.tool_calls;
    if (toolCalls?.[0]?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCalls[0].function.arguments);
        logline = parsed.logline?.trim() || "";
      } catch {
        logline = result.content?.trim() || "";
      }
    } else {
      logline = result.content?.trim() || "";
    }

    // Clean up: remove quotes wrapping the entire logline
    if (logline.startsWith('"') && logline.endsWith('"')) {
      logline = logline.slice(1, -1);
    }

    // Truncate to 300 chars (DB limit)
    logline = logline.slice(0, 300);

    // Log usage
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    await adminClient.from("ai_usage_log").insert({
      function_name: "generate-logline",
      model_id: result.modelId,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      estimated_cost_cents: result.estimatedCostCents,
      status: "ok",
      user_id: user.id,
    });

    return new Response(JSON.stringify({ logline }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[generate-logline] Error:", e);
    const status = e.message?.includes("429") ? 429 : e.message?.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: e.message || "Internal error" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
