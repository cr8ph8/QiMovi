import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import { canonicalJson, canonicalValue, hashCanonical } from "./canonical-json.mjs";
import { SCHEMA } from "./constants.mjs";
import { invariant } from "./errors.mjs";

export const ARTIFACT_REGISTRY_SCHEMA_VERSION = SCHEMA.artifactRegistry;

export const MANIFEST_COLUMNS = Object.freeze([
  "record_id",
  "baseline_number",
  "artifact_name",
  "artifact_key",
  "bundle",
  "authority_class",
  "materialization_mode",
  "template_file",
  "template_locator",
  "default_scope",
  "default_applicability",
  "gate_relevance",
  "evidence_boundary",
]);

const LIBRARY_VERSION_KEYS = Object.freeze([
  "authority_model",
  "baseline_artifact_types",
  "created_on",
  "library_name",
  "library_version",
  "limitations",
  "policy_overlays",
  "required_office_deliverables",
  "source_prd",
  "status",
  "updated_on",
]);

const REGISTRY_KEYS = Object.freeze([
  "counts",
  "library",
  "records",
  "registry_hash",
  "schema_version",
  "sources",
]);

const LIBRARY_KEYS = Object.freeze([
  "authority_model",
  "created_on",
  "library_name",
  "library_version",
  "limitations",
  "source_prd",
  "status",
  "updated_on",
]);

const COUNT_KEYS = Object.freeze([
  "baseline_artifact_types",
  "office_deliverables",
  "policy_overlays",
  "records",
]);

const SOURCE_KEYS = Object.freeze([
  "library_version_file",
  "library_version_sha256",
  "manifest_file",
  "manifest_sha256",
]);

const RECORD_KEYS = Object.freeze([
  ...MANIFEST_COLUMNS,
  "kind",
  "source_format",
].sort());

const MATERIALIZATION_MODES = new Set([
  "CURATED_PACKAGE",
  "EXTERNAL_EVIDENCE",
  "GENERATED_VIEW",
  "HYBRID",
  "TRANSACTIONAL_VIEW",
  "WORKING_RECORD",
]);

