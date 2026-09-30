import { supabase } from "@/integrations/supabase/client";
import type { PersistedPreproductionPack } from "@/lib/persistedPreproductionPack";
import {
  freezeRehearsal, parseRehearsalDraft, parseRehearsalDraftText, serializeRehearsalDraft,
  REHEARSAL_UUID, REHEARSAL_SHA256, type RehearsalDraft,
} from "../../supabase/functions/_shared/rehearsal-draft-v1";

export { serializeRehearsalDraft, type RehearsalDraft };

export interface RehearsalRecord {
  readonly draftId: string;
  readonly version: number;
  readonly text: string;
  readonly sha256: string;
  readonly draft: RehearsalDraft;
  readonly replayed: boolean;
  readonly basisState: "CURRENT_PACK" | "SUPERSEDED_PACK";
}

export interface RehearsalShot {
  sceneIndex: number;
  shot: string;
  description: string;
  frameLabels: string[];
  promptCount: number;
}

export function listRehearsalShots(pack: PersistedPreproductionPack): RehearsalShot[] {
  const content = pack.envelope?.content;
  if (!content) return [];
  return (content.live_action?.scenes ?? []).flatMap(scene => scene.shots.map(shot => ({
    sceneIndex: scene.scene_index,
    shot: shot.shot,
    description: shot.description,
    frameLabels: (content.animation?.key_frames ?? [])
      .filter(frame => frame.scene_index === scene.scene_index && frame.shot === shot.shot).map(frame => frame.frame),
    promptCount: (content.ai_generation?.shot_prompts ?? [])
      .filter(prompt => prompt.scene_index === scene.scene_index && prompt.shot === shot.shot).length,
  })));
}

export function rehearsalMatchesPack(draft: RehearsalDraft, pack: PersistedPreproductionPack): boolean {
  const envelope = pack.envelope;
  if (!envelope || !pack.canonicalText || !pack.sha256) return false;
  const b = draft.basis;
  return b.project_id === envelope.basis.project_id && b.entry_id === envelope.basis.entry_id &&
    b.artifact_id === pack.pack._artifact_id && b.artifact_version === pack.pack._version &&
    b.pack_sha256 === pack.sha256 && b.package_id === envelope.package_id &&
    b.context_bundle_id === envelope.basis.context_bundle_id && b.context_hash === envelope.basis.context_hash &&
    b.source_hash === envelope.basis.source_hash && b.source_hash_scope === envelope.basis.source_hash_scope &&
    listRehearsalShots(pack).some(shot => shot.sceneIndex === draft.target.scene_index && shot.shot === draft.target.shot);
}

export function createRehearsalDraft(pack: PersistedPreproductionPack, input: {
  proposalId: string; sceneIndex: number; shot: string; note: string;
}): RehearsalDraft {
  if (!pack.envelope || !pack.canonicalText || !pack.sha256) throw new Error("A verified v2 pack is required for rehearsal");
  const draft = parseRehearsalDraft({
    schema_version: "filmstack-rehearsal-draft/v1",
    proposal_id: input.proposalId,
    document_state: "REVIEW_DRAFT", authority_state: "NO_EXTERNAL_AUTHORITY",
    basis: {
      ...pack.envelope.basis,
      artifact_id: pack.pack._artifact_id, artifact_version: pack.pack._version,
      pack_sha256: pack.sha256, package_id: pack.envelope.package_id,
    },
    target: { scene_index: input.sceneIndex, shot: input.shot },
    change: { kind: "ADD_PAUSE", duration_ms: 2000, timing_basis: "PROPOSED_ADDITION" },
    note: input.note,
  });
  if (!rehearsalMatchesPack(draft, pack)) throw new Error("The rehearsal shot does not belong to this pack");
  return draft;
}

