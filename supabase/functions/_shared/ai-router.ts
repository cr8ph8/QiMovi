/**
 * Shared AI Router — CanIScreenwrite
 *
 * Centralises provider selection, gateway calls, cost estimation,
 * and routing-decision logging for every AI-calling edge function.
 *
 * Usage:
 *   import { callAI, COST_PER_1K } from "../_shared/ai-router.ts";
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Cost table (in-memory fallback, populated from ai_models on first call) ───

export const COST_PER_1K: Record<string, { input: number; output: number }> = {
  "google/gemini-3-flash-preview": { input: 0.01, output: 0.04 },
  "google/gemini-3.1-pro-preview": { input: 0.125, output: 0.5 },
  "google/gemini-2.5-flash": { input: 0.015, output: 0.06 },
  "google/gemini-2.5-flash-lite": { input: 0.008, output: 0.03 },
  "google/gemini-2.5-pro": { input: 0.125, output: 0.5 },
  "openai/gpt-5": { input: 0.5, output: 1.5 },
  "openai/gpt-5-mini": { input: 0.1, output: 0.3 },
  "openai/gpt-5-nano": { input: 0.03, output: 0.1 },
  "openai/gpt-5.2": { input: 0.6, output: 1.8 },
};

// ─── Model registry cache ───

interface ModelRegistryEntry {
  id: string;
  status: string;
  replacement_model_id: string | null;
  cost_input_per_1k: number;
  cost_output_per_1k: number;
  tier: string;
}

let modelRegistryCache: Record<string, ModelRegistryEntry> | null = null;
let registryCacheTime = 0;
const REGISTRY_CACHE_TTL_MS = 60_000; // 1 minute

async function getModelRegistry(): Promise<Record<string, ModelRegistryEntry>> {
  const now = Date.now();
  if (modelRegistryCache && now - registryCacheTime < REGISTRY_CACHE_TTL_MS) {
    return modelRegistryCache;
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return modelRegistryCache || {};

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data } = await supabase
      .from("ai_models")
      .select("id, status, replacement_model_id, cost_input_per_1k, cost_output_per_1k, tier");

    if (data) {
      const map: Record<string, ModelRegistryEntry> = {};
      for (const row of data) {
        map[row.id] = row as ModelRegistryEntry;
        // Update COST_PER_1K in-memory fallback
        COST_PER_1K[row.id] = { input: Number(row.cost_input_per_1k), output: Number(row.cost_output_per_1k) };
      }
      modelRegistryCache = map;
      registryCacheTime = now;
      return map;
    }
  } catch (e) {
    console.error("[ai-router] Model registry fetch error (non-fatal):", e);
  }
  return modelRegistryCache || {};
}

/**
 * Checks model status in the registry. If retired, returns the replacement model.
 * If deprecated, logs a warning but allows the call.
 * Returns { resolvedModelId, routingReason } — routingReason is set only if model was rerouted.
 */
async function checkModelRetirement(
  modelId: string,
): Promise<{ resolvedModelId: string; retirementRouting: string | null }> {
  const registry = await getModelRegistry();
  const entry = registry[modelId];

  if (!entry) {
    // Unknown model — allow (could be a new model not yet in registry)
    return { resolvedModelId: modelId, retirementRouting: null };
  }

  if (entry.status === "retired") {
    const replacement = entry.replacement_model_id || DEFAULT_MODEL;
    // Make sure replacement isn't also retired (one level deep)
    const replacementEntry = registry[replacement];
    const finalModel = replacementEntry?.status === "retired"
      ? (replacementEntry.replacement_model_id || DEFAULT_MODEL)
      : replacement;

    console.log(`[ai-router] Model "${modelId}" is RETIRED → rerouting to "${finalModel}"`);
    return { resolvedModelId: finalModel, retirementRouting: "model_retired" };
  }

  if (entry.status === "deprecated") {
    console.warn(`[ai-router] Model "${modelId}" is DEPRECATED — still usable but scheduled for retirement`);
  }

  return { resolvedModelId: modelId, retirementRouting: null };
}

// ─── Types ───

export interface ProviderResolution {
  apiUrl: string;
  apiKey: string;
  modelId: string;
  /** The model id sent to the upstream API (strips org prefix for custom providers) */
  apiModelId: string;
  provider: "lovable" | "custom";
}