const APPLICABILITY_VALUES = new Set(["CONDITIONAL", "REQUIRED"]);
const EXPECTED_V1_COUNTS = Object.freeze({
  records: 53,
  baseline_artifact_types: 30,
  policy_overlays: 23,
  office_deliverables: 10,
});
const SOURCE_FORMATS = new Map([
  [".docx", "DOCX"],
  [".pptx", "PPTX"],
  [".xlsx", "XLSX"],
]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_FIELD_LENGTH = 8192;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactKeys(value, expected, field) {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_REGISTRY_OBJECT", `${field} must be an object.`);
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  invariant(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    "UNEXPECTED_REGISTRY_KEYS",
    `${field} must contain exactly: ${wanted.join(", ")}.`,
    { actual },
  );
}

function assertNonEmptyText(value, field, maxLength = MAX_FIELD_LENGTH) {
  invariant(typeof value === "string", "INVALID_REGISTRY_TEXT", `${field} must be a string.`);
  invariant(value.length > 0 && value.length <= maxLength, "INVALID_REGISTRY_TEXT", `${field} must contain 1-${maxLength} characters.`);
  invariant(value === value.trim(), "INVALID_REGISTRY_TEXT", `${field} must not contain leading or trailing whitespace.`);
  invariant(!/[\u0000-\u001f\u007f]/u.test(value), "INVALID_REGISTRY_TEXT", `${field} must not contain control characters.`);
}

function assertSafeInteger(value, field, minimum = 0) {
  invariant(Number.isSafeInteger(value) && value >= minimum, "INVALID_REGISTRY_INTEGER", `${field} must be a safe integer of at least ${minimum}.`);
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function decodeUtf8(bytes, field) {
  invariant(Buffer.isBuffer(bytes), "INVALID_SOURCE_BYTES", `${field} must be supplied as a Buffer.`);
  invariant(bytes.length > 0 && bytes.length <= MAX_SOURCE_BYTES, "INVALID_SOURCE_SIZE", `${field} must contain 1-${MAX_SOURCE_BYTES} bytes.`);
  let decoded;
  try {
    decoded = UTF8_DECODER.decode(bytes);
  } catch {
    invariant(false, "INVALID_UTF8", `${field} must be valid UTF-8.`);
  }
  invariant(!decoded.startsWith("\uFEFF"), "UNEXPECTED_UTF8_BOM", `${field} must not begin with a UTF-8 BOM.`);
  invariant(!decoded.includes("\u0000"), "INVALID_SOURCE_TEXT", `${field} must not contain NUL characters.`);
  return decoded;
}

function finishCsvRow(rows, row, field) {
  row.push(field);
  rows.push(row);
}

/**
 * Parse RFC-4180-style CSV while rejecting permissive edge cases. Quoted fields
 * may contain commas, escaped quotes, and line breaks; downstream field rules
 * reject control characters in this manifest's semantic values.
 */
export function parseStrictCsv(input) {
  const text = Buffer.isBuffer(input) ? decodeUtf8(input, "manifest") : input;
  invariant(typeof text === "string" && text.length > 0, "EMPTY_CSV", "Manifest CSV must be non-empty text.");
  invariant(!text.startsWith("\uFEFF"), "UNEXPECTED_UTF8_BOM", "Manifest CSV must not begin with a UTF-8 BOM.");
  invariant(!text.includes("\u0000"), "INVALID_CSV", "Manifest CSV must not contain NUL characters.");

  const rows = [];
  let row = [];
  let field = "";
  let state = "FIELD_START";
  let rowStarted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (state === "QUOTED") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          state = "AFTER_QUOTE";
        }
      } else if (character === "\r") {
        invariant(text[index + 1] === "\n", "INVALID_CSV_NEWLINE", "Manifest CSV uses a bare carriage return inside a quoted field.");
        field += "\r\n";
        index += 1;
      } else {
        field += character;
      }
      rowStarted = true;
      continue;
    }

    const isCrLf = character === "\r" && text[index + 1] === "\n";
    invariant(character !== "\r" || isCrLf, "INVALID_CSV_NEWLINE", "Manifest CSV uses a bare carriage return.");
    const isNewline = character === "\n" || isCrLf;

    if (state === "AFTER_QUOTE") {
      if (character === ",") {
        row.push(field);
        field = "";
        state = "FIELD_START";
        rowStarted = true;
        continue;
      }
      if (isNewline) {
        finishCsvRow(rows, row, field);
        row = [];
        field = "";
        state = "FIELD_START";
        rowStarted = false;
        if (isCrLf) index += 1;
        continue;
      }
      invariant(false, "INVALID_CSV_QUOTE", "Only a delimiter or newline may follow a closing CSV quote.", { index });
    }

    if (state === "FIELD_START" && character === '"') {
      state = "QUOTED";
      rowStarted = true;
      continue;
    }
    invariant(character !== '"', "INVALID_CSV_QUOTE", "Quotes must enclose an entire CSV field.", { index });

    if (character === ",") {
      row.push(field);
      field = "";
      state = "FIELD_START";
      rowStarted = true;
      continue;
    }
    if (isNewline) {
      finishCsvRow(rows, row, field);
      row = [];
      field = "";
      state = "FIELD_START";
      rowStarted = false;
      if (isCrLf) index += 1;
      continue;
    }

    field += character;
    state = "UNQUOTED";
    rowStarted = true;
  }

  invariant(state !== "QUOTED", "UNCLOSED_CSV_QUOTE", "Manifest CSV ends inside a quoted field.");
  if (rowStarted || row.length > 0 || field.length > 0) {
    finishCsvRow(rows, row, field);
  }

  invariant(rows.length > 1, "EMPTY_CSV", "Manifest CSV must contain a header and at least one record.");
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    invariant(rows[rowIndex].length === MANIFEST_COLUMNS.length, "INVALID_CSV_COLUMN_COUNT", `CSV row ${rowIndex + 1} must contain exactly ${MANIFEST_COLUMNS.length} columns.`, { actual: rows[rowIndex].length });
  }
  invariant(
    rows[0].every((value, index) => value === MANIFEST_COLUMNS[index]),
    "INVALID_CSV_HEADER",
    `Manifest header must be exactly: ${MANIFEST_COLUMNS.join(",")}.`,
    { actual: rows[0] },
  );
  return rows.slice(1);
}

