/**
 * Shared browser/Edge contract for prospective preproduction packs.
 * Generated content cannot supply the server-owned identity or provenance.
 * The source hash covers ContentContext Fountain UTF-8, not an admitted file.
 * This module deliberately has no runtime dependencies or provider effects.
 */
export const PREPRODUCTION_V2_MAX_BYTES = 2 * 1024 * 1024;
export const PREPRODUCTION_TRACKS_V2 = [
  "live_action",
  "animation",
  "ai_generation",
] as const;
export type PreproductionTrackV2 = (typeof PREPRODUCTION_TRACKS_V2)[number];

export interface PreproductionContentV2 {
  summary: {
    logline: string;
    tone?: string;
    format?: string;
    primary_locations?: string[];
  };
  live_action?: {
    crew_notes?: string;
    locations?: {
      name: string;
      type?: string;
      scenes: number[];
      notes?: string;
    }[];
    scenes: {
      scene_index: number;
      slug: string;
      page_estimate?: number;
      intent?: string;
      shots: {
        shot: string;
        framing: string;
        lens_mm?: number;
        movement?: string;
        description: string;
        beat?: string;
      }[];
    }[];
  };
  animation?: {
    style_target?: string;
    character_sheets?: {
      name: string;
      silhouette?: string;
      palette?: string[];
      expression_range?: string[];
    }[];
    key_frames: {
      scene_index: number;
      frame: string;
      shot: string;
      description: string;
      staging?: string;
    }[];
    pipeline_notes?: string;
  };
  ai_generation?: {
    style_prompt: string;
    negative_prompt?: string;
    aspect_ratio?: string;
    continuity_tokens?: {
      token: string;
      refers_to: string;
      description?: string;
    }[];
    shot_prompts: {
      scene_index: number;
      shot: string;
      image_prompt: string;
      motion_prompt?: string;
      seed_hint?: string;
    }[];
  };
  open_questions: string[];
}

export interface PreproductionEnvelopeV2 {
  schema_version: "filmstack-preproduction-pack/v2";
  package_id: string;
  document_state: "PROSPECTIVE_DRAFT";
  authority_state: "NO_EXTERNAL_AUTHORITY";
  basis: {
    project_id: string;
    entry_id: string;
    context_bundle_id: string;
    context_hash: string;
    source_hash: string;
    source_hash_scope: "CONTENT_CONTEXT_FOUNTAIN_UTF8";
  };
  tracks: PreproductionTrackV2[];
  generation: {
    generated_at: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost_cents: number;
  };
  content: PreproductionContentV2;
}

export class PreproductionPackV2Error extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = "PreproductionPackV2Error";
    this.path = path;
  }
}

type ValueParser = (raw: unknown, path: string) => unknown;
type Fields = Record<string, ValueParser>;
const own = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function fail(path: string, reason: string): never {
  throw new PreproductionPackV2Error(path, reason);
}

/** Read data properties only; all returned objects/arrays are fresh copies. */
function shape(required: Fields, optional: Fields = {}): ValueParser {
  return (raw, path) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return fail(path, "Expected an object");
    }
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail(path, "Expected a plain JSON object");
    }
    if (Object.getOwnPropertySymbols(raw).length) {
      return fail(path, "Symbol properties are not JSON fields");
    }
    const properties = Object.getOwnPropertyDescriptors(raw);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(properties)) {
      if (!own(required, key) && !own(optional, key)) {
        return fail(`${path}.${key}`, "Unexpected field");
      }
      const property = properties[key];
      if (!property.enumerable || !own(property, "value")) {
        return fail(`${path}.${key}`, "Expected an enumerable JSON data field");
      }
      result[key] = (required[key] ?? optional[key])(property.value, `${path}.${key}`);
    }
    for (const key of Object.keys(required)) {
      if (!own(properties, key)) return fail(`${path}.${key}`, "Required field is missing");
    }
    return result;
  };
}

const text = (max: number, nonblank = false): ValueParser => (raw, path) => {
  if (typeof raw !== "string" || raw.length > max || (nonblank && !raw.trim())) {
    return fail(path, `Expected ${nonblank ? "nonblank " : ""}text of at most ${max} characters`);
  }
  return raw;
};

const number = (min: number, max: number, integer = false, exclusiveMin = false): ValueParser =>
  (raw, path) => {
    if (
      typeof raw !== "number" || !Number.isFinite(raw) ||
      (integer && !Number.isSafeInteger(raw)) || raw > max ||
      (exclusiveMin ? raw <= min : raw < min)
    ) {
      return fail(path, `Expected a finite ${integer ? "safe integer" : "number"} in bounds`);
    }
    // PostgreSQL and JavaScript must emit the same numeric bytes. Admit safe
    // integers or plain decimal fractions with at most six printed places;
    // exponent notation and extra precision are outside this pack contract.
    if (!Number.isSafeInteger(raw) && !/^-?\d+\.\d{1,6}$/.test(JSON.stringify(raw))) {
      return fail(path, "Expected a safe integer or a plain decimal with at most six fractional digits");
    }
    return raw;
  };

