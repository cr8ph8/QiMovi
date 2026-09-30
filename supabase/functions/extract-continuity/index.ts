// extract-continuity — Ask the AI router to convert a screenplay into
// structured continuity events and persist them to character_belief_events
// with source='extracted'. Hand-authored rows always win at merge time.

import { callAI } from "../_shared/ai-router.ts";
import { logGovernanceAction } from "../_shared/audit.ts";
import {
  requireEntryOwner,
  requireProjectOwner,
  requireUser,
} from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUNCTION_NAME = "extract-continuity";
const MODEL_HINT = "google/gemini-3-flash-preview";
const CONTINUITY_EXTRACTION_ON_HOLD = true;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "emit_continuity_events",
    description: "Emit structured continuity events for every scene in the screenplay.",
    parameters: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene_ref: { type: "string", description: "Slugline or short scene id, e.g. 'INT. CELL - NIGHT'." },
              scene_order: { type: "integer", minimum: 0 },
              event_kind: {
                type: "string",
                enum: ["introduce_char","confine","release","kill","learn","introduce_prop","char_acts","requires_free","uses_prop","acts_on"],
              },
              actors: { type: "array", items: { type: "string" } },
              object: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["scene_ref","scene_order","event_kind","actors"],
            additionalProperties: false,
          },
        },
      },
      required: ["events"],
      additionalProperties: false,
    },
  },
};

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: "missing supabase env" }), { status: 500, headers: corsHeaders });
  }

  const auth = await requireUser(req, corsHeaders);
  if (auth instanceof Response) return auth;

  if (CONTINUITY_EXTRACTION_ON_HOLD) {
    return new Response(
      JSON.stringify({
        error: "security_maintenance",
        message: "Continuity extraction is temporarily paused while secure billing is upgraded.",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let body: { entry_id?: string; fountain_text?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const entryId = body.entry_id;
  if (!entryId) {
    return new Response(JSON.stringify({ error: "entry_id required" }), { status: 400, headers: corsHeaders });
  }

  const admin = auth.admin;
  const entryAccess = await requireEntryOwner(admin, auth.userId, entryId, corsHeaders);
  if (entryAccess instanceof Response) return entryAccess;

  // Resolve the optional unified project once. If present, authorize it before
  // using the service role to read canonical artifacts.
  const { data: mapRow } = await admin
    .from("project_legacy_map")
    .select("project_id")
    .eq("source_table", "entries")
    .eq("source_id", entryId)
    .maybeSingle();
  const projectId = (mapRow as any)?.project_id as string | undefined;
  if (projectId) {
    const projectAccess = await requireProjectOwner(
      admin,
      auth.userId,
      projectId,
      corsHeaders,
    );
    if (projectAccess instanceof Response) return projectAccess;
  }

  // Fetch screenplay text if not provided. Phase B: prefer canonical
  // project_artifacts.payload_json.fountain_text; fall back to legacy columns
  // for rows created before the mirror trigger landed.
  let text = body.fountain_text ?? "";
  if (!text) {
    if (projectId) {
      const { data: art } = await admin
        .from("project_artifacts")
        .select("payload_json")
        .eq("project_id", projectId)
        .eq("artifact_type", "fountain")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      text = String((art as any)?.payload_json?.fountain_text ?? "");
    }
    if (!text) {
      const { data: entry } = await admin
        .from("entries")
        .select("script_text, fountain_text")
        .eq("id", entryId)
        .maybeSingle();
      text = String(
        (entry as any)?.script_text ?? (entry as any)?.fountain_text ?? ""
      );
    }
    if (!text) {
      const { data: draft } = await admin
        .from("screenplay_drafts")
        .select("fountain_text")
        .eq("source_entry_id", entryId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      text = String((draft as any)?.fountain_text ?? "");
    }
  }
  if (!text || text.length < 50) {
    return new Response(JSON.stringify({ error: "no screenplay text available for extraction" }), {
      status: 400, headers: corsHeaders,
    });
  }
  // Cap to keep token cost predictable
  const capped = text.slice(0, 60_000);
  const promptHash = await sha256(capped);

  const systemMsg = `You extract continuity events from screenplays. For every scene, emit events with kinds drawn from the allowed enum.
Rules:
- Use "introduce_char" the first time a named character appears.
- Use "confine" when a character is imprisoned, tied up, or otherwise unable to move freely. Use "release" when that constraint ends.
- Use "kill" when a character dies on-page.
- Use "introduce_prop" when a specific named object first appears.
- Use "learn" with object=<knowledge_key> when a character gains knowledge.
- Use "requires_free" when a scene requires a character to be physically free to act (e.g. fighting, escaping).
- Use "uses_prop" with object=<prop_name> when a character uses a specific named prop.
- Use "acts_on" with object=<knowledge_key> when a character demonstrably uses knowledge they should have learned.
- Use "char_acts" as a default for any other concrete action attributable to a named character.
Always include scene_order starting at 0 in the order scenes appear.
Return ONLY the tool call.`;

  const result = await callAI({
    route: { functionName: FUNCTION_NAME, modelHint: MODEL_HINT },
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: capped },
    ],
    temperature: 0,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: "function", function: { name: "emit_continuity_events" } },
    meta: { entryId, userId: auth.userId },
  });

  let events: Array<Record<string, unknown>> = [];
  try {
    const toolCalls = result.raw?.choices?.[0]?.message?.tool_calls;
    const argStr = toolCalls?.[0]?.function?.arguments;
    if (argStr) events = JSON.parse(argStr).events ?? [];
  } catch (e) {
    console.error("[extract-continuity] parse failed:", (e as Error).message);
  }

  // Replace previous extracted rows for this entry (authored rows untouched)
  await admin.from("character_belief_events")
    .delete()
    .eq("entry_id", entryId)
    .eq("source", "extracted");

  if (events.length > 0) {
    const rows = events.map((e) => ({
      entry_id: entryId,
      kind: "stay" as const, // legacy NOT NULL column — neutral default
      event_kind: e.event_kind,
      source: "extracted",
      detected_by: result.modelId,
      extractor_model_id: null, // model id is text — ai_models.id may differ; leave null
      extractor_confidence: (e.confidence as number) ?? null,
      prompt_hash: promptHash,
      scene_ref: e.scene_ref,
      evidence: {
        scene_ref: e.scene_ref,
        scene_order: e.scene_order,
        actors: e.actors ?? [],
        object: e.object ?? null,
        confidence: e.confidence ?? null,
      },
      turn_label: (e.scene_ref as string) ?? null,
    }));
    const { error: insErr } = await admin.from("character_belief_events").insert(rows);
    if (insErr) console.error("[extract-continuity] insert failed:", insErr.message);
  }

  await logGovernanceAction({
    userId: auth.userId,
    action: "narrative_gate.extract",
    target: { entry_id: entryId },
    details: { event_count: events.length, model: result.modelId, prompt_hash: promptHash },
  });

  return new Response(JSON.stringify({
    extracted_count: events.length,
    model: result.modelId,
    prompt_hash: promptHash,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