function parseLibraryVersion(bytes) {
  const text = decodeUtf8(bytes, "LIBRARY_VERSION.json");
  let version;
  try {
    version = JSON.parse(text);
  } catch {
    invariant(false, "INVALID_LIBRARY_VERSION_JSON", "LIBRARY_VERSION.json must contain valid JSON.");
  }
  assertExactKeys(version, LIBRARY_VERSION_KEYS, "library version");
  assertNonEmptyText(version.library_name, "library_name", 256);
  assertNonEmptyText(version.library_version, "library_version", 64);
  invariant(/^\d+\.\d+\.\d+$/u.test(version.library_version), "INVALID_LIBRARY_VERSION", "library_version must be a numeric semantic version.");
  for (const dateField of ["created_on", "updated_on"]) {
    assertNonEmptyText(version[dateField], dateField, 10);
    invariant(/^\d{4}-\d{2}-\d{2}$/u.test(version[dateField]), "INVALID_LIBRARY_DATE", `${dateField} must use YYYY-MM-DD.`);
  }
  for (const countField of ["baseline_artifact_types", "policy_overlays", "required_office_deliverables"]) {
    assertSafeInteger(version[countField], countField, 1);
  }
  for (const field of ["authority_model", "source_prd", "status"]) {
    assertNonEmptyText(version[field], field, 2048);
  }
  invariant(Array.isArray(version.limitations) && version.limitations.length > 0, "INVALID_LIBRARY_LIMITATIONS", "limitations must be a non-empty array.");
  const limitationSet = new Set();
  for (const [index, limitation] of version.limitations.entries()) {
    assertNonEmptyText(limitation, `limitations[${index}]`, 4096);
    invariant(!limitationSet.has(limitation), "DUPLICATE_LIBRARY_LIMITATION", "limitations must not contain duplicates.");
    limitationSet.add(limitation);
  }
  return version;
}

function sourceFormatFor(templateFile) {
  const extension = path.posix.extname(templateFile);
  const sourceFormat = SOURCE_FORMATS.get(extension);
  invariant(sourceFormat !== undefined, "INVALID_TEMPLATE_FORMAT", `template_file must end in one of: ${[...SOURCE_FORMATS.keys()].join(", ")}.`);
  return sourceFormat;
}