const literal = (expected: string): ValueParser => (raw, path) => {
  if (raw !== expected) return fail(path, `Expected ${expected}`);
  return raw;
};

const matchingText = (pattern: RegExp, description: string): ValueParser => (raw, path) => {
  if (typeof raw !== "string" || !pattern.test(raw)) return fail(path, `Expected ${description}`);
  return raw;
};

const list = (item: ValueParser, max: number, min = 0): ValueParser => (raw, path) => {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) {
    return fail(path, `Expected an array containing ${min} to ${max} items`);
  }
  if (
    Object.getOwnPropertyNames(raw).length !== raw.length + 1 ||
    Object.getOwnPropertySymbols(raw).length
  ) {
    return fail(path, "Expected a dense JSON array without extra properties");
  }
  const result: unknown[] = [];
  for (let index = 0; index < raw.length; index++) {
    const property = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!property?.enumerable || !own(property, "value")) {
      return fail(`${path}[${index}]`, "Expected a JSON array item");
    }
    result.push(item(property.value, `${path}[${index}]`));
  }
  return result;
};

const sceneIndex = number(1, 10_000, true);
const shot = shape(
  { shot: text(80, true), framing: text(200, true), description: text(10_000, true) },
  { lens_mm: number(0, 1_000, false, true), movement: text(500), beat: text(5_000) },
);
const scene = shape(
  { scene_index: sceneIndex, slug: text(500, true), shots: list(shot, 10, 1) },
  { page_estimate: number(0, 10_000), intent: text(5_000) },
);
const summary = shape(
  { logline: text(5_000, true) },
  { tone: text(1_000), format: text(500), primary_locations: list(text(500, true), 100) },
);
const liveAction = shape(
  { scenes: list(scene, 40, 1) },
  {
    crew_notes: text(20_000),
    locations: list(shape(
      { name: text(500, true), scenes: list(sceneIndex, 40) },
      { type: text(200), notes: text(5_000) },
    ), 100),
  },
);
const animation = shape(
  {
    key_frames: list(shape(
      { scene_index: sceneIndex, frame: text(200, true), shot: text(80, true), description: text(10_000, true) },
      { staging: text(10_000) },
    ), 400),
  },
  {
    style_target: text(5_000),
    character_sheets: list(shape(
      { name: text(500, true) },
      {
        silhouette: text(5_000),
        palette: list(text(100), 32),
        expression_range: list(text(500), 64),
      },
    ), 100),
    pipeline_notes: text(20_000),
  },
);
const aiGeneration = shape(
  {
    style_prompt: text(20_000, true),
    shot_prompts: list(shape(
      { scene_index: sceneIndex, shot: text(80, true), image_prompt: text(20_000, true) },
      { motion_prompt: text(20_000), seed_hint: text(500) },
    ), 400),
  },
  {
    negative_prompt: text(20_000),
    aspect_ratio: text(100),
    continuity_tokens: list(shape(
      { token: text(500, true), refers_to: text(2_000, true) },
      { description: text(5_000) },
    ), 200),
  },
);
const trackParsers: Record<PreproductionTrackV2, ValueParser> = {
  live_action: liveAction,
  animation,
  ai_generation: aiGeneration,
};

/** Undefined requests all tracks; invalid/duplicate requests never become defaults. */
export function parsePreproductionTracks(value: unknown = undefined): PreproductionTrackV2[] {
  if (value === undefined) return [...PREPRODUCTION_TRACKS_V2];
  const parsed = list((raw, path) => {
    if (typeof raw !== "string" || !PREPRODUCTION_TRACKS_V2.includes(raw as PreproductionTrackV2)) {
      return fail(path, "Unknown preproduction track");
    }
    return raw;
  }, 3, 1)(value, "tracks") as PreproductionTrackV2[];
  if (new Set(parsed).size !== parsed.length) return fail("tracks", "Duplicate preproduction track");
  return PREPRODUCTION_TRACKS_V2.filter((track) => parsed.includes(track));
}

function unique(seen: Set<string | number>, identity: string | number, path: string): void {
  if (seen.has(identity)) fail(path, "Duplicate identity");
  seen.add(identity);
}

