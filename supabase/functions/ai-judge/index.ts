import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, resolveProvider, resolveModelHint, COST_PER_1K, AIRouterError, aiErrorResponse } from "../_shared/ai-router.ts";
import { createVersionSnapshot, emitGovernanceEvents, addProvenanceNode } from "../_shared/governance.ts";
import { requireUser, requireEntryOwner } from "../_shared/auth.ts";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NUM_PASSES = 3;
const VARIANCE_THRESHOLD = 15;
const PAID_AI_JUDGING_ON_HOLD = true;

// CanIScreenwrite Grading Sheet — 9 categories, 120 pts total
const CATEGORY_LABELS: Record<string, string> = {
  concept: "Concept",
  story: "Story",
  characters: "Characters",
  dialogue: "Dialogue",
  theme: "Theme/Message",
  market: "Market Potential",
  cinematic: "Cinematic Quality",
  climax: "Climax",
  technicalities: "Technicalities",
};

const DEFAULT_IPQ_WEIGHTS: Record<string, number> = {
  concept: 15, story: 20, characters: 20, dialogue: 10,
  theme: 10, market: 15, cinematic: 10, climax: 10, technicalities: 10,
};

// Map AI output keys → DB column names
const SCORE_TO_DB_COLUMN: Record<string, string> = {
  concept: "originality",
  story: "structure",
  characters: "character_depth",
  dialogue: "dialogue",
  theme: "theme",
  market: "market",
  cinematic: "visual",
  climax: "emotion",
  technicalities: "format_adherence",
};

const clamp = (val: number, max: number) =>
  Math.max(0, Math.min(max, Math.round(val * 10) / 10));

const toPercent = (val: number, max: number) =>
  max > 0 ? Math.round((val / max) * 100) : 0;

function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Return the median of a sorted-copy of values. For even-length arrays, averages the two middle. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ─── Q2E Scene↔Arc Coherence (dry-run) ───────────────────────────────────────
// Advisory only. Does NOT change any rubric score. Gated by site_settings.
// No embeddings: TF-cosine proxy over scene/act/script token vectors.
const SCENE_HEADING_RE = /^\s*(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i;
const STOPWORDS = new Set([
  "the","and","you","for","are","but","not","with","this","that","have","from",
  "your","they","will","what","when","there","their","into","just","like","then",
  "than","been","were","more","some","very","over","also","about","could","would",
  "should","much","such","only","make","made","does","didn","don","cant","can",
  "him","her","his","she","them","its","yes","one","two","out","off","got","get",
]);

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[a-z]{3,}/g;
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    if (!STOPWORDS.has(m[0])) tokens.push(m[0]);
  }
  return tokens;
}

function tfVector(tokens: string[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const t of tokens) v.set(t, (v.get(t) || 0) + 1);
  return v;
}

function addInto(target: Map<string, number>, src: Map<string, number>): void {
  for (const [k, n] of src) target.set(k, (target.get(k) || 0) + n);
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, va] of small) {
    const vb = large.get(k);
    if (vb) dot += va * vb;
  }
  let na = 0, nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function splitScenes(scriptText: string): string[] {
  const lines = scriptText.split(/\r?\n/);
  const scenes: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (SCENE_HEADING_RE.test(line) && buf.length > 0) {
      scenes.push(buf.join("\n"));
      buf = [];
    }
    buf.push(line);
  }
  if (buf.length > 0) scenes.push(buf.join("\n"));
  // Drop pre-first-heading preamble if it's the only "scene" with no heading
  return scenes.filter((s) => s.trim().length > 0);
}

interface CoherenceResult {
  enabled: boolean;
  ran: boolean;
  reason?: string;
  script?: number;
  per_act?: { "1": number; "2": number; "3": number };
  anisotropy?: number;
  scene_count?: number;
  flags?: Array<{ scene_index: number; type: "drift" | "collapse"; value: number }>;
  band?: [number, number];
  version: 1;
}