export interface RouteRequest {
  /** Calling edge-function name, e.g. "ai-judge" */
  functionName: string;
  /** Default / preferred model */
  modelHint?: string;
  /** If set, look up competition_judge_config for provider override */
  competitionId?: string;
  /** Custom provider config (pre-fetched) — avoids a DB round-trip when ai-judge already has it */
  customConfig?: {
    model_provider?: string;
    model_id?: string;
    custom_api_base_url?: string | null;
    custom_api_key_encrypted?: string | null;
  } | null;
}

export interface AICallOptions {
  route: RouteRequest;
  messages: Array<{ role: string; content: string }>;
  /** Defaults to 0.3 */
  temperature?: number;
  max_completion_tokens?: number;
  /** Request JSON mode */
  response_format?: { type: string };
  /** Tool definitions for structured output via function calling */
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: any } }>;
  /** Tool choice constraint */
  tool_choice?: any;
  /**
   * Reference to a context_bundles row built via buildContentContext().
   * When provided, the router verifies the hash before the upstream call so
   * the model receives the exact versioned payload governance recorded.
   */
  context_ref?: { bundle_id: string; payload_hash: string };
  /** Extra metadata logged alongside the routing decision */
  meta?: {
    entryId?: string;
    userId?: string;
    correlationId?: string;
    sensitivity?: string;
    /** Script page count — enables cost-based routing for short scripts */
    pageCount?: number;
    /** Unified project id — recorded for cross-table tracing */
    projectId?: string;
    /**
     * Optional retrieved / augmented context passed inside the prompt
     * (RAG chunks, tool results, user-uploaded files, brief comments, etc.).
     * When present, the router fires a cheap workspace injection self-report
     * probe after the call completes. See _shared/workspaceProbes.ts.
     */
    augmentedContext?: string;
  };
}

export interface AICallResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  modelId: string;
  estimatedCostCents: number;
  raw: any;
}

// ─── Policy blocking ───

/** Sensitivity levels that can be blocked via site_settings flags */
const POLICY_BLOCKABLE_SENSITIVITIES = ["confidential", "nda_protected", "embargoed"] as const;

/**
 * Check site_settings for a flag like `block_ai_confidential`, `block_ai_nda_protected`, etc.
 * Returns true if the request should be blocked.
 */
async function checkPolicyBlock(sensitivity: string | undefined): Promise<boolean> {
  if (!sensitivity || sensitivity === "standard") return false;
  if (!POLICY_BLOCKABLE_SENSITIVITIES.includes(sensitivity as any)) return false;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      throw new AIRouterError(
        "AI sensitivity policy could not be verified.",
        503,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const settingKey = `block_ai_${sensitivity}`;
    const { data, error } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", settingKey)
      .maybeSingle();

    if (error || !data) {
      throw new AIRouterError(
        "AI sensitivity policy could not be verified.",
        503,
      );
    }

    return data?.value === true;
  } catch (e) {
    if (e instanceof AIRouterError) throw e;
    console.error("[ai-router] Policy check error (blocking):", e);
    throw new AIRouterError("AI sensitivity policy could not be verified.", 503);
  }
}

/**
 * Log a policy-blocked event to ai_usage_log so governance audits can see it.
 */
async function logPolicyBlock(options: AICallOptions, sensitivity: string) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;

    const supabase = createClient(supabaseUrl, serviceKey);
    await supabase.from("ai_usage_log").insert({
      function_name: options.route.functionName,
      model_id: "none",
      prompt_tokens: 0,
      completion_tokens: 0,
      estimated_cost_cents: 0,
      status: "blocked",
      entry_id: options.meta?.entryId || null,
      user_id: options.meta?.userId || null,
      correlation_id: options.meta?.correlationId || null,
      sensitivity,
      routing_reason: "policy_blocked",
    });
  } catch (e) {
    console.error("[ai-router] Policy block log failed:", e);
  }
}

// ─── Provider resolution ───

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

// ─── Sensitivity-based model upgrade map ───
// When an entry or competition has elevated sensitivity, the router
// automatically upgrades to a more capable model for higher-quality,
// more nuanced analysis — unless a custom provider is already configured.

const SENSITIVITY_MODEL_OVERRIDES: Record<string, string> = {
  confidential: "google/gemini-2.5-pro",
  nda_protected: "google/gemini-2.5-pro",
  embargoed: "google/gemini-2.5-flash",
  invite_only: "google/gemini-2.5-pro",
};

