/**
 * Shared Governance Utilities — CanIScreenwrite
 *
 * CANONICAL SOURCE-OF-TRUTH CONTRACT:
 * ────────────────────────────────────
 * screenplay_versions  → Creative lineage truth (version tree, parent/child, text hashes)
 * governance_events    → Governance truth (AI routing, judge calls, safety filters, policy checks)
 * provenance_nodes/edges → Provenance graph truth (knowledge lineage, influence graph)
 * artifacts/artifact_metrics → Artifact truth (computed interpretations, aggregated metrics)
 * influence_scores     → Per-version raw scores (complements artifact_metrics which are per-artifact)
 * ai_usage_log         → Model telemetry truth (model, tokens, latency, cost, routing)
 * audit_log            → Platform/system audit truth (permissions, billing, feature toggles, admin actions)
 *
 * LOG DISCIPLINE RULES:
 * ─────────────────────
 * • governance_events:  reasoning layer (AI decisions, evaluation results, routing context)
 * • audit_log:          trigger layer (user/system actions: token ops, config changes, admin events)
 * • ai_usage_log:       telemetry layer (inference metadata: model, tokens, cost, latency)
 * • NEVER write the same event to both governance_events AND audit_log
 * • Link governance_events ↔ ai_usage_log using shared execution_id
 *
 * EVIDENCE BUNDLE v1 CONTRACT (frozen):
 * ─────────────────────────────────────
 * {
 *   project_id, project_title, creation_timeline[],
 *   authorship_continuity_score, ai_influence_ratio, human_contribution_ratio,
 *   primary_creator_id, contributors[], version_graph_hash, governance_audit_hash,
 *   confidentiality_mode, provenance_summary: { nodes_count, edges_count },
 *   evidence_bundle_hash, generated_at
 * }
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Text hashing (SHA-256) ───

async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Version Snapshots ───

export interface VersionSnapshotInput {
  entryId: string;
  parentVersionId?: string | null;
  sourceType: string; // human_edit, ai_rewrite, import, submission_snapshot, review_snapshot
  actorType: string;  // user, ai, admin, system
  actorId?: string | null;
  textContent: string;
}

export async function createVersionSnapshot(
  supabase: SupabaseClient,
  input: VersionSnapshotInput,
): Promise<{ id: string; text_hash: string } | null> {
  try {
    const textHash = await hashText(input.textContent);
    const textExcerpt = input.textContent.slice(0, 500);

    const { data, error } = await supabase
      .from("screenplay_versions")
      .insert({
        entry_id: input.entryId,
        parent_version_id: input.parentVersionId || null,
        source_type: input.sourceType,
        actor_type: input.actorType,
        actor_id: input.actorId || null,
        text_hash: textHash,
        text_excerpt: textExcerpt,
      })
      .select("id, text_hash")
      .single();

    if (error) {
      console.error("[governance] Version snapshot error:", error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error("[governance] Version snapshot exception:", e);
    return null;
  }
}

// ─── Governance Events ───

export interface GovernanceEventInput {
  entryId?: string | null;
  versionId?: string | null;
  eventType: string;
  eventStatus?: string;
  provider?: string | null;
  modelName?: string | null;
  routingReason?: string | null;
  privacyMode?: string | null;
  executionId?: string | null;
  metadata?: Record<string, any>;
}

export async function emitGovernanceEvent(
  supabase: SupabaseClient,
  input: GovernanceEventInput,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("governance_events")
      .insert({
        entry_id: input.entryId || null,
        version_id: input.versionId || null,
        event_type: input.eventType,
        event_status: input.eventStatus || "recorded",
        provider: input.provider || null,
        model_name: input.modelName || null,
        routing_reason: input.routingReason || null,
        privacy_mode: input.privacyMode || null,
        execution_id: input.executionId || null,
        metadata_json: input.metadata || {},
      })
      .select("id")
      .single();

    if (error) {
      console.error("[governance] Event emit error:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.error("[governance] Event emit exception:", e);
    return null;
  }
}

/** Batch-emit multiple governance events in a single insert */
export async function emitGovernanceEvents(
  supabase: SupabaseClient,
  events: GovernanceEventInput[],
): Promise<void> {
  try {
    const rows = events.map((e) => ({
      entry_id: e.entryId || null,
      version_id: e.versionId || null,
      event_type: e.eventType,
      event_status: e.eventStatus || "recorded",
      provider: e.provider || null,
      model_name: e.modelName || null,
      routing_reason: e.routingReason || null,
      privacy_mode: e.privacyMode || null,
      execution_id: e.executionId || null,
      metadata_json: e.metadata || {},
    }));
    const { error } = await supabase.from("governance_events").insert(rows);
    if (error) console.error("[governance] Batch event emit error:", error.message);
  } catch (e) {
    console.error("[governance] Batch event emit exception:", e);
  }
}

