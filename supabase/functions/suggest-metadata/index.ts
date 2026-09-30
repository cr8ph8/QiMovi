import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, resolveModelHint, aiErrorResponse } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METADATA_AI_ON_HOLD = true;

const suggestMetadataTool = {
  type: "function" as const,
  function: {
    name: "suggest_metadata",
    description: "Return suggested metadata for a screenplay",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Suggested or extracted title" },
        logline: { type: "string", description: "One-sentence logline" },
        genre: {
          type: "string",
          enum: ["Drama", "Comedy", "Thriller", "Horror", "Sci-Fi", "Action", "Romance", "Mystery", "Other"],
        },
        format: {
          type: "string",
          enum: ["Feature", "Short Film", "Pilot", "Micro Short", "Vertical"],
        },
        confidence: {
          type: "object",
          properties: {
            title: { type: "number", description: "Confidence 0-100" },
            logline: { type: "number", description: "Confidence 0-100" },
            genre: { type: "number", description: "Confidence 0-100" },
            format: { type: "number", description: "Confidence 0-100" },
          },
          required: ["title", "logline", "genre", "format"],
        },
      },
      required: ["title", "logline", "genre", "format", "confidence"],
      additionalProperties: false,
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    if (METADATA_AI_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI metadata suggestions are temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { text, pageCount } = await req.json();
    if (!text || typeof text !== "string") throw new Error("Missing text");

    // Truncate to ~8000 chars to stay within token limits
    const truncatedText = text.slice(0, 8000);

    const modelHint = await resolveModelHint("suggest-metadata", "google/gemini-3-flash-preview");

    const systemPrompt = `You are a screenplay metadata analyst. Given a screenplay text, extract or suggest:
- title: The screenplay's title (extract from title page if present, otherwise suggest based on content)
- logline: A compelling one-sentence logline capturing the core story
- genre: The primary genre (one of: Drama, Comedy, Thriller, Horror, Sci-Fi, Action, Romance, Mystery, Other)
- format: The screenplay format (one of: Feature, Short Film, Pilot, Micro Short, Vertical)

For each field, provide a confidence score from 0-100:
- 90-100: Extracted directly from the text
- 70-89: Strongly inferred from content
- 50-69: Moderate inference
- Below 50: Weak guess

You MUST call the suggest_metadata function with your analysis.`;

    const userPrompt = `Analyze this screenplay (${pageCount || "unknown"} pages) and suggest metadata:\n\n${truncatedText}`;

    const result = await callAI({
      route: { functionName: "suggest-metadata", modelHint },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_completion_tokens: 1000,
      tools: [suggestMetadataTool],
      tool_choice: { type: "function", function: { name: "suggest_metadata" } },
      meta: { userId: user.id },
    });

    let suggestions;
    try {
      suggestions = JSON.parse(result.content);
    } catch {
      throw new Error("Failed to parse AI suggestions");
    }

    // Clamp confidence scores
    if (suggestions.confidence) {
      for (const key of ["title", "logline", "genre", "format"]) {
        suggestions.confidence[key] = Math.max(0, Math.min(100, Math.round(suggestions.confidence[key] || 0)));
      }
    }

    return new Response(
      JSON.stringify({ suggestions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("suggest-metadata error:", error);
    return aiErrorResponse(error, corsHeaders);
  }
});
