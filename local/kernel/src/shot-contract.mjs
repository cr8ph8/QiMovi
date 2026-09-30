import crypto from "node:crypto";
import fs from "node:fs";
import { TextDecoder } from "node:util";

import {
  assertSha256,
  canonicalValue,
  cloneCanonical,
  hashCanonical,
  timingSafeHashEqual,
} from "./canonical-json.mjs";
import { SCHEMA } from "./constants.mjs";
import { invariant } from "./errors.mjs";

export const SHOT_TAXONOMY_SCHEMA_VERSION = SCHEMA.shotTaxonomy;
export const SHOT_TAXONOMY_REGISTRY_SCHEMA_VERSION = SCHEMA.shotTaxonomyRegistry;
export const SHOT_RECORD_SCHEMA_VERSION = SCHEMA.shotRecord;

export const SHOT_CATEGORY_ORDER = Object.freeze([
  "SHOT_SIZE",
  "CAMERA_ANGLE",
  "COMPOSITION",
  "CAMERA_MOVEMENT",
  "SUPPORT_RIG",
  "FOCUS_OPTICAL",
  "COVERAGE_PURPOSE",
  "CAPTURE_MODE",
]);

const CATEGORY_CODE_PREFIX = Object.freeze({
  SHOT_SIZE: "SIZE_",
  CAMERA_ANGLE: "ANGLE_",
  COMPOSITION: "COMP_",
  CAMERA_MOVEMENT: "MOVE_",
  SUPPORT_RIG: "RIG_",
  FOCUS_OPTICAL: "OPT_",
  COVERAGE_PURPOSE: "COVER_",
  CAPTURE_MODE: "CAPTURE_",
});

const RESERVED_IDENTIFIERS = "(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)";
const ID_PATTERN = new RegExp(`^(?!${RESERVED_IDENTIFIERS}$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`);
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const FPS_PATTERN = /^(?:0\.(?:0*[1-9]\d*)|[1-9]\d*(?:\.\d+)?)$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const SOURCE_FILE = "02_Production_Planning/SHOT_TAXONOMY.json";
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 8192;
const MAX_SHOT_RECORDS = 2048;

const TAXONOMY_KEYS = Object.freeze([
  "schema_version",
  "taxonomy_version",
  "updated_on",
  "boundary",
  "source_reference",
  "category_order",
  "categories",
  "reference_mapping",
  "sources",
]);
const SOURCE_REFERENCE_KEYS = Object.freeze(["label", "description", "reference_count"]);
const CATEGORY_KEYS = Object.freeze(["label", "entries"]);
const ENTRY_KEYS = Object.freeze(["code", "value", "definition", "aliases", "supplied_refs"]);
const MAPPING_KEYS = Object.freeze(["reference_number", "supplied_term", "category", "code", "clarification"]);
const SOURCE_KEYS = Object.freeze(["label", "url"]);
const SNAPSHOT_KEYS = Object.freeze(["source_sha256", "taxonomy_hash", "counts", "taxonomy"]);
const REGISTRY_KEYS = Object.freeze(["schema_version", "taxonomy", "provenance", "counts", "taxonomy_hash", "registry_hash"]);
const PROVENANCE_KEYS = Object.freeze(["source_file", "source_sha256"]);
const COUNT_KEYS = Object.freeze(["categories", "entries", "supplied_references", "sources"]);

const SHOT_RECORD_KEYS = Object.freeze([
  "schema_version",
  "shot_id",
  "title_id",
  "scene_id",
  "source_revision_hash",
  "taxonomy_ref",
  "record_state",
  "authority_state",
  "narrative",
  "taxonomy_codes",
  "custom_values",
  "capture_plan",
  "continuity",
  "constraints",
  "shot_hash",
]);
const SHOT_DRAFT_KEYS = Object.freeze(SHOT_RECORD_KEYS.filter((key) => key !== "shot_hash"));
const TAXONOMY_REF_KEYS = Object.freeze(["schema_version", "taxonomy_version", "taxonomy_hash"]);
const NARRATIVE_KEYS = Object.freeze(["story_purpose", "action", "dialogue_audio"]);
const CAPTURE_PLAN_KEYS = Object.freeze(["lens", "camera_pose", "frames_per_second", "planned_duration_ms"]);
const CONTINUITY_KEYS = Object.freeze([
  "character_states",
  "continuity_in_shot_hashes",
  "required_outcomes",
  "forbidden_outcomes",
  "location_state",
  "time_state",
  "style_state",
]);
const CHARACTER_STATE_KEYS = Object.freeze(["character_id", "state"]);
const CONSTRAINT_KEYS = Object.freeze(["production", "generation"]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function assertExactKeys(value, expected, field, code = "INVALID_SHOT_TAXONOMY") {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), code, `${field} must be an object.`);
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  invariant(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    code,
    `${field} must contain exactly: ${wanted.join(", ")}.`,
    { actual },
  );
}

