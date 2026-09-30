// Edge function: outline-from-beats
// Converts a structured project brief (plot beats + characters) into a
// scene-by-scene outline. Routes through the central AI router for telemetry.

import { callAI, aiErrorResponse } from "../_shared/ai-router.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UNCHARGED_OUTLINE_GENERATION_ON_HOLD = true;

const SYSTEM_PROMPT = `You are a screenwriting structure assistant.

You receive a project brief (logline, premise, characters, plot beats, themes, world) and produce a structured scene outline.

RULES:
- Each scene must map to one of the provided plot beats by name.
- Use slugline conventions (INT./EXT. — LOCATION — DAY/NIGHT).
- Reference characters using the canonical names supplied. Do NOT invent new characters.
- Keep scene descriptions concise (1–3 sentences). State the dramatic purpose.
- Suggest a page-length estimate per scene (small integer).
- Output a confidence score (0–1).
- If beats are sparse, generate fewer scenes — do not pad.

Always return your answer by calling the build_scene_outline tool.`;

const TOOL = {
  type: "function",
  function: {
    name: "build_scene_outline",
    description: "Return a scene-by-scene outline derived from the project brief.",
    parameters: {
      type: "object",
      properties: {
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scene_number: { type: "integer" },
              slugline: { type: "string", description: "INT./EXT. — LOCATION — TIME" },
              beat_ref: { type: "string", description: "Name of the plot beat this scene serves." },
              act: { type: "string" },
              description: { type: "string", description: "1–3 sentences." },
              characters: {
                type: "array",
                items: { type: "string" },
                description: "Canonical character names present in the scene.",
              },
              dramatic_purpose: { type: "string" },
              estimated_pages: { type: "number" },
            },
            required: [
              "scene_number",
              "slugline",
              "beat_ref",
              "description",
              "characters",
            ],
            additionalProperties: false,
          },
        },
        total_estimated_pages: { type: "number" },
        confidence: { type: "number" },
        notes: { type: "string", description: "Brief reasoning / caveats." },
      },
      required: ["scenes", "confidence"],
      additionalProperties: false,
    },
  },
};

interface AliasRow {
  canonical_name: string;
  alias_name: string;
}

function buildAliasMap(aliases: AliasRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of aliases) {
    const canonical = a.canonical_name.trim().toUpperCase();
    const alias = a.alias_name.trim().toUpperCase();
    map.set(alias, canonical);
    if (!map.has(canonical)) map.set(canonical, canonical);
  }
  return map;
}