/**
 * Applies sensitivity-based model selection.
 * Custom provider configs are never overridden — the admin chose them deliberately.
 * Explicit modelHint from competition_judge_config also takes priority.
 */
function applySensitivityRouting(
  baseModelId: string,
  sensitivity: string | undefined,
  hasExplicitConfig: boolean,
): { modelId: string; upgraded: boolean } {
  if (!sensitivity || sensitivity === "standard" || hasExplicitConfig) {
    return { modelId: baseModelId, upgraded: false };
  }
  const override = SENSITIVITY_MODEL_OVERRIDES[sensitivity];
  if (override && override !== baseModelId) {
    console.log(`[ai-router] Sensitivity "${sensitivity}" → upgrading model from ${baseModelId} to ${override}`);
    return { modelId: override, upgraded: true };
  }
  return { modelId: baseModelId, upgraded: false };
}

// ─── Cost-based routing for short scripts ───

async function checkCostRoutingSettings(): Promise<{ enabled: boolean; threshold: number }> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return { enabled: true, threshold: 10 };

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data } = await supabase
      .from("site_settings")
      .select("key, value, text_value")
      .in("key", ["cost_routing_enabled", "short_script_page_threshold"]);

    let enabled = true;
    let threshold = 10;
    for (const row of (data || [])) {
      if (row.key === "cost_routing_enabled") enabled = row.value !== false;
      if (row.key === "short_script_page_threshold") threshold = parseInt(row.text_value, 10) || 10;
    }
    return { enabled, threshold };
  } catch (e) {
    console.error("[ai-router] Cost routing setting check error (non-fatal, allowing):", e);
    return { enabled: true, threshold: 10 };
  }
}

const SHORT_SCRIPT_MODEL = "google/gemini-2.5-flash-lite";

async function applyCostRouting(
  modelId: string,
  pageCount: number | undefined,
  hasExplicitConfig: boolean,
  wasSensitivityUpgraded: boolean,
): Promise<{ modelId: string; downgraded: boolean; threshold: number }> {
  const { enabled: costRoutingEnabled, threshold } = await checkCostRoutingSettings();

  if (
    !pageCount ||
    pageCount > threshold ||
    hasExplicitConfig ||
    wasSensitivityUpgraded
  ) {
    return { modelId, downgraded: false, threshold };
  }

  if (!costRoutingEnabled) {
    console.log("[ai-router] Cost routing disabled via site_settings, skipping downgrade");
    return { modelId, downgraded: false, threshold };
  }
  if (modelId !== SHORT_SCRIPT_MODEL) {
    console.log(`[ai-router] Short script (${pageCount} pages, threshold=${threshold}) → downgrading from ${modelId} to ${SHORT_SCRIPT_MODEL}`);
    return { modelId: SHORT_SCRIPT_MODEL, downgraded: true, threshold };
  }
  return { modelId, downgraded: false, threshold };
}

export async function resolveProvider(route: RouteRequest, sensitivity?: string, pageCount?: number): Promise<ProviderResolution> {
  const cfg = route.customConfig;
  const isCustom =
    cfg?.model_provider === "custom" &&
    cfg?.custom_api_key_encrypted &&
    cfg?.custom_api_base_url;

  if (isCustom) {
    const baseUrl = cfg!.custom_api_base_url!.replace(/\/$/, "");
    const modelId = cfg!.model_id || route.modelHint || DEFAULT_MODEL;
    return {
      apiUrl: `${baseUrl}/v1/chat/completions`,
      apiKey: cfg!.custom_api_key_encrypted!,
      modelId,
      apiModelId: modelId.split("/").pop() || modelId,
      provider: "custom",
    };
  }

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

  const baseModelId = cfg?.model_id || route.modelHint || DEFAULT_MODEL;
  const hasExplicitConfig = Boolean(cfg?.model_id);

  // Chain: retirement check → sensitivity upgrade → cost downgrade
  const { resolvedModelId: postRetirementModel, retirementRouting } = await checkModelRetirement(baseModelId);

  const sensitivityResult = applySensitivityRouting(postRetirementModel, sensitivity, hasExplicitConfig);
  const costResult = await applyCostRouting(sensitivityResult.modelId, pageCount, hasExplicitConfig, sensitivityResult.upgraded);
  let finalModelId = costResult.modelId;

  // Final retirement check on the resolved model (in case sensitivity/cost routing picked a retired model)
  const finalCheck = await checkModelRetirement(finalModelId);
  finalModelId = finalCheck.resolvedModelId;

  return {
    apiUrl: LOVABLE_GATEWAY,
    apiKey: lovableKey,
    modelId: finalModelId,
    apiModelId: finalModelId,
    provider: "lovable",
    _retirementRouting: retirementRouting || finalCheck.retirementRouting,
  } as ProviderResolution & { _retirementRouting?: string | null };
}