function assertText(value, field, maxLength = MAX_TEXT, code = "INVALID_SHOT_TAXONOMY") {
  invariant(typeof value === "string", code, `${field} must be a string.`);
  invariant(value.length > 0 && value.length <= maxLength, code, `${field} must contain 1-${maxLength} characters.`);
  invariant(value === value.trim(), code, `${field} must not contain leading or trailing whitespace.`);
  invariant(!CONTROL_PATTERN.test(value), code, `${field} must not contain control characters.`);
}

function assertNullableText(value, field, maxLength = MAX_TEXT) {
  if (value === null) return;
  assertText(value, field, maxLength, "INVALID_SHOT_RECORD");
}

function assertSafeInteger(value, field, minimum = 0, code = "INVALID_SHOT_TAXONOMY") {
  invariant(Number.isSafeInteger(value) && value >= minimum, code, `${field} must be a safe integer of at least ${minimum}.`);
}

function isCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function assertIdentifier(value, field) {
  invariant(typeof value === "string" && ID_PATTERN.test(value), "INVALID_SHOT_RECORD", `${field} must be a safe Hampton identifier.`);
}

function assertUnique(values, field, code = "INVALID_SHOT_TAXONOMY") {
  invariant(new Set(values).size === values.length, code, `${field} must not contain duplicates.`);
}

function assertSorted(values, field, code = "INVALID_SHOT_TAXONOMY") {
  const sorted = [...values].sort(compareText);
  invariant(values.every((value, index) => value === sorted[index]), code, `${field} must be sorted in canonical code-unit order.`);
}

function assertSortedUniqueTextArray(values, field, maxItems = 128) {
  invariant(Array.isArray(values) && values.length <= maxItems, "INVALID_SHOT_RECORD", `${field} must be an array of at most ${maxItems} items.`);
  values.forEach((value, index) => assertText(value, `${field}[${index}]`, 2048, "INVALID_SHOT_RECORD"));
  assertUnique(values, field, "INVALID_SHOT_RECORD");
  assertSorted(values, field, "INVALID_SHOT_RECORD");
}

function assertSortedUniqueHashes(values, field, maxItems = 128) {
  invariant(Array.isArray(values) && values.length <= maxItems, "INVALID_SHOT_RECORD", `${field} must be an array of at most ${maxItems} items.`);
  values.forEach((value, index) => assertSha256(value, `${field}[${index}]`));
  assertUnique(values, field, "INVALID_SHOT_RECORD");
  assertSorted(values, field, "INVALID_SHOT_RECORD");
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function decodeJsonBytes(bytes, field, maxBytes) {
  invariant(Buffer.isBuffer(bytes), "INVALID_SOURCE_BYTES", `${field} must be supplied as a Buffer.`);
  invariant(bytes.length > 0 && bytes.length <= maxBytes, "INVALID_SOURCE_SIZE", `${field} must contain 1-${maxBytes} bytes.`);
  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    invariant(false, "INVALID_UTF8", `${field} must be valid UTF-8.`);
  }
  invariant(!text.startsWith("\uFEFF"), "UNEXPECTED_UTF8_BOM", `${field} must not begin with a UTF-8 BOM.`);
  invariant(!text.includes("\u0000"), "INVALID_SOURCE_TEXT", `${field} must not contain NUL characters.`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    invariant(false, "INVALID_JSON", `${field} must contain valid JSON.`);
  }
  return value;
}

