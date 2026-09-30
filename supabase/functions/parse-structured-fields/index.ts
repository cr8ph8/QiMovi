// Structured-fields parser: converts a screenplay document into
// { logline, genre, synopsis, themes[], characters[] } while preserving
// the raw script_text. Writes the result into entries.parsed_metadata.structured
// (merge-preserve other fields) and stamps entries.logline / entries.genre when
// they are currently empty.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, resolveModelHint, aiErrorResponse } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UNCHARGED_STRUCTURED_PARSE_ON_HOLD = true;

const tool = {
  type: "function" as const,
  function: {
    name: "return_structured_fields",
    description: "Return structured screenplay fields extracted from the source text.",
    parameters: {
      type: "object",
      properties: {
        logline: { type: "string", description: "One sentence, ≤ 40 words, present tense." },
        genre: { type: "string", description: "Primary genre + optional subgenre, comma-separated." },
        synopsis: { type: "string", description: "120–220 word neutral synopsis covering setup, escalation, climax." },
        themes: {
          type: "array",
          description: "3–6 distinct thematic tags grounded in the text.",
          items: { type: "string" },
        },
        characters: {
          type: "array",
          description: "Up to 12 named characters present in the screenplay.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: {
                type: "string",
                enum: ["protagonist", "antagonist", "supporting", "ensemble", "minor"],
              },
              description: { type: "string", description: "≤ 30 words, grounded in the text." },
            },
            required: ["name", "role", "description"],
          },
        },
        confidence: { type: "number", description: "Overall extraction confidence 0–100." },
      },
      required: ["logline", "genre", "synopsis", "themes", "characters", "confidence"],
      additionalProperties: false,
    },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (UNCHARGED_STRUCTURED_PARSE_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI screenplay field extraction is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const entryId: string | undefined = body?.entryId;
    let scriptText: string | undefined = typeof body?.text === "string" ? body.text : undefined;
    const persist: boolean = body?.persist !== false; // default true when entryId is provided
    const pageCount: number | undefined = body?.pageCount;

    const admin = createClient(supabaseUrl, serviceKey);

    let entryRow: { id: string; user_id: string; script_text: string | null; parsed_metadata: Record<string, unknown> | null; logline: string | null; genre: string | null; page_count: number | null } | null = null;

    if (entryId) {
      const { data, error } = await admin
        .from("entries")
        .select("id,user_id,script_text,parsed_metadata,logline,genre,page_count")
        .eq("id", entryId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return new Response(JSON.stringify({ error: "Entry not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Owner-only unless admin
      if (data.user_id !== user.id) {
        const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      entryRow = data as typeof entryRow;
      if (!scriptText) scriptText = data.script_text || "";
    }

    if (!scriptText || scriptText.trim().length < 200) {
      return new Response(JSON.stringify({ error: "script text required (≥200 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sample beginning + middle + end to capture arc on long features without
    // blowing the context window.
    const MAX = 90_000;
    let prompt: string;
    if (scriptText.length <= MAX) {
      prompt = scriptText;
    } else {
      const slice = Math.floor(MAX / 3);
      prompt = [
        scriptText.slice(0, slice),
        "\n\n[...middle of screenplay...]\n\n",
        scriptText.slice(Math.floor(scriptText.length / 2) - slice / 2, Math.floor(scriptText.length / 2) + slice / 2),
        "\n\n[...later in screenplay...]\n\n",
        scriptText.slice(-slice),
      ].join("");
    }

    const modelHint = await resolveModelHint("parse-structured-fields", "google/gemini-3-flash-preview");
    const pages = pageCount ?? entryRow?.page_count ?? null;

    const result = await callAI({
      route: { functionName: "parse-structured-fields", modelHint },
      messages: [
        {
          role: "system",
          content: `You are a screenplay analyst extracting structured fields. Ground every field in the supplied text. Avoid persuasion bias, ideological weighting, manipulative tone, and unjustified certainty. If a field is uncertain, lower the confidence rather than fabricating detail. You MUST call return_structured_fields.`,
        },
        {
          role: "user",
          content: `Screenplay (${pages ?? "unknown"} pages). Extract structured fields.\n\n${prompt}`,
        },
      ],
      temperature: 0.2,
      max_completion_tokens: 2000,
      tools: [tool],
      tool_choice: { type: "function", function: { name: "return_structured_fields" } },
      meta: { entryId, userId: user.id },
    });

    let structured: Record<string, unknown>;
    try {
      structured = JSON.parse(result.content);
    } catch {
      return new Response(JSON.stringify({ error: "AI returned invalid JSON" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
      ...structured,
      confidence: Math.max(0, Math.min(100, Math.round(Number(structured.confidence) || 0))),
      model_id: result.modelId,
      parsed_at: new Date().toISOString(),
    };

    if (persist && entryRow) {
      const merged = { ...(entryRow.parsed_metadata || {}), structured: payload };
      const update: Record<string, unknown> = { parsed_metadata: merged };
      if (!entryRow.logline && typeof payload.logline === "string") update.logline = payload.logline;
      if (!entryRow.genre && typeof payload.genre === "string") update.genre = payload.genre;
      const { error: upErr } = await admin.from("entries").update(update).eq("id", entryRow.id);
      if (upErr) console.error("persist failed", upErr);
    }

    return new Response(JSON.stringify({ structured: payload, persisted: persist && !!entryRow }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-structured-fields error", err);
    return aiErrorResponse(err, corsHeaders);
  }
});