function assertContentLinks(content: PreproductionContentV2): void {
  const sceneIds = new Set<string | number>();
  const liveShots = new Set<string>();
  for (const [sceneOffset, current] of (content.live_action?.scenes ?? []).entries()) {
    const scenePath = `content.live_action.scenes[${sceneOffset}]`;
    unique(sceneIds, current.scene_index, `${scenePath}.scene_index`);
    const shotIds = new Set<string | number>();
    for (const [shotOffset, currentShot] of current.shots.entries()) {
      unique(shotIds, currentShot.shot.toLowerCase(), `${scenePath}.shots[${shotOffset}].shot`);
      liveShots.add(`${current.scene_index}:${currentShot.shot}`);
    }
  }
  const locationNames = new Set<string | number>();
  for (const [offset, location] of (content.live_action?.locations ?? []).entries()) {
    const locationPath = `content.live_action.locations[${offset}]`;
    unique(locationNames, location.name.toLowerCase(), `${locationPath}.name`);
    const references = new Set<string | number>();
    for (const [index, reference] of location.scenes.entries()) {
      unique(references, reference, `${locationPath}.scenes[${index}]`);
      if (!sceneIds.has(reference)) fail(`${locationPath}.scenes[${index}]`, "Orphan scene reference");
    }
  }
  const frameIds = new Set<string | number>();
  for (const [offset, frame] of (content.animation?.key_frames ?? []).entries()) {
    const framePath = `content.animation.key_frames[${offset}]`;
    unique(frameIds, frame.frame.toLowerCase(), `${framePath}.frame`);
    if (content.live_action && !liveShots.has(`${frame.scene_index}:${frame.shot}`)) {
      fail(`${framePath}.shot`, "Orphan frame reference; expected an exact live-action scene and shot");
    }
  }
  const characters = new Set<string | number>();
  for (const [offset, character] of (content.animation?.character_sheets ?? []).entries()) {
    unique(characters, character.name.toLowerCase(), `content.animation.character_sheets[${offset}].name`);
  }
  const promptIds = new Set<string | number>();
  for (const [offset, prompt] of (content.ai_generation?.shot_prompts ?? []).entries()) {
    const promptPath = `content.ai_generation.shot_prompts[${offset}]`;
    unique(promptIds, `${prompt.scene_index}:${prompt.shot.toLowerCase()}`, `${promptPath}.shot`);
    if (content.live_action && !liveShots.has(`${prompt.scene_index}:${prompt.shot}`)) {
      fail(`${promptPath}.shot`, "Orphan prompt reference; expected an exact live-action scene and shot");
    }
  }
  const tokens = new Set<string | number>();
  for (const [offset, token] of (content.ai_generation?.continuity_tokens ?? []).entries()) {
    unique(tokens, token.token.toLowerCase(), `content.ai_generation.continuity_tokens[${offset}].token`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function boundedSerialization(value: unknown, path: string): string {
  const result = `${canonicalJson(value)}\n`;
  if (new TextEncoder().encode(result).byteLength > PREPRODUCTION_V2_MAX_BYTES) {
    return fail(path, "Canonical UTF-8 document exceeds the 2 MiB limit");
  }
  return result;
}

/** Model-owned content only. Metadata, omitted tracks, and extra tracks fail closed. */
export function parseGeneratedPreproductionContent(
  raw: unknown,
  tracks: readonly PreproductionTrackV2[],
): PreproductionContentV2 {
  const selected = parsePreproductionTracks(tracks);
  const fields: Fields = { summary, open_questions: list(text(10_000), 100) };
  for (const track of selected) fields[track] = trackParsers[track];
  const content = shape(fields)(raw, "content") as unknown as PreproductionContentV2;
  assertContentLinks(content);
  boundedSerialization(content, "content");
  return content;
}

const uuid = matchingText(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  "a UUID",
);
const sha256 = matchingText(/^[0-9a-f]{64}$/, "a lowercase SHA-256 hash");
const isoUtc: ValueParser = (raw, path) => {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
    return fail(path, "Expected an ISO UTC timestamp ending in Z");
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== raw.slice(0, 19)) {
    return fail(path, "Expected a valid ISO UTC timestamp");
  }
  return raw;
};
const envelopeShape = shape({
  schema_version: literal("filmstack-preproduction-pack/v2"),
  package_id: uuid,
  document_state: literal("PROSPECTIVE_DRAFT"),
  authority_state: literal("NO_EXTERNAL_AUTHORITY"),
  basis: shape({
    project_id: uuid,
    entry_id: uuid,
    context_bundle_id: uuid,
    context_hash: sha256,
    source_hash: sha256,
    source_hash_scope: literal("CONTENT_CONTEXT_FOUNTAIN_UTF8"),
  }),
  tracks: (raw) => {
    if (raw === undefined) return fail("tracks", "An envelope must explicitly declare its tracks");
    return parsePreproductionTracks(raw);
  },
  generation: shape({
    generated_at: isoUtc,
    model: text(500, true),
    prompt_tokens: number(0, Number.MAX_SAFE_INTEGER, true),
    completion_tokens: number(0, Number.MAX_SAFE_INTEGER, true),
    estimated_cost_cents: number(0, Number.MAX_VALUE),
  }),
  // Content is validated after the independently checked track declaration.
  content: (raw) => raw,
});

export function parsePreproductionEnvelope(raw: unknown): PreproductionEnvelopeV2 {
  const envelope = envelopeShape(raw, "pack") as unknown as PreproductionEnvelopeV2;
  envelope.content = parseGeneratedPreproductionContent(envelope.content, envelope.tracks);
  boundedSerialization(envelope, "pack");
  return envelope;
}

/** Deterministic sorted object keys, canonical track order, preserved content arrays, one LF. */
export function serializePreproductionEnvelope(raw: unknown): string {
  return boundedSerialization(parsePreproductionEnvelope(raw), "pack");
}