// ─── Advertiser-influence guard ───
//
// Functions that produce evaluations, comparisons, or rewrites for the user
// MUST NEVER receive sponsorship / advertiser context inside their prompt.
// (Inspired by Wu et al. 2026 — "Ads in AI Chatbots", which shows LLMs
// routinely betray users when sponsored content leaks into context.)
const AD_PROTECTED_FUNCTIONS = new Set<string>([
  "ai-judge",
  "ai-compare",
  "ai-analyze-reports",
  "suggest-rewrites",
  "rewrite-selection",
  "voice-drift",
  "generate-script",
  "generate-title",
  "generate-logline",
  "outline-from-beats",
  "organize-brain-dump",
  "seed-filmstack",
  "auto-audit",
  "suggest-character-diamond",
  "verify-character-identity",
  "embed-character",
]);

const AD_INFLUENCE_PATTERNS = [
  /sponsor(ed|ship)?/i,
  /advertise(r|ment|d)?/i,
  /paid\s+(placement|partner|promotion)/i,
  /promoted\s+(by|content)/i,
  /\bad[_-]?slot\b/i,
];

function detectAdvertiserInfluence(messages: AICallOptions["messages"]): string | null {
  for (const m of messages) {
    const c = typeof m.content === "string" ? m.content : "";
    for (const p of AD_INFLUENCE_PATTERNS) {
      const hit = c.match(p);
      if (hit) return hit[0];
    }
  }
  return null;
}

async function logAdvertiserBlock(options: AICallOptions, matched: string) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    const supabase = createClient(supabaseUrl, serviceKey);
    await supabase.from("ai_usage_log").insert({
      function_name: options.route.functionName,
      model_id: "none",
      prompt_tokens: 0,
      completion_tokens: 0,
      estimated_cost_cents: 0,
      status: "blocked",
      entry_id: options.meta?.entryId || null,
      user_id: options.meta?.userId || null,
      correlation_id: options.meta?.correlationId || null,
      sensitivity: options.meta?.sensitivity || "standard",
      routing_reason: `advertiser_influence_blocked:${matched}`.slice(0, 120),
    });
  } catch (e) {
    console.error("[ai-router] advertiser-block log failed:", e);
  }
}

// ─── Protected-author emulation guard ───
//
// Motivated by Chakrabarty/Ginsburg/Dhillon (2025, arXiv:2510.13939v4):
// Author-specific fine-tuning produces non-verbatim outputs that readers
// prefer over expert human writers, with AI detectors collapsing to ~3%
// flag rate. Mode (per policy): disclose-and-watermark, allow.
// We DETECT and LOG; we do not block. The disclosure UI handles user-facing
// acknowledgement, and evidence bundles will carry the flag forward.

const AUTHOR_GUARDED_FUNCTIONS = new Set<string>([
  "ai-judge",
  "ai-compare",
  "ai-analyze-reports",
  "suggest-rewrites",
  "rewrite-selection",
  "voice-drift",
  "generate-script",
  "generate-title",
  "generate-logline",
  "outline-from-beats",
  "organize-brain-dump",
  "seed-filmstack",
  "auto-audit",
  "legal-summary",
  "suggest-character-diamond",
  "verify-character-identity",
  "embed-character",
]);

const STYLE_TARGET_TRIGGERS = [
  /\b(in the (style|voice|manner) of|emulat(e|ing)|written like|mimic(king)?|channel(ing)?|pastiche of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-zà-ÿ.'\-]+){0,3})/i,
  /\bstyle[_-]?target\s*[:=]\s*['"]?([A-Z][a-z]+(?:\s+[A-Z][a-zà-ÿ.'\-]+){0,3})/i,
];

let protectedAuthorsCache: { names: string[]; loadedAt: number } | null = null;
const PROTECTED_AUTHORS_TTL_MS = 5 * 60_000;

