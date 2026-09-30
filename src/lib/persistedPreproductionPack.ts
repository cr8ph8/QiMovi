import { canonicalJson } from "@/lib/canonicalJson";
import { preproductionPackSchema, type PrepPack } from "@/lib/preproductionPack";
import {
  parsePreproductionEnvelope,
  serializePreproductionEnvelope,
  type PreproductionEnvelopeV2,
} from "../../supabase/functions/_shared/preproduction-pack-v2";

export interface PersistedPreproductionPack {
  readonly pack: PrepPack;
  readonly canonicalText: string | null;
  readonly sha256: string | null;
  readonly envelope: PreproductionEnvelopeV2 | null;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Display projection only. Downloads always use the stored envelope text. */
function displayPack(envelope: PreproductionEnvelopeV2): PrepPack {
  const content = structuredClone(envelope.content);
  if (content.animation) {
    // Legacy rendering uses frame labels; retain shot identity in the envelope.
    content.animation.key_frames = content.animation.key_frames.map(frame => {
      const { shot: _shot, ...display } = frame;
      return display as typeof frame;
    });
  }
  return preproductionPackSchema.parse({
    ...content,
    _meta: {
      ...envelope.generation,
      tracks: envelope.tracks,
      context_hash: envelope.basis.context_hash,
      context_bundle_id: envelope.basis.context_bundle_id,
      source_entry_id: envelope.basis.entry_id,
    },
  });
}

/** Validate both immediate Edge responses and rows retrieved after reopening. */
export async function readPersistedPreproductionPack(input: {
  payload: unknown;
  canonicalText: unknown;
  sha256: unknown;
  artifactId: string;
  version: number;
  projectId: string;
  entryId?: string | null;
}): Promise<PersistedPreproductionPack> {
  const payload = input.payload;
  if (!Number.isSafeInteger(input.version) || input.version < 1 ||
      !/^[0-9a-f-]{36}$/i.test(input.artifactId)) throw new Error("Invalid artifact identity");
  const versioned = payload && typeof payload === "object" && "schema_version" in payload;
  if (!versioned) {
    if (input.canonicalText != null || input.sha256 != null) throw new Error("Legacy pack has unexpected exact-byte fields");
    const pack = preproductionPackSchema.parse(payload);
    return freeze({ pack: { ...pack, _artifact_id: input.artifactId, _version: input.version }, canonicalText: null, sha256: null, envelope: null });
  }
  const envelope = parsePreproductionEnvelope(payload);
  if (envelope.basis.project_id !== input.projectId ||
      (input.entryId && envelope.basis.entry_id !== input.entryId)) throw new Error("Pack belongs to a different project or entry");
  if (typeof input.canonicalText !== "string" || typeof input.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("Exact pack bytes are unavailable");
  if (serializePreproductionEnvelope(envelope) !== input.canonicalText ||
      canonicalJson(JSON.parse(input.canonicalText)) !== canonicalJson(payload)) throw new Error("Stored pack bytes and payload disagree");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.canonicalText));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== input.sha256) throw new Error("Stored pack hash does not match its exact bytes");
  return freeze({
    pack: { ...displayPack(envelope), _artifact_id: input.artifactId, _version: input.version },
    canonicalText: input.canonicalText,
    sha256: hash,
    envelope,
  });
}

export function persistedPreproductionDownloadText(value: PersistedPreproductionPack): string {
  return value.canonicalText ?? `${JSON.stringify(value.pack, null, 2)}\n`;
}