function assertSafeOfficePathSyntax(templateFile, field) {
  assertNonEmptyText(templateFile, field, 1024);
  invariant(!path.posix.isAbsolute(templateFile), "UNSAFE_TEMPLATE_PATH", `${field} must be relative.`);
  invariant(!templateFile.includes("\\"), "UNSAFE_TEMPLATE_PATH", `${field} must use forward slashes.`);
  invariant(!/[?:*<>|#]/u.test(templateFile), "UNSAFE_TEMPLATE_PATH", `${field} contains a platform-unsafe path character.`);
  const segments = templateFile.split("/");
  invariant(segments.length >= 2 && segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."), "UNSAFE_TEMPLATE_PATH", `${field} contains an unsafe path segment.`);
  invariant(path.posix.normalize(templateFile) === templateFile, "UNSAFE_TEMPLATE_PATH", `${field} must be a normalized relative path.`);
  sourceFormatFor(templateFile);
  return segments;
}

function assertSafeOfficePath(templateFile, libraryDirectory, field) {
  const segments = assertSafeOfficePathSyntax(templateFile, field);

  const libraryRoot = fs.realpathSync(libraryDirectory);
  const candidate = path.resolve(libraryRoot, ...segments);
  invariant(candidate.startsWith(`${libraryRoot}${path.sep}`), "UNSAFE_TEMPLATE_PATH", `${field} resolves outside the template library.`);
  let actual;
  try {
    actual = fs.realpathSync(candidate);
  } catch {
    invariant(false, "MISSING_TEMPLATE_FILE", `${field} does not exist: ${templateFile}.`);
  }
  invariant(actual.startsWith(`${libraryRoot}${path.sep}`), "UNSAFE_TEMPLATE_PATH", `${field} resolves outside the template library through a symbolic link.`);
  invariant(fs.statSync(actual).isFile(), "INVALID_TEMPLATE_FILE", `${field} must resolve to a file.`);
}

function listOfficeDeliverables(libraryDirectory) {
  const libraryRoot = fs.realpathSync(libraryDirectory);
  const deliverables = [];

  function visit(directory, relativeDirectory, depth) {
    invariant(depth <= 8, "LIBRARY_TREE_TOO_DEEP", "Template library directory depth exceeds 8.");
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      invariant(!/[\u0000-\u001f\u007f]/u.test(entry.name), "UNSAFE_TEMPLATE_PATH", "Template library entry names must not contain control characters.");
      const relative = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        invariant(false, "UNSAFE_TEMPLATE_SYMLINK", `Template library must not contain symbolic links: ${relative}.`);
      }
      if (entry.isDirectory()) {
        visit(absolute, relative, depth + 1);
      } else if (entry.isFile() && SOURCE_FORMATS.has(path.posix.extname(relative))) {
        assertSafeOfficePath(relative, libraryRoot, `Office deliverable ${relative}`);
        deliverables.push(relative);
      }
    }
  }

  visit(libraryRoot, "", 0);
  return deliverables.sort(compareText);
}

function recordFromRow(row, rowNumber, libraryDirectory) {
  const source = Object.fromEntries(MANIFEST_COLUMNS.map((column, index) => [column, row[index]]));
  for (const column of MANIFEST_COLUMNS) {
    if (column !== "baseline_number") assertNonEmptyText(source[column], `row ${rowNumber} ${column}`);
  }

  const baselineMatch = /^B-(\d{3})$/u.exec(source.record_id);
  const overlayMatch = /^O-(\d{3})$/u.exec(source.record_id);
  invariant(Boolean(baselineMatch) !== Boolean(overlayMatch), "INVALID_RECORD_ID", `row ${rowNumber} record_id must match B-NNN or O-NNN.`);

  let baselineNumber = null;
  let kind;
  if (baselineMatch) {
    invariant(/^\d+$/u.test(source.baseline_number), "INVALID_BASELINE_NUMBER", `row ${rowNumber} baseline_number must be an integer for a B- record.`);
    baselineNumber = Number(source.baseline_number);
    assertSafeInteger(baselineNumber, `row ${rowNumber} baseline_number`, 1);
    invariant(Number(baselineMatch[1]) === baselineNumber, "BASELINE_ID_MISMATCH", `row ${rowNumber} record_id must encode baseline_number.`);
    kind = "BASELINE";
  } else {
    invariant(source.baseline_number === "", "INVALID_OVERLAY_BASELINE", `row ${rowNumber} baseline_number must be empty for an O- record.`);
    kind = "POLICY_OVERLAY";
  }

  invariant(/^[A-Z][A-Z0-9_]{1,127}$/u.test(source.artifact_key), "INVALID_ARTIFACT_KEY", `row ${rowNumber} artifact_key is invalid.`);
  invariant(MATERIALIZATION_MODES.has(source.materialization_mode), "INVALID_MATERIALIZATION_MODE", `row ${rowNumber} materialization_mode is not supported.`);
  invariant(APPLICABILITY_VALUES.has(source.default_applicability), "INVALID_DEFAULT_APPLICABILITY", `row ${rowNumber} default_applicability is not supported.`);
  assertSafeOfficePath(source.template_file, libraryDirectory, `row ${rowNumber} template_file`);

  return {
    ...source,
    baseline_number: baselineNumber,
    kind,
    source_format: sourceFormatFor(source.template_file),
  };
}

function assertUnique(records, selector, code, label) {
  const seen = new Set();
  for (const record of records) {
    const value = selector(record);
    if (value === null) continue;
    invariant(!seen.has(value), code, `${label} must be unique: ${value}.`);
    seen.add(value);
  }
}

function assertContiguousRecordIds(records, kind, prefix, expectedCount) {
  const selected = records.filter((record) => record.kind === kind);
  invariant(selected.length === expectedCount, "REGISTRY_COUNT_MISMATCH", `${kind} count must equal ${expectedCount}.`, { actual: selected.length });
  for (let index = 1; index <= expectedCount; index += 1) {
    const expectedId = `${prefix}-${String(index).padStart(3, "0")}`;
    invariant(selected[index - 1]?.record_id === expectedId, "NON_CONTIGUOUS_RECORD_IDS", `${kind} record IDs must be contiguous through ${expectedId}.`);
    if (kind === "BASELINE") {
      invariant(selected[index - 1].baseline_number === index, "NON_CONTIGUOUS_BASELINES", `Baseline numbers must be contiguous through ${index}.`);
    }
  }
}

function registryPayload(registry) {
  const { registry_hash: ignored, ...payload } = registry;
  return payload;
}

function assertSha256(value, field) {
  invariant(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), "INVALID_REGISTRY_HASH", `${field} must be a lowercase SHA-256 digest.`);
}