async function getProtectedAuthors(): Promise<string[]> {
  const now = Date.now();
  if (protectedAuthorsCache && now - protectedAuthorsCache.loadedAt < PROTECTED_AUTHORS_TTL_MS) {
    return protectedAuthorsCache.names;
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return protectedAuthorsCache?.names || [];
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data } = await supabase
      .from("protected_authors")
      .select("name_normalized")
      .eq("active", true);
    const names = (data || []).map((r: any) => r.name_normalized).filter(Boolean);
    protectedAuthorsCache = { names, loadedAt: now };
    return names;
  } catch (e) {
    console.error("[ai-router] protected_authors fetch failed (non-fatal):", e);
    return protectedAuthorsCache?.names || [];
  }
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function detectProtectedAuthorEmulation(
  messages: AICallOptions["messages"],
): Promise<{ matchedAuthor: string; kind: "prompt_named_author" | "style_target" } | null> {
  const authors = await getProtectedAuthors();
  if (authors.length === 0) return null;

  for (const m of messages) {
    const content = typeof m.content === "string" ? m.content : "";
    if (!content) continue;

    // 1) Style-target triggers (strongest signal)
    for (const re of STYLE_TARGET_TRIGGERS) {
      const hit = content.match(re);
      if (hit) {
        const candidate = normalizeForMatch(hit[hit.length - 1] || "");
        if (candidate && authors.includes(candidate)) {
          return { matchedAuthor: candidate, kind: "style_target" };
        }
      }
    }

    // 2) Bare named-author match (weaker but still flagged)
    const normalized = " " + normalizeForMatch(content) + " ";
    for (const a of authors) {
      if (normalized.includes(" " + a + " ")) {
        return { matchedAuthor: a, kind: "prompt_named_author" };
      }
    }
  }
  return null;
}

async function logAuthorEmulationFlag(
  options: AICallOptions,
  matchedAuthor: string,
  kind: string,
) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Persist a structured flag for the admin Fine-Tune Risk panel
    await supabase.rpc("log_author_emulation_flag", {
      _user_id: options.meta?.userId || null,
      _entry_id: options.meta?.entryId || null,
      _function_name: options.route.functionName,
      _matched_author: matchedAuthor,
      _match_kind: kind,
      _correlation_id: options.meta?.correlationId || null,
    });

    // Also log a routing breadcrumb on ai_usage_log for the governance dashboard
    await supabase.from("ai_usage_log").insert({
      function_name: options.route.functionName,
      model_id: "pending",
      prompt_tokens: 0,
      completion_tokens: 0,
      estimated_cost_cents: 0,
      status: "flagged",
      entry_id: options.meta?.entryId || null,
      user_id: options.meta?.userId || null,
      correlation_id: options.meta?.correlationId || null,
      sensitivity: options.meta?.sensitivity || "standard",
      routing_reason: `protected_author_emulation:${kind}:${matchedAuthor}`.slice(0, 120),
    });
  } catch (e) {
    console.error("[ai-router] author-emulation flag log failed:", e);
  }
}

// ─── Core AI call ───

