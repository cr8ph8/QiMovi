import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "supabase/migrations/20260904090000_atomic_preproduction_pack_v2.sql";
const DATABASE = "security_regressions";
const IDS = {
  owner: "11000000-0000-4000-8000-000000000001",
  stranger: "11000000-0000-4000-8000-000000000002",
  project: "31000000-0000-4000-8000-000000000001",
  entry: "21000000-0000-4000-8000-000000000001",
  context: "41000000-0000-4000-8000-000000000001",
};
const SOURCE = 'FADE IN:\n\nEXT. MOON - NIGHT\nARCHi says "café 🌙".\n';
const RPC = `SELECT * FROM public.persist_preproduction_pack_v2(
  $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::uuid,$8::text,$9::text,$10::uuid
)`;
let passed = 0;

const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const exactPack = (value) => `${canonical(value)}\n`;
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");
const stripPsql = (sql) => sql.split("\n").filter((line) => !line.trimStart().startsWith("\\")).join("\n");

async function check(label, work) {
  await work();
  passed += 1;
  console.log(`✓ ${label}`);
}

async function fails(work, message) {
  await assert.rejects(work, (error) => {
    assert.ok(String(error).includes(message), `Expected ${message}, received ${String(error)}`);
    return true;
  });
}

async function role(pg, name, work, claims = { role: name, sub: IDS.owner }) {
  assert.ok(["anon", "authenticated", "service_role"].includes(name));
  await pg.exec(`SET ROLE ${name}`);
  try {
    await pg.query("SELECT set_config('request.jwt.claims',$1,false), set_config('request.jwt.claim.role',$2,false)", [JSON.stringify(claims), claims.role ?? ""]);
    return await work();
  } finally {
    await pg.exec("RESET ROLE");
    await pg.query("SELECT set_config('request.jwt.claims','',false), set_config('request.jwt.claim.role','',false)");
  }
}