// This narrow transport boundary precedes regeneration of database types on staging.
// It does not modify or claim to regenerate the generated Supabase type file.
const database = supabase as unknown as {
  rpc(name: "read_rehearsal_draft_v1" | "save_rehearsal_draft_v1", args: Record<string, unknown>):
    PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

function checkScope(projectId: string, entryId: string) {
  if (!REHEARSAL_UUID.test(projectId) || !REHEARSAL_UUID.test(entryId)) throw new Error("Invalid rehearsal project or entry");
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function transportError(error: { message?: string; code?: string }): Error {
  const message = error.message ?? "";
  if (/disabled/.test(message) || error.code === "PGRST202" || /does not exist/.test(message)) {
    return new Error("Saved rehearsals are not enabled in this environment.");
  }
  if (/conflict/.test(message)) return new Error("Another rehearsal was saved. Reload the saved draft before trying again.");
  if (/stale|superseded|not_current/.test(message)) return new Error("The source pack changed. Reopen the current pack to start a new proposal.");
  if (/access|owner|actor|permission|authenticated/.test(message)) return new Error("You do not have access to saved rehearsals for this project.");
  return new Error("The rehearsal could not be saved or read. Your proposal is still available to retry.");
}

export async function verifyRehearsalRecord(raw: unknown, projectId: string, entryId: string): Promise<RehearsalRecord> {
  checkScope(projectId, entryId);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Object.getOwnPropertySymbols(raw).length) {
    throw new Error("Invalid saved rehearsal response");
  }
  const fields = ["draft_id", "version", "draft_text", "draft_sha256", "replayed", "basis_state"];
  const properties = Object.getOwnPropertyDescriptors(raw);
  if (Object.keys(properties).length !== fields.length) throw new Error("Invalid saved rehearsal response");
  const row: Record<string, unknown> = {};
  for (const key of fields) {
    const property = properties[key];
    if (!property?.enumerable || !("value" in property)) throw new Error("Invalid saved rehearsal response");
    row[key] = property.value;
  }
  if (typeof row.draft_id !== "string" || !REHEARSAL_UUID.test(row.draft_id) ||
      typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1 || row.version > 2147483647 ||
      typeof row.draft_text !== "string" || typeof row.draft_sha256 !== "string" || !REHEARSAL_SHA256.test(row.draft_sha256) ||
      typeof row.replayed !== "boolean" || typeof row.basis_state !== "string" || !["CURRENT_PACK", "SUPERSEDED_PACK"].includes(row.basis_state)) {
    throw new Error("Invalid saved rehearsal response");
  }
  // Primitive data fields were copied before validation and before async verification.
  const snapshot = row;
  const text = snapshot.draft_text as string;
  const draft = parseRehearsalDraftText(text);
  if (draft.basis.project_id !== projectId || draft.basis.entry_id !== entryId) throw new Error("Saved rehearsal belongs to another project or entry");
  if (await hashText(text) !== snapshot.draft_sha256) throw new Error("Saved rehearsal bytes do not match their hash");
  return freezeRehearsal({
    draftId: snapshot.draft_id as string, version: snapshot.version as number,
    text, sha256: snapshot.draft_sha256 as string, draft, replayed: snapshot.replayed as boolean,
    basisState: snapshot.basis_state as RehearsalRecord["basisState"],
  });
}

function rows(data: unknown): unknown[] {
  if (!Array.isArray(data) || data.length > 1) throw new Error("Unexpected rehearsal response");
  return data;
}

export async function readRehearsalDraft(projectId: string, entryId: string): Promise<RehearsalRecord | null> {
  checkScope(projectId, entryId);
  const { data, error } = await database.rpc("read_rehearsal_draft_v1", { p_project_id: projectId, p_entry_id: entryId });
  if (error) throw transportError(error);
  const records = rows(data);
  return records.length ? verifyRehearsalRecord(records[0], projectId, entryId) : null;
}

export async function saveRehearsalDraft(input: { draft: RehearsalDraft; expectedDraftId: string | null }): Promise<RehearsalRecord> {
  const draft = parseRehearsalDraft(input.draft);
  const expectedId = input.expectedDraftId;
  if (expectedId !== null && !REHEARSAL_UUID.test(expectedId)) throw new Error("Invalid prior rehearsal identity");
  const text = serializeRehearsalDraft(draft);
  const sha256 = await hashText(text);
  const { data, error } = await database.rpc("save_rehearsal_draft_v1", {
    p_project_id: draft.basis.project_id, p_entry_id: draft.basis.entry_id,
    p_expected_draft_id: expectedId, p_draft_text: text, p_draft_sha256: sha256,
  });
  if (error) throw transportError(error);
  const records = rows(data);
  if (records.length !== 1) throw new Error("The server did not confirm the saved rehearsal");
  const record = await verifyRehearsalRecord(records[0], draft.basis.project_id, draft.basis.entry_id);
  if (record.text !== text || record.sha256 !== sha256) throw new Error("The saved response does not match your proposal");
  return record;
}
