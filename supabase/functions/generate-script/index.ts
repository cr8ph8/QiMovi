import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, aiErrorResponse, resolveModelHint } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID_SCRIPT_GENERATION_ON_HOLD = true;

const CATEGORY_PAGE_TARGETS: Record<string, string> = {
  vertical: "2-5 pages",
  micro: "2-5 pages",
  short: "8-15 pages",
  pilot_30: "25-35 pages",
  pilot_60: "50-65 pages",
  feature: "90-110 pages",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (PAID_SCRIPT_GENERATION_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI screenplay generation is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { prompt, category } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pageTarget = CATEGORY_PAGE_TARGETS[category] || "5-15 pages";

    // Derive estimated page count from category for cost routing
    const CATEGORY_EST_PAGES: Record<string, number> = {
      vertical: 3,
      micro: 3,
      short: 12,
      pilot_30: 30,
      pilot_60: 58,
      feature: 100,
    };
    const estimatedPageCount = CATEGORY_EST_PAGES[category] || 10;

    const systemPrompt = `You are a professional screenwriter AI. Generate a ${pageTarget} screenplay or treatment based on the user's idea.

The screenplay MUST explore themes of identity and choice.

Requirements:
- Include a clear protagonist
- Include a central conflict
- Include at least one turning point
- Include dialogue samples in proper screenplay format
- Include a logline at the top
- Target length: ${pageTarget}

Format the output in standard screenplay format:
- Scene headings (INT./EXT.)
- Action lines
- Character names (centered, caps)
- Dialogue (indented)
- Parentheticals where appropriate

Keep the tone cinematic and the narrative compelling.`;

    const modelHint = await resolveModelHint("generate-script", "google/gemini-3-flash-preview");
    const result = await callAI({
      route: {
        functionName: "generate-script",
        modelHint,
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Story idea: ${prompt}` },
      ],
      max_completion_tokens: 8000,
      temperature: 0.8,
      meta: {
        userId: user.id,
        pageCount: estimatedPageCount,
      },
    });

    return new Response(
      JSON.stringify({ script: result.content, model: result.modelId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("generate-script error:", error);
    return aiErrorResponse(error, corsHeaders);
  }
});