function assertCompiledRecord(record, index, libraryDirectory = null) {
  assertExactKeys(record, RECORD_KEYS, `records[${index}]`);
  for (const column of MANIFEST_COLUMNS) {
    if (column === "baseline_number") continue;
    assertNonEmptyText(record[column], `records[${index}].${column}`);
  }
  invariant(record.kind === "BASELINE" || record.kind === "POLICY_OVERLAY", "INVALID_RECORD_KIND", `records[${index}].kind is invalid.`);
  if (record.kind === "BASELINE") {
    assertSafeInteger(record.baseline_number, `records[${index}].baseline_number`, 1);
    invariant(record.record_id === `B-${String(record.baseline_number).padStart(3, "0")}`, "BASELINE_ID_MISMATCH", `records[${index}] baseline identity is inconsistent.`);
  } else {
    invariant(record.baseline_number === null && /^O-\d{3}$/u.test(record.record_id), "INVALID_OVERLAY_BASELINE", `records[${index}] overlay identity is inconsistent.`);
  }
  invariant(/^[A-Z][A-Z0-9_]{1,127}$/u.test(record.artifact_key), "INVALID_ARTIFACT_KEY", `records[${index}].artifact_key is invalid.`);
  invariant(MATERIALIZATION_MODES.has(record.materialization_mode), "INVALID_MATERIALIZATION_MODE", `records[${index}].materialization_mode is invalid.`);
  invariant(APPLICABILITY_VALUES.has(record.default_applicability), "INVALID_DEFAULT_APPLICABILITY", `records[${index}].default_applicability is invalid.`);
  invariant(record.source_format === sourceFormatFor(record.template_file), "SOURCE_FORMAT_MISMATCH", `records[${index}].source_format does not match template_file.`);
  assertSafeOfficePathSyntax(record.template_file, `records[${index}].template_file`);
  if (libraryDirectory !== null) assertSafeOfficePath(record.template_file, libraryDirectory, `records[${index}].template_file`);
}