function computeCoherenceDryRun(
  scriptText: string,
  band: [number, number],
  minScenes: number,
): CoherenceResult {
  const scenes = splitScenes(scriptText || "");
  if (scenes.length < minScenes) {
    return { enabled: true, ran: false, reason: `scenes<${minScenes}`, scene_count: scenes.length, version: 1 };
  }
  const sceneVecs = scenes.map((s) => tfVector(tokenize(s)));
  const scriptCentroid = new Map<string, number>();
  for (const v of sceneVecs) addInto(scriptCentroid, v);

  // Three acts by scene-index thirds
  const n = sceneVecs.length;
  const third = Math.max(1, Math.floor(n / 3));
  const actRanges: Array<[number, number]> = [
    [0, third],
    [third, Math.min(n, 2 * third)],
    [Math.min(n, 2 * third), n],
  ];
  const actCentroids = actRanges.map(([a, b]) => {
    const c = new Map<string, number>();
    for (let i = a; i < b; i++) addInto(c, sceneVecs[i]);
    return c;
  });
  const sceneAct: number[] = [];
  for (let i = 0; i < n; i++) {
    sceneAct.push(actRanges.findIndex(([a, b]) => i >= a && i < b));
  }

  const [low, high] = band;
  const flags: Array<{ scene_index: number; type: "drift" | "collapse"; value: number }> = [];
  const sceneBand: number[] = [];
  const perActBands: number[][] = [[], [], []];

  for (let i = 0; i < n; i++) {
    const align = cosine(sceneVecs[i], actCentroids[sceneAct[i]]);
    const norm = high > low ? Math.max(0, Math.min(1, (align - low) / (high - low))) : 0;
    sceneBand.push(norm);
    perActBands[sceneAct[i]].push(norm);
    if (align < 0.2) flags.push({ scene_index: i, type: "drift", value: Math.round(align * 1000) / 1000 });
    else if (align > 0.98) flags.push({ scene_index: i, type: "collapse", value: Math.round(align * 1000) / 1000 });
  }

  const med = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // Anisotropy: mean pairwise cosine on a capped sample (cost guard)
  const SAMPLE_CAP = 24;
  const idxs = n <= SAMPLE_CAP
    ? Array.from({ length: n }, (_, i) => i)
    : Array.from({ length: SAMPLE_CAP }, (_, k) => Math.floor((k * n) / SAMPLE_CAP));
  let pairSum = 0, pairCount = 0;
  for (let i = 0; i < idxs.length; i++) {
    for (let j = i + 1; j < idxs.length; j++) {
      pairSum += cosine(sceneVecs[idxs[i]], sceneVecs[idxs[j]]);
      pairCount++;
    }
  }
  const anisotropy = pairCount > 0 ? pairSum / pairCount : 0;

  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    enabled: true,
    ran: true,
    script: r3(med(sceneBand)),
    per_act: { "1": r3(med(perActBands[0])), "2": r3(med(perActBands[1])), "3": r3(med(perActBands[2])) },
    anisotropy: r3(anisotropy),
    scene_count: n,
    flags,
    band: [low, high],
    version: 1,
  };
}

async function readCoherenceSettings(supabase: any): Promise<
  { enabled: boolean; band: [number, number]; anisotropyMax: number; minScenes: number }
> {
  const defaults = { enabled: false, band: [0.55, 0.92] as [number, number], anisotropyMax: 0.85, minScenes: 6 };
  try {
    const { data } = await supabase
      .from("site_settings")
      .select("key, value, text_value")
      .in("key", ["q2e_coherence_enabled", "q2e_coherence_band", "q2e_anisotropy_max", "q2e_coherence_min_scenes"]);
    if (!data) return defaults;
    const map = new Map<string, { value: boolean | null; text_value: string | null }>();
    for (const r of data) map.set(r.key, { value: r.value, text_value: r.text_value });
    const bandRaw = map.get("q2e_coherence_band")?.text_value;
    const band: [number, number] = bandRaw
      ? (bandRaw.split(",").map((s) => Number(s.trim())) as [number, number])
      : defaults.band;
    return {
      enabled: !!map.get("q2e_coherence_enabled")?.value,
      band: Number.isFinite(band[0]) && Number.isFinite(band[1]) ? band : defaults.band,
      anisotropyMax: Number(map.get("q2e_anisotropy_max")?.text_value) || defaults.anisotropyMax,
      minScenes: Number(map.get("q2e_coherence_min_scenes")?.text_value) || defaults.minScenes,
    };
  } catch (_e) {
    return defaults;
  }
}

interface PassResult {
  scores: Record<string, any>;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Build the return_scores tool definition with dynamic max values from weights.
 */
function buildScoresTool(weights: Record<string, number>, labels: Record<string, string> = CATEGORY_LABELS) {
  const properties: Record<string, any> = {};
  const totalMax = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [key, max] of Object.entries(weights)) {
    properties[key] = { type: "number", description: `Score 0-${max} for ${labels[key] || key}` };
  }
  properties.total_score = { type: "number", description: `Sum of all category scores (max ${totalMax})` };
  properties.feedback = { type: "string", description: "2-3 paragraph General Review covering strengths, weaknesses, and actionable recommendations" };
  properties.confidence = { type: "number", description: "Confidence in evaluation accuracy, 0-100" };

  return {
    type: "function" as const,
    function: {
      name: "return_scores",
      description: "Return structured screenplay evaluation scores across all grading categories",
      parameters: {
        type: "object",
        properties,
        required: [...Object.keys(weights), "total_score", "feedback", "confidence"],
        additionalProperties: false,
      },
    },
  };
}

/**
 * Run a single evaluation pass via callAI with tool-calling.
 * We set skipLog=true via a special correlation_id prefix so the router
 * doesn't double-log — ai-judge logs an aggregated row after all passes complete.
 */
