// Runs structured parsing (logline, genre, synopsis, themes, characters) on the
// extracted_text of a brain_dump_files row. Persists results into the same row.
//
// Body: { file_id: string }
// Returns: { structured: object }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, resolveModelHint, aiErrorResponse } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UNCHARGED_BRAIN_DUMP_PARSE_ON_HOLD = true;

const tool = {
  type: "function" as const,
  function: {
    name: "return_structured_fields",
    description: "Return structured creative document fields extracted from the source text.",
    parameters: {
      type: "object",
      properties: {
        logline: { type: "string", description: "One sentence, ≤ 40 words, present tense. Empty string if not derivable." },
        genre: { type: "string", description: "Primary genre + optional subgenre, comma-separated. Empty if unclear." },
        synopsis: { type: "string", description: "120–220 word neutral synopsis. Empty if document is not narrative." },
        themes: {
          type: "array",
          description: "3–6 distinct thematic tags grounded in the text. Empty if not narrative.",
          items: { type: "string" },
        },
        characters: {
          type: "array",
          description: "Up to 12 named characters present in the text.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string", enum: ["protagonist", "antagonist", "supporting", "ensemble", "minor"] },
              description: { type: "string", description: "≤ 30 words, grounded in the text." },
            },
            required: ["name", "role", "description"],
          },
        },
        doc_type: {
          type: "string",
          enum: ["screenplay", "treatment", "outline", "notes", "business", "coverage", "transcript", "other"],
          description: "Best guess at the kind of document.",
        },
        confidence: { type: "number", description: "Overall extraction confidence 0–100." },
        field_confidence: {
          type: "object",
          description: "Per-field confidence scores 0–100 for logline, genre, synopsis, themes, characters, doc_type. Omit if not available.",
          properties: {
            logline: { type: "number" },
            genre: { type: "number" },
            synopsis: { type: "number" },
            themes: { type: "number" },
            characters: { type: "number" },
            doc_type: { type: "number" },
          },
        },
        field_sources: {
          type: "object",
          description: "For each field, the verbatim snippets from the source text that grounded the extraction. Snippets must be short quotes (≤ 240 chars) copied verbatim from the source. Omit a field when there is no direct textual grounding.",
          properties: {
            logline: { type: "array", items: { type: "string" } },
            genre: { type: "array", items: { type: "string" } },
            synopsis: { type: "array", items: { type: "string" } },
            themes: {
              type: "array",
              description: "One snippet per theme, aligned by index with the themes array when possible.",
              items: { type: "string" },
            },
            characters: {
              type: "array",
              description: "One snippet per character, aligned by index with the characters array when possible.",
              items: { type: "string" },
            },
            doc_type: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["logline", "genre", "synopsis", "themes", "characters", "doc_type", "confidence"],
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

    if (UNCHARGED_BRAIN_DUMP_PARSE_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI brain-dump analysis is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const file_id: string | undefined = body?.file_id;
    if (!file_id) {
      return new Response(JSON.stringify({ error: "file_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: row, error: rowErr } = await admin
      .from("brain_dump_files")
      .select("id,user_id,filename,extracted_text,structured")
      .eq("id", file_id)
      .maybeSingle();
    if (rowErr) throw rowErr;
    if (!row) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (row.user_id !== user.id) {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const text = (row.extracted_text || "").trim();
    if (text.length < 200) {
      await admin
        .from("brain_dump_files")
        .update({ structured_status: "skipped", structured_error: "Not enough text to parse (<200 chars)" })
        .eq("id", file_id);
      return new Response(
        JSON.stringify({ error: "Not enough text to parse (<200 chars)", status: "skipped" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Sample head/middle/tail for long documents.
    const MAX = 90_000;
    let prompt: string;
    if (text.length <= MAX) {
      prompt = text;
    } else {
      const slice = Math.floor(MAX / 3);
      prompt = [
        text.slice(0, slice),
        "\n\n[...middle of document...]\n\n",
        text.slice(Math.floor(text.length / 2) - slice / 2, Math.floor(text.length / 2) + slice / 2),
        "\n\n[...later in document...]\n\n",
        text.slice(-slice),
      ].join("");
    }

    await admin
      .from("brain_dump_files")
      .update({ structured_status: "pending", structured_error: null })
      .eq("id", file_id);

    const modelHint = await resolveModelHint("parse-brain-dump-file", "google/gemini-3-flash-preview");

    let structured: Record<string, unknown>;
    try {
      const result = await callAI({
        route: { functionName: "parse-brain-dump-file", modelHint },
        messages: [
          {
            role: "system",
            content:
              "You extract structured creative-document fields. Ground every field in the supplied text. Avoid persuasion bias, ideological weighting, manipulative tone, and unjustified certainty. Leave fields empty (\"\" or []) when the document does not support them rather than fabricating detail. You MUST call return_structured_fields.",
          },
          {
            role: "user",
            content: `Source file: ${row.filename}\n\n${prompt}`,
          },
        ],
        temperature: 0.2,
        max_completion_tokens: 2000,
        tools: [tool],
        tool_choice: { type: "function", function: { name: "return_structured_fields" } },
        meta: { userId: user.id },
      });
      structured = JSON.parse(result.content);
      (structured as Record<string, unknown>).model_id = result.modelId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI parse failed";
      await admin
        .from("brain_dump_files")
        .update({ structured_status: "error", structured_error: msg })
        .eq("id", file_id);
      return aiErrorResponse(e, corsHeaders);
    }

    const payload: Record<string, unknown> = {
      ...structured,
      confidence: Math.max(0, Math.min(1, (Number(structured.confidence) || 0) / 100)),
      parsed_at: new Date().toISOString(),
    };

    if (structured.field_confidence && typeof structured.field_confidence === "object") {
      const fc = structured.field_confidence as Record<string, number>;
      payload.field_confidence = Object.fromEntries(
        Object.entries(fc).map(([k, v]) => [k, Math.max(0, Math.min(1, (Number(v) || 0) / 100))])
      );
    }

    if (structured.field_sources && typeof structured.field_sources === "object") {
      const fs = structured.field_sources as Record<string, unknown>;
      const verified: Record<string, Array<{ snippet: string; start?: number; end?: number; verified: boolean }>> = {};
      for (const [field, snippets] of Object.entries(fs)) {
        if (!Array.isArray(snippets)) continue;
        verified[field] = (snippets as unknown[])
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .slice(0, 12)
          .map((raw) => {
            const snippet = raw.trim().slice(0, 240);
            const idx = text.indexOf(snippet);
            if (idx >= 0) return { snippet, start: idx, end: idx + snippet.length, verified: true };
            return { snippet, verified: false };
          });
      }
      payload.field_sources = verified;
    }

    const { data: updated, error: upErr } = await admin
      .from("brain_dump_files")
      .update({
        structured: payload,
        structured_status: "done",
        structured_error: null,
        structured_parsed_at: new Date().toISOString(),
      })
      .eq("id", file_id)
      .select("*")
      .single();
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({ structured: payload, file: updated }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("parse-brain-dump-file error", err);
    return aiErrorResponse(err, corsHeaders);
  }
});
