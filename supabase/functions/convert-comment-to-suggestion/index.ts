// Edge function: convert-comment-to-suggestion
// Takes a brain dump brief comment (and optional linked screenplay context)
// and turns it into structured, actionable screenplay suggestions / revisions.
// Pro/Studio plan only.

import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UNCHARGED_COMMENT_CONVERSION_ON_HOLD = true;

const SYSTEM_PROMPT = `You are a script editor working with a screenwriter.

You receive ONE reader/collaborator comment left on the writer's brain dump (project brief), plus optional context about the brief and a linked screenplay draft.

Your job: turn the comment into 1–4 concrete, actionable screenplay suggestions the writer can apply or reject. Each suggestion must:
- be specific (mention a character, beat, scene, or line if implied)
- be respectful of the writer's intent — do NOT introduce new themes the comment didn't raise
- classify the kind of change (dialogue_polish, scene_rewrite, structural, character, theme, note)
- include a short rationale grounded in the comment's text
- include a confidence score 0–1 (lower if the comment is vague)

If the comment is purely off-topic, abusive, or contains no actionable feedback, return an empty suggestions array and set summary to a one-line explanation.

Always respond by calling the suggest_revisions tool.`;

const TOOL = {
  type: "function",
  function: {
    name: "suggest_revisions",
    description: "Return actionable screenplay suggestions derived from a single comment.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-sentence digest of what the commenter was asking for." },
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short label, ≤ 80 chars" },
              kind: {
                type: "string",
                enum: ["dialogue_polish", "scene_rewrite", "structural", "character", "theme", "note"],
              },
              target: { type: "string", description: "Which character/beat/scene this applies to, if known." },
              suggestion: { type: "string", description: "The concrete change the writer should consider." },
              rationale: { type: "string", description: "Why, grounded in the comment." },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["title", "kind", "suggestion", "rationale", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "suggestions"],
      additionalProperties: false,
    },
  },
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const comment_id: string | undefined = body?.comment_id;
    if (!comment_id) {
      return new Response(JSON.stringify({ error: "comment_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve user
    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: authHeader },
    });
    if (!userResp.ok) {
      return new Response(JSON.stringify({ error: "Invalid session." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userData = await userResp.json();
    const userId: string | undefined = userData?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Invalid session." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (UNCHARGED_COMMENT_CONVERSION_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI comment conversion is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pro/Studio plan enforcement
    const planResp = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=plan,status&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const planRows = planResp.ok ? await planResp.json() : [];
    const sub = Array.isArray(planRows) && planRows.length > 0 ? planRows[0] : null;
    const plan = (sub?.plan ?? "free").toString().toLowerCase();
    const status = (sub?.status ?? "").toString().toLowerCase();
    const allowed = (plan === "pro" || plan === "studio") &&
      (status === "" || status === "active" || status === "trialing");
    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: "Brain Dump suggestions require the Pro plan.",
          code: "plan_required",
          required_plan: "pro",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch comment + brief (verify owner)
    const commentResp = await fetch(
      `${supabaseUrl}/rest/v1/brief_comments?id=eq.${comment_id}&select=id,body,author_name,brief_id,created_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const commentRows = commentResp.ok ? await commentResp.json() : [];
    const comment = Array.isArray(commentRows) ? commentRows[0] : null;
    if (!comment) {
      return new Response(JSON.stringify({ error: "Comment not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const briefResp = await fetch(
      `${supabaseUrl}/rest/v1/project_briefs?id=eq.${comment.brief_id}&select=id,user_id,title,organized,entry_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const briefRows = briefResp.ok ? await briefResp.json() : [];
    const brief = Array.isArray(briefRows) ? briefRows[0] : null;
    if (!brief || brief.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Not authorized for this comment." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Optional linked screenplay context
    let entryContext = "";
    if (brief.entry_id) {
      const entryResp = await fetch(
        `${supabaseUrl}/rest/v1/entries?id=eq.${brief.entry_id}&select=title,logline,genre`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      );
      if (entryResp.ok) {
        const rows = await entryResp.json();
        const e = Array.isArray(rows) ? rows[0] : null;
        if (e) {
          entryContext = [
            "LINKED SCREENPLAY:",
            e.title ? `Title: ${e.title}` : null,
            e.logline ? `Logline: ${e.logline}` : null,
            e.genre ? `Genre: ${e.genre}` : null,
          ].filter(Boolean).join("\n");
        }
      }
    }

    const organized = brief.organized as Record<string, unknown> | null;
    const briefSnippet = [
      brief.title ? `Brief title: ${brief.title}` : null,
      organized && typeof organized === "object" && (organized as { logline?: string }).logline
        ? `Logline: ${(organized as { logline?: string }).logline}`
        : null,
      organized && typeof organized === "object" && (organized as { premise?: string }).premise
        ? `Premise: ${((organized as { premise?: string }).premise ?? "").toString().slice(0, 600)}`
        : null,
    ].filter(Boolean).join("\n");

    const userPrompt = [
      briefSnippet || null,
      entryContext || null,
      `COMMENT FROM ${comment.author_name}:`,
      comment.body,
    ].filter(Boolean).join("\n\n");

    let result;
    try {
      result = await callAI({
        route: {
          functionName: "convert-comment-to-suggestion",
          modelHint: "google/gemini-3-flash-preview",
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "suggest_revisions" } },
        meta: { briefId: brief.id, commentId: comment.id, entryId: brief.entry_id ?? null },
      });
    } catch (e) {
      return aiErrorResponse(e, corsHeaders);
    }

    if (!result.content) {
      return new Response(JSON.stringify({ error: "Model did not return structured output." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: { summary?: string; suggestions?: unknown[] } = {};
    try {
      parsed = JSON.parse(result.content);
    } catch (e) {
      console.error("Failed to parse tool args", e);
      return new Response(JSON.stringify({ error: "Invalid structured output." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const input_hash = await sha256(`${comment.id}:${comment.body}`);
    const output_hash = await sha256(JSON.stringify(parsed));
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "convert-comment-to-suggestion",
      action: "convert",
      input_hash,
      output_hash,
      model: result.modelId,
      brief_id: brief.id,
      comment_id: comment.id,
      entry_id: brief.entry_id ?? null,
      suggestion_count: Array.isArray(parsed.suggestions) ? parsed.suggestions.length : 0,
    }));

    return new Response(
      JSON.stringify({
        summary: parsed.summary ?? "",
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        brief_id: brief.id,
        entry_id: brief.entry_id ?? null,
        input_hash,
        output_hash,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("convert-comment-to-suggestion error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
