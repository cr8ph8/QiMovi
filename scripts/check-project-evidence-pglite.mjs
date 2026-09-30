import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = "supabase/tests/fixtures/security_baseline.sql";
const MANIFEST = "supabase/tests/fixtures/security_migrations.txt";
const SUPERSEDED_MANIFEST = "supabase/tests/fixtures/security_migrations_superseded.txt";
const NATIVE_LEDGER_SUITE = "supabase/tests/project_evidence_observation_ledger.test.sql";
const NATIVE_CONCURRENCY_SETUP = "supabase/tests/project_evidence_concurrency_setup.sql";
const NATIVE_CONCURRENCY_CALL = "supabase/tests/project_evidence_concurrency_call.sql";
const DATABASE = "security_regressions";
const EVIDENCE_FIXTURES = Object.freeze({
  STORY_ROOM_REVIEW_RECEIPT: {
    path: "supabase/tests/fixtures/project_evidence_story_room_review.valid.json",
    schemaVersion: "filmstack-story-room-review-receipt/v2",
  },
  STORYBOARD_REVIEW_RECEIPT: {
    path: "supabase/tests/fixtures/project_evidence_storyboard_review.valid.json",
    schemaVersion: "filmstack-storyboard-review-receipt/v2",
  },
  STORY_ROOM_BINDING_PREFLIGHT: {
    path: "supabase/tests/fixtures/project_evidence_story_room_binding_preflight.valid.json",
    schemaVersion: "filmstack-story-room-binding-preflight/v1",
  },
});

const IDS = Object.freeze({
  owner: "10000000-0000-4000-8000-000000000001",
  stranger: "10000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-000000000003",
  entry: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  context: "40000000-0000-4000-8000-000000000001",
  contextWithoutBytes: "40000000-0000-4000-8000-000000000002",
  contextWrongIdentity: "40000000-0000-4000-8000-000000000003",
  contextWriter: "40000000-0000-4000-8000-000000000004",
});

const PROJECT_UPDATED_AT = "2026-08-31T20:00:00.123456Z";
const RPC_SQL = `
  SELECT * FROM public.record_project_evidence_observation_v1(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
    $7::text, $8::text, $9::integer, $10::text, $11::text, $12::uuid
  )
`;