/** Validate a compiled registry and return its canonical value. */
export function validateArtifactRegistry(registry, { libraryDirectory = null } = {}) {
  assertExactKeys(registry, REGISTRY_KEYS, "artifact registry");
  invariant(registry.schema_version === ARTIFACT_REGISTRY_SCHEMA_VERSION, "INVALID_REGISTRY_SCHEMA_VERSION", `schema_version must equal ${ARTIFACT_REGISTRY_SCHEMA_VERSION}.`);

  assertExactKeys(registry.library, LIBRARY_KEYS, "library");
  for (const field of LIBRARY_KEYS.filter((key) => key !== "limitations")) {
    assertNonEmptyText(registry.library[field], `library.${field}`, 2048);
  }
  invariant(/^\d+\.\d+\.\d+$/u.test(registry.library.library_version), "INVALID_LIBRARY_VERSION", "library.library_version must be a numeric semantic version.");
  invariant(/^\d{4}-\d{2}-\d{2}$/u.test(registry.library.created_on), "INVALID_LIBRARY_DATE", "library.created_on must use YYYY-MM-DD.");
  invariant(/^\d{4}-\d{2}-\d{2}$/u.test(registry.library.updated_on), "INVALID_LIBRARY_DATE", "library.updated_on must use YYYY-MM-DD.");
  invariant(Array.isArray(registry.library.limitations) && registry.library.limitations.length > 0, "INVALID_LIBRARY_LIMITATIONS", "library.limitations must be a non-empty array.");
  registry.library.limitations.forEach((value, index) => assertNonEmptyText(value, `library.limitations[${index}]`, 4096));
  invariant(new Set(registry.library.limitations).size === registry.library.limitations.length, "DUPLICATE_LIBRARY_LIMITATION", "library.limitations must not contain duplicates.");

  assertExactKeys(registry.counts, COUNT_KEYS, "counts");
  for (const key of COUNT_KEYS) assertSafeInteger(registry.counts[key], `counts.${key}`, 1);
  for (const [key, expected] of Object.entries(EXPECTED_V1_COUNTS)) {
    invariant(registry.counts[key] === expected, "REGISTRY_COUNT_MISMATCH", `counts.${key} must equal ${expected} for registry v1.`);
  }

  assertExactKeys(registry.sources, SOURCE_KEYS, "sources");
  invariant(registry.sources.manifest_file === "TEMPLATE_LIBRARY_MANIFEST.csv", "INVALID_SOURCE_NAME", "sources.manifest_file is invalid.");
  invariant(registry.sources.library_version_file === "LIBRARY_VERSION.json", "INVALID_SOURCE_NAME", "sources.library_version_file is invalid.");
  assertSha256(registry.sources.manifest_sha256, "sources.manifest_sha256");
  assertSha256(registry.sources.library_version_sha256, "sources.library_version_sha256");

  invariant(Array.isArray(registry.records), "INVALID_REGISTRY_RECORDS", "records must be an array.");
  registry.records.forEach((record, index) => assertCompiledRecord(record, index, libraryDirectory));
  const sorted = [...registry.records].sort((left, right) => compareText(left.record_id, right.record_id));
  invariant(registry.records.every((record, index) => record.record_id === sorted[index].record_id), "NON_CANONICAL_RECORD_ORDER", "records must be sorted by record_id.");
  assertUnique(registry.records, (record) => record.record_id, "DUPLICATE_RECORD_ID", "record_id");
  assertUnique(registry.records, (record) => record.artifact_key, "DUPLICATE_ARTIFACT_KEY", "artifact_key");
  assertUnique(registry.records, (record) => record.baseline_number, "DUPLICATE_BASELINE_NUMBER", "baseline_number");
  assertContiguousRecordIds(registry.records, "BASELINE", "B", registry.counts.baseline_artifact_types);
  assertContiguousRecordIds(registry.records, "POLICY_OVERLAY", "O", registry.counts.policy_overlays);

  invariant(registry.records.length === registry.counts.records, "REGISTRY_COUNT_MISMATCH", "counts.records does not match records.length.");
  if (libraryDirectory !== null) {
    const officeCount = listOfficeDeliverables(libraryDirectory).length;
    invariant(officeCount === registry.counts.office_deliverables, "OFFICE_DELIVERABLE_COUNT_MISMATCH", "counts.office_deliverables does not match Office files shipped in the template library.", { actual: officeCount });
  }
  invariant(registry.counts.records === registry.counts.baseline_artifact_types + registry.counts.policy_overlays, "REGISTRY_COUNT_MISMATCH", "Baseline and overlay counts must sum to records count.");

  assertSha256(registry.registry_hash, "registry_hash");
  invariant(hashCanonical(registryPayload(registry)) === registry.registry_hash, "SEMANTIC_REGISTRY_HASH_MISMATCH", "registry_hash does not match the canonical registry payload.");
  return canonicalValue(registry);
}