function readStableRegularFile(filePath, field, maxBytes) {
  invariant(typeof filePath === "string" && filePath.length > 0, "INVALID_SOURCE_PATH", `${field} path is required.`);
  let pathStat;
  try {
    pathStat = fs.lstatSync(filePath, { bigint: true });
  } catch {
    invariant(false, "SOURCE_FILE_UNAVAILABLE", `${field} could not be opened.`);
  }
  invariant(!pathStat.isSymbolicLink() && pathStat.isFile(), "INVALID_SOURCE_FILE", `${field} must be a regular, non-symbolic-link file.`);
  invariant(pathStat.size > 0n && pathStat.size <= BigInt(maxBytes), "INVALID_SOURCE_SIZE", `${field} must contain 1-${maxBytes} bytes.`);

  let descriptor;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(descriptor, { bigint: true });
    invariant(before.isFile(), "INVALID_SOURCE_FILE", `${field} must remain a regular file.`);
    invariant(before.dev === pathStat.dev && before.ino === pathStat.ino, "SOURCE_FILE_CHANGED", `${field} changed while opening.`);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    invariant(
      before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs
        && BigInt(bytes.length) === before.size,
      "SOURCE_FILE_CHANGED",
      `${field} changed while reading.`,
    );
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function taxonomyCounts(taxonomy) {
  return {
    categories: SHOT_CATEGORY_ORDER.length,
    entries: SHOT_CATEGORY_ORDER.reduce((total, category) => total + taxonomy.categories[category].entries.length, 0),
    supplied_references: taxonomy.reference_mapping.length,
    sources: taxonomy.sources.length,
  };
}

function validateTaxonomyCanonical(taxonomy) {
  assertExactKeys(taxonomy, TAXONOMY_KEYS, "shot taxonomy");
  invariant(taxonomy.schema_version === SHOT_TAXONOMY_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `shot taxonomy schema_version must equal ${SHOT_TAXONOMY_SCHEMA_VERSION}.`);
  assertText(taxonomy.taxonomy_version, "taxonomy_version", 64);
  invariant(SEMVER_PATTERN.test(taxonomy.taxonomy_version), "INVALID_SHOT_TAXONOMY", "taxonomy_version must be a numeric semantic version.");
  assertText(taxonomy.updated_on, "updated_on", 10);
  invariant(isCalendarDate(taxonomy.updated_on), "INVALID_SHOT_TAXONOMY", "updated_on must be a valid YYYY-MM-DD date.");
  assertText(taxonomy.boundary, "boundary", 4096);

  assertExactKeys(taxonomy.source_reference, SOURCE_REFERENCE_KEYS, "source_reference");
  assertText(taxonomy.source_reference.label, "source_reference.label", 512);
  assertText(taxonomy.source_reference.description, "source_reference.description", 4096);
  assertSafeInteger(taxonomy.source_reference.reference_count, "source_reference.reference_count", 1);
  invariant(taxonomy.source_reference.reference_count <= 1000, "INVALID_SHOT_TAXONOMY", "reference_count must not exceed 1000.");

  invariant(Array.isArray(taxonomy.category_order), "INVALID_SHOT_TAXONOMY", "category_order must be an array.");
  invariant(
    taxonomy.category_order.length === SHOT_CATEGORY_ORDER.length
      && taxonomy.category_order.every((category, index) => category === SHOT_CATEGORY_ORDER[index]),
    "INVALID_SHOT_TAXONOMY",
    `category_order must be exactly: ${SHOT_CATEGORY_ORDER.join(", ")}.`,
  );
  assertExactKeys(taxonomy.categories, SHOT_CATEGORY_ORDER, "categories");

  const codeToCategory = new Map();
  const entryByCategoryAndCode = new Map();
  const suppliedReferenceOwners = new Map();
  let entryCount = 0;

  for (const category of SHOT_CATEGORY_ORDER) {
    const categoryValue = taxonomy.categories[category];
    assertExactKeys(categoryValue, CATEGORY_KEYS, `categories.${category}`);
    assertText(categoryValue.label, `categories.${category}.label`, 512);
    invariant(Array.isArray(categoryValue.entries) && categoryValue.entries.length > 0 && categoryValue.entries.length <= 256, "INVALID_SHOT_TAXONOMY", `categories.${category}.entries must contain 1-256 entries.`);
    entryCount += categoryValue.entries.length;
    const values = [];
    let customCount = 0;

    for (const [entryIndex, entry] of categoryValue.entries.entries()) {
      const field = `categories.${category}.entries[${entryIndex}]`;
      assertExactKeys(entry, ENTRY_KEYS, field);
      assertText(entry.code, `${field}.code`, 128);
      invariant(CODE_PATTERN.test(entry.code), "INVALID_SHOT_TAXONOMY", `${field}.code must be an uppercase taxonomy code.`);
      invariant(entry.code.startsWith(CATEGORY_CODE_PREFIX[category]), "SHOT_DIMENSION_MISMATCH", `${entry.code} does not belong to ${category}.`);
      invariant(!codeToCategory.has(entry.code), "INVALID_SHOT_TAXONOMY", `Taxonomy codes must be globally unique: ${entry.code}.`);
      codeToCategory.set(entry.code, category);
      entryByCategoryAndCode.set(`${category}\u0000${entry.code}`, entry);
      if (entry.code.endsWith("_CUSTOM")) customCount += 1;

      assertText(entry.value, `${field}.value`, 512);
      assertText(entry.definition, `${field}.definition`, 4096);
      values.push(entry.value);
      invariant(Array.isArray(entry.aliases) && entry.aliases.length <= 64, "INVALID_SHOT_TAXONOMY", `${field}.aliases must be an array of at most 64 items.`);
      entry.aliases.forEach((alias, aliasIndex) => assertText(alias, `${field}.aliases[${aliasIndex}]`, 512));
      assertUnique(entry.aliases, `${field}.aliases`);

      invariant(Array.isArray(entry.supplied_refs) && entry.supplied_refs.length <= taxonomy.source_reference.reference_count, "INVALID_SHOT_TAXONOMY", `${field}.supplied_refs must be a bounded array.`);
      entry.supplied_refs.forEach((reference, referenceIndex) => {
        assertSafeInteger(reference, `${field}.supplied_refs[${referenceIndex}]`, 1);
        invariant(reference <= taxonomy.source_reference.reference_count, "INVALID_SHOT_TAXONOMY", `${field}.supplied_refs contains an out-of-range reference.`);
        invariant(!suppliedReferenceOwners.has(reference), "INVALID_SHOT_TAXONOMY", `Reference ${reference} is assigned to more than one taxonomy entry.`);
        suppliedReferenceOwners.set(reference, { category, code: entry.code });
      });
      assertUnique(entry.supplied_refs, `${field}.supplied_refs`);
      invariant(entry.supplied_refs.every((value, index) => index === 0 || entry.supplied_refs[index - 1] < value), "INVALID_SHOT_TAXONOMY", `${field}.supplied_refs must be sorted numerically.`);
    }

    assertUnique(values, `categories.${category} entry values`);
    invariant(customCount === 1, "INVALID_SHOT_TAXONOMY", `${category} must contain exactly one *_CUSTOM entry.`);
  }
  invariant(entryCount <= 2048, "INVALID_SHOT_TAXONOMY", "Shot taxonomy must not exceed 2048 entries.");

  invariant(Array.isArray(taxonomy.reference_mapping), "INVALID_SHOT_TAXONOMY", "reference_mapping must be an array.");
  invariant(taxonomy.reference_mapping.length === taxonomy.source_reference.reference_count, "INVALID_SHOT_TAXONOMY", "reference_mapping must cover source_reference.reference_count exactly.");
  for (let index = 0; index < taxonomy.reference_mapping.length; index += 1) {
    const mapping = taxonomy.reference_mapping[index];
    const field = `reference_mapping[${index}]`;
    assertExactKeys(mapping, MAPPING_KEYS, field);
    invariant(mapping.reference_number === index + 1, "INVALID_SHOT_TAXONOMY", "reference_mapping must be ordered and contiguous from 1.");
    assertText(mapping.supplied_term, `${field}.supplied_term`, 512);
    invariant(SHOT_CATEGORY_ORDER.includes(mapping.category), "INVALID_SHOT_TAXONOMY", `${field}.category is not supported.`);
    assertText(mapping.code, `${field}.code`, 128);
    assertText(mapping.clarification, `${field}.clarification`, 2048);
    const entry = entryByCategoryAndCode.get(`${mapping.category}\u0000${mapping.code}`);
    invariant(entry !== undefined, codeToCategory.has(mapping.code) ? "SHOT_DIMENSION_MISMATCH" : "UNKNOWN_SHOT_CODE", `${field} does not resolve to the declared category and code.`);
    invariant(entry.supplied_refs.includes(mapping.reference_number), "INVALID_SHOT_TAXONOMY", `${field} is missing from its entry supplied_refs.`);
    const owner = suppliedReferenceOwners.get(mapping.reference_number);
    invariant(owner?.category === mapping.category && owner?.code === mapping.code, "INVALID_SHOT_TAXONOMY", `${field} disagrees with its entry supplied_refs.`);
  }
  invariant(suppliedReferenceOwners.size === taxonomy.source_reference.reference_count, "INVALID_SHOT_TAXONOMY", "Every supplied reference must map to exactly one taxonomy entry.");

  invariant(Array.isArray(taxonomy.sources) && taxonomy.sources.length > 0 && taxonomy.sources.length <= 128, "INVALID_SHOT_TAXONOMY", "sources must contain 1-128 records.");
  const sourceLabels = [];
  const sourceUrls = [];
  for (const [index, source] of taxonomy.sources.entries()) {
    const field = `sources[${index}]`;
    assertExactKeys(source, SOURCE_KEYS, field);
    assertText(source.label, `${field}.label`, 512);
    assertText(source.url, `${field}.url`, 2048);
    let parsed;
    try {
      parsed = new URL(source.url);
    } catch {
      invariant(false, "INVALID_SHOT_TAXONOMY", `${field}.url must be a valid URL.`);
    }
    invariant(source.url.startsWith("https://") && parsed.protocol === "https:" && parsed.username === "" && parsed.password === "", "INVALID_SHOT_TAXONOMY", `${field}.url must be a credential-free lowercase https:// URL.`);
    sourceLabels.push(source.label);
    sourceUrls.push(source.url);
  }
  assertUnique(sourceLabels, "source labels");
  assertUnique(sourceUrls, "source URLs");
  return taxonomy;
}

export function validateShotTaxonomy(value) {
  const taxonomy = canonicalValue(value);
  validateTaxonomyCanonical(taxonomy);
  return deepFreeze(taxonomy);
}

export function shotTaxonomyHash(value) {
  return hashCanonical(validateShotTaxonomy(value));
}

function parseTaxonomyBytes(sourceBytes) {
  invariant(Buffer.isBuffer(sourceBytes), "INVALID_SOURCE_BYTES", "shot taxonomy source must be supplied as a Buffer.");
  const bytes = Buffer.from(sourceBytes);
  const value = decodeJsonBytes(bytes, "shot taxonomy source", MAX_SOURCE_BYTES);
  const taxonomy = validateShotTaxonomy(value);
  return deepFreeze({
    source_sha256: sha256Bytes(bytes),
    taxonomy_hash: hashCanonical(taxonomy),
    counts: deepFreeze(taxonomyCounts(taxonomy)),
    taxonomy,
  });
}

function validateSnapshotCanonical(snapshot) {
  assertExactKeys(snapshot, SNAPSHOT_KEYS, "shot taxonomy snapshot");
  assertSha256(snapshot.source_sha256, "source_sha256");
  assertSha256(snapshot.taxonomy_hash, "taxonomy_hash");
  assertExactKeys(snapshot.counts, COUNT_KEYS, "shot taxonomy snapshot counts");
  const taxonomy = validateShotTaxonomy(snapshot.taxonomy);
  const expectedCounts = taxonomyCounts(taxonomy);
  for (const key of COUNT_KEYS) {
    assertSafeInteger(snapshot.counts[key], `counts.${key}`, 1);
    invariant(snapshot.counts[key] === expectedCounts[key], "INVALID_SHOT_TAXONOMY", `counts.${key} does not match the taxonomy.`);
  }
  invariant(timingSafeHashEqual(hashCanonical(taxonomy), snapshot.taxonomy_hash), "SHOT_TAXONOMY_HASH_MISMATCH", "taxonomy_hash does not match the canonical taxonomy.");
  return snapshot;
}

export function loadShotTaxonomy(filePath) {
  const bytes = readStableRegularFile(filePath, "shot taxonomy source", MAX_SOURCE_BYTES);
  return parseTaxonomyBytes(bytes);
}

function registryHashPayload(registry) {
  const payload = cloneCanonical(registry);
  delete payload.registry_hash;
  return payload;
}

export function validateShotTaxonomyRegistry(value) {
  const registry = canonicalValue(value);
  assertExactKeys(registry, REGISTRY_KEYS, "shot taxonomy registry");
  invariant(registry.schema_version === SHOT_TAXONOMY_REGISTRY_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `shot taxonomy registry schema_version must equal ${SHOT_TAXONOMY_REGISTRY_SCHEMA_VERSION}.`);
  assertExactKeys(registry.provenance, PROVENANCE_KEYS, "shot taxonomy registry provenance");
  invariant(registry.provenance.source_file === SOURCE_FILE, "INVALID_SHOT_TAXONOMY", `provenance.source_file must equal ${SOURCE_FILE}.`);
  assertSha256(registry.provenance.source_sha256, "provenance.source_sha256");
  assertExactKeys(registry.counts, COUNT_KEYS, "shot taxonomy registry counts");

  const taxonomy = validateShotTaxonomy(registry.taxonomy);
  const expectedCounts = taxonomyCounts(taxonomy);
  for (const key of COUNT_KEYS) {
    assertSafeInteger(registry.counts[key], `counts.${key}`, 1);
    invariant(registry.counts[key] === expectedCounts[key], "INVALID_SHOT_TAXONOMY", `counts.${key} does not match the taxonomy.`);
  }
  assertSha256(registry.taxonomy_hash, "taxonomy_hash");
  invariant(timingSafeHashEqual(hashCanonical(taxonomy), registry.taxonomy_hash), "SHOT_TAXONOMY_HASH_MISMATCH", "taxonomy_hash does not match the canonical taxonomy.");
  assertSha256(registry.registry_hash, "registry_hash");
  invariant(timingSafeHashEqual(hashCanonical(registryHashPayload(registry)), registry.registry_hash), "SHOT_TAXONOMY_REGISTRY_HASH_MISMATCH", "registry_hash does not match the canonical registry payload.");
  return deepFreeze(registry);
}

export function compileShotTaxonomyRegistry({ sourceBytes = null, sourceSnapshot = null, sourceFile = SOURCE_FILE } = {}) {
  invariant(sourceFile === SOURCE_FILE, "INVALID_SOURCE_NAME", `sourceFile must equal ${SOURCE_FILE}.`);
  invariant((sourceBytes === null) !== (sourceSnapshot === null), "INVALID_SOURCE_INPUT", "Supply exactly one of sourceBytes or sourceSnapshot.");
  let snapshot;
  if (sourceSnapshot !== null) {
    snapshot = canonicalValue(sourceSnapshot);
    validateSnapshotCanonical(snapshot);
    deepFreeze(snapshot);
  } else {
    snapshot = parseTaxonomyBytes(sourceBytes);
  }
  const payload = {
    schema_version: SHOT_TAXONOMY_REGISTRY_SCHEMA_VERSION,
    taxonomy: snapshot.taxonomy,
    provenance: {
      source_file: sourceFile,
      source_sha256: snapshot.source_sha256,
    },
    counts: snapshot.counts,
    taxonomy_hash: snapshot.taxonomy_hash,
  };
  return validateShotTaxonomyRegistry({ ...payload, registry_hash: hashCanonical(payload) });
}

export function serializeShotTaxonomyRegistry(registry) {
  return `${JSON.stringify(validateShotTaxonomyRegistry(registry), null, 2)}\n`;
}

export function loadCompiledShotTaxonomy(filePath) {
  const bytes = readStableRegularFile(filePath, "compiled shot taxonomy registry", MAX_REGISTRY_BYTES);
  return validateShotTaxonomyRegistry(decodeJsonBytes(bytes, "compiled shot taxonomy registry", MAX_REGISTRY_BYTES));
}

function taxonomyContext(value) {
  const snapshot = canonicalValue(value);
  invariant(snapshot !== null && typeof snapshot === "object" && !Array.isArray(snapshot), "INVALID_SHOT_TAXONOMY", "A shot taxonomy snapshot object is required.");
  if (snapshot.schema_version === SHOT_TAXONOMY_REGISTRY_SCHEMA_VERSION) {
    const registry = validateShotTaxonomyRegistry(snapshot);
    return { taxonomy: registry.taxonomy, taxonomy_hash: registry.taxonomy_hash };
  }
  if (snapshot.schema_version === SHOT_TAXONOMY_SCHEMA_VERSION) {
    const taxonomy = validateShotTaxonomy(snapshot);
    return { taxonomy, taxonomy_hash: hashCanonical(taxonomy) };
  }
  if (Object.hasOwn(snapshot, "taxonomy")) {
    validateSnapshotCanonical(snapshot);
    return { taxonomy: snapshot.taxonomy, taxonomy_hash: snapshot.taxonomy_hash };
  }
  invariant(false, "INVALID_SHOT_TAXONOMY", "A validated source snapshot, source taxonomy, or compiled taxonomy registry is required.");
}

function findTaxonomyEntry(context, category, code) {
  invariant(SHOT_CATEGORY_ORDER.includes(category), "INVALID_SHOT_DIMENSION", `Unknown shot dimension: ${category}.`);
  const entry = context.taxonomy.categories[category].entries.find((candidate) => candidate.code === code);
  if (entry !== undefined) return entry;
  const owner = SHOT_CATEGORY_ORDER.find((candidateCategory) => context.taxonomy.categories[candidateCategory].entries.some((candidate) => candidate.code === code));
  invariant(owner === undefined, "SHOT_DIMENSION_MISMATCH", `${code} belongs to ${owner}, not ${category}.`);
  invariant(false, "UNKNOWN_SHOT_CODE", `Unknown shot taxonomy code: ${code}.`);
}

export function resolveShotTaxonomyEntry(taxonomySnapshot, category, code) {
  assertText(code, "shot taxonomy code", 128, "INVALID_SHOT_RECORD");
  return cloneCanonical(findTaxonomyEntry(taxonomyContext(taxonomySnapshot), category, code));
}

function validateShotRecordCanonical(record, context, { requireHash }) {
  assertExactKeys(record, requireHash ? SHOT_RECORD_KEYS : SHOT_DRAFT_KEYS, "shot record", "INVALID_SHOT_RECORD");
  invariant(record.schema_version === SHOT_RECORD_SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", `shot record schema_version must equal ${SHOT_RECORD_SCHEMA_VERSION}.`);
  assertIdentifier(record.shot_id, "shot_id");
  assertIdentifier(record.title_id, "title_id");
  assertIdentifier(record.scene_id, "scene_id");
  assertSha256(record.source_revision_hash, "source_revision_hash");

  assertExactKeys(record.taxonomy_ref, TAXONOMY_REF_KEYS, "taxonomy_ref", "INVALID_SHOT_RECORD");
  invariant(record.taxonomy_ref.schema_version === context.taxonomy.schema_version, "SHOT_TAXONOMY_VERSION_MISMATCH", "taxonomy_ref.schema_version does not match the admitted taxonomy.");
  invariant(record.taxonomy_ref.taxonomy_version === context.taxonomy.taxonomy_version, "SHOT_TAXONOMY_VERSION_MISMATCH", "taxonomy_ref.taxonomy_version does not match the admitted taxonomy.");
  assertSha256(record.taxonomy_ref.taxonomy_hash, "taxonomy_ref.taxonomy_hash");
  invariant(timingSafeHashEqual(record.taxonomy_ref.taxonomy_hash, context.taxonomy_hash), "SHOT_TAXONOMY_HASH_MISMATCH", "taxonomy_ref.taxonomy_hash does not match the admitted taxonomy.");
  invariant(record.record_state === "PROSPECTIVE_DRAFT", "INVALID_SHOT_RECORD", "record_state must equal PROSPECTIVE_DRAFT.");
  invariant(record.authority_state === "NO_EXTERNAL_AUTHORITY", "INVALID_SHOT_RECORD", "authority_state must equal NO_EXTERNAL_AUTHORITY.");

  assertExactKeys(record.narrative, NARRATIVE_KEYS, "narrative", "INVALID_SHOT_RECORD");
  assertText(record.narrative.story_purpose, "narrative.story_purpose", 4096, "INVALID_SHOT_RECORD");
  assertText(record.narrative.action, "narrative.action", 8192, "INVALID_SHOT_RECORD");
  assertNullableText(record.narrative.dialogue_audio, "narrative.dialogue_audio", 8192);

  assertExactKeys(record.taxonomy_codes, SHOT_CATEGORY_ORDER, "taxonomy_codes", "INVALID_SHOT_RECORD");
  assertExactKeys(record.custom_values, SHOT_CATEGORY_ORDER, "custom_values", "INVALID_SHOT_RECORD");
  for (const category of SHOT_CATEGORY_ORDER) {
    const code = record.taxonomy_codes[category];
    const customValue = record.custom_values[category];
    invariant(code === null || typeof code === "string", "INVALID_SHOT_RECORD", `taxonomy_codes.${category} must be null or a taxonomy code.`);
    if (code === null) {
      invariant(customValue === null, "UNEXPECTED_CUSTOM_SHOT_NOTE", `custom_values.${category} must be null when no code is selected.`);
      continue;
    }
    invariant(CODE_PATTERN.test(code), "UNKNOWN_SHOT_CODE", `taxonomy_codes.${category} must be an exact uppercase taxonomy code.`);
    const entry = findTaxonomyEntry(context, category, code);
    if (entry.code.endsWith("_CUSTOM")) {
      assertNullableText(customValue, `custom_values.${category}`, 2048);
      invariant(customValue !== null, "CUSTOM_SHOT_NOTE_REQUIRED", `custom_values.${category} is required for ${code}.`);
    } else {
      invariant(customValue === null, "UNEXPECTED_CUSTOM_SHOT_NOTE", `custom_values.${category} must be null unless a *_CUSTOM code is selected.`);
    }
  }

  assertExactKeys(record.capture_plan, CAPTURE_PLAN_KEYS, "capture_plan", "INVALID_SHOT_RECORD");
  assertNullableText(record.capture_plan.lens, "capture_plan.lens", 512);
  assertNullableText(record.capture_plan.camera_pose, "capture_plan.camera_pose", 2048);
  if (record.capture_plan.frames_per_second !== null) {
    assertText(record.capture_plan.frames_per_second, "capture_plan.frames_per_second", 32, "INVALID_SHOT_RECORD");
    invariant(FPS_PATTERN.test(record.capture_plan.frames_per_second), "INVALID_SHOT_RECORD", "capture_plan.frames_per_second must be a positive canonical decimal string.");
  }
  invariant(
    record.capture_plan.planned_duration_ms === null
      || (Number.isSafeInteger(record.capture_plan.planned_duration_ms) && record.capture_plan.planned_duration_ms > 0),
    "INVALID_SHOT_RECORD",
    "capture_plan.planned_duration_ms must be null or a positive safe integer.",
  );

  assertExactKeys(record.continuity, CONTINUITY_KEYS, "continuity", "INVALID_SHOT_RECORD");
  invariant(Array.isArray(record.continuity.character_states) && record.continuity.character_states.length <= 64, "INVALID_SHOT_RECORD", "continuity.character_states must be an array of at most 64 items.");
  const characterIds = [];
  for (const [index, characterState] of record.continuity.character_states.entries()) {
    const field = `continuity.character_states[${index}]`;
    assertExactKeys(characterState, CHARACTER_STATE_KEYS, field, "INVALID_SHOT_RECORD");
    assertIdentifier(characterState.character_id, `${field}.character_id`);
    assertText(characterState.state, `${field}.state`, 2048, "INVALID_SHOT_RECORD");
    characterIds.push(characterState.character_id);
  }
  assertUnique(characterIds, "continuity.character_states character_id", "INVALID_SHOT_RECORD");
  assertSorted(characterIds, "continuity.character_states", "INVALID_SHOT_RECORD");
  assertSortedUniqueHashes(record.continuity.continuity_in_shot_hashes, "continuity.continuity_in_shot_hashes");
  assertSortedUniqueTextArray(record.continuity.required_outcomes, "continuity.required_outcomes");
  assertSortedUniqueTextArray(record.continuity.forbidden_outcomes, "continuity.forbidden_outcomes");
  assertNullableText(record.continuity.location_state, "continuity.location_state", 2048);
  assertNullableText(record.continuity.time_state, "continuity.time_state", 2048);
  assertNullableText(record.continuity.style_state, "continuity.style_state", 4096);

  assertExactKeys(record.constraints, CONSTRAINT_KEYS, "constraints", "INVALID_SHOT_RECORD");
  assertSortedUniqueTextArray(record.constraints.production, "constraints.production");
  assertSortedUniqueTextArray(record.constraints.generation, "constraints.generation");

  if (requireHash) {
    assertSha256(record.shot_hash, "shot_hash");
    const observed = hashCanonical(shotRecordHashPayloadCanonical(record));
    invariant(timingSafeHashEqual(observed, record.shot_hash), "SHOT_RECORD_HASH_MISMATCH", "shot_hash does not match the canonical shot record payload.");
  }
  return record;
}

function shotRecordHashPayloadCanonical(record) {
  const payload = cloneCanonical(record);
  delete payload.shot_hash;
  return payload;
}

export function shotRecordHashPayload(record) {
  const snapshot = canonicalValue(record);
  assertExactKeys(snapshot, SHOT_RECORD_KEYS, "shot record", "INVALID_SHOT_RECORD");
  return shotRecordHashPayloadCanonical(snapshot);
}

export function sealShotRecord(draft, { taxonomySnapshot } = {}) {
  const input = canonicalValue(draft);
  assertExactKeys(input, SHOT_DRAFT_KEYS, "shot record draft", "INVALID_SHOT_RECORD");
  const context = taxonomyContext(taxonomySnapshot);
  validateShotRecordCanonical(input, context, { requireHash: false });
  const record = { ...input, shot_hash: hashCanonical(input) };
  validateShotRecordCanonical(record, context, { requireHash: true });
  return cloneCanonical(record);
}

export function validateShotRecord(record, { taxonomySnapshot } = {}) {
  const snapshot = canonicalValue(record);
  const context = taxonomyContext(taxonomySnapshot);
  validateShotRecordCanonical(snapshot, context, { requireHash: true });
  return deepFreeze(snapshot);
}

export function validateShotRecordSet(records, { taxonomySnapshot } = {}) {
  const snapshot = canonicalValue(records);
  invariant(Array.isArray(snapshot) && snapshot.length > 0 && snapshot.length <= MAX_SHOT_RECORDS, "INVALID_SHOT_RECORD_SET", `shot record set must contain 1-${MAX_SHOT_RECORDS} records.`);
  const context = taxonomyContext(taxonomySnapshot);
  const identities = new Set();
  for (const record of snapshot) {
    validateShotRecordCanonical(record, context, { requireHash: true });
    const identity = `${record.title_id}\u0000${record.shot_id}`;
    invariant(!identities.has(identity), "DUPLICATE_SHOT_ID", `shot_id ${record.shot_id} is duplicated within title ${record.title_id}.`);
    identities.add(identity);
  }
  return deepFreeze(snapshot);
}