let passed = 0;

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactDocument(document) {
  const text = `${canonicalJson(document)}\n`;
  const bytes = Buffer.from(text, "utf8");
  return {
    text,
    bytes,
    base64: bytes.toString("base64"),
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function exactBytes(value) {
  const bytes = Buffer.from(value);
  return {
    bytes,
    base64: bytes.toString("base64"),
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function serializeEvidenceDocument(recordKind, document) {
  return recordKind === "STORYBOARD_REVIEW_RECEIPT"
    ? `${JSON.stringify(document, null, 2)}\n`
    : `${canonicalJson(document)}\n`;
}

function exactEvidenceDocument(recordKind, document) {
  return exactBytes(serializeEvidenceDocument(recordKind, document));
}

async function loadEvidenceFixture(recordKind) {
  const fixture = EVIDENCE_FIXTURES[recordKind];
  assert.ok(fixture, `Unknown evidence fixture kind: ${recordKind}`);
  const text = await fs.readFile(path.join(ROOT_DIR, fixture.path), "utf8");
  const document = JSON.parse(text);
  assert.equal(document.schema_version, fixture.schemaVersion);
  assert.equal(
    text,
    serializeEvidenceDocument(recordKind, document),
    `${fixture.path} must preserve the exact local exporter serialization`,
  );
  return { document, exact: exactBytes(text) };
}

function stripPsqlMetaCommands(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");
}

async function check(label, work) {
  await work();
  passed += 1;
  console.log(`✓ ${label}`);
}

async function expectError(label, work, expectedCode) {
  let caught = null;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label}: expected ${expectedCode}, but the operation succeeded`);
  assert.match(String(caught), new RegExp(expectedCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

async function withRole(pg, role, claims, work) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  await pg.exec(`SET ROLE ${role}`);
  try {
    await pg.query(
      "SELECT set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.role', $2, false)",
      [JSON.stringify(claims), claims.role ?? ""],
    );
    return await work();
  } finally {
    await pg.exec("RESET ROLE");
    await pg.query(
      "SELECT set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.role', '', false)",
    );
  }
}

async function applyFocusedSchema(pg) {
  const baselineSql = stripPsqlMetaCommands(
    await fs.readFile(path.join(ROOT_DIR, BASELINE), "utf8"),
  );
  await pg.exec(baselineSql);

  const migrations = (await fs.readFile(path.join(ROOT_DIR, MANIFEST), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (const migration of migrations) {
    if (!migration.startsWith("supabase/migrations/") || migration.includes("..")) {
      throw new Error(`Unsafe migration path in ${MANIFEST}: ${migration}`);
    }
    await pg.exec(await fs.readFile(path.join(ROOT_DIR, migration), "utf8"));
  }
  return migrations;
}

async function verifyExtensionsSchemaFallback() {
  const alternateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "qicsw-pglite-extensions-"),
  );
  let alternate;
  try {
    alternate = await PGlite.create({
      dataDir: alternateRoot,
      extensions: { pgcrypto },
    });
    await alternate.exec(`CREATE DATABASE ${DATABASE}`);
    await alternate.close();
    alternate = await PGlite.create({
      dataDir: alternateRoot,
      database: DATABASE,
      extensions: { pgcrypto },
    });
    await alternate.exec(`
      CREATE SCHEMA extensions;
      CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    `);
    await applyFocusedSchema(alternate);
    const result = await alternate.query(`
      SELECT
        n.nspname AS extension_schema,
        public.project_evidence_sha256_hex_v1(convert_to('abc', 'UTF8')) AS golden
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pgcrypto'
    `);
    assert.deepEqual(result.rows[0], {
      extension_schema: "extensions",
      golden: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  } finally {
    if (alternate) await alternate.close().catch(() => undefined);
    const expectedPrefix = path.join(os.tmpdir(), "qicsw-pglite-extensions-");
    if (alternateRoot.startsWith(expectedPrefix)) {
      await fs.rm(alternateRoot, { recursive: true, force: true });
    }
  }
}

function recordParameters({
  contextId = IDS.context,
  contextHash,
  baseHash,
  exact,
  idempotencyKey,
  recordedBy = IDS.owner,
  recordKind = "STORY_ROOM_REVIEW_RECEIPT",
  schemaVersion = "filmstack-story-room-review-receipt/v2",
}) {
  return [
    IDS.project,
    IDS.entry,
    contextId,
    contextHash,
    baseHash,
    recordKind,
    schemaVersion,
    exact.base64,
    exact.byteLength,
    exact.sha256,
    idempotencyKey,
    recordedBy,
  ];
}

async function callRecorder(pg, parameters) {
  return withRole(pg, "service_role", { role: "service_role" }, async () => {
    const result = await pg.query(RPC_SQL, parameters);
    assert.equal(result.rows.length, 1);
    return result.rows[0];
  });
}

function observationEnvelope({ id, actor, baseHash, contextHash, local, createdAt }) {
  return {
    schema_version: "filmstack-project-evidence-observation/v1",
    observation_id: id,
    observation_state: "RECORDED_NON_AUTHORITATIVE",
    authority_state: "NO_EXTERNAL_AUTHORITY",
    authenticated_actor_id: actor,
    record_kind: "STORY_ROOM_REVIEW_RECEIPT",
    local_document: {
      schema_version: "filmstack-story-room-review-receipt/v2",
      sha256: local.sha256,
      byte_length: local.byteLength,
      encoding: "UTF-8",
      media_type: "application/json",
      historical_claims_preserved: true,
    },
    binding: {
      project_id: IDS.project,
      entry_id: IDS.entry,
      context_bundle_id: IDS.context,
      context_payload_hash: contextHash,
      recording_base_hash: baseHash,
      correspondence_state: "VERIFIED_TO_TARGET_CONTEXT_SNAPSHOT",
      correspondence_claim: "LOCAL_BYTES_MATCH_TARGET_CONTEXT_SNAPSHOT_ONLY",
      context_currentness_claim: "NOT_MADE",
      pack_provenance_claim: "NOT_MADE",
      source_admission_claim: "NOT_MADE",
      canon_claim: "NOT_MADE",
      production_authorization_claim: "NOT_MADE",
    },
    effects: {
      persistent_state_change: "EVIDENCE_OBSERVATION_AND_IDEMPOTENCY_REQUEST_APPENDED",
      authoritative_project_state_change: "NONE",
      project_artifact_creation: "NOT_PERFORMED",
      source_admission: "NOT_PERFORMED",
      admission_candidate_creation: "NOT_PERFORMED",
      lifecycle_transition: "NOT_PERFORMED",
      production_gate: "UNCHANGED_PRODUCE_BLOCKED",
      provider_call: false,
      token_spend: false,
    },
    created_at: createdAt,
  };
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qicsw-pglite-ledger-"));
  let pg;
  try {
    pg = await PGlite.create({ dataDir: tempRoot, extensions: { pgcrypto } });
    await pg.exec(`CREATE DATABASE ${DATABASE}`);
    await pg.close();
    pg = await PGlite.create({
      dataDir: tempRoot,
      database: DATABASE,
      extensions: { pgcrypto },
    });

    const migrations = await applyFocusedSchema(pg);
    await check("focused migration manifest reaches rehearsal draft storage after atomic packs", async () => {
      assert.equal(migrations.at(-2), "supabase/migrations/20260904090000_atomic_preproduction_pack_v2.sql");
      assert.equal(migrations.at(-1), "supabase/migrations/20260905090000_rehearsal_drafts_v1.sql");
      const result = await pg.query("SELECT current_database() AS database");
      assert.equal(result.rows[0].database, DATABASE);
    });

    await check("every containment-era migration is classified locally", async () => {
      const superseded = (await fs.readFile(
        path.join(ROOT_DIR, SUPERSEDED_MANIFEST),
        "utf8",
      ))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      const declarations = [...migrations, ...superseded];
      const declared = new Set(declarations);
      const duplicates = [...declared]
        .filter((migration) => declarations.filter((candidate) => candidate === migration).length > 1)
        .sort();
      assert.deepEqual(duplicates, [], "migration manifests must not declare the same file twice");
      const firstManaged = [...declared].sort()[0];
      assert.ok(firstManaged, "security migration manifests must not be empty");
      const migrationFiles = (await fs.readdir(
        path.join(ROOT_DIR, "supabase/migrations"),
      ))
        .filter((name) => name.endsWith(".sql"))
        .map((name) => `supabase/migrations/${name}`)
        .sort();
      const unclassified = migrationFiles.filter(
        (migration) => migration >= firstManaged && !declared.has(migration),
      );
      assert.deepEqual(unclassified, []);
    });

    await check("shared native-PostgreSQL ledger regression SQL executes cleanly", async () => {
      await pg.exec(await fs.readFile(path.join(ROOT_DIR, NATIVE_LEDGER_SUITE), "utf8"));
    });

    await check("native concurrency fixture and writer materialize one exact request", async () => {
      await pg.exec(stripPsqlMetaCommands(
        await fs.readFile(path.join(ROOT_DIR, NATIVE_CONCURRENCY_SETUP), "utf8"),
      ));
      const callSql = stripPsqlMetaCommands(
        await fs.readFile(path.join(ROOT_DIR, NATIVE_CONCURRENCY_CALL), "utf8"),
      ).replaceAll(":'race_key'", "'pglite-concurrency-call'");
      await pg.exec(callSql);
      await pg.exec("RESET ROLE");
      await pg.query(
        "SELECT set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claims', '', false)",
      );
      const result = await pg.query(`
        SELECT
          (SELECT count(*)::integer FROM project_evidence_test.fixture) AS fixture_count,
          bool_and(f.local_byte_length > 0) AS has_bytes,
          bool_and(f.local_sha256 = public.project_evidence_sha256_hex_v1(
            decode(local_exact_bytes_base64, 'base64')
          )) AS hash_matches,
          (SELECT count(*)::integer FROM public.project_evidence_observations) AS observation_count,
          (SELECT count(*)::integer FROM public.project_evidence_observation_requests) AS request_count
        FROM project_evidence_test.fixture f
      `);
      assert.deepEqual(result.rows[0], {
        fixture_count: 1,
        has_bytes: true,
        hash_matches: true,
        observation_count: 1,
        request_count: 1,
      });
      await pg.exec(`
        TRUNCATE TABLE
          public.project_evidence_observation_requests,
          public.project_evidence_observations;
        DELETE FROM public.context_bundles
         WHERE id = '96000000-0000-4000-8000-000000000004'::uuid;
        DELETE FROM public.project_legacy_map
         WHERE project_id = '96000000-0000-4000-8000-000000000003'::uuid;
        DELETE FROM public.projects
         WHERE id = '96000000-0000-4000-8000-000000000003'::uuid;
        DELETE FROM public.entries
         WHERE id = '96000000-0000-4000-8000-000000000002'::uuid;
        DELETE FROM auth.users
         WHERE id = '96000000-0000-4000-8000-000000000001'::uuid;
        UPDATE public.site_settings
           SET value = false, text_value = 'off'
         WHERE key = 'production_review_evidence_v1';
        DROP SCHEMA project_evidence_test CASCADE;
      `);
    });

    await check("pgcrypto is installed in the migration's protected public search path", async () => {
      const result = await pg.query(`
        SELECT n.nspname AS schema
          FROM pg_extension e
          JOIN pg_namespace n ON n.oid = e.extnamespace
         WHERE e.extname = 'pgcrypto'
      `);
      assert.equal(result.rows[0].schema, "public");
    });

    await check("hash wrapper binds pgcrypto preinstalled in the extensions schema", async () => {
      await verifyExtensionsSchemaFallback();
    });

    await check("migration forces the recording feature off", async () => {
      const result = await pg.query(`
        SELECT value, text_value FROM public.site_settings
         WHERE key = 'production_review_evidence_v1'
      `);
      assert.deepEqual(result.rows[0], { value: false, text_value: "off" });
    });

    const contextBase = {
      project_id: IDS.project,
      entry_id: IDS.entry,
      sensitivity: "standard",
      parent_hash: null,
      author_intent: { title: "ARCHi", logline: "A test begins.", themes: [], tone: "luminous", goals: [] },
      narrative_tradition: { id: null, label: null },
      target_format: { category: "micro-series", page_bounds: { min: null, max: null } },
      story_plan: {
        numeric_boundary_vector: { tiny: 1e-7, huge: 1e21 },
        key_order_vector: { A: 1, a: 2, "é": 3, "😀": 4 },
      },
      script_text: { fountain: "FADE IN:", page_count: 1 },
      characters: [{ name: "ARCHi" }],
      world_rules: [],
      locked_elements: [],
      prior_artifacts: [],
      revision_history: [],
      provenance: { ai_influence_score: null, gate_verdict: null, sources: [] },
      output_request: { mode: "story_room_review" },
    };
    const contextCanonical = canonicalJson(contextBase);
    const contextHash = sha256(contextCanonical);
    const contextPayload = { ...contextBase, content_hash: contextHash };
    const contextFileSha = sha256(`${JSON.stringify(contextPayload, null, 2)}\n`);
    let evidenceFixtures;

    await check("shared evidence fixtures preserve exact exporter bytes and target context", async () => {
      evidenceFixtures = Object.fromEntries(await Promise.all(
        Object.keys(EVIDENCE_FIXTURES).map(async (recordKind) => [
          recordKind,
          await loadEvidenceFixture(recordKind),
        ]),
      ));

      const storyRoomContext = evidenceFixtures.STORY_ROOM_REVIEW_RECEIPT
        .document.basis.workspace_context;
      assert.equal(storyRoomContext.selected_context_content_hash, contextHash);
      assert.equal(storyRoomContext.context_bundle.exact_file_sha256, contextFileSha);
      assert.equal(
        evidenceFixtures.STORYBOARD_REVIEW_RECEIPT.document.basis.context_hash,
        contextHash,
      );
      assert.equal(
        evidenceFixtures.STORY_ROOM_BINDING_PREFLIGHT.document.basis
          .workspace_context.context_bundle.declared_content_hash,
        contextHash,
      );
    });

    await pg.query(`
      INSERT INTO auth.users (id, aud, role, email) VALUES
        ($1::uuid, 'authenticated', 'authenticated', 'owner@example.invalid'),
        ($2::uuid, 'authenticated', 'authenticated', 'stranger@example.invalid'),
        ($3::uuid, 'authenticated', 'authenticated', 'admin@example.invalid')
    `, [IDS.owner, IDS.stranger, IDS.admin]);
    await pg.query(`
      INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, 'admin')
    `, [IDS.admin]);
    await pg.query(`
      INSERT INTO public.entries (id, user_id, title) VALUES ($1::uuid, $2::uuid, 'ARCHi')
    `, [IDS.entry, IDS.owner]);
    await pg.query(`
      INSERT INTO public.projects (id, owner_id, lifecycle_state, updated_at)
        VALUES ($1::uuid, $2::uuid, 'draft', $3::timestamptz)
    `, [IDS.project, IDS.owner, PROJECT_UPDATED_AT]);
    await pg.query(`
      INSERT INTO public.project_legacy_map (project_id, source_table, source_id)
        VALUES ($1::uuid, 'entries', $2::uuid)
    `, [IDS.project, IDS.entry]);
    await pg.query(`
      INSERT INTO public.context_bundles (
        id, project_id, entry_id, payload_json, payload_hash, payload_canonical_text
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::text, $6::text)
    `, [
      IDS.context,
      IDS.project,
      IDS.entry,
      JSON.stringify(contextPayload),
      contextHash,
      contextCanonical,
    ]);

    await check("exact JavaScript context bytes survive exponent and Unicode JSONB normalization", async () => {
      const result = await pg.query(`
        SELECT payload_canonical_text,
               public.project_evidence_sha256_hex_v1(
                 convert_to(payload_canonical_text, 'UTF8')
               ) AS hash
          FROM public.context_bundles WHERE id = $1::uuid
      `, [IDS.context]);
      assert.equal(result.rows[0].payload_canonical_text, contextCanonical);
      assert.equal(result.rows[0].hash, contextHash);
      assert.match(contextCanonical, /1e-7/);
      assert.match(contextCanonical, /1e\+21/);
    });

    await check("service-role context writer can insert exact bytes and backfill non-identity metadata", async () => {
      const writerBase = {
        ...contextBase,
        author_intent: { ...contextBase.author_intent, title: "ARCHi writer probe" },
      };
      const writerCanonical = canonicalJson(writerBase);
      const writerHash = sha256(writerCanonical);
      await withRole(pg, "service_role", { role: "service_role" }, async () => {
        await pg.query(`
          INSERT INTO public.context_bundles (
            id, project_id, entry_id, built_by, payload_json, payload_hash,
            payload_canonical_text, output_request, mode
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::jsonb, $6, $7,
            $8::jsonb, 'story_room_review'
          )
        `, [
          IDS.contextWriter,
          IDS.project,
          IDS.entry,
          IDS.owner,
          JSON.stringify({ ...writerBase, content_hash: writerHash }),
          writerHash,
          writerCanonical,
          JSON.stringify({ mode: "story_room_review" }),
        ]);
        await pg.query(`
          UPDATE public.context_bundles
             SET story_plan_hash = $2, provenance_hash = $3,
                 continuity_node_id = $4::uuid
           WHERE id = $1::uuid
        `, [IDS.contextWriter, "1".repeat(64), "2".repeat(64), randomUUID()]);
      });
      const result = await pg.query(`
        SELECT payload_hash, story_plan_hash, provenance_hash
          FROM public.context_bundles WHERE id = $1::uuid
      `, [IDS.contextWriter]);
      assert.deepEqual(result.rows[0], {
        payload_hash: writerHash,
        story_plan_hash: "1".repeat(64),
        provenance_hash: "2".repeat(64),
      });
    });

    let recordingContext;
    await check("owner resolves an authenticated project-entry-context base hash", async () => {
      recordingContext = await withRole(
        pg,
        "authenticated",
        { sub: IDS.owner, role: "authenticated" },
        async () => (await pg.query(`
          SELECT * FROM public.get_project_evidence_recording_context_v1(
            $1::uuid, $2::uuid, $3::uuid
          )
        `, [IDS.project, IDS.entry, IDS.context])).rows[0],
      );
      assert.equal(recordingContext.context_payload_hash, contextHash);
      assert.match(recordingContext.recording_base_hash, /^[a-f0-9]{64}$/);
    });

    await check("non-owner cannot resolve the recording base", async () => {
      await expectError("non-owner context", () => withRole(
        pg,
        "authenticated",
        { sub: IDS.stranger, role: "authenticated" },
        () => pg.query(`SELECT * FROM public.get_project_evidence_recording_context_v1($1::uuid,$2::uuid,$3::uuid)`, [IDS.project, IDS.entry, IDS.context]),
      ), "not_authorized");
    });

    const receipt = evidenceFixtures.STORY_ROOM_REVIEW_RECEIPT.document;
    const exact = evidenceFixtures.STORY_ROOM_REVIEW_RECEIPT.exact;
    const baseInput = {
      contextHash,
      baseHash: recordingContext.recording_base_hash,
      exact,
      idempotencyKey: "story-room-review:owner:first",
    };

    await check("service-role claim is required independently of SQL ownership", async () => {
      await expectError("missing service claim", () => pg.query(
        RPC_SQL,
        recordParameters({ ...baseInput, idempotencyKey: "story-room-review:no-service" }),
      ), "service_role_required");
    });

    await check("authenticated role cannot execute the recorder RPC", async () => {
      await expectError("authenticated execute", () => withRole(
        pg,
        "authenticated",
        { sub: IDS.owner, role: "authenticated" },
        () => pg.query(
          RPC_SQL,
          recordParameters({ ...baseInput, idempotencyKey: "story-room-review:auth-denied" }),
        ),
      ), "permission denied");
    });

    await check("feature flag fails closed for false/off, true/off and false/on", async () => {
      for (const [value, textValue, suffix] of [
        [false, "off", "off"],
        [true, "off", "split-a"],
        [false, "on", "split-b"],
      ]) {
        await pg.query(`
          UPDATE public.site_settings SET value = $1::boolean, text_value = $2::text
           WHERE key = 'production_review_evidence_v1'
        `, [value, textValue]);
        await expectError(`flag ${suffix}`, () => callRecorder(
          pg,
          recordParameters({ ...baseInput, idempotencyKey: `story-room-review:flag:${suffix}` }),
        ), "production_review_evidence_disabled");
      }
      await pg.exec(`
        UPDATE public.site_settings SET value = true, text_value = 'on'
         WHERE key = 'production_review_evidence_v1'
      `);
    });

    await check("malformed recorder inputs fail closed without appending state", async () => {
      const cases = [];
      const withChange = (index, value, code, label) => {
        const parameters = recordParameters({
          ...baseInput,
          idempotencyKey: `negative-matrix:${label}`,
        });
        parameters[index] = value;
        cases.push({ label, code, parameters });
      };
      withChange(3, "not-a-hash", "invalid_hash_format", "hash");
      withChange(7, "%%%", "invalid_base64", "base64");
      withChange(8, 0, "invalid_expected_local_byte_length", "length");
      withChange(10, "short", "invalid_idempotency_key", "key");
      withChange(5, "UNKNOWN_RECORD_KIND", "unsupported_record_kind_or_schema", "kind");

      const invalidUtf8 = recordParameters({
        ...baseInput,
        exact: exactBytes(Uint8Array.from([0xff, 0xfe])),
        idempotencyKey: "negative-matrix:invalid-utf8",
      });
      cases.push({ label: "invalid UTF-8", code: "invalid_utf8_or_json", parameters: invalidUtf8 });

      const missingLf = recordParameters({
        ...baseInput,
        exact: exactBytes(Buffer.from(canonicalJson(receipt), "utf8")),
        idempotencyKey: "negative-matrix:missing-lf",
      });
      cases.push({ label: "missing trailing LF", code: "local_serialization_missing_trailing_lf", parameters: missingLf });

      const wrongSchema = structuredClone(receipt);
      wrongSchema.schema_version = "filmstack-story-room-review-receipt/v1";
      const wrongSchemaParameters = recordParameters({
        ...baseInput,
        exact: exactDocument(wrongSchema),
        idempotencyKey: "negative-matrix:local-schema",
      });
      cases.push({ label: "local schema", code: "local_schema_mismatch", parameters: wrongSchemaParameters });

      for (const testCase of cases) {
        await expectError(
          testCase.label,
          () => callRecorder(pg, testCase.parameters),
          testCase.code,
        );
      }
      const counts = await pg.query(`
        SELECT
          (SELECT count(*)::int FROM public.project_evidence_observations) AS observations,
          (SELECT count(*)::int FROM public.project_evidence_observation_requests) AS requests
      `);
      assert.deepEqual(counts.rows[0], { observations: 0, requests: 0 });
    });

    let first;
    await check("first exact receipt appends one non-authoritative observation and request", async () => {
      first = await callRecorder(pg, recordParameters(baseInput));
      assert.equal(first.replayed, false);
      assert.equal(first.reused_exact_observation, false);
      assert.equal(first.observation_state, "RECORDED_NON_AUTHORITATIVE");
      assert.equal(first.persistence_effect, "EVIDENCE_OBSERVATION_AND_IDEMPOTENCY_REQUEST_APPENDED");
      const counts = await pg.query(`
        SELECT
          (SELECT count(*)::int FROM public.project_evidence_observations) AS observations,
          (SELECT count(*)::int FROM public.project_evidence_observation_requests) AS requests
      `);
      assert.deepEqual(counts.rows[0], { observations: 1, requests: 1 });
    });

    await check("stored bytes, SHA-256, envelope hash and actor bindings recompute exactly", async () => {
      const result = await pg.query(`
        SELECT
          encode(local_exact_bytes, 'base64') AS base64,
          local_sha256,
          encode(digest(local_exact_bytes, 'sha256'), 'hex') AS recomputed_local,
          envelope_sha256,
          encode(
            digest(
              convert_to(public.project_evidence_canonical_json_v1(envelope_json), 'UTF8'),
              'sha256'
            ),
            'hex'
          ) AS recomputed_envelope,
          envelope_json ->> 'authenticated_actor_id' AS envelope_actor,
          created_at
        FROM public.project_evidence_observations WHERE id = $1::uuid
      `, [first.observation_id]);
      const row = result.rows[0];
      assert.equal(row.base64.replace(/\n/g, ""), exact.base64);
      assert.equal(row.local_sha256, exact.sha256);
      assert.equal(row.recomputed_local, exact.sha256);
      assert.equal(row.envelope_sha256, row.recomputed_envelope);
      assert.equal(row.envelope_actor, IDS.owner);

      const requestTime = await pg.query(`
        SELECT r.created_at >= o.created_at AS causal_order
          FROM public.project_evidence_observation_requests r
          JOIN public.project_evidence_observations o ON o.id = r.observation_id
         WHERE r.idempotency_key = $1
      `, [baseInput.idempotencyKey]);
      assert.equal(requestTime.rows[0].causal_order, true);
    });

    await check("same idempotency key replays without another row", async () => {
      const replay = await callRecorder(pg, recordParameters(baseInput));
      assert.equal(replay.observation_id, first.observation_id);
      assert.equal(replay.replayed, true);
      assert.equal(replay.persistence_effect, "NONE_IDEMPOTENT_REPLAY");
      const counts = await pg.query(`SELECT count(*)::int AS count FROM public.project_evidence_observation_requests`);
      assert.equal(counts.rows[0].count, 1);
    });

    await check("same actor and bytes with a new key reuse the exact observation", async () => {
      const reused = await callRecorder(pg, recordParameters({
        ...baseInput,
        idempotencyKey: "story-room-review:owner:second",
      }));
      assert.equal(reused.observation_id, first.observation_id);
      assert.equal(reused.replayed, false);
      assert.equal(reused.reused_exact_observation, true);
      assert.equal(reused.persistence_effect, "IDEMPOTENCY_REQUEST_APPENDED_REUSING_EXACT_OBSERVATION");
    });

    await check("same idempotency key with changed exact bytes conflicts", async () => {
      const changed = structuredClone(receipt);
      changed.reviewer.label = "Changed local reviewer";
      const changedExact = exactDocument(changed);
      await expectError("idempotency conflict", () => callRecorder(pg, recordParameters({
        ...baseInput,
        exact: changedExact,
      })), "idempotency_key_conflict");
    });

    await check("a second authorized actor receives a distinct actor-bound envelope", async () => {
      const adminResult = await callRecorder(pg, recordParameters({
        ...baseInput,
        idempotencyKey: "story-room-review:admin:first",
        recordedBy: IDS.admin,
      }));
      assert.notEqual(adminResult.observation_id, first.observation_id);
      const actor = await pg.query(`
        SELECT envelope_json ->> 'authenticated_actor_id' AS actor
          FROM public.project_evidence_observations WHERE id = $1::uuid
      `, [adminResult.observation_id]);
      assert.equal(actor.rows[0].actor, IDS.admin);
    });

    await check("RLS exposes both evidence ledgers only to the owner or admin", async () => {
      const countAs = (actor) => withRole(
        pg,
        "authenticated",
        { sub: actor, role: "authenticated" },
        async () => (await pg.query(`
          SELECT
            (SELECT count(*)::int FROM public.project_evidence_observations) AS observations,
            (SELECT count(*)::int FROM public.project_evidence_observation_requests) AS requests
        `)).rows[0],
      );
      assert.deepEqual(await countAs(IDS.owner), { observations: 2, requests: 3 });
      assert.deepEqual(await countAs(IDS.stranger), { observations: 0, requests: 0 });
      assert.deepEqual(await countAs(IDS.admin), { observations: 2, requests: 3 });
    });

    await check("authenticated and service roles cannot write ledger tables directly", async () => {
      for (const role of ["authenticated", "service_role"]) {
        await expectError(`${role} direct insert`, () => withRole(
          pg,
          role,
          { sub: IDS.owner, role },
          () => pg.exec("INSERT INTO public.project_evidence_observations DEFAULT VALUES"),
        ), "permission denied");
        await expectError(`${role} direct request insert`, () => withRole(
          pg,
          role,
          { sub: IDS.owner, role },
          () => pg.exec("INSERT INTO public.project_evidence_observation_requests DEFAULT VALUES"),
        ), "permission denied");
      }
    });

    await check("table-owner mutation is stopped by append-only triggers", async () => {
      await expectError("owner update", () => pg.query(`
        UPDATE public.project_evidence_observations SET observation_state = observation_state
         WHERE id = $1::uuid
      `, [first.observation_id]), "project_evidence_is_append_only");
      await expectError("owner delete", () => pg.query(`
        DELETE FROM public.project_evidence_observation_requests
         WHERE idempotency_key = $1
      `, [baseInput.idempotencyKey]), "project_evidence_is_append_only");
    });

    await check("table constraints reject a privileged empty or unbound envelope", async () => {
      await expectError("empty envelope", () => pg.query(`
        INSERT INTO public.project_evidence_observations (
          id, project_id, entry_id, context_bundle_id, context_payload_hash,
          recording_base_hash, record_kind, local_schema_version,
          local_exact_bytes, local_sha256, local_byte_length, recorded_by,
          envelope_json, envelope_sha256, created_at
        )
        SELECT
          gen_random_uuid(), project_id, entry_id, context_bundle_id, context_payload_hash,
          recording_base_hash, record_kind, local_schema_version,
          local_exact_bytes, local_sha256, local_byte_length, recorded_by,
          '{}'::jsonb,
          encode(digest(convert_to('{}', 'UTF8'), 'sha256'), 'hex'),
          created_at
        FROM public.project_evidence_observations WHERE id = $1::uuid
      `, [first.observation_id]), "project_evidence_envelope_contract");
    });

    await check("request rows cannot point at another actor's observation identity", async () => {
      await expectError("request linkage", () => pg.query(`
        INSERT INTO public.project_evidence_observation_requests (
          observation_id, project_id, recorded_by, idempotency_key,
          request_hash, recording_base_hash
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'request-linkage:wrong-actor', $4, $5)
      `, [first.observation_id, IDS.project, IDS.admin, "d".repeat(64), baseInput.baseHash]), "foreign key constraint");
    });

    await check("recording base CAS rejects a stale project snapshot", async () => {
      await pg.exec(`UPDATE public.projects SET updated_at = '2026-08-31T20:00:01.123456Z' WHERE id = '${IDS.project}'`);
      await expectError("stale base", () => callRecorder(pg, recordParameters({
        ...baseInput,
        idempotencyKey: "story-room-review:stale-base",
      })), "stale_recording_base");
      await pg.exec(`UPDATE public.projects SET updated_at = '${PROJECT_UPDATED_AT}' WHERE id = '${IDS.project}'`);
    });

    await check("context payload identity must match its project and entry row", async () => {
      const wrongBase = { ...contextBase, project_id: IDS.stranger };
      const wrongCanonical = canonicalJson(wrongBase);
      const wrongHash = sha256(wrongCanonical);
      await pg.query(`
        INSERT INTO public.context_bundles (
          id, project_id, entry_id, payload_json, payload_hash, payload_canonical_text
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5, $6)
      `, [
        IDS.contextWrongIdentity,
        IDS.project,
        IDS.entry,
        JSON.stringify({ ...wrongBase, content_hash: wrongHash }),
        wrongHash,
        wrongCanonical,
      ]);
      await expectError("context identity", () => withRole(
        pg,
        "authenticated",
        { sub: IDS.owner, role: "authenticated" },
        () => pg.query(`SELECT * FROM public.get_project_evidence_recording_context_v1($1::uuid,$2::uuid,$3::uuid)`, [IDS.project, IDS.entry, IDS.contextWrongIdentity]),
      ), "context_payload_identity_failure");
    });

    await check("legacy context rows without proven canonical bytes fail closed", async () => {
      await pg.query(`
        INSERT INTO public.context_bundles (
          id, project_id, entry_id, payload_json, payload_hash, payload_canonical_text
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5, NULL)
      `, [IDS.contextWithoutBytes, IDS.project, IDS.entry, JSON.stringify(contextPayload), contextHash]);
      await expectError("missing exact context bytes", () => withRole(
        pg,
        "authenticated",
        { sub: IDS.owner, role: "authenticated" },
        () => pg.query(`SELECT * FROM public.get_project_evidence_recording_context_v1($1::uuid,$2::uuid,$3::uuid)`, [IDS.project, IDS.entry, IDS.contextWithoutBytes]),
      ), "context_canonical_bytes_unavailable");
    });

    await check("context payload, hash and exact canonical text become immutable", async () => {
      await expectError("context hash mutation", () => pg.query(`
        UPDATE public.context_bundles SET payload_hash = $2 WHERE id = $1::uuid
      `, [IDS.context, "f".repeat(64)]), "context_bundle_identity_is_immutable");
      await expectError("context text mutation", () => pg.query(`
        UPDATE public.context_bundles SET payload_canonical_text = '{}' WHERE id = $1::uuid
      `, [IDS.context]), "context_bundle_identity_is_immutable");
    });

    await check("storyboard receipt branch records safe bytes and rejects authority escalation", async () => {
      const storyboard = evidenceFixtures.STORYBOARD_REVIEW_RECEIPT.document;
      const storyboardInput = {
        ...baseInput,
        exact: evidenceFixtures.STORYBOARD_REVIEW_RECEIPT.exact,
        idempotencyKey: "storyboard-review:owner:first",
        recordKind: "STORYBOARD_REVIEW_RECEIPT",
        schemaVersion: "filmstack-storyboard-review-receipt/v2",
      };
      const recorded = await callRecorder(pg, recordParameters(storyboardInput));
      assert.equal(recorded.observation_state, "RECORDED_NON_AUTHORITATIVE");

      const escalated = structuredClone(storyboard);
      escalated.effects.upload = true;
      await expectError("storyboard authority escalation", () => callRecorder(
        pg,
        recordParameters({
          ...storyboardInput,
          exact: exactEvidenceDocument("STORYBOARD_REVIEW_RECEIPT", escalated),
          idempotencyKey: "storyboard-review:owner:escalated",
        }),
      ), "local_authority_contract_violation");
    });

    await check("binding preflight branch records safe bytes and rejects source admission", async () => {
      const preflight = evidenceFixtures.STORY_ROOM_BINDING_PREFLIGHT.document;
      const preflightInput = {
        ...baseInput,
        exact: evidenceFixtures.STORY_ROOM_BINDING_PREFLIGHT.exact,
        idempotencyKey: "story-room-preflight:owner:first",
        recordKind: "STORY_ROOM_BINDING_PREFLIGHT",
        schemaVersion: "filmstack-story-room-binding-preflight/v1",
      };
      const recorded = await callRecorder(pg, recordParameters(preflightInput));
      assert.equal(recorded.observation_state, "RECORDED_NON_AUTHORITATIVE");

      const escalated = structuredClone(preflight);
      escalated.effects.source_admission = "PERFORMED";
      await expectError("preflight source admission", () => callRecorder(
        pg,
        recordParameters({
          ...preflightInput,
          exact: exactEvidenceDocument("STORY_ROOM_BINDING_PREFLIGHT", escalated),
          idempotencyKey: "story-room-preflight:owner:admitted",
        }),
      ), "local_authority_contract_violation");
    });

    await check("project lifecycle and artifact authority remain unchanged", async () => {
      const result = await pg.query(`
        SELECT p.lifecycle_state::text,
               (SELECT count(*)::int FROM public.project_artifacts a WHERE a.project_id = p.id) AS artifacts
          FROM public.projects p WHERE p.id = $1::uuid
      `, [IDS.project]);
      assert.deepEqual(result.rows[0], { lifecycle_state: "draft", artifacts: 0 });
    });

    await check("project observation-count quota rejects the 129th distinct observation", async () => {
      const existingCount = Number((await pg.query(`
        SELECT count(*)::int AS count
          FROM public.project_evidence_observations
         WHERE project_id = $1::uuid
      `, [IDS.project])).rows[0].count);
      for (let index = 0; index < 128 - existingCount; index += 1) {
        const localBytes = Buffer.from(`quota-fixture-${index}`, "utf8");
        const local = {
          bytes: localBytes,
          byteLength: localBytes.byteLength,
          sha256: sha256(localBytes),
        };
        const id = randomUUID();
        const createdAt = new Date(Date.UTC(2026, 7, 31, 21, 0, index)).toISOString();
        const envelope = observationEnvelope({
          id,
          actor: IDS.owner,
          baseHash: baseInput.baseHash,
          contextHash,
          local,
          createdAt,
        });
        await pg.query(`
          INSERT INTO public.project_evidence_observations (
            id, project_id, entry_id, context_bundle_id, context_payload_hash,
            recording_base_hash, record_kind, local_schema_version,
            local_exact_bytes, local_sha256, local_byte_length, recorded_by,
            envelope_json, envelope_sha256, created_at
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
            'STORY_ROOM_REVIEW_RECEIPT', 'filmstack-story-room-review-receipt/v2',
            $7::bytea, $8, $9::integer, $10::uuid, $11::jsonb, $12, $13::timestamptz
          )
        `, [
          id,
          IDS.project,
          IDS.entry,
          IDS.context,
          contextHash,
          baseInput.baseHash,
          localBytes,
          local.sha256,
          local.byteLength,
          IDS.owner,
          JSON.stringify(envelope),
          sha256(canonicalJson(envelope)),
          createdAt,
        ]);
      }
      const changed = structuredClone(receipt);
      changed.reviewer.label = "Observation quota probe";
      await expectError("observation quota", () => callRecorder(pg, recordParameters({
        ...baseInput,
        exact: exactDocument(changed),
        idempotencyKey: "story-room-review:observation-quota",
      })), "project_evidence_observation_quota_exhausted");
    });

    await check("per-actor request quota rejects the 257th request", async () => {
      const existingActorRequests = Number((await pg.query(`
        SELECT count(*)::int AS count
          FROM public.project_evidence_observation_requests
         WHERE project_id = $1::uuid AND recorded_by = $2::uuid
      `, [IDS.project, IDS.owner])).rows[0].count);
      await pg.query(`
        INSERT INTO public.project_evidence_observation_requests (
          observation_id, project_id, recorded_by, idempotency_key,
          request_hash, recording_base_hash
        )
        SELECT $1::uuid, $2::uuid, $3::uuid,
               'quota-request:' || lpad(g::text, 6, '0'),
               repeat('e', 64), $4
          FROM generate_series(1, $5::integer) AS g
      `, [
        first.observation_id,
        IDS.project,
        IDS.owner,
        baseInput.baseHash,
        256 - existingActorRequests,
      ]);
      await expectError("request quota", () => callRecorder(pg, recordParameters({
        ...baseInput,
        idempotencyKey: "story-room-review:request-quota",
      })), "project_evidence_request_quota_exhausted");
    });

    console.log(`\n${passed} project-evidence database checks passed.`);
    console.log("Compatibility boundary: PGlite proves PostgreSQL semantics in one isolated session; the wired native PostgreSQL 17 CI job is the engine-parity and true two-session concurrency gate.");
  } finally {
    if (pg) await pg.close().catch(() => undefined);
    const expectedPrefix = path.join(os.tmpdir(), "qicsw-pglite-ledger-");
    if (tempRoot.startsWith(expectedPrefix)) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("Project evidence PGlite verification failed.");
  console.error(error);
  process.exitCode = 1;
});
