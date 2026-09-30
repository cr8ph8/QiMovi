import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";
import { callAI, resolveModelHint } from "../_shared/ai-router.ts";
import { requireEntryOwner, requireUser } from "../_shared/auth.ts";
import { buildContentContext } from "../_shared/content-context.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID_REWRITE_TOOLS_ON_HOLD = true;

const BodySchema = z.object({
  script_text: z.string().min(50).max(200_000),
  entry_id: z.string().uuid().optional().nullable(),
  scores: z
    .object({
      dialogue: z.number().optional(),
      character_depth: z.number().optional(),
      structure: z.number().optional(),
      originality: z.number().optional(),
      emotion: z.number().optional(),
      theme: z.number().optional(),
      format_adherence: z.number().optional(),
    })
    .partial()
    .optional()
    .nullable(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const user_id = auth.userId;

    if (PAID_REWRITE_TOOLS_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI rewrite suggestions are temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { script_text, entry_id, scores } = parsed.data;
    if (entry_id) {
      const ownerCheck = await requireEntryOwner(
        auth.admin,
        user_id,
        entry_id,
        corsHeaders,
      );
      if (ownerCheck instanceof Response) return ownerCheck;
    }

    const truncated = script_text.slice(0, 8000);

    const scoreContext = scores
      ? `\nThe screenplay was scored: dialogue=${scores.dialogue}/15, character_depth=${scores.character_depth}/15, structure=${scores.structure}/15, originality=${scores.originality}/15, emotion=${scores.emotion}/10, theme=${scores.theme}/10, format_adherence=${scores.format_adherence}/10. Focus suggestions on the weakest areas.`
      : "";

    const systemPrompt = `You are an expert script doctor analyzing a screenplay. Identify 4-6 critical points across the script that would benefit from rewriting. Mix different types of suggestions: weak dialogue, flat action lines, pacing issues, unclear transitions, underdeveloped character moments, or missed emotional beats.

For each suggestion, respond with a JSON array where each item has:
- "element_text": the exact text from the script that should be rewritten (copy it exactly, 1-3 lines max)
- "type": one of "dialogue", "action", "character", "pacing", "transition", "emotion"
- "reason": a concise 1-sentence explanation of why this needs work
- "suggested_action": one of "rewrite", "expand", "condense", "punch_up"
- "priority": "high", "medium", or "low"

Return ONLY the JSON array, no markdown, no explanation.`;

    const userPrompt = `Analyze this screenplay and identify critical rewrite points:${scoreContext}\n\n---\n${truncated}`;

    const modelHint = await resolveModelHint("suggest-rewrites", "google/gemini-3-flash-preview");

    // Resolve project + build content context bundle when an entry anchor exists.
    let contextRef: { bundle_id: string; payload_hash: string } | undefined;
    let projectId: string | null = null;
    if (entry_id) {
      try {
        const adminClient = auth.admin;
        const { data: leg } = await adminClient
          .from("project_legacy_map")
          .select("project_id")
          .eq("source_table", "entries")
          .eq("source_id", entry_id)
          .maybeSingle();
        projectId = (leg as any)?.project_id ?? null;

        // Auto-create project mapping on the fly if the entry hasn't been
        // mirrored yet. Without this, callAI rejects with 409 because
        // suggest-rewrites is on the AI_ROUTER_REQUIRE_CONTEXT_REF list.
        if (!projectId) {
          const { data: entryRow } = await adminClient
            .from("entries")
            .select("id, user_id, title")
            .eq("id", entry_id)
            .maybeSingle();
          const ownerId = (entryRow as any)?.user_id ?? user_id;
          const title = (entryRow as any)?.title ?? "Untitled";
          if (ownerId) {
            const { data: project } = await adminClient
              .from("projects")
              .insert({ owner_id: ownerId, title, kind: "screenplay", lifecycle_state: "draft" })
              .select("id")
              .single();
            const newId = (project as any)?.id ?? null;
            if (newId) {
              const { error: mapErr } = await adminClient
                .from("project_legacy_map")
                .insert({ project_id: newId, source_table: "entries", source_id: entry_id });
              if (mapErr) {
                const { data: race } = await adminClient
                  .from("project_legacy_map")
                  .select("project_id")
                  .eq("source_table", "entries")
                  .eq("source_id", entry_id)
                  .maybeSingle();
                projectId = (race as any)?.project_id ?? null;
                if (projectId) await adminClient.from("projects").delete().eq("id", newId);
              } else {
                projectId = newId;
              }
            }
          }
        }

        if (projectId) {
          const built = await buildContentContext(
            adminClient,
            projectId,
            { mode: "diagnostic", task: "rewrite.suggest", scope: "script", model_hint: modelHint },
            user_id,
          );
          contextRef = { bundle_id: built.bundle_id, payload_hash: built.context_hash };
        }
      } catch (ctxErr) {
        console.error("[suggest-rewrites] context build failed:", ctxErr);
      }
    }

    // If governance requires context_ref for this route and we still don't
    // have one (e.g. no entry_id supplied), surface a clear 400 instead of
    // letting ai-router raise an opaque 500.
    if (!contextRef) {
      return new Response(
        JSON.stringify({
          error: "context_unavailable",
          message:
            "Rewrite suggestions require an anchored entry. Open this screenplay from My Submissions or the Entry workspace and retry.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }



    const result = await callAI({
      route: {
        functionName: "suggest-rewrites",
        modelHint,
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      context_ref: contextRef,
      meta: {
        entryId: entry_id || undefined,
        userId: user_id || undefined,
        projectId: projectId || undefined,
      },
    });


    let suggestions = [];
    try {
      let cleaned = result.content.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      suggestions = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse suggestions JSON:", parseErr, result.content);
      return new Response(JSON.stringify({ error: "Failed to parse AI response", raw: result.content }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persist suggestions to DB if we have entry_id and user_id
    if (entry_id && user_id && suggestions.length > 0) {
      try {
        const adminClient = auth.admin;

        const rows = suggestions.map((s: any) => ({
          entry_id,
          user_id,
          element_text: s.element_text,
          type: s.type,
          reason: s.reason,
          suggested_action: s.suggested_action,
          priority: s.priority,
        }));

        const { data: inserted, error: insertErr } = await adminClient
          .from("rewrite_suggestions")
          .insert(rows)
          .select();

        if (insertErr) {
          console.error("Failed to persist suggestions:", insertErr);
        } else if (inserted) {
          // Return the DB rows (with ids) plus suggestion_count for surcharge calc
          return new Response(JSON.stringify({ suggestions: inserted, suggestion_count: inserted.length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (dbErr) {
        console.error("DB persist error:", dbErr);
      }
    }

    return new Response(JSON.stringify({ suggestions, suggestion_count: suggestions.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-rewrites error:", e);
    const status = (e as any)?.status === 429 ? 429 : (e as any)?.status === 402 ? 402 : 500;
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