// ─── Provenance Graph ───

export interface ProvenanceNodeInput {
  entryId: string;
  nodeType: string; // version, rewrite_event, review_output, submission_milestone
  relatedVersionId?: string | null;
  relatedEventId?: string | null;
  label: string;
  metadata?: Record<string, any>;
}

export async function addProvenanceNode(
  supabase: SupabaseClient,
  input: ProvenanceNodeInput,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("provenance_nodes")
      .insert({
        entry_id: input.entryId,
        node_type: input.nodeType,
        related_version_id: input.relatedVersionId || null,
        related_event_id: input.relatedEventId || null,
        label: input.label,
        metadata_json: input.metadata || {},
      })
      .select("id")
      .single();

    if (error) {
      console.error("[governance] Provenance node error:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.error("[governance] Provenance node exception:", e);
    return null;
  }
}

export interface ProvenanceEdgeInput {
  entryId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string; // transformed_by, reviewed_by, derived_from, submitted_as
  metadata?: Record<string, any>;
}

export async function addProvenanceEdge(
  supabase: SupabaseClient,
  input: ProvenanceEdgeInput,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("provenance_edges")
      .insert({
        entry_id: input.entryId,
        from_node_id: input.fromNodeId,
        to_node_id: input.toNodeId,
        edge_type: input.edgeType,
        metadata_json: input.metadata || {},
      })
      .select("id")
      .single();

    if (error) {
      console.error("[governance] Provenance edge error:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.error("[governance] Provenance edge exception:", e);
    return null;
  }
}

// ─── Heuristic Influence Scoring ───

export interface InfluenceScores {
  semanticDrift: number;
  voiceStability: number;
  originalityDistance: number;
  structuralIntegrity: number;
  aiInfluence: number;
}

/**
 * Compute lightweight heuristic influence scores between input and output text.
 * All scores are 0-1 where higher means MORE change/influence.
 */
export function computeHeuristicInfluence(inputText: string, outputText: string): InfluenceScores {
  const inputLen = inputText.length;
  const outputLen = outputText.length;

  if (inputLen === 0 && outputLen === 0) {
    return { semanticDrift: 0, voiceStability: 1, originalityDistance: 0, structuralIntegrity: 1, aiInfluence: 0 };
  }

  // Character-level diff ratio (Levenshtein approximation via shared substring ratio)
  const inputWords = inputText.toLowerCase().split(/\s+/).filter(Boolean);
  const outputWords = outputText.toLowerCase().split(/\s+/).filter(Boolean);
  const inputSet = new Set(inputWords);
  const outputSet = new Set(outputWords);
  const shared = [...inputSet].filter((w) => outputSet.has(w)).length;
  const totalUnique = new Set([...inputSet, ...outputSet]).size;
  const jaccardSimilarity = totalUnique > 0 ? shared / totalUnique : 1;

  // Length change ratio
  const lengthRatio = Math.abs(inputLen - outputLen) / Math.max(inputLen, outputLen, 1);

  // N-gram overlap (bigrams)
  const inputBigrams = getBigrams(inputWords);
  const outputBigrams = getBigrams(outputWords);
  const sharedBigrams = [...inputBigrams].filter((b) => outputBigrams.has(b)).length;
  const totalBigrams = new Set([...inputBigrams, ...outputBigrams]).size;
  const bigramSimilarity = totalBigrams > 0 ? sharedBigrams / totalBigrams : 1;

  // Line structure comparison
  const inputLines = inputText.split("\n").length;
  const outputLines = outputText.split("\n").length;
  const structuralChange = Math.abs(inputLines - outputLines) / Math.max(inputLines, outputLines, 1);

  const semanticDrift = clamp(1 - jaccardSimilarity);
  const voiceStability = clamp(bigramSimilarity);
  const originalityDistance = clamp(1 - bigramSimilarity * 0.6 - jaccardSimilarity * 0.4);
  const structuralIntegrity = clamp(1 - structuralChange);
  const aiInfluence = clamp(
    semanticDrift * 0.3 + (1 - voiceStability) * 0.2 + originalityDistance * 0.2 + lengthRatio * 0.3,
  );

  return {
    semanticDrift: round4(semanticDrift),
    voiceStability: round4(voiceStability),
    originalityDistance: round4(originalityDistance),
    structuralIntegrity: round4(structuralIntegrity),
    aiInfluence: round4(aiInfluence),
  };
}

function getBigrams(words: string[]): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

function clamp(val: number): number {
  return Math.max(0, Math.min(1, val));
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

// ─── Scoring Label Helpers ───

/** Returns high/moderate/low based on continuity score thresholds */
export function computeContinuityLabel(score: number): string {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "moderate";
  return "low";
}

/** Returns high/moderate/low based on voice stability score thresholds */
export function computeVoiceStabilityLabel(score: number): string {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "moderate";
  return "low";
}

/** Returns low/moderate/high risk based on originality distance */
export function computeOriginalityRiskLabel(distance: number): string {
  if (distance < 0.3) return "low";
  if (distance < 0.6) return "moderate";
  return "high";
}

/**
 * Detect structural flags by comparing text_excerpts across versions.
 * Parses for scene headings (INT./EXT.) and character cues (uppercase names).
 */
export function detectStructuralFlags(versions: any[]): string[] {
  const flags: string[] = [];
  if (versions.length < 2) return flags;

  const extractSceneHeadings = (text: string): string[] => {
    if (!text) return [];
    return (text.match(/^(INT\.|EXT\.|INT\/EXT\.).*/gim) || []).map((s) => s.trim().toUpperCase());
  };

  const extractCharacters = (text: string): Set<string> => {
    if (!text) return new Set();
    const matches = text.match(/^[A-Z][A-Z\s]{2,}$/gm) || [];
    return new Set(matches.map((m) => m.trim()));
  };

  const first = versions[0];
  const last = versions[versions.length - 1];

  const firstScenes = extractSceneHeadings(first.text_excerpt || "");
  const lastScenes = extractSceneHeadings(last.text_excerpt || "");
  if (firstScenes.length !== lastScenes.length && firstScenes.length > 0) {
    flags.push("scene_count_changed");
  }

  const firstChars = extractCharacters(first.text_excerpt || "");
  const lastChars = extractCharacters(last.text_excerpt || "");
  const droppedChars = [...firstChars].filter((c) => !lastChars.has(c));
  if (droppedChars.length > 0) {
    flags.push("character_dropped");
  }

  // Dialogue/action ratio shift detection (approximate via line patterns)
  const countDialogueLines = (text: string): number => {
    if (!text) return 0;
    return (text.match(/^[A-Z][A-Z\s]{2,}$/gm) || []).length;
  };
  const firstDialogueRatio = first.text_excerpt ? countDialogueLines(first.text_excerpt) / Math.max((first.text_excerpt || "").split("\n").length, 1) : 0;
  const lastDialogueRatio = last.text_excerpt ? countDialogueLines(last.text_excerpt) / Math.max((last.text_excerpt || "").split("\n").length, 1) : 0;
  if (Math.abs(firstDialogueRatio - lastDialogueRatio) > 0.2) {
    flags.push("dialogue_ratio_shifted");
  }

  return flags;
}

// ─── Store Influence Scores ───

export interface StoreInfluenceInput {
  entryId: string;
  versionId: string;
  scores: InfluenceScores;
  method?: string;
  metadata?: Record<string, any>;
}

export async function storeInfluenceScores(
  supabase: SupabaseClient,
  input: StoreInfluenceInput,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("influence_scores")
      .insert({
        entry_id: input.entryId,
        version_id: input.versionId,
        semantic_drift_score: input.scores.semanticDrift,
        voice_stability_score: input.scores.voiceStability,
        originality_distance_score: input.scores.originalityDistance,
        structural_integrity_score: input.scores.structuralIntegrity,
        ai_influence_score: input.scores.aiInfluence,
        scoring_method: input.method || "heuristic_v1",
        metadata_json: input.metadata || {},
      })
      .select("id")
      .single();

    if (error) {
      console.error("[governance] Influence score error:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.error("[governance] Influence score exception:", e);
    return null;
  }
}

/**
 * Run full governance pipeline for an AI rewrite operation.
 * Creates versions, events, provenance, and influence scores.
 * All operations are fire-and-forget safe (errors are logged, not thrown).
 */
export async function recordRewriteGovernance(
  supabase: SupabaseClient,
  params: {
    entryId: string;
    inputText: string;
    outputText: string;
    action: string;
    modelUsed: string;
    provider: string;
    userId?: string | null;
    sensitivity?: string;
    correlationId?: string;
  },
): Promise<{ versionId: string | null; executionId: string }> {
  const { entryId, inputText, outputText, action, modelUsed, provider, userId, sensitivity, correlationId } = params;

  // Generate shared execution_id for cross-table traceability
  const executionId = crypto.randomUUID();

  // 1. Create version snapshot of the output
  const version = await createVersionSnapshot(supabase, {
    entryId,
    sourceType: "ai_rewrite",
    actorType: "ai",
    actorId: null,
    textContent: outputText,
  });

  const versionId = version?.id || null;

  // 2. Emit governance events (reasoning layer — NOT audit_log)
  await emitGovernanceEvents(supabase, [
    { entryId, versionId, eventType: "ai_request_received", provider, modelName: modelUsed, privacyMode: sensitivity, executionId, metadata: { action, correlation_id: correlationId } },
    { entryId, versionId, eventType: "provider_called", provider, modelName: modelUsed, executionId },
    { entryId, versionId, eventType: "model_output_received", provider, modelName: modelUsed, executionId, metadata: { output_length: outputText.length } },
  ]);

  // 3. Compute and store influence scores
  if (versionId) {
    const scores = computeHeuristicInfluence(inputText, outputText);
    await storeInfluenceScores(supabase, {
      entryId,
      versionId,
      scores,
      metadata: { action, model: modelUsed },
    });

    // 4. Build provenance graph
    const inputNode = await addProvenanceNode(supabase, {
      entryId,
      nodeType: "version",
      label: `Pre-${action} text`,
      metadata: { source: "input" },
    });

    const outputNode = await addProvenanceNode(supabase, {
      entryId,
      nodeType: "rewrite_event",
      relatedVersionId: versionId,
      label: `AI ${action} output`,
      metadata: { model: modelUsed, action },
    });

    if (inputNode && outputNode) {
      await addProvenanceEdge(supabase, {
        entryId,
        fromNodeId: inputNode,
        toNodeId: outputNode,
        edgeType: "transformed_by",
        metadata: { action, model: modelUsed },
      });
    }
  }

  return { versionId, executionId };
}