async function runSinglePass(
  route: Parameters<typeof callAI>[0]["route"],
  systemPrompt: string,
  userContent: string,
  scoresTool: ReturnType<typeof buildScoresTool>,
  meta: { entryId?: string; userId?: string; correlationId?: string; sensitivity?: string; pageCount?: number; projectId?: string },
  contextRef?: { bundle_id: string; payload_hash: string },
): Promise<PassResult> {
  const result = await callAI({
    route,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_completion_tokens: 2000,
    temperature: 0.3,
    tools: [scoresTool],
    tool_choice: { type: "function", function: { name: "return_scores" } },
    context_ref: contextRef,
    meta,
  });

  let scores;
  try {
    scores = JSON.parse(result.content);
  } catch {
    throw new Error("Failed to parse AI judge tool-call response");
  }

  return {
    scores,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let correlationId: string | undefined;
  // Never use the caller-provided entry ID for service-role crash recovery.
  // This sentinel is populated only after ownership (or admin access) is proven.
  let authorizedEntryId: string | undefined;

  try {
    correlationId = crypto.randomUUID();
    const { entry_id, model_override } = await req.json();
    if (!entry_id) {
      return new Response(JSON.stringify({ error: "entry_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Require authenticated user
    const auth = await requireUser(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const supabase = auth.admin;

    if (PAID_AI_JUDGING_ON_HOLD) {
      return new Response(JSON.stringify({
        error: "security_maintenance",
        message: "AI scoring is temporarily paused while secure billing is upgraded.",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller owns the entry (admins can judge any entry)
    const ownerCheck = await requireEntryOwner(supabase, auth.userId, entry_id, corsHeaders);
    if (ownerCheck instanceof Response) return ownerCheck;
    authorizedEntryId = ownerCheck.entry.id;

    const { data: entry, error: fetchError } = await supabase
      .from("entries")
      .select("id, script_text, title, logline, genre, competition_id, user_id, sensitivity, page_count, rubric_preset")
      .eq("id", entry_id)
      .single();

    if (fetchError || !entry) throw new Error("Entry not found");
    const entrySensitivity = entry.sensitivity || "standard";
    const entryPageCount = entry.page_count || undefined;

    // Fetch judge config
    let config: any = null;
    if (entry.competition_id) {
      const { data } = await supabase
        .from("competition_judge_config")
        .select("*")
        .eq("competition_id", entry.competition_id)
        .single();
      config = data;
    }

    // Resolve rubric preset: entry → config → 'default'
    const rubricPreset: string = entry.rubric_preset || config?.rubric_preset || "default";
    const isDefaultRubric = rubricPreset === "default" || rubricPreset === "custom";

    // Load preset definition from feature_configs (dimensions + labels + weights)
    let presetLabels: Record<string, string> = CATEGORY_LABELS;
    let weights: Record<string, number> = (config?.scoring_weights as Record<string, number>) || { ...DEFAULT_IPQ_WEIGHTS };

    if (!isDefaultRubric) {
      const { data: presetRow } = await supabase
        .from("feature_configs")
        .select("usage_policy")
        .eq("id", `rubric_${rubricPreset}`)
        .maybeSingle();
      const policy = (presetRow?.usage_policy as any) || {};
      if (policy.weights && typeof policy.weights === "object") {
        weights = policy.weights as Record<string, number>;
      }
      if (policy.labels && typeof policy.labels === "object") {
        presetLabels = policy.labels as Record<string, string>;
      }
    }

    // Resolve current rubric version for this preset (immutable snapshot tag)
    let rubricVersion: number = 1;
    {
      const { data: verRow } = await supabase
        .from("rubric_versions")
        .select("version")
        .eq("preset_id", rubricPreset)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (verRow?.version) rubricVersion = verRow.version;
    }


    // Resolve model: model_override → competition config → feature_configs → default
    const featureHint = await resolveModelHint("ai-judge", "google/gemini-3-flash-preview");
    const effectiveModelHint = model_override || config?.model_id || featureHint;
    const route = {
      functionName: "ai-judge",
      modelHint: effectiveModelHint,
      competitionId: entry.competition_id || undefined,
      customConfig: (!model_override && config) ? {
        model_provider: config.model_provider,
        model_id: config.model_id,
        custom_api_base_url: config.custom_api_base_url,
        custom_api_key_encrypted: config.custom_api_key_encrypted,
      } : null,
    };

    const resolved = await resolveProvider(route, entrySensitivity, entryPageCount);
    const modelId = resolved.modelId;

    await supabase.from("entries").update({ status: "judging" }).eq("id", entry_id);

    const scoreFields = Object.entries(weights).map(
      ([key, max]) => `  "${key}": <number 0-${max}>`,
    );

    const dimensionList = Object.entries(weights)
      .map(([k, max], i) => `${i + 1}. ${presetLabels[k] || k} (0-${max})`)
      .join("\n");
    const totalMax = Object.values(weights).reduce((a, b) => a + b, 0);

    // ─── Eval-awareness de-biasing (Anthropic workspace paper, July 2026) ───
    // Two neutralized prompt variants. Meta-cues like "grading",
    // "competition", "submission", "judge" are removed because the paper's
    // §5 ablation shows models detect evaluation context and can conceal
    // behavior. Variant is picked per-request by hashing entry_id +
    // correlationId; each pass logs its own variant hash to
    // governance_events (workspace_probe_kind = 'eval_awareness_variant').
    const variantSeed = `${entry_id}:${correlationId ?? ""}`;
    const variantHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(variantSeed),
    );
    const variantByte = new Uint8Array(variantHash)[0] ?? 0;
    const variantId: "A" | "B" = variantByte % 2 === 0 ? "A" : "B";

    const buildVariantA = () => isDefaultRubric
      ? `Read the following screenplay carefully and, for each numbered dimension below, note what works and what does not.
Then produce a numeric assessment on each dimension by calling the return_scores function.

Dimensions (numeric range in parentheses):
1. Concept (0-${weights.concept || 15}): originality, audience appeal, uniqueness of premise.
2. Story (0-${weights.story || 20}): structure, pacing, narrative clarity, plot progression.
3. Characters (0-${weights.characters || 20}): depth, arcs, relationships, motivation.
4. Dialogue (0-${weights.dialogue || 10}): authenticity, voice, memorability, subtext.
5. Theme (0-${weights.theme || 10}): clarity, integration into story, emotional resonance.
6. Market fit (0-${weights.market || 15}): commercial viability, audience fit, genre positioning.
7. Cinematic quality (0-${weights.cinematic || 10}): visual storytelling, setting impact, directorial potential.
8. Climax (0-${weights.climax || 10}): payoff, emotional resolution, narrative satisfaction.
9. Craft (0-${weights.technicalities || 10}): formatting, grammar, screenplay standards compliance.

Be direct and specific. Do not soften observations. The feedback field is a 2-3 paragraph discussion covering what is strong, what is weak, and what would change your reading.`
      : `Read the following screenplay carefully. The work is in the "${rubricPreset.toUpperCase()}" form (${rubricPreset === "vertical" ? "mobile-first vertical 9:16 serialized shorts" : "micro short films, single-arc narratives, 1–5 pages"}, ${totalMax} points total).
For each dimension below, form an independent assessment, then call the return_scores function.

Dimensions:
${dimensionList}

Reward what the form demands: ${rubricPreset === "vertical" ? "hook density, pacing per page, visual clarity on a small screen" : "tight structure, clear character intent, a single resolved beat"}. Be direct. The feedback field is a 2-3 paragraph discussion — strengths, weaknesses, and what would change your reading.`;

    const buildVariantB = () => isDefaultRubric
      ? `Below is a screenplay. Consider it against the following ${Object.keys(weights).length} criteria, each independently:

${Object.entries(weights).map(([k, max], i) => `${i + 1}. ${presetLabels[k] || CATEGORY_LABELS[k] || k} (0-${max})`).join("\n")}

Form your own view of each criterion before calling return_scores. Do not adjust one score to accommodate another. In the feedback field, write 2-3 paragraphs describing the reading experience — what worked for you, what did not, and what specific change would most alter your response.`
      : `Below is a screenplay in the "${rubricPreset.toUpperCase()}" form (${totalMax} points total). Consider it against these criteria, each independently:

${dimensionList}

Form your own view of each criterion before calling return_scores. Do not adjust one score to accommodate another. In the feedback field, write 2-3 paragraphs describing the reading experience — what worked for you, what did not, and what specific change would most alter your response.`;

    const judgingPrompt = variantId === "A" ? buildVariantA() : buildVariantB();

    // Log variant hash to governance_events (non-blocking).
    import("../_shared/workspaceProbes.ts")
      .then(({ logEvalAwarenessVariant }) =>
        logEvalAwarenessVariant({
          variantId,
          promptText: judgingPrompt,
          functionName: "ai-judge",
          correlationId: correlationId ?? null,
          entryId: entry_id,
        }),
      )
      .catch((e) => console.error("[ai-judge] variant log failed (non-fatal):", e));

    const userContent = `Title: ${entry.title}\nLogline: ${entry.logline || "None provided"}\nGenre: ${entry.genre || "Not specified"}\n\nScreenplay:\n${(entry.script_text || "").slice(0, 100000)}`;

    // Build tool definition with dynamic weights
    const scoresTool = buildScoresTool(weights, presetLabels);

    // ─── Resolve unified project_id + build canonical ContentContext ───
    let projectId: string | undefined;
    let contextRef: { bundle_id: string; payload_hash: string } | undefined;
    try {
      const { data: legacyRow } = await supabase
        .from("project_legacy_map")
        .select("project_id")
        .eq("source_table", "entries")
        .eq("source_id", entry_id)
        .maybeSingle();
      projectId = (legacyRow as any)?.project_id ?? undefined;
      if (projectId) {
        const { buildContentContext } = await import("../_shared/content-context.ts");
        const built = await buildContentContext(supabase, projectId, {
          mode: "diagnostic",
          task: "ai_judge.multi_pass_score",
          scope: "script",
          constraints: { rubric_preset: rubricPreset, rubric_version: rubricVersion, passes: NUM_PASSES },
          model_hint: effectiveModelHint,
        }, auth.userId);
        contextRef = { bundle_id: built.bundle_id, payload_hash: built.context_hash };
      }
    } catch (ctxErr) {
      console.error("[ai-judge] context bundle build failed (continuing without spine):", ctxErr);
    }

    // ─── Multi-Pass Evaluation ───
    console.log(`Starting ${NUM_PASSES}-pass evaluation for entry ${entry_id}`);

    const passMeta = {
      entryId: entry_id,
      userId: auth.userId,
      correlationId,
      sensitivity: entrySensitivity,
      pageCount: entryPageCount,
      projectId,
    };

    const passPromises = Array.from({ length: NUM_PASSES }, () =>
      runSinglePass(route, judgingPrompt, userContent, scoresTool, passMeta, contextRef),
    );
    const passResults = await Promise.all(passPromises);

    // Reflection-interrupt probe (advisory, non-blocking). Fires ONCE per
    // judge invocation, at the natural midpoint (after passes complete but
    // before the median-consensus commits). See workspace paper §7.
    import("../_shared/workspaceProbes.ts")
      .then(({ runReflectionProbe }) =>
        runReflectionProbe({
          operationId: correlationId ?? entry_id,
          midpointOrdinal: 1,
          taskDescription:
            `Screenplay evaluation across ${Object.keys(weights).length} dimensions ` +
            `(${Object.keys(weights).join(", ")}). ` +
            `Rubric preset: ${rubricPreset}. Prompt variant: ${variantId}. ` +
            `Passes completed: ${passResults.length}.`,
          functionName: "ai-judge",
          correlationId: correlationId ?? null,
          entryId: entry_id,
        }),
      )
      .catch((e) => console.error("[ai-judge] reflection probe failed (non-fatal):", e));

    // Aggregate tokens across all passes
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    for (const pr of passResults) {
      totalPromptTokens += pr.promptTokens;
      totalCompletionTokens += pr.completionTokens;
    }

    // ─── Median Consensus: reject outliers by using median-of-N ───
    const dimKeys = Object.keys(weights);
    const medianScores: Record<string, number> = {};
    const dimVariance: Record<string, number> = {};
    const outlierEvents: Array<{ key: string; passIndex: number; passValue: number; medianValue: number; deviationPct: number }> = [];

    for (const key of dimKeys) {
      const max = weights[key];
      const passValues = passResults.map((pr) => clamp(pr.scores[key] || 0, max));
      const med = median(passValues);
      medianScores[key] = clamp(med, max);
      dimVariance[key] = Math.round(stdDev(passValues) * 100) / 100;

      // Flag any pass that deviates >25% from the median on this dimension
      for (let pi = 0; pi < passValues.length; pi++) {
        if (med > 0) {
          const deviation = Math.abs(passValues[pi] - med) / med;
          if (deviation > 0.25) {
            outlierEvents.push({ key, passIndex: pi, passValue: passValues[pi], medianValue: med, deviationPct: Math.round(deviation * 100) });
          }
        }
      }
    }

    const bestFeedback =
      passResults
        .map((pr) => pr.scores.feedback || "")
        .sort((a, b) => b.length - a.length)[0] || "No feedback provided.";

    let totalScore = 0;
    const dimensionScoresJson: Record<string, number> = {};
    const finalScores: Record<string, any> = {
      feedback: bestFeedback,
      entry_id,
      total_score: 0,
      judge_model_id: modelId,
      originality: 0, structure: 0, character_depth: 0, dialogue: 0,
      theme: 0, emotion: 0, format_adherence: 0,
      market: 0, visual: 0,
      rubric_preset: rubricPreset,
      rubric_version: rubricVersion,
      dimension_scores: dimensionScoresJson,

    };

    if (isDefaultRubric) {
      // Map AI output keys (concept, story, etc.) → DB columns
      for (const key of dimKeys) {
        const dbCol = SCORE_TO_DB_COLUMN[key] || key;
        finalScores[dbCol] = medianScores[key];
        dimensionScoresJson[key] = medianScores[key];
        totalScore += medianScores[key];
      }
    } else {
      // Non-default rubric: persist via dimension_scores jsonb, leave legacy cols at 0
      for (const key of dimKeys) {
        dimensionScoresJson[key] = medianScores[key];
        totalScore += medianScores[key];
      }
    }
    finalScores.total_score = Math.round(totalScore * 10) / 10;

    const overallVariancePct = Math.round(
      avg(dimKeys.map((k) => (dimVariance[k] / weights[k]) * 100)),
    );

    const { error: scoreError } = await supabase.from("scores").upsert(finalScores, { onConflict: "entry_id" });
    if (scoreError) throw new Error(`Score upsert error: ${scoreError.message}`);

    // grading_reports is keyed to the 9-dim default schema; skip for custom presets
    if (isDefaultRubric) {
      await supabase.from("grading_reports").insert({
        entry_id,
        model_id: modelId,
        originality: finalScores.originality,
        structure: finalScores.structure,
        character_depth: finalScores.character_depth,
        dialogue: finalScores.dialogue,
        theme: finalScores.theme,
        emotion: finalScores.emotion,
        format_adherence: finalScores.format_adherence,
        market: finalScores.market || 0,
        visual: finalScores.visual || 0,
        total_score: finalScores.total_score,
        feedback: finalScores.feedback,
        rubric_preset: rubricPreset,
        rubric_version: rubricVersion,
      });
    }

    await supabase.from("entries").update({ status: "scored" }).eq("id", entry_id);

    // ─── Q2E Quotient Scoring with Variance (default rubric only) ───
    if (isDefaultRubric) try {
      const w = weights;

      const computeQ = (passResults: PassResult[], mapper: (pr: Record<string, any>) => number) => {
        const values = passResults.map((pr) => mapper(pr.scores));
        return { avg: Math.round(avg(values)), stddev: Math.round(stdDev(values) * 10) / 10 };
      };

      // Q2E quotients mapped from CanIScreenwrite categories
      const structure_qR = computeQ(passResults, (sc) => toPercent(clamp(sc.story || 0, w.story || 20), w.story || 20));
      const character_qR = computeQ(passResults, (sc) => toPercent(clamp(sc.characters || 0, w.characters || 20), w.characters || 20));
      const dialogue_qR = computeQ(passResults, (sc) => toPercent(clamp(sc.dialogue || 0, w.dialogue || 10), w.dialogue || 10));
      const theme_qR = computeQ(passResults, (sc) => toPercent(clamp(sc.theme || 0, w.theme || 10), w.theme || 10));
      const creativity_qR = computeQ(passResults, (sc) =>
        Math.round((toPercent(clamp(sc.concept || 0, w.concept || 15), w.concept || 15) + toPercent(clamp(sc.cinematic || 0, w.cinematic || 10), w.cinematic || 10)) / 2),
      );
      const audience_qR = computeQ(passResults, (sc) => toPercent(clamp(sc.climax || 0, w.climax || 10), w.climax || 10));
      const market_qR = computeQ(passResults, (sc) => toPercent(clamp(sc.market || 0, w.market || 15), w.market || 15));

      const qResults = [structure_qR, character_qR, dialogue_qR, theme_qR, creativity_qR, audience_qR, market_qR];
      const variance_score = Math.round(avg(qResults.map((r) => r.stddev)) * 10) / 10;
      const activeDims = dimKeys.filter((k) => avgScores[k] > 0).length;
      const confidence_score = Math.round((activeDims / dimKeys.length) * 100);

      const quotientRow = {
        entry_id,
        structure_q: structure_qR.avg,
        character_q: character_qR.avg,
        dialogue_q: dialogue_qR.avg,
        theme_q: theme_qR.avg,
        creativity_q: creativity_qR.avg,
        audience_q: audience_qR.avg,
        market_q: market_qR.avg,
        variance_score,
        confidence_score,
      };

      await supabase.from("script_quotients").insert(quotientRow);

      for (let i = 0; i < passResults.length; i++) {
        const pr = passResults[i];
        const passQuotients = {
          structure_q: toPercent(clamp(pr.scores.story || 0, w.story || 20), w.story || 20),
          character_q: toPercent(clamp(pr.scores.characters || 0, w.characters || 20), w.characters || 20),
          dialogue_q: toPercent(clamp(pr.scores.dialogue || 0, w.dialogue || 10), w.dialogue || 10),
          theme_q: toPercent(clamp(pr.scores.theme || 0, w.theme || 10), w.theme || 10),
          creativity_q: Math.round((toPercent(clamp(pr.scores.concept || 0, w.concept || 15), w.concept || 15) + toPercent(clamp(pr.scores.cinematic || 0, w.cinematic || 10), w.cinematic || 10)) / 2),
          audience_q: toPercent(clamp(pr.scores.climax || 0, w.climax || 10), w.climax || 10),
          market_q: toPercent(clamp(pr.scores.market || 0, w.market || 15), w.market || 15),
          pass_index: i + 1,
          raw_scores: Object.fromEntries(dimKeys.map((k) => [k, clamp(pr.scores[k] || 0, weights[k])])),
        };

        await supabase.from("evaluation_runs").insert({
          entry_id,
          model_used: modelId,
          temperature: 0.3,
          quotient_scores_json: passQuotients,
        });
      }

      console.log(`Q2E: variance=${variance_score}, confidence=${confidence_score}, unstable=${overallVariancePct > VARIANCE_THRESHOLD}`);
    } catch (q2eErr) {
      console.error("Q2E quotient insert error (non-fatal):", q2eErr);
    }

    // ─── Q2E Scene↔Arc Coherence (dry-run, advisory only) ───
    try {
      const settings = await readCoherenceSettings(supabase);
      if (settings.enabled) {
        const result = computeCoherenceDryRun(entry.script_text || "", settings.band, settings.minScenes);
        const collapseFlagged = result.ran && (result.anisotropy ?? 0) > settings.anisotropyMax;

        await supabase.from("governance_events").insert({
          entry_id,
          event_type: "coherence_observed_dryrun",
          event_status: "recorded",
          metadata_json: {
            correlation_id: correlationId,
            model_id: modelId,
            mode: "dryrun",
            anisotropy_max: settings.anisotropyMax,
            embedding_collapse_flag: collapseFlagged,
            coherence: result,
          },
        });

        console.log(
          `Coherence dry-run: scenes=${result.scene_count} script=${result.script ?? "n/a"} ` +
            `anisotropy=${result.anisotropy ?? "n/a"} flags=${result.flags?.length ?? 0} collapse=${collapseFlagged}`,
        );
      }
    } catch (cohErr) {
      console.error("Coherence dry-run error (non-fatal, no rubric impact):", cohErr);
    }

    // ─── Award badges ───
    try {
      const userId = entry.user_id;
      const badgesToAward: Array<{ user_id: string; badge_key: string; badge_label: string; badge_icon: string }> = [];

      const { count: scoredCount } = await supabase
        .from("entries")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "scored");

      if (scoredCount === 1) {
        badgesToAward.push({ user_id: userId, badge_key: "first_score", badge_label: "First Score", badge_icon: "star" });
      }
      if (totalScore >= 96) {
        badgesToAward.push({ user_id: userId, badge_key: "high_scorer", badge_label: "High Scorer", badge_icon: "trophy" });
      }
      if (totalScore >= 108) {
        badgesToAward.push({ user_id: userId, badge_key: "top_marks", badge_label: "Top Marks", badge_icon: "trophy" });
      }
      for (const [key, max] of Object.entries(weights)) {
        const val = dimensionScoresJson[key] ?? finalScores[SCORE_TO_DB_COLUMN[key] || key];
        if (val === max) {
          badgesToAward.push({ user_id: userId, badge_key: "perfect_category", badge_label: "Perfect Category", badge_icon: "zap" });
          break;
        }
      }
      if ((scoredCount || 0) >= 5) {
        badgesToAward.push({ user_id: userId, badge_key: "prolific_writer", badge_label: "Prolific Writer", badge_icon: "pen-tool" });
      }

      for (const badge of badgesToAward) {
        await supabase.from("user_badges").insert(badge).select().maybeSingle();
      }
    } catch (badgeErr) {
      console.error("Badge award error (non-fatal):", badgeErr);
    }

    // ─── Log aggregated usage (ai-judge manages its own aggregate alongside per-pass callAI logs) ───
    const costRates = COST_PER_1K[modelId] || { input: 0.05, output: 0.15 };
    const estimatedCostCents =
      (totalPromptTokens / 1000) * costRates.input +
      (totalCompletionTokens / 1000) * costRates.output;

    if (entry.competition_id) {
      await supabase.from("judge_usage_log").insert({
        competition_id: entry.competition_id,
        entry_id,
        model_id: modelId,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        estimated_cost_cents: Math.round(estimatedCostCents * 10000) / 10000,
      });
    }

    await supabase.from("ai_usage_log").insert({
      entry_id,
      user_id: entry.user_id,
      function_name: "ai-judge",
      model_id: modelId,
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      estimated_cost_cents: Math.round(estimatedCostCents * 10000) / 10000,
      status: "success",
      duration_ms: Date.now() - startTime,
      correlation_id: correlationId,
    });

    // ─── Governance layer (fire-and-forget) ───
    try {
      const reviewVersion = await createVersionSnapshot(supabase, {
        entryId: entry_id,
        sourceType: "review_snapshot",
        actorType: "ai",
        textContent: JSON.stringify(finalScores),
      });

      const govEvents = [
        { entryId: entry_id, versionId: reviewVersion?.id, eventType: "ai_request_received", provider: "lovable", modelName: modelId, privacyMode: entrySensitivity, metadata: { passes: NUM_PASSES } },
        { entryId: entry_id, versionId: reviewVersion?.id, eventType: "sensitivity_evaluated", privacyMode: entrySensitivity, metadata: { sensitivity: entrySensitivity } },
        { entryId: entry_id, versionId: reviewVersion?.id, eventType: "routing_decided", provider: resolved.provider, modelName: modelId, routingReason: resolved.provider === "custom" ? "competition_config" : null },
        { entryId: entry_id, versionId: reviewVersion?.id, eventType: "provider_called", provider: resolved.provider, modelName: modelId, metadata: { passes: NUM_PASSES } },
        { entryId: entry_id, versionId: reviewVersion?.id, eventType: "model_output_received", provider: resolved.provider, modelName: modelId, metadata: { total_score: totalScore, variance_pct: overallVariancePct } },
        { entryId: entry_id, versionId: reviewVersion?.id, eventType: "governance_decision_made", eventStatus: "approved", metadata: { stability: overallVariancePct <= VARIANCE_THRESHOLD ? "stable" : "unstable" } },
      ];

      // Emit scoring_outlier governance events for any pass that deviated >25% from median
      for (const outlier of outlierEvents) {
        govEvents.push({
          entryId: entry_id, versionId: reviewVersion?.id, eventType: "scoring_outlier",
          provider: resolved.provider, modelName: modelId,
          metadata: { dimension: outlier.key, pass_index: outlier.passIndex, pass_value: outlier.passValue, median_value: outlier.medianValue, deviation_pct: outlier.deviationPct },
        } as any);
      }

      await emitGovernanceEvents(supabase, govEvents);

      // ─── Score Anchoring: check universe siblings for drift ───
      try {
        const { data: ueRow } = await supabase
          .from("universe_entries")
          .select("universe_id")
          .eq("entry_id", entry_id)
          .maybeSingle();

        if (ueRow?.universe_id) {
          const { data: siblings } = await supabase
            .from("universe_entries")
            .select("entry_id")
            .eq("universe_id", ueRow.universe_id)
            .neq("entry_id", entry_id);

          if (siblings && siblings.length > 0) {
            const siblingIds = siblings.map((s: any) => s.entry_id);
            // eslint-disable-next-line no-restricted-syntax -- drift-only governance signal, not a displayed total
            const { data: siblingReports } = await supabase
              .from("grading_reports")
              .select("entry_id, total_score")
              .in("entry_id", siblingIds)
              .order("created_at", { ascending: false });

            if (siblingReports && siblingReports.length > 0) {
              // Compare against the most recent report per sibling
              const seen = new Set<string>();
              for (const sr of siblingReports) {
                if (seen.has(sr.entry_id)) continue;
                seen.add(sr.entry_id);
                const delta = Math.abs(finalScores.total_score - sr.total_score);
                if (delta > 15) {
                  await supabase.from("governance_events").insert({
                    entry_id,
                    event_type: "score_anchor_drift",
                    event_status: "flagged",
                    metadata_json: {
                      sibling_entry_id: sr.entry_id,
                      sibling_score: sr.total_score,
                      new_score: finalScores.total_score,
                      delta,
                      universe_id: ueRow.universe_id,
                    },
                  });
                  console.log(`Score anchor drift: ${delta} pts vs sibling ${sr.entry_id}`);
                }
              }
            }
          }
        }
      } catch (anchorErr) {
        console.error("Score anchoring check error (non-fatal):", anchorErr);
      }

      await addProvenanceNode(supabase, {
        entryId: entry_id,
        nodeType: "review_output",
        relatedVersionId: reviewVersion?.id,
        label: `AI Judge — Score ${totalScore}`,
        metadata: { model: modelId, passes: NUM_PASSES, total_score: totalScore },
      });
    } catch (govErr) {
      console.error("Governance recording error (non-fatal):", govErr);
    }

    // ─── Trigger voice drift analysis (fire-and-forget) ───
    try {
      const driftUrl = `${supabaseUrl}/functions/v1/voice-drift`;
      fetch(driftUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ entry_id, correlation_id: correlationId }),
      }).catch((e) => console.error("Voice drift trigger failed:", e));
    } catch (e) {
      console.error("Voice drift trigger error:", e);
    }

    // ─── Send score notification email (fire-and-forget) ───
    try {
      const userEmail = entry.user_id
        ? (await supabase.from("profiles").select("email").eq("user_id", entry.user_id).maybeSingle())?.data?.email
        : null;
      if (userEmail) {
        const sendUrl = `${supabaseUrl}/functions/v1/send-transactional-email`;
        fetch(sendUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            templateName: "score-notification",
            recipientEmail: userEmail,
            idempotencyKey: `score-notify-${entry_id}`,
            templateData: {
              title: entry.title,
              totalScore,
              displayName: null,
              isCompetitionEntry: !!entry.competition_id,
            },
          }),
        }).catch((e) => console.error("Score notification email failed:", e));
      }
    } catch (e) {
      console.error("Score notification email error:", e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        scores: finalScores,
        passes: NUM_PASSES,
        variance_pct: overallVariancePct,
        stability: overallVariancePct <= VARIANCE_THRESHOLD ? "stable" : "unstable",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("AI Judge error:", error);
    const errorMsg = (error as Error).message?.slice(0, 1000) || "Unknown error";

    // All crash recovery is best-effort
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, serviceKey);

      await sb.from("ai_usage_log").insert({
        function_name: "ai-judge",
        model_id: "unknown",
        status: "error",
        error_message: errorMsg,
        duration_ms: Date.now() - startTime,
        correlation_id: correlationId,
        entry_id: authorizedEntryId || null,
      });

      if (authorizedEntryId) {
        await sb.from("entries").update({ status: "error" }).eq("id", authorizedEntryId);
      }

      await logGovernanceAction({
        action: "ai_judge_crash",
        details: {
          entry_id: authorizedEntryId || null,
          error: errorMsg,
          correlation_id: correlationId,
          duration_ms: Date.now() - startTime,
        },
      });

      if (authorizedEntryId) {
        await sb.from("governance_events").insert({
          entry_id: authorizedEntryId,
          event_type: "ai_judge_error",
          event_status: "failed",
          metadata_json: {
            error: errorMsg,
            correlation_id: correlationId,
            duration_ms: Date.now() - startTime,
          },
        });
      }

      const { data: admins } = await sb.from("user_roles").select("user_id").eq("role", "admin");
      if (admins && admins.length > 0) {
        const notifications = admins.map((a: { user_id: string }) => ({
          user_id: a.user_id,
          title: "AI Judge Crash",
          message: `Entry ${authorizedEntryId || "unknown"} failed during evaluation: ${errorMsg.slice(0, 200)}`,
          type: "error",
          metadata: { entry_id: authorizedEntryId, correlation_id: correlationId },
        }));
        await sb.from("user_notifications").insert(notifications);
      }
    } catch (crashRecoveryErr) {
      console.error("Crash recovery failed:", crashRecoveryErr);
    }

    return aiErrorResponse(error, corsHeaders);
  }
});