export async function callAI(options: AICallOptions): Promise<AICallResult> {
  // ── Context-ref verification (the spine) ──
  // If the caller provided a context_ref, confirm the bundle exists and its
  // payload_hash still matches. This guarantees the model is being called
  // against the exact versioned payload governance recorded.
  //
  // Per-function hard-require: set AI_ROUTER_REQUIRE_CONTEXT_REF to a
  // comma-separated list of function names that MUST pass a context_ref.
  // Any listed function calling without one is rejected (409). This lets us
  // flip enforcement per caller as adoption rolls out.
  const requireList = (Deno.env.get("AI_ROUTER_REQUIRE_CONTEXT_REF") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!options.context_ref && requireList.includes(options.route.functionName)) {
    throw new AIRouterError(
      `context_ref required for "${options.route.functionName}" but none was provided.`,
      409,
    );
  }
  if (options.context_ref) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) {
        throw new AIRouterError("context_ref verification unavailable.", 503);
      }
      if (!options.meta?.projectId) {
        throw new AIRouterError(
          "context_ref requires a project-bound routing request.",
          409,
        );
      }

      const admin = createClient(supabaseUrl, serviceKey);
      const { data: bundle, error: bundleError } = await admin
        .from("context_bundles")
        .select("payload_hash, project_id, entry_id, built_by")
        .eq("id", options.context_ref.bundle_id)
        .maybeSingle();
      if (bundleError) {
        throw new AIRouterError("context_ref verification unavailable.", 503);
      }
      const actual = (bundle as any)?.payload_hash ?? null;
      if (!actual) {
        throw new AIRouterError(
          `context_ref ${options.context_ref.bundle_id} not found — refuse to call model without a verifiable bundle.`,
          409,
        );
      }
      if (actual !== options.context_ref.payload_hash) {
        throw new AIRouterError(
          "context_ref hash mismatch — context bundle changed since reference was issued.",
          409,
        );
      }
      if ((bundle as any).project_id !== options.meta.projectId) {
        throw new AIRouterError("context_ref project mismatch.", 403);
      }
      const bundleEntryId = (bundle as any).entry_id ?? null;
      if (bundleEntryId !== (options.meta.entryId ?? null)) {
        throw new AIRouterError("context_ref entry mismatch.", 403);
      }
      if ((bundle as any).built_by !== (options.meta.userId ?? null)) {
        throw new AIRouterError("context_ref principal mismatch.", 403);
      }

      // Sensitivity is security state, not caller-controlled metadata. Resolve
      // it from the entry bound to the verified context and normalize all
      // downstream policy, provider-routing, and audit decisions to that value.
      if (bundleEntryId) {
        const { data: entryPolicy, error: entryPolicyError } = await admin
          .from("entries")
          .select("sensitivity")
          .eq("id", bundleEntryId)
          .maybeSingle();
        if (entryPolicyError || !entryPolicy) {
          throw new AIRouterError(
            "context_ref sensitivity verification unavailable.",
            503,
          );
        }
        const authoritativeSensitivity =
          (entryPolicy as any).sensitivity ?? "standard";
        if (
          options.meta.sensitivity &&
          options.meta.sensitivity !== authoritativeSensitivity
        ) {
          throw new AIRouterError("context_ref sensitivity mismatch.", 403);
        }
        options = {
          ...options,
          meta: { ...options.meta, sensitivity: authoritativeSensitivity },
        };
      }
    } catch (e) {
      if (e instanceof AIRouterError) throw e;
      console.error("[ai-router] context_ref verification error (blocking):", e);
      throw new AIRouterError("context_ref verification unavailable.", 503);
    }
  }

  // ── Advertiser-influence guard ──
  if (AD_PROTECTED_FUNCTIONS.has(options.route.functionName)) {
    const matched = detectAdvertiserInfluence(options.messages);
    if (matched) {
      console.error(`[ai-router] BLOCKED advertiser influence in "${options.route.functionName}": matched "${matched}"`);
      await logAdvertiserBlock(options, matched).catch(() => {});
      throw new AIRouterError(
        `AI request blocked: sponsorship / advertiser context detected in protected function "${options.route.functionName}".`,
        403,
      );
    }
  }

  // ── Protected-author emulation flag (disclose + watermark, do not block) ──
  if (AUTHOR_GUARDED_FUNCTIONS.has(options.route.functionName)) {
    const hit = await detectProtectedAuthorEmulation(options.messages);
    if (hit) {
      console.warn(
        `[ai-router] FLAGGED protected-author emulation in "${options.route.functionName}": "${hit.matchedAuthor}" (${hit.kind})`,
      );
      await logAuthorEmulationFlag(options, hit.matchedAuthor, hit.kind).catch(() => {});
      // Allow the request to proceed — disclosure UI + admin review handle the rest.
    }
  }


  // ── Policy block check ──
  const sensitivity = options.meta?.sensitivity;
  if (sensitivity && await checkPolicyBlock(sensitivity)) {
    console.log(`[ai-router] BLOCKED by policy: sensitivity="${sensitivity}", function="${options.route.functionName}"`);
    await logPolicyBlock(options, sensitivity).catch(e => console.error("Policy block log error:", e));
    throw new AIRouterError(
      `AI request blocked by governance policy: sensitivity level "${sensitivity}" is not permitted for AI processing.`,
      403,
    );
  }

  const resolved = await resolveProvider(options.route, sensitivity, options.meta?.pageCount) as ProviderResolution & { _retirementRouting?: string | null };

  // Derive routing_reason from provider resolution
  let routingReason: string | null = resolved._retirementRouting || null;
  if (!routingReason) {
    const baseModel = options.route.customConfig?.model_id || options.route.modelHint || DEFAULT_MODEL;
    if (resolved.provider === "custom") {
      routingReason = "competition_config";
    } else if (resolved.modelId !== baseModel) {
      const sens = options.meta?.sensitivity;
      if (sens && sens !== "standard" && SENSITIVITY_MODEL_OVERRIDES[sens]) {
        routingReason = "sensitivity_upgrade";
      } else if (options.meta?.pageCount && resolved.modelId === SHORT_SCRIPT_MODEL) {
        routingReason = "cost_downgrade";
      } else {
        routingReason = "admin_override";
      }
    }
  }

  const body: Record<string, any> = {
    model: resolved.apiModelId,
    messages: options.messages,
  };
  if (options.temperature != null) body.temperature = options.temperature;
  if (options.max_completion_tokens) body.max_completion_tokens = options.max_completion_tokens;
  if (options.response_format) body.response_format = options.response_format;
  if (options.tools) body.tools = options.tools;
  if (options.tool_choice) body.tool_choice = options.tool_choice;

  // Retry with exponential backoff for transient gateway errors (502, 503, 504)
  const MAX_RETRIES = 3;
  const RETRYABLE_STATUSES = [502, 503, 504];
  let response: Response | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.log(`[ai-router] Retry ${attempt}/${MAX_RETRIES} after ${delayMs}ms for ${resolved.modelId}`);
      await new Promise(r => setTimeout(r, delayMs));
    }

    response = await fetch(resolved.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) break;

    // Non-retryable errors — fail immediately
    if (response.status === 429) {
      await response.text();
      throw new AIRouterError("Rate limited — please try again shortly.", 429);
    }
    if (response.status === 402) {
      await response.text();
      throw new AIRouterError("AI credits exhausted.", 402);
    }

    if (RETRYABLE_STATUSES.includes(response.status) && attempt < MAX_RETRIES) {
      lastError = await response.text();
      console.warn(`[ai-router] Transient ${response.status} from gateway (attempt ${attempt + 1})`);
      continue;
    }

    // Final attempt or non-retryable status
    const errText = await response.text();
    throw new AIRouterError(`AI gateway error (${response.status}): ${errText}`, response.status);
  }

  if (!response || !response.ok) {
    throw new AIRouterError(`AI gateway error after ${MAX_RETRIES} retries: ${lastError || "unknown"}`, 502);
  }

  const data = await response.json();
  // Extract content: prefer tool_calls arguments (structured output) over plain content
  const message = data.choices?.[0]?.message;
  const toolCall = message?.tool_calls?.[0];
  const content = toolCall?.function?.arguments ?? message?.content ?? "";
  const usage = data.usage || {};
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;

  const costRates = COST_PER_1K[resolved.modelId] || { input: 0.05, output: 0.15 };
  const estimatedCostCents =
    (promptTokens / 1000) * costRates.input +
    (completionTokens / 1000) * costRates.output;

  // Fire-and-forget: log routing decision + usage to ai_usage_log
  logRoutingDecision(options, resolved, promptTokens, completionTokens, estimatedCostCents, routingReason).catch(
    (e) => console.error("AI router log error (non-fatal):", e),
  );

  // Fire-and-forget: workspace-aware injection self-report probe.
  // Only runs when the caller passed `meta.augmentedContext` (RAG output,
  // tool results, user-uploaded content, etc.). Advisory only — see
  // _shared/workspaceProbes.ts and .lovable/research/workspace-paper.md.
  if (options.meta?.augmentedContext) {
    import("./workspaceProbes.ts")
      .then(({ runInjectionSelfReport }) =>
        runInjectionSelfReport({
          augmentedContext: options.meta!.augmentedContext!,
          functionName: options.route.functionName,
          correlationId: options.meta?.correlationId ?? null,
          entryId: options.meta?.entryId ?? null,
        }),
      )
      .catch((e) => console.error("[ai-router] injection probe error (non-fatal):", e));
  }

  return {
    content,
    promptTokens,
    completionTokens,
    modelId: resolved.modelId,
    estimatedCostCents: Math.round(estimatedCostCents * 10000) / 10000,
    raw: data,
  };
}