async function setup(pg) {
  await pg.exec(stripPsql(await read("supabase/tests/fixtures/security_baseline.sql")));
  // The focused baseline intentionally lacks historical artifact columns.
  const columns = await pg.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_artifacts' AND column_name='artifact_type'");
  if (columns.rows.length === 0) await pg.exec(await read("supabase/tests/fixtures/preproduction_artifact_columns.sql"));
  const manifest = (await read("supabase/tests/fixtures/security_migrations.txt")).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  for (const migration of manifest) {
    assert.ok(migration.startsWith("supabase/migrations/") && !migration.includes(".."));
    await pg.exec(await read(migration));
  }
  if (!manifest.includes(MIGRATION)) await pg.exec(await read(MIGRATION));
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qicsw-pack-v2-"));
  let pg;
  try {
    pg = await PGlite.create({ dataDir: tempRoot, extensions: { pgcrypto } });
    await pg.exec(`CREATE DATABASE ${DATABASE}`);
    await pg.close();
    pg = await PGlite.create({ dataDir: tempRoot, database: DATABASE, extensions: { pgcrypto } });
    await setup(pg);
    const contextBase = {
      project_id: IDS.project, entry_id: IDS.entry,
      script_text: { fountain: SOURCE },
      numeric_boundaries: { tiny: 1e-7, huge: 1e21 },
    };
    const contextText = canonical(contextBase);
    const contextHash = sha(contextText);
    const sourceHash = sha(SOURCE);
    const contextPayload = { ...contextBase, content_hash: contextHash };
    await pg.query("INSERT INTO auth.users (id,aud,role,email) VALUES ($1,'authenticated','authenticated','owner@example.invalid'),($2,'authenticated','authenticated','stranger@example.invalid')", [IDS.owner, IDS.stranger]);
    await pg.query("INSERT INTO public.entries (id,user_id,title) VALUES ($1,$2,'Pack pilot')", [IDS.entry, IDS.owner]);
    await pg.query("INSERT INTO public.projects (id,owner_id,lifecycle_state,updated_at) VALUES ($1,$2,'draft','2026-09-04T12:00:00Z')", [IDS.project, IDS.owner]);
    await pg.query("INSERT INTO public.project_legacy_map (project_id,source_table,source_id) VALUES ($1,'entries',$2)", [IDS.project, IDS.entry]);
    await pg.query("INSERT INTO public.context_bundles (id,project_id,entry_id,payload_json,payload_hash,payload_canonical_text) VALUES ($1,$2,$3,$4,$5,$6)", [IDS.context, IDS.project, IDS.entry, JSON.stringify(contextPayload), contextHash, contextText]);
    const projectBefore = (await pg.query("SELECT * FROM public.projects WHERE id=$1", [IDS.project])).rows[0];

    const document = (overrides = {}) => ({
      schema_version: "filmstack-preproduction-pack/v2",
      package_id: randomUUID(),
      document_state: "PROSPECTIVE_DRAFT",
      authority_state: "NO_EXTERNAL_AUTHORITY",
      basis: { project_id: IDS.project, entry_id: IDS.entry, context_bundle_id: IDS.context, context_hash: contextHash, source_hash: sourceHash, source_hash_scope: "CONTENT_CONTEXT_FOUNTAIN_UTF8" },
      tracks: ["live_action"],
      generation: { generated_at: "2026-09-04T12:00:00.000Z", model: "local-fixture", prompt_tokens: 0, completion_tokens: 0, estimated_cost_cents: 0.000001 },
      content: { summary: { logline: "ARCHi follows the moon 🌙." }, live_action: { scenes: [{ scene_index: 1, slug: "EXT. MOON - NIGHT", shots: [{ shot: "1A", framing: "Wide", description: "ARCHi watches." }] }] }, open_questions: [] },
      ...overrides,
    });
    const params = (doc, expected = null, overrides = {}) => {
      const text = exactPack(doc);
      const result = [IDS.project, IDS.entry, IDS.context, contextHash, sourceHash, expected, doc.package_id, text, sha(text), IDS.owner];
      for (const [key, value] of Object.entries(overrides)) result[Number(key)] = value;
      return result;
    };
    const call = (args) => role(pg, "service_role", async () => (await pg.query(RPC, args)).rows[0]);
    const snapshot = async () => (await pg.query("SELECT id,version,is_current,payload_canonical_text,payload_sha256 FROM public.project_artifacts ORDER BY version,id")).rows;
    const fixtureText = await read("supabase/tests/fixtures/preproduction_pack_v2.valid.json");
    const firstDoc = JSON.parse(fixtureText);
    await check("shared frontend/Edge/SQL fixture matches canonical bytes and exact context", async () => {
      assert.equal(fixtureText, exactPack(firstDoc));
      assert.deepEqual(firstDoc, document({ package_id: firstDoc.package_id }));
    });
    let first;
    await check("service RPC persists exact canonical pack bytes and actor in one current version", async () => {
      first = await call(params(firstDoc));
      assert.equal(first.version, 1);
      assert.equal(first.replayed, false);
      assert.equal(first.payload_canonical_text, exactPack(firstDoc));
      assert.equal(first.payload_sha256, sha(exactPack(firstDoc)));
      const row = (await pg.query("SELECT * FROM public.project_artifacts WHERE id=$1", [first.artifact_id])).rows[0];
      assert.deepEqual(row.payload_json, firstDoc);
      assert.equal(row.created_by, IDS.owner);
      assert.equal(row.is_current, true);
    });
    await check("exact bytes roundtrip after database close and reopen", async () => {
      await pg.close();
      pg = await PGlite.create({ dataDir: tempRoot, database: DATABASE, extensions: { pgcrypto } });
      const reopened = (await pg.query("SELECT payload_canonical_text,payload_sha256 FROM public.project_artifacts WHERE id=$1", [first.artifact_id])).rows[0];
      assert.equal(reopened.payload_canonical_text, exactPack(firstDoc));
      assert.equal(reopened.payload_sha256, sha(reopened.payload_canonical_text));
      assert.ok(reopened.payload_canonical_text.includes("0.000001"));
      assert.ok(reopened.payload_canonical_text.includes("🌙"));
    });
    await check("identical package retry returns original without a second artifact", async () => {
      assert.deepEqual(await call(params(firstDoc)), { ...first, replayed: true });
      assert.equal((await snapshot()).length, 1);
    });
    await check("same package with different exact bytes is rejected", async () => {
      const changed = document({ package_id: firstDoc.package_id });
      changed.content.summary.logline = "Changed bytes";
      await fails(() => call(params(changed, first.artifact_id)), "preproduction_pack_package_conflict");
      assert.equal((await snapshot()).length, 1);
    });
    await check("anon and authenticated cannot execute even with spoofed service claims", async () => {
      for (const name of ["anon", "authenticated"]) {
        await fails(() => role(pg, name, () => pg.query(RPC, params(document(), first.artifact_id)), { role: "service_role", sub: IDS.owner }), "permission denied for function persist_preproduction_pack_v2");
      }
    });
    await check("service caller still requires verified service request role", async () => {
      await fails(() => role(pg, "service_role", () => pg.query(RPC, params(document(), first.artifact_id)), { role: "authenticated", sub: IDS.owner }), "preproduction_pack_service_role_required");
    });
    await check("service actor must own the project, including during replay", async () => {
      await fails(() => call(params(firstDoc, null, { 9: IDS.stranger })), "preproduction_pack_project_actor_mismatch");
    });
    await check("wrong entry mapping is rejected", async () => {
      const entry = randomUUID();
      const doc = document(); doc.basis.entry_id = entry;
      await fails(() => call(params(doc, first.artifact_id, { 1: entry })), "preproduction_pack_entry_project_mismatch");
    });
    await check("entry ownership is checked independently", async () => {
      await pg.query("UPDATE public.entries SET user_id=$1 WHERE id=$2", [IDS.stranger, IDS.entry]);
      try { await fails(() => call(params(document(), first.artifact_id)), "preproduction_pack_entry_actor_mismatch"); }
      finally { await pg.query("UPDATE public.entries SET user_id=$1 WHERE id=$2", [IDS.owner, IDS.entry]); }
    });
    await check("hash mismatch and missing hashes are rejected before any write", async () => {
      await fails(() => call(params(document(), first.artifact_id, { 8: "0".repeat(64) })), "preproduction_pack_payload_hash_mismatch");
      await fails(() => call(params(document(), first.artifact_id, { 4: null })), "preproduction_pack_invalid_hash");
    });
    await check("invalid JSON and greater than 2 MiB exact text fail closed", async () => {
      const malformed = "{";
      await fails(() => call(params(document(), first.artifact_id, { 7: "{x", 8: sha("{x") })), "preproduction_pack_invalid_json");
      await fails(() => call(params(document(), first.artifact_id, { 7: malformed, 8: sha(malformed) })), "preproduction_pack_bytes_out_of_bounds");
      const oversized = " ".repeat(2097153);
      await fails(() => call(params(document(), first.artifact_id, { 7: oversized, 8: sha(oversized) })), "preproduction_pack_bytes_out_of_bounds");
    });
    await check("canonical spelling rejects pretty JSON, missing LF, duplicates and alternate numeric spelling", async () => {
      const doc = document();
      for (const text of [JSON.stringify(doc, null, 2) + "\n", canonical(doc), exactPack(doc).replace('"prompt_tokens":0', '"prompt_tokens":0.0'), exactPack(doc).replace('"prompt_tokens":0', '"prompt_tokens":0,"prompt_tokens":0')]) {
        await fails(() => call(params(doc, first.artifact_id, { 7: text, 8: sha(text) })), "preproduction_pack_noncanonical_bytes");
      }
    });
    await check("unsupported number precision and exponent values fail closed", async () => {
      for (const cost of [1e-7, 1e21, 1.2345678]) {
        const doc = document(); doc.generation.estimated_cost_cents = cost;
        await fails(() => call(params(doc, first.artifact_id)), "preproduction_pack_nonportable_number");
      }
      const doc = document();
      const text = exactPack(doc).replace('"estimated_cost_cents":0.000001', '"estimated_cost_cents":9007199254740990.1');
      await fails(() => call(params(doc, first.artifact_id, { 7: text, 8: sha(text) })), "preproduction_pack_nonportable_number");
    });
    await check("authority, identity and strict envelope fields cannot be supplied arbitrarily", async () => {
      for (const override of [{ authority_state: "APPROVED" }, { document_state: "PRODUCTION_READY" }, { injected: true }, { generation: null }, { content: null }]) {
        await fails(() => call(params(document(override), first.artifact_id)), "preproduction_pack_invalid_envelope");
      }
      const doc = document(); doc.basis.source_hash_scope = "ADMITTED_SOURCE";
      await fails(() => call(params(doc, first.artifact_id)), "preproduction_pack_invalid_envelope");
    });
    await check("tracks must be nonempty, unique and recognized", async () => {
      for (const tracks of [[], ["live_action", "live_action"], ["unknown"], [1], null]) {
        await fails(() => call(params(document({ tracks }), first.artifact_id)), "preproduction_pack_invalid_tracks");
      }
    });
    await check("context identity and hash must match the referenced snapshot", async () => {
      const doc = document(); doc.basis.context_hash = "0".repeat(64);
      await fails(() => call(params(doc, first.artifact_id, { 3: "0".repeat(64) })), "preproduction_pack_context_integrity_mismatch");
      const missing = randomUUID(); doc.basis.context_bundle_id = missing; doc.basis.context_hash = contextHash;
      await fails(() => call(params(doc, first.artifact_id, { 2: missing })), "preproduction_pack_context_mismatch");
    });
    await check("fountain source hash is independently recomputed from exact UTF8", async () => {
      const doc = document(); doc.basis.source_hash = sha(SOURCE.trim());
      await fails(() => call(params(doc, first.artifact_id, { 4: doc.basis.source_hash })), "preproduction_pack_source_hash_mismatch");
    });
    await check("contexts without preserved canonical bytes cannot authorize persistence", async () => {
      const id = randomUUID();
      await pg.query("INSERT INTO public.context_bundles (id,project_id,entry_id,payload_json,payload_hash) VALUES ($1,$2,$3,$4,$5)", [id, IDS.project, IDS.entry, JSON.stringify(contextPayload), contextHash]);
      const doc = document(); doc.basis.context_bundle_id = id;
      await fails(() => call(params(doc, first.artifact_id, { 2: id })), "preproduction_pack_context_bytes_unavailable");
    });
    await check("context payload wrong project identity fails despite valid stored bytes/hash", async () => {
      const id = randomUUID();
      const wrongBase = { ...contextBase, project_id: randomUUID() };
      const wrongText = canonical(wrongBase); const wrongHash = sha(wrongText);
      await pg.query("INSERT INTO public.context_bundles (id,project_id,entry_id,payload_json,payload_hash,payload_canonical_text) VALUES ($1,$2,$3,$4,$5,$6)", [id, IDS.project, IDS.entry, JSON.stringify({ ...wrongBase, content_hash: wrongHash }), wrongHash, wrongText]);
      const doc = document(); doc.basis.context_bundle_id = id; doc.basis.context_hash = wrongHash;
      await fails(() => call(params(doc, first.artifact_id, { 2: id, 3: wrongHash })), "preproduction_pack_context_integrity_mismatch");
    });
    await check("current replacement uses CAS and retains prior exact artifact", async () => {
      const next = await call(params(document(), first.artifact_id));
      assert.equal(next.version, 2);
      const rows = await snapshot();
      assert.equal(rows.length, 2);
      assert.equal(rows[0].is_current, false);
      assert.equal(rows[1].is_current, true);
      assert.equal(rows[0].payload_canonical_text, first.payload_canonical_text);
      const before = await snapshot();
      await fails(() => call(params(document(), first.artifact_id)), "preproduction_pack_current_conflict");
      assert.deepEqual(await snapshot(), before);
    });
    await check("historical byte-identical retry returns original without restoring it current", async () => {
      const before = await snapshot();
      assert.deepEqual(await call(params(firstDoc)), { ...first, replayed: true });
      assert.deepEqual(await snapshot(), before);
    });
    await check("insert failure keeps prior current record and does not consume a version", async () => {
      const before = await snapshot();
      await pg.exec("CREATE FUNCTION public.pack_test_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_pack_insert_failure'; END $$; CREATE TRIGGER pack_test_fail_insert BEFORE INSERT ON public.project_artifacts FOR EACH ROW EXECUTE FUNCTION public.pack_test_fail_insert()");
      try { await fails(() => call(params(document(), before.at(-1).id)), "injected_pack_insert_failure"); }
      finally { await pg.exec("DROP TRIGGER pack_test_fail_insert ON public.project_artifacts; DROP FUNCTION public.pack_test_fail_insert()"); }
      assert.deepEqual(await snapshot(), before);
    });
    await check("retirement failure rolls back the newly inserted version too", async () => {
      const before = await snapshot();
      await pg.exec("CREATE FUNCTION public.pack_test_fail_retire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.is_current=false THEN RAISE EXCEPTION 'injected_pack_retire_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER pack_test_fail_retire BEFORE UPDATE ON public.project_artifacts FOR EACH ROW EXECUTE FUNCTION public.pack_test_fail_retire()");
      try { await fails(() => call(params(document(), before.at(-1).id)), "injected_pack_retire_failure"); }
      finally { await pg.exec("DROP TRIGGER pack_test_fail_retire ON public.project_artifacts; DROP FUNCTION public.pack_test_fail_retire()"); }
      assert.deepEqual(await snapshot(), before);
    });
    await check("browser owner direct insert/update/delete of v2 is blocked", async () => {
      await fails(() => role(pg, "authenticated", () => pg.query("UPDATE public.project_artifacts SET is_current=true WHERE id=$1", [first.artifact_id])), "preproduction_pack_service_writer_required");
      await fails(() => role(pg, "authenticated", () => pg.query("DELETE FROM public.project_artifacts WHERE id=$1", [first.artifact_id])), "preproduction_pack_service_writer_required");
      const doc = document(); const text = exactPack(doc);
      await fails(() => role(pg, "authenticated", () => pg.query("INSERT INTO public.project_artifacts (project_id,artifact_type,payload_json,payload_canonical_text,payload_sha256) VALUES ($1,'preproduction_pack',$2,$3,$4)", [IDS.project, JSON.stringify(doc), text, sha(text)])), "preproduction_pack_service_writer_required");
    });
    await check("stored exact payload cannot be rewritten or cleared", async () => {
      await fails(() => pg.query("UPDATE public.project_artifacts SET payload_canonical_text=NULL,payload_sha256=NULL WHERE id=$1", [first.artifact_id]), "preproduction_pack_immutable");
      await fails(() => pg.query("DELETE FROM public.project_artifacts WHERE id=$1", [first.artifact_id]), "preproduction_pack_immutable");
    });
    await check("constraints reject absent canonical bytes and mismatched parsed JSON", async () => {
      const doc = document(); const text = exactPack(doc);
      await fails(() => pg.query("INSERT INTO public.project_artifacts (project_id,artifact_type,payload_json) VALUES ($1,'preproduction_pack',$2)", [IDS.project, JSON.stringify(doc)]), "project_artifact_pack_v2_exact_bytes");
      await fails(() => pg.query("INSERT INTO public.project_artifacts (project_id,artifact_type,payload_json,payload_canonical_text,payload_sha256) VALUES ($1,'preproduction_pack',$2,$3,$4)", [IDS.project, JSON.stringify({ ...doc, package_id: randomUUID() }), text, sha(text)]), "project_artifact_pack_v2_exact_bytes");
    });
    await check("legacy rows keep their payload and remain usable", async () => {
      const legacy = randomUUID();
      await pg.query("INSERT INTO public.project_artifacts (id,project_id,artifact_type,is_current,payload_json) VALUES ($1,$2,'fountain',true,$3)", [legacy, IDS.project, JSON.stringify({ fountain: "Legacy exact body" })]);
      await role(pg, "authenticated", () => pg.query("UPDATE public.project_artifacts SET payload_json=$1 WHERE id=$2", [JSON.stringify({ fountain: "Legacy edit" }), legacy]));
      await role(pg, "authenticated", () => pg.query("DELETE FROM public.project_artifacts WHERE id=$1", [legacy]));
      assert.equal((await pg.query("SELECT id FROM public.project_artifacts WHERE id=$1", [legacy])).rows.length, 0);
    });
    await check("no lifecycle, source admission, evidence ledger or production gate changes", async () => {
      assert.deepEqual((await pg.query("SELECT * FROM public.projects WHERE id=$1", [IDS.project])).rows[0], projectBefore);
      assert.equal((await pg.query("SELECT count(*)::integer AS n FROM public.project_evidence_observations")).rows[0].n, 0);
      assert.equal((await pg.query("SELECT count(*)::integer AS n FROM public.project_evidence_observation_requests")).rows[0].n, 0);
      assert.deepEqual((await pg.query("SELECT value,text_value FROM public.site_settings WHERE key='production_review_evidence_v1'")).rows[0], { value: false, text_value: "off" });
    });
    console.log(`\n${passed} preproduction-pack database checks passed.`);
    console.log("Scope: disposable PGlite PostgreSQL semantics and reopen proof; serial CAS loser coverage is not a true two-session race or a deployed Supabase HTTP test.");
  } finally {
    if (pg) await pg.close().catch(() => undefined);
    if (tempRoot.startsWith(path.join(os.tmpdir(), "qicsw-pack-v2-"))) await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Preproduction pack database verification failed.");
  console.error(error);
  process.exitCode = 1;
});
