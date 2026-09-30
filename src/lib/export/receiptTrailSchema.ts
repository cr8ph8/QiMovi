/**
 * Versioned JSON Schema for ReceiptTrail export packages.
 *
 * Embedded directly into every JSON export so auditors can validate the
 * bundle offline with any JSON Schema Draft 2020-12 validator (Ajv, ajv-cli,
 * jsonschema, python-jsonschema, etc.) without fetching remote resources.
 *
 * Versioning rules:
 *   - `RECEIPT_TRAIL_SCHEMA_VERSION` is the canonical export version.
 *   - Bump the PATCH segment for doc-only changes.
 *   - Bump the MINOR segment for additive, backward-compatible fields.
 *   - Bump the MAJOR segment for breaking rename/removal/type changes and
 *     update `SCHEMA_COMPAT` accordingly.
 *
 * `SCHEMA_COMPAT` lists every prior `schema` identifier that this validator
 * still accepts as equivalent, so older archives keep verifying cleanly.
 */

export const RECEIPT_TRAIL_SCHEMA_VERSION = "2.0.0" as const;
export const RECEIPT_TRAIL_SCHEMA_ID =
  "https://caniscreenwrite.com/schemas/receipt-trail-export/v2.json" as const;
export const RECEIPT_TRAIL_SCHEMA_NAME = "receipt_trail_export" as const;

/** Legacy `schema` string tags accepted for backward-compat validation. */
export const SCHEMA_COMPAT: readonly string[] = [
  "receipt_trail_export_v1",
  "receipt_trail_export_v2",
] as const;

export const RECEIPT_TRAIL_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RECEIPT_TRAIL_SCHEMA_ID,
  title: "ReceiptTrail Export Package",
  description:
    "Machine-readable, versioned envelope for a ReceiptTrail export. " +
    "Auditors can validate any exported package against this schema " +
    "offline; the schema travels with the payload under `schema_definition`.",
  type: "object",
  required: [
    "schema",
    "schema_version",
    "schema_id",
    "generated_at",
    "title",
    "count",
    "entries",
  ],
  additionalProperties: false,
  properties: {
    schema: {
      type: "string",
      description:
        "Stable schema tag. Historic values are enumerated for back-compat.",
      enum: SCHEMA_COMPAT,
    },
    schema_version: {
      type: "string",
      description: "SemVer of the schema this payload conforms to.",
      pattern: "^\\d+\\.\\d+\\.\\d+$",
    },
    schema_id: {
      type: "string",
      format: "uri",
      description: "Canonical URI identifier of the schema.",
    },
    schema_definition: {
      type: "object",
      description:
        "Full inline JSON Schema (Draft 2020-12) so this bundle validates offline.",
    },
    generated_at: {
      type: "string",
      format: "date-time",
      description: "ISO-8601 timestamp when the export was produced.",
    },
    title: { type: "string", minLength: 1 },
    subtitle: { type: ["string", "null"] },
    audience: { type: ["string", "null"] },
    evidence: {
      description:
        "Optional evidence anchor tying this package to a bundle hash.",
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            hash: { type: ["string", "null"] },
            label: { type: ["string", "null"] },
            generatedAt: { type: ["string", "null"], format: "date-time" },
          },
        },
      ],
    },
    count: {
      type: "integer",
      minimum: 0,
      description: "Must equal `entries.length`.",
    },
    entries: {
      type: "array",
      items: { $ref: "#/$defs/receiptEntry" },
    },
  },
  $defs: {
    receiptEntry: {
      type: "object",
      required: ["id", "title"],
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1 },
        timestamp: { type: ["string", "null"] },
        title: { type: "string" },
        badges: {
          type: "array",
          items: { $ref: "#/$defs/receiptBadge" },
        },
        notes: { type: "string" },
        hash: { type: ["string", "null"] },
        hash_label: { type: ["string", "null"] },
        correlation_id: { type: ["string", "null"] },
        actor: { type: ["string", "null"] },
      },
    },
    receiptBadge: {
      type: "object",
      required: ["label", "tone"],
      additionalProperties: false,
      properties: {
        label: { type: "string", minLength: 1 },
        tone: {
          type: "string",
          enum: ["default", "primary", "warn", "danger", "success"],
        },
        title: { type: ["string", "null"] },
      },
    },
  },
} as const;

export type ReceiptTrailSchema = typeof RECEIPT_TRAIL_JSON_SCHEMA;