// ─── Routing decision logger ───

async function logRoutingDecision(
  options: AICallOptions,
  resolved: ProviderResolution,
  promptTokens: number,
  completionTokens: number,
  estimatedCostCents: number,
  routingReason: string | null,
) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;

    const supabase = createClient(supabaseUrl, serviceKey);

    await supabase.from("ai_usage_log").insert({
      function_name: options.route.functionName,
      model_id: resolved.modelId,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      estimated_cost_cents: Math.round(estimatedCostCents * 10000) / 10000,
      status: "success",
      entry_id: options.meta?.entryId || null,
      user_id: options.meta?.userId || null,
      correlation_id: options.meta?.correlationId || null,
      sensitivity: options.meta?.sensitivity || "standard",
      routing_reason: routingReason,
    });
  } catch (e) {
    console.error("Routing decision log failed:", e);
  }
}

// ─── Error class for HTTP-aware errors ───

// ─── Resolve model hint from feature_configs ───

const FUNCTION_FEATURE_MAP: Record<string, string> = {
  "rewrite-selection": "ai_rewrite",
  "voice-drift": "deep_voice",
  "ai-judge": "ai_score",
  "generate-script": "dialogue_generation",
  "legal-summary": "legal_summary",
  "ai-compare": "ai_score",
  "organize-brain-dump": "brain_dump",
  "suggest-character-diamond": "character_diamond_suggest",
  "embed-character": "character_drift_embedding",
  "verify-character-identity": "identity_engine",
  "rollback-character-diamond": "character_rollback",
};