/** Compile source bytes and linked Office paths into a hash-bound registry. */
export function compileArtifactRegistry({ manifestBytes, libraryVersionBytes, libraryDirectory }) {
  invariant(typeof libraryDirectory === "string" && libraryDirectory.length > 0, "INVALID_LIBRARY_DIRECTORY", "libraryDirectory is required.");
  const version = parseLibraryVersion(libraryVersionBytes);
  const rows = parseStrictCsv(manifestBytes);
  const records = rows
    .map((row, index) => recordFromRow(row, index + 2, libraryDirectory))
    .sort((left, right) => compareText(left.record_id, right.record_id));

  assertUnique(records, (record) => record.record_id, "DUPLICATE_RECORD_ID", "record_id");
  assertUnique(records, (record) => record.artifact_key, "DUPLICATE_ARTIFACT_KEY", "artifact_key");
  assertUnique(records, (record) => record.baseline_number, "DUPLICATE_BASELINE_NUMBER", "baseline_number");
  assertContiguousRecordIds(records, "BASELINE", "B", version.baseline_artifact_types);
  assertContiguousRecordIds(records, "POLICY_OVERLAY", "O", version.policy_overlays);

  const referencedOfficeFiles = new Set(records.map((record) => record.template_file));
  const officeDeliverables = listOfficeDeliverables(libraryDirectory);
  invariant(records.length === version.baseline_artifact_types + version.policy_overlays, "REGISTRY_COUNT_MISMATCH", "Manifest record count does not match LIBRARY_VERSION counts.", { actual: records.length });
  invariant(officeDeliverables.length === version.required_office_deliverables, "OFFICE_DELIVERABLE_COUNT_MISMATCH", "Office files shipped in the template library do not match LIBRARY_VERSION required_office_deliverables.", { actual: officeDeliverables.length });
  invariant([...referencedOfficeFiles].every((templateFile) => officeDeliverables.includes(templateFile)), "MISSING_TEMPLATE_FILE", "Every manifest template_file must name a shipped Office deliverable.");

  const payload = {
    schema_version: ARTIFACT_REGISTRY_SCHEMA_VERSION,
    library: {
      library_name: version.library_name,
      library_version: version.library_version,
      created_on: version.created_on,
      updated_on: version.updated_on,
      authority_model: version.authority_model,
      status: version.status,
      source_prd: version.source_prd,
      limitations: version.limitations,
    },
    sources: {
      manifest_file: "TEMPLATE_LIBRARY_MANIFEST.csv",
      manifest_sha256: sha256Bytes(manifestBytes),
      library_version_file: "LIBRARY_VERSION.json",
      library_version_sha256: sha256Bytes(libraryVersionBytes),
    },
    counts: {
      records: records.length,
      baseline_artifact_types: version.baseline_artifact_types,
      policy_overlays: version.policy_overlays,
      office_deliverables: officeDeliverables.length,
    },
    records,
  };
  const registry = {
    ...payload,
    registry_hash: hashCanonical(payload),
  };
  return validateArtifactRegistry(registry, { libraryDirectory });
}

export function serializeArtifactRegistry(registry, options = {}) {
  const validated = validateArtifactRegistry(registry, options);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function loadArtifactRegistrySources(libraryDirectory) {
  const manifestPath = path.join(libraryDirectory, "TEMPLATE_LIBRARY_MANIFEST.csv");
  const libraryVersionPath = path.join(libraryDirectory, "LIBRARY_VERSION.json");
  return {
    manifestBytes: fs.readFileSync(manifestPath),
    libraryVersionBytes: fs.readFileSync(libraryVersionPath),
    libraryDirectory,
  };
}

export function canonicalRegistryPayloadJson(registry) {
  validateArtifactRegistry(registry);
  return canonicalJson(registryPayload(registry));
}