function resolveName(name: string, map: Map<string, string>): string {
  const normalized = name.replace(/\s*\(.*\)$/, "").trim().toUpperCase();
  return map.get(normalized) || normalized;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;

    if (UNCHARGED_OUTLINE_GENERATION_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI outline generation is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const brief = body?.brief;
    const universe_id: string | undefined = body?.universe_id;
    const entry_id: string | undefined = body?.entry_id;

    if (!brief || typeof brief !== "object") {
      return new Response(JSON.stringify({ error: "Missing or invalid brief." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(brief.plot_beats) || brief.plot_beats.length === 0) {
      return new Response(
        JSON.stringify({ error: "Brief has no plot beats to outline." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // --- Build alias map from universe (optional) -----------------------
    let aliases: AliasRow[] = [];
    if (universe_id && supabaseUrl && serviceKey) {
      const authHeader = req.headers.get("Authorization");
      const aliasResp = await fetch(
        `${supabaseUrl}/rest/v1/universe_character_aliases?universe_id=eq.${universe_id}&select=canonical_name,alias_name`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: authHeader ?? `Bearer ${serviceKey}`,
          },
        },
      );
      if (aliasResp.ok) {
        aliases = await aliasResp.json();
      } else {
        console.warn("Failed to fetch aliases", aliasResp.status);
      }
    }
    const aliasMap = buildAliasMap(aliases);

    // --- Optional: pull entry character names to enrich canonical roster
    let entryCharacterNames: string[] = [];
    if (entry_id && supabaseUrl && serviceKey) {
      const authHeader = req.headers.get("Authorization");
      const entryResp = await fetch(
        `${supabaseUrl}/rest/v1/entries?id=eq.${entry_id}&select=parsed_metadata`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: authHeader ?? `Bearer ${serviceKey}`,
          },
        },
      );
      if (entryResp.ok) {
        const rows = await entryResp.json();
        const meta = Array.isArray(rows) ? rows[0]?.parsed_metadata : null;
        const list = meta?.characters ?? meta?.character_list ?? [];
        if (Array.isArray(list)) {
          entryCharacterNames = list
            .map((c: { name?: string } | string) =>
              typeof c === "string" ? c : c?.name ?? "",
            )
            .filter((n: string) => !!n);
        }
      }
    }

    // --- Pre-resolve character names from the brief ---------------------
    const briefCharacters: Array<{ name: string; canonical: string; role?: string }> = (
      Array.isArray(brief.characters) ? brief.characters : []
    ).map((c: { name: string; role?: string }) => ({
      name: c.name,
      canonical: resolveName(c.name, aliasMap),
      role: c.role,
    }));

    const seen = new Set(briefCharacters.map((c) => c.canonical));
    for (const n of entryCharacterNames) {
      const canonical = resolveName(n, aliasMap);
      if (!seen.has(canonical)) {
        briefCharacters.push({ name: n, canonical, role: "from screenplay" });
        seen.add(canonical);
      }
    }

    const canonicalRoster = briefCharacters.length
      ? briefCharacters
          .map((c) => `- ${c.canonical}${c.role ? ` (${c.role})` : ""}`)
          .join("\n")
      : "(none provided)";

    const userPrompt = [
      "PROJECT BRIEF",
      brief.logline ? `Logline: ${brief.logline}` : null,
      brief.premise ? `Premise: ${brief.premise}` : null,
      brief.suggested_format ? `Format: ${brief.suggested_format}` : null,
      brief.world?.tone ? `Tone: ${brief.world.tone}` : null,
      brief.world?.setting ? `Setting: ${brief.world.setting}` : null,
      "",
      "CANONICAL CHARACTER ROSTER (use these exact names in scenes.characters):",
      canonicalRoster,
      "",
      "PLOT BEATS:",
      brief.plot_beats
        .map(
          (b: { act?: string; beat_name: string; description: string }, i: number) =>
            `${i + 1}. [${b.act ?? "?"}] ${b.beat_name} — ${b.description}`,
        )
        .join("\n"),
    ]
      .filter(Boolean)
      .join("\n");

    let result;
    try {
      result = await callAI({
        route: { functionName: "outline-from-beats", modelHint: "google/gemini-3-flash-preview" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "build_scene_outline" } },
        meta: { entryId: entry_id },
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

    let outline: {
      scenes: Array<{
        scene_number: number;
        slugline: string;
        beat_ref: string;
        act?: string;
        description: string;
        characters: string[];
        dramatic_purpose?: string;
        estimated_pages?: number;
      }>;
      total_estimated_pages?: number;
      confidence: number;
      notes?: string;
    };
    try {
      outline = JSON.parse(result.content);
    } catch (e) {
      console.error("Failed to parse outline tool args", e);
      return new Response(JSON.stringify({ error: "Invalid structured output." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Post-process: re-resolve every character name through alias map -
    outline.scenes = outline.scenes.map((s) => ({
      ...s,
      characters: Array.from(
        new Set((s.characters ?? []).map((c) => resolveName(c, aliasMap))),
      ),
    }));

    if (
      typeof outline.total_estimated_pages !== "number" ||
      Number.isNaN(outline.total_estimated_pages)
    ) {
      outline.total_estimated_pages = outline.scenes.reduce(
        (sum, s) => sum + (Number(s.estimated_pages) || 0),
        0,
      );
    }

    const input_hash = await sha256(JSON.stringify({ brief, universe_id }));
    const output_hash = await sha256(JSON.stringify(outline));
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        component: "outline-from-beats",
        action: "outline",
        input_hash,
        output_hash,
        confidence: outline.confidence,
        universe_id: universe_id ?? null,
        alias_count: aliases.length,
        scene_count: outline.scenes.length,
        model: result.modelId,
      }),
    );

    return new Response(
      JSON.stringify({
        outline,
        roster: briefCharacters,
        alias_count: aliases.length,
        input_hash,
        output_hash,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("outline-from-beats error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