/**
 * Look up `feature_configs.model_hint` for a given edge function name.
 * Returns the DB-configured model if set, otherwise the provided fallback.
 */
export async function resolveModelHint(functionName: string, fallback: string): Promise<string> {
  try {
    const featureId = FUNCTION_FEATURE_MAP[functionName] || functionName;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return fallback;

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data } = await supabase
      .from("feature_configs")
      .select("model_hint")
      .eq("id", featureId)
      .maybeSingle();

    if (data?.model_hint) {
      console.log(`[ai-router] resolveModelHint: ${functionName} → ${data.model_hint} (from feature_configs.${featureId})`);
      return data.model_hint;
    }
  } catch (e) {
    console.error("resolveModelHint error (non-fatal):", e);
  }
  return fallback;
}

// ─── Model surcharge lookup (cost-proportional) ───

/** In-memory fallback surcharges based on API cost differentials */
const SURCHARGE_DEFAULTS: Record<string, { multiplier: number; flat_surcharge: number }> = {
  budget:        { multiplier: 1.0, flat_surcharge: 0 },
  fast:          { multiplier: 1.0, flat_surcharge: 0 },
  standard:      { multiplier: 1.0, flat_surcharge: 0 },
  premium:       { multiplier: 3.0, flat_surcharge: 0 },
  super_premium: { multiplier: 5.0, flat_surcharge: 0 },
};

/**
 * Look up the surcharge multiplier for a model based on its tier.
 * Tries the `model_surcharges` DB table first, falls back to in-memory defaults.
 */
export async function getModelSurcharge(modelId: string): Promise<{ multiplier: number; flat_surcharge: number; tier: string | null }> {
  const registry = await getModelRegistry();
  const modelEntry = registry[modelId];
  const tier = modelEntry?.tier || "standard";

  // Try DB lookup
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey);
      const { data } = await supabase
        .from("model_surcharges")
        .select("multiplier, flat_surcharge, enabled")
        .eq("tier", tier)
        .maybeSingle();

      if (data && data.enabled) {
        return { multiplier: data.multiplier, flat_surcharge: data.flat_surcharge, tier };
      }
    }
  } catch (e) {
    console.error("[ai-router] Surcharge lookup error (non-fatal):", e);
  }

  // Fallback to in-memory defaults
  const fallback = SURCHARGE_DEFAULTS[tier] || SURCHARGE_DEFAULTS.standard;
  return { multiplier: fallback.multiplier, flat_surcharge: fallback.flat_surcharge, tier };
}

export class AIRouterError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AIRouterError";
    this.status = status;
  }
}

// ─── Helper: build an error Response from an AIRouterError ───

export function aiErrorResponse(
  error: unknown,
  corsHeaders: Record<string, string>,
): Response {
  if (error instanceof AIRouterError) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const msg = error instanceof Error ? error.message : "Unknown error";
  return new Response(
    JSON.stringify({ error: msg }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
