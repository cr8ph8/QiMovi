// Edge function: news-draft-suggest
// Admin-only. Takes a feature_roadmap entry (or freeform changelog snippet)
// and returns a first-pass news article draft (title, excerpt, body markdown,
// category, tags) for the admin News editor.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are the editor of the CanIScreenwrite product news page.

You take a single changelog / roadmap entry describing a shipped feature, system update, or announcement and you write a first-pass news post for the public news feed.

VOICE & FORMAT
- Brand voice: confident, plainspoken, lightly editorial. Cinema Aurea aesthetic — sharp, no hype, no marketing fluff.
- Audience: screenwriters and platform operators who already use the product.
- Body is short-form markdown. Use ## for section headings, ### for sub-headings, **bold** for emphasis, and "- " bullets. No HTML, no code fences, no images.
- Length target: 150–350 words. One opener paragraph, 2–4 short sections, no fabricated metrics or quotes.

RULES
- Do NOT invent features, numbers, dates, or quotes that are not implied by the changelog input.
- If something is unclear, write tentatively ("rolling out", "available now to ...") rather than inventing detail.
- Pick the best-fitting category from the allowed list.
- Suggest 2–5 short lowercase tags (single words or short phrases, no leading #).
- Title ≤ 80 chars, excerpt ≤ 220 chars, both plain text (no markdown).

Always return your answer by calling the draft_news_post tool.`;

const TOOL = {
  type: "function",
  function: {
    name: "draft_news_post",
    description: "Return a first-pass news article draft based on the changelog entry.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "≤80 chars, plain text" },
        excerpt: { type: "string", description: "≤220 chars, plain text" },
        body: { type: "string", description: "Short-form markdown body, 150–350 words" },
        category: {
          type: "string",
          enum: [
            "announcement",
            "feature_release",
            "system_update",
            "competition",
            "legal",
            "retirement",
          ],
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "2–5 short lowercase tags",
        },
        reasoning: {
          type: "string",
          description: "Brief reasoning trace for governance/audit.",
        },
      },
      required: ["title", "excerpt", "body", "category", "tags"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Admin-only auth ─────────────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === anonKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Input ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const roadmap_id: string | undefined = body?.roadmap_id;
    const freeform: string = (body?.changelog ?? "").toString().trim();
    const hintCategory: string | undefined = body?.category;

    let source: {
      title?: string;
      description?: string | null;
      status?: string | null;
      released_at?: string | null;
    } | null = null;

    if (roadmap_id) {
      const { data, error } = await supabase
        .from("feature_roadmap")
        .select("title, description, status, released_at")
        .eq("id", roadmap_id)
        .maybeSingle();
      if (error) {
        return new Response(
          JSON.stringify({ error: `Could not load roadmap entry: ${error.message}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      source = data;
    }


    if (!source && !freeform) {
      return new Response(
        JSON.stringify({ error: "Provide either roadmap_id or a changelog snippet." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userPrompt = [
      source
        ? [
            "ROADMAP ENTRY:",
            source.title ? `Title: ${source.title}` : null,
            source.status ? `Status: ${source.status}` : null,
            source.released_at ? `Released: ${source.released_at}` : null,
            source.description ? `Description:\n${source.description}` : null,
          ]

            .filter(Boolean)
            .join("\n")
        : null,
      freeform ? `ADDITIONAL CHANGELOG NOTES:\n${freeform}` : null,
      hintCategory ? `Preferred category if it fits: ${hintCategory}` : null,
      "",
      "Draft the news post now.",
    ]
      .filter(Boolean)
      .join("\n\n");

    let result;
    try {
      result = await callAI({
        route: {
          functionName: "news-draft-suggest",
          modelHint: "google/gemini-3-flash-preview",
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "draft_news_post" } },
        meta: { sensitivity: "standard" },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    if (!result.content) {
      return new Response(
        JSON.stringify({ error: "Model did not return a draft." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let draft: Record<string, unknown> = {};
    try {
      draft = JSON.parse(result.content);
    } catch (e) {
      console.error("Failed to parse draft tool output", e);
      return new Response(
        JSON.stringify({ error: "Invalid structured output from model." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ draft, model: result.modelId, source_roadmap_id: roadmap_id ?? null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("news-draft-suggest error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
