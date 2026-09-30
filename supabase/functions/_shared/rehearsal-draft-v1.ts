/** Proposed shot timing only. A draft never supplies production authority. */
export const REHEARSAL_MAX_BYTES = 32 * 1024;
export const REHEARSAL_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const REHEARSAL_SHA256 = /^[a-f0-9]{64}$/;

export interface RehearsalDraft {
  schema_version: "filmstack-rehearsal-draft/v1";
  proposal_id: string;
  document_state: "REVIEW_DRAFT";
  authority_state: "NO_EXTERNAL_AUTHORITY";
  basis: {
    project_id: string;
    entry_id: string;
    artifact_id: string;
    artifact_version: number;
    pack_sha256: string;
    package_id: string;
    context_bundle_id: string;
    context_hash: string;
    source_hash: string;
    source_hash_scope: "CONTENT_CONTEXT_FOUNTAIN_UTF8";
  };
  target: { scene_index: number; shot: string };
  change: { kind: "ADD_PAUSE"; duration_ms: 2000; timing_basis: "PROPOSED_ADDITION" };
  note: string;
}

type Parser = (value: unknown) => unknown;
function invalid(): never { throw new Error("Invalid rehearsal draft"); }

function shape(value: unknown, fields: Record<string, Parser>): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.getOwnPropertySymbols(value).length) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== Object.keys(fields).length) return invalid();
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    const property = descriptors[key];
    if (!property || !property.enumerable || !("value" in property)) return invalid();
    result[key] = fields[key](property.value);
  }
  return result;
}

const literal = (expected: string | number): Parser => value => value === expected ? value : invalid();
const matching = (pattern: RegExp): Parser => value =>
  typeof value === "string" && pattern.test(value) ? value : invalid();
const positiveInteger: Parser = value => typeof value === "number" && Number.isSafeInteger(value) &&
  value > 0 && value <= 2147483647 ? value : invalid();
const text = (max: number, nonblank = false): Parser => value => {
  if (typeof value !== "string" || value.length > max || (nonblank && !value.trim())) return invalid();
  // PostgreSQL jsonb rejects NUL and unpaired surrogates. Match that boundary.
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point === 0 || (point >= 0xd800 && point <= 0xdfff)) return invalid();
  }
  return value;
};

export function freezeRehearsal<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeRehearsal);
    Object.freeze(value);
  }
  return value;
}

export function parseRehearsalDraft(value: unknown): RehearsalDraft {
  const result = shape(value, {
    schema_version: literal("filmstack-rehearsal-draft/v1"),
    proposal_id: matching(REHEARSAL_UUID),
    document_state: literal("REVIEW_DRAFT"),
    authority_state: literal("NO_EXTERNAL_AUTHORITY"),
    basis: value => shape(value, {
      project_id: matching(REHEARSAL_UUID), entry_id: matching(REHEARSAL_UUID),
      artifact_id: matching(REHEARSAL_UUID), artifact_version: positiveInteger,
      pack_sha256: matching(REHEARSAL_SHA256), package_id: matching(REHEARSAL_UUID),
      context_bundle_id: matching(REHEARSAL_UUID), context_hash: matching(REHEARSAL_SHA256),
      source_hash: matching(REHEARSAL_SHA256), source_hash_scope: literal("CONTENT_CONTEXT_FOUNTAIN_UTF8"),
    }),
    target: value => shape(value, { scene_index: positiveInteger, shot: text(200, true) }),
    change: value => shape(value, {
      kind: literal("ADD_PAUSE"), duration_ms: literal(2000), timing_basis: literal("PROPOSED_ADDITION"),
    }),
    note: text(2000),
  }) as unknown as RehearsalDraft;
  return freezeRehearsal(result);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export function serializeRehearsalDraft(value: RehearsalDraft): string {
  const serialized = `${canonical(parseRehearsalDraft(value))}\n`;
  if (new TextEncoder().encode(serialized).byteLength > REHEARSAL_MAX_BYTES) return invalid();
  return serialized;
}

export function parseRehearsalDraftText(value: unknown): RehearsalDraft {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > REHEARSAL_MAX_BYTES) return invalid();
  const draft = parseRehearsalDraft(JSON.parse(value));
  if (serializeRehearsalDraft(draft) !== value) throw new Error("Rehearsal bytes are not canonical");
  return draft;
}
