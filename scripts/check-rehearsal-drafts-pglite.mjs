import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "supabase/migrations/20260905090000_rehearsal_drafts_v1.sql";
const DATABASE = "security_regressions";
const IDS = {
  owner: "11000000-0000-4000-8000-000000000001",
  stranger: "11000000-0000-4000-8000-000000000002",
  entry: "21000000-0000-4000-8000-000000000001",
  project: "31000000-0000-4000-8000-000000000001",
  context: "41000000-0000-4000-8000-000000000001",
};
const SOURCE = 'FADE IN:\n\nEXT. MOON - NIGHT\nARCHi says "café 🌙".\n';
const SAVE = "SELECT * FROM public.save_rehearsal_draft_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text)";
const READ = "SELECT * FROM public.read_rehearsal_draft_v1($1::uuid,$2::uuid)";
const PACK_SAVE = "SELECT * FROM public.persist_preproduction_pack_v2($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::uuid,$8::text,$9::text,$10::uuid)";
const CORE_TABLES = ["projects", "project_artifacts", "context_bundles", "project_evidence_observations", "project_evidence_observation_requests", "token_wallets", "wallet_transactions"];
let passed = 0;

const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const exact = (value) => `${canonical(value)}\n`;
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const readFile = (file) => fs.readFile(path.join(ROOT, file), "utf8");
const stripPsql = (sql) => sql.split("\n").filter((line) => !line.trimStart().startsWith("\\")).join("\n");
const clone = (value) => structuredClone(value);

async function check(label, work) {
  await work();
  passed += 1;
  console.log(`✓ ${label}`);
}

async function fails(work, message) {
  await assert.rejects(work, (error) => {
    assert.ok(String(error).includes(message), `Expected ${message}; received ${String(error)}`);
    return true;
  });
}

async function role(pg, name, work, actor = IDS.owner) {
  assert.ok(["anon", "authenticated", "service_role"].includes(name));
  await pg.exec(`SET ROLE ${name}`);
  try {
    await pg.query("SELECT set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role',$2,false)", [JSON.stringify({ role: name, ...(actor ? { sub: actor } : {}) }), name]);
    return await work();
  } finally {
    await pg.exec("RESET ROLE");
    await pg.query("SELECT set_config('request.jwt.claims','',false),set_config('request.jwt.claim.role','',false)");
  }
}

async function setup(pg) {
  await pg.exec(stripPsql(await readFile("supabase/tests/fixtures/security_baseline.sql")));
  const manifest = (await readFile("supabase/tests/fixtures/security_migrations.txt")).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  for (const migration of manifest) {
    assert.ok(migration.startsWith("supabase/migrations/") && !migration.includes(".."));
    await pg.exec(await readFile(migration));
  }
  if (!manifest.includes(MIGRATION)) await pg.exec(await readFile(MIGRATION));
}

async function main() {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Node >=22 required");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qicsw-rehearsal-v1-"));
  let pg;
  try {
    pg = await PGlite.create({ dataDir: tempRoot, extensions: { pgcrypto } });
    await pg.exec(`CREATE DATABASE ${DATABASE}`);
    await pg.close();
    pg = await PGlite.create({ dataDir: tempRoot, database: DATABASE, extensions: { pgcrypto } });
    await setup(pg);
    const contextBase = { project_id: IDS.project, entry_id: IDS.entry, script_text: { fountain: SOURCE }, numeric_boundaries: { tiny: 1e-7, huge: 1e21 } };
    const contextText = canonical(contextBase);
    const contextHash = sha(contextText);
    await pg.query("INSERT INTO auth.users(id,aud,role,email) VALUES($1,'authenticated','authenticated','owner@example.invalid'),($2,'authenticated','authenticated','stranger@example.invalid')", [IDS.owner, IDS.stranger]);
    await pg.query("INSERT INTO public.entries(id,user_id,title) VALUES($1,$2,'Rehearsal pilot')", [IDS.entry, IDS.owner]);
    await pg.query("INSERT INTO public.projects(id,owner_id,lifecycle_state,updated_at) VALUES($1,$2,'draft','2026-09-05T12:00:00Z')", [IDS.project, IDS.owner]);
    await pg.query("INSERT INTO public.project_legacy_map(project_id,source_table,source_id) VALUES($1,'entries',$2)", [IDS.project, IDS.entry]);
    await pg.query("INSERT INTO public.context_bundles(id,project_id,entry_id,payload_json,payload_hash,payload_canonical_text) VALUES($1,$2,$3,$4,$5,$6)", [IDS.context, IDS.project, IDS.entry, JSON.stringify({ ...contextBase, content_hash: contextHash }), contextHash, contextText]);

    const packText = await readFile("supabase/tests/fixtures/preproduction_pack_v2.valid.json");
    const originalPack = JSON.parse(packText);
    const persistPack = (pack, expected = null) => role(pg, "service_role", async () => (await pg.query(PACK_SAVE, [IDS.project, IDS.entry, IDS.context, contextHash, sha(SOURCE), expected, pack.package_id, exact(pack), sha(exact(pack)), IDS.owner])).rows[0]);
    const pack = await persistPack(originalPack);
    const fixtureText = await readFile("supabase/tests/fixtures/rehearsal_draft_v1.valid.json");
    const fixture = JSON.parse(fixtureText);
    const firstDoc = clone(fixture);
    // The reusable fixture has a stable artifact UUID; bind it here to the
    // artifact actually committed through the preproduction RPC under test.
    firstDoc.basis.artifact_id = pack.artifact_id;
    const newDoc = (overrides = {}) => ({ ...clone(firstDoc), proposal_id: randomUUID(), ...overrides });
    const args = (doc, expected = null) => [IDS.project, IDS.entry, expected, exact(doc), sha(exact(doc))];
    const save = (doc, expected = null, actor = IDS.owner) => role(pg, "authenticated", async () => (await pg.query(SAVE, args(doc, expected))).rows[0], actor);
    const read = (actor = IDS.owner) => role(pg, "authenticated", async () => (await pg.query(READ, [IDS.project, IDS.entry])).rows, actor);
    const setFlag = (value, text = value ? "on" : "off") => pg.query("UPDATE public.site_settings SET value=$1,text_value=$2 WHERE key='rehearsal_drafts_v1'", [value, text]);
    const drafts = async () => (await pg.query("SELECT * FROM public.rehearsal_drafts ORDER BY project_id,entry_id,version")).rows;
    const core = async () => {
      const snapshot = {};
      for (const table of CORE_TABLES) snapshot[table] = (await pg.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
      return snapshot;
    };
    const noCoreWrites = async (work) => {
      const before = await core();
      await work();
      assert.deepEqual(await core(), before, "Rehearsal operation changed project/pack/context/evidence/cash state");
    };

    await check("shared exact fixture binds the existing pack fixture without invented timing", async () => {
      assert.equal(fixtureText, exact(fixture));
      assert.equal(fixture.basis.pack_sha256, sha(packText));
      assert.equal(fixture.basis.package_id, originalPack.package_id);
      assert.equal(fixture.basis.context_hash, contextHash);
      assert.equal(fixture.basis.source_hash, sha(SOURCE));
      assert.deepEqual(fixture.change, { kind: "ADD_PAUSE", duration_ms: 2000, timing_basis: "PROPOSED_ADDITION" });
    });
    await check("migration defaults flag off and database denies both read and save", async () => {
      assert.deepEqual((await pg.query("SELECT value,text_value FROM public.site_settings WHERE key='rehearsal_drafts_v1'")).rows[0], { value: false, text_value: "off" });
      await fails(() => read(), "rehearsal_draft_disabled");
      await fails(() => save(firstDoc), "rehearsal_draft_disabled");
      assert.equal((await drafts()).length, 0);
      await setFlag(true, "off");
      await fails(() => read(), "rehearsal_draft_disabled");
      await setFlag(false, "on");
      await fails(() => save(firstDoc), "rehearsal_draft_disabled");
      await setFlag(true);
    });
    await check("owner read returns no row before the first draft", () => noCoreWrites(async () => assert.deepEqual(await read(), [])));
    let first;
    await check("authenticated owner saves a distinct review draft without changing production state", () => noCoreWrites(async () => {
      first = await save(firstDoc);
      assert.equal(first.version, 1);
      assert.equal(first.replayed, false);
      assert.equal(first.basis_state, "CURRENT_PACK");
      assert.equal(first.draft_text, exact(firstDoc));
      assert.equal(first.draft_sha256, sha(first.draft_text));
      const row = (await drafts())[0];
      assert.equal(row.recorded_by, IDS.owner);
      assert.deepEqual(row.draft_json, firstDoc);
      assert.deepEqual(await read(), [first]);
    }));
    await check("exact bytes and read result survive disk close and reopen", async () => {
      await pg.close();
      pg = await PGlite.create({ dataDir: tempRoot, database: DATABASE, extensions: { pgcrypto } });
      assert.deepEqual(await read(), [first]);
      assert.equal(sha((await read())[0].draft_text), first.draft_sha256);
      assert.ok(first.draft_text.includes("🌙"));
    });
    await check("same proposal and bytes replay original despite stale expected id", () => noCoreWrites(async () => {
      assert.deepEqual(await save(firstDoc, randomUUID()), { ...first, replayed: true });
      assert.equal((await drafts()).length, 1);
    }));
    await check("same proposal with changed bytes conflicts and preserves history", async () => {
      const before = await drafts();
      await fails(() => save({ ...clone(firstDoc), note: "Different note" }, first.draft_id), "rehearsal_draft_proposal_conflict");
      assert.deepEqual(await drafts(), before);
    });
    await check("anon and service roles cannot invoke owner RPCs even with owner subject", async () => {
      for (const name of ["anon", "service_role"]) {
        await fails(() => role(pg, name, () => pg.query(READ, [IDS.project, IDS.entry])), "permission denied for function read_rehearsal_draft_v1");
        await fails(() => role(pg, name, () => pg.query(SAVE, args(newDoc(), first.draft_id))), "permission denied for function save_rehearsal_draft_v1");
      }
    });
    await check("read, append and replay require auth.uid and current project ownership", async () => {
      for (const actor of [null, IDS.stranger]) {
        const message = actor ? "rehearsal_draft_project_actor_mismatch" : "rehearsal_draft_access_required";
        await fails(() => read(actor), message);
        await fails(() => save(newDoc(), first.draft_id, actor), message);
        await fails(() => save(firstDoc, null, actor), message);
      }
    });
    await check("read and append independently verify entry owner and project mapping", async () => {
      await pg.query("UPDATE public.entries SET user_id=$1 WHERE id=$2", [IDS.stranger, IDS.entry]);
      try {
        await fails(() => read(), "rehearsal_draft_entry_actor_mismatch");
        await fails(() => save(newDoc(), first.draft_id), "rehearsal_draft_entry_actor_mismatch");
        await fails(() => save(firstDoc), "rehearsal_draft_entry_actor_mismatch");
      } finally { await pg.query("UPDATE public.entries SET user_id=$1 WHERE id=$2", [IDS.owner, IDS.entry]); }
      await fails(() => role(pg, "authenticated", () => pg.query(READ, [IDS.project, randomUUID()])), "rehearsal_draft_entry_project_mismatch");
      const invalidArgs = args(newDoc(), first.draft_id); invalidArgs[1] = randomUUID();
      await fails(() => role(pg, "authenticated", () => pg.query(SAVE, invalidArgs)), "rehearsal_draft_entry_project_mismatch");
    });
    await check("no direct table reads or writes and RLS is enabled without client policies", async () => {
      const row = (await pg.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.rehearsal_drafts'::regclass")).rows[0];
      assert.equal(row.relrowsecurity, true);
      assert.equal((await pg.query("SELECT count(*)::integer AS n FROM pg_policies WHERE schemaname='public' AND tablename='rehearsal_drafts'")).rows[0].n, 0);
      for (const name of ["anon", "authenticated", "service_role"]) {
        for (const sql of ["SELECT * FROM public.rehearsal_drafts", "DELETE FROM public.rehearsal_drafts", "UPDATE public.rehearsal_drafts SET version=2", "INSERT INTO public.rehearsal_drafts DEFAULT VALUES"]) {
          await fails(() => role(pg, name, () => pg.exec(sql)), "permission denied for table rehearsal_drafts");
        }
      }
    });
    await check("history tampering and deletion are rejected even for the database owner", async () => {
      const before = await drafts();
      await fails(() => pg.query("UPDATE public.rehearsal_drafts SET draft_text='changed' WHERE id=$1", [first.draft_id]), "rehearsal_draft_history_immutable");
      await fails(() => pg.query("DELETE FROM public.rehearsal_drafts WHERE id=$1", [first.draft_id]), "rehearsal_draft_history_immutable");
      assert.deepEqual(await drafts(), before);
    });
    await check("hash, canonical LF and duplicate-key checks fail closed", async () => {
      const doc = newDoc();
      const badHash = args(doc, first.draft_id); badHash[4] = "0".repeat(64);
      await fails(() => role(pg, "authenticated", () => pg.query(SAVE, badHash)), "rehearsal_draft_hash_mismatch");
      const nullHash = args(doc, first.draft_id); nullHash[4] = null;
      await fails(() => role(pg, "authenticated", () => pg.query(SAVE, nullHash)), "rehearsal_draft_invalid_hash");
      for (const text of [canonical(doc), JSON.stringify(doc, null, 2) + "\n", exact(doc).replace('"duration_ms":2000', '"duration_ms":2000.0'), exact(doc).replace('"duration_ms":2000', '"duration_ms":2000,"duration_ms":2000')]) {
        await fails(() => role(pg, "authenticated", () => pg.query(SAVE, [IDS.project, IDS.entry, first.draft_id, text, sha(text)])), "rehearsal_draft_noncanonical_bytes");
      }
      await fails(() => role(pg, "authenticated", () => pg.query(SAVE, [IDS.project, IDS.entry, first.draft_id, "{x", sha("{x")])), "rehearsal_draft_invalid_json");
    });
    await check("oversize bytes and UTF16 note/shot caps match browser limits", async () => {
      const huge = " ".repeat(32769);
      await fails(() => role(pg, "authenticated", () => pg.query(SAVE, [IDS.project, IDS.entry, first.draft_id, huge, sha(huge)])), "rehearsal_draft_bytes_out_of_bounds");
      for (const note of ["x".repeat(2001), "🌙".repeat(1001)]) await fails(() => save(newDoc({ note }), first.draft_id), "rehearsal_draft_invalid_envelope");
      const doc = newDoc(); doc.target.shot = "🌙".repeat(101);
      await fails(() => save(doc, first.draft_id), "rehearsal_draft_invalid_target");
      const max = newDoc({ note: "🌙".repeat(1000) });
      const result = await pg.query("SELECT public.validate_rehearsal_draft_v1($1,$2) AS value", [exact(max), sha(exact(max))]);
      assert.deepEqual(result.rows[0].value, max);
    });
    await check("letter v is valid shot text while vertical-tab-only and Unicode whitespace are blank", async () => {
      const valid = newDoc(); valid.target.shot = "v";
      await fails(() => save(valid, first.draft_id), "rehearsal_draft_target_not_found");
      for (const shot of ["", "\v", "\u00a0\u2028\ufeff", " \t\n"]) {
        const doc = newDoc(); doc.target.shot = shot;
        await fails(() => save(doc, first.draft_id), "rehearsal_draft_invalid_target");
      }
    });
    await check("all object levels reject extra fields, forged authority and invented timing", async () => {
      const candidates = [newDoc({ extra: true }), newDoc({ authority_state: "APPROVED" }), newDoc({ document_state: "APPLIED" })];
      for (const doc of candidates) await fails(() => save(doc, first.draft_id), "rehearsal_draft_invalid_envelope");
      const badBasis = newDoc(); badBasis.basis.source_hash_scope = "ADMITTED_SCREENPLAY";
      await fails(() => save(badBasis, first.draft_id), "rehearsal_draft_invalid_basis");
      for (const [part, extra, message] of [["basis", "latest_screenplay", "invalid_basis"], ["target", "total_ms", "invalid_target"], ["change", "baseline_ms", "invalid_change"]]) {
        const doc = newDoc(); doc[part][extra] = 123;
        await fails(() => save(doc, first.draft_id), `rehearsal_draft_${message}`);
      }
      for (const change of [{ kind: "ADD_PAUSE", duration_ms: "2000", timing_basis: "PROPOSED_ADDITION" }, { kind: "ADD_PAUSE", duration_ms: 3000, timing_basis: "PROPOSED_ADDITION" }, { kind: "ADD_PAUSE", duration_ms: 2000, timing_basis: "MEASURED" }]) await fails(() => save(newDoc({ change }), first.draft_id), "rehearsal_draft_invalid_change");
    });
    await check("missing fields, numeric strings, fractions and int overflow are rejected", async () => {
      const missing = newDoc(); delete missing.note;
      await fails(() => save(missing, first.draft_id), "rehearsal_draft_invalid_envelope");
      for (const value of ["1", 0, 1.5, 2147483648]) {
        const target = newDoc(); target.target.scene_index = value;
        await fails(() => save(target, first.draft_id), "rehearsal_draft_invalid_target");
        const basis = newDoc(); basis.basis.artifact_version = value;
        await fails(() => save(basis, first.draft_id), "rehearsal_draft_invalid_basis");
      }
    });
    await check("every source-pack basis field is checked against the persisted exact pack", async () => {
      for (const [key, value] of [["artifact_id", randomUUID()], ["artifact_version", 2], ["pack_sha256", "0".repeat(64)], ["package_id", randomUUID()], ["context_bundle_id", randomUUID()], ["context_hash", "0".repeat(64)], ["source_hash", "0".repeat(64)]]) {
        const doc = newDoc(); doc.basis[key] = value;
        await fails(() => save(doc, first.draft_id), "rehearsal_draft_pack_basis_mismatch");
      }
      for (const key of ["project_id", "entry_id"]) {
        const doc = newDoc(); doc.basis[key] = randomUUID();
        await fails(() => save(doc, first.draft_id), "rehearsal_draft_identity_mismatch");
      }
    });
    await check("target must be one existing live-action scene and shot", async () => {
      const wrongScene = newDoc(); wrongScene.target.scene_index = 2;
      await fails(() => save(wrongScene, first.draft_id), "rehearsal_draft_target_not_found");
      const wrongShot = newDoc(); wrongShot.target.shot = "1B";
      await fails(() => save(wrongShot, first.draft_id), "rehearsal_draft_target_not_found");
    });
    await check("ambiguous legacy multiple-current packs cannot claim a current basis", async () => {
      const duplicate = randomUUID();
      await pg.query("INSERT INTO public.project_artifacts(id,project_id,artifact_type,is_current,payload_json) VALUES($1,$2,'preproduction_pack',true,'{}')", [duplicate, IDS.project]);
      try {
        await fails(() => read(), "rehearsal_draft_ambiguous_current_pack");
        await fails(() => save(newDoc(), first.draft_id), "rehearsal_draft_ambiguous_current_pack");
      } finally { await pg.query("DELETE FROM public.project_artifacts WHERE id=$1", [duplicate]); }
    });
    let second;
    await check("new proposal appends version two; a serial CAS loser leaves both exact versions intact", () => noCoreWrites(async () => {
      second = await save(newDoc({ note: "Second proposed pause note" }), first.draft_id);
      assert.equal(second.version, 2);
      assert.deepEqual(await read(), [second]);
      const before = await drafts();
      await fails(() => save(newDoc(), first.draft_id), "rehearsal_draft_current_conflict");
      assert.deepEqual(await drafts(), before);
      assert.equal(before[0].draft_text, first.draft_text);
      assert.deepEqual(await save(firstDoc), { ...first, replayed: true });
    }));
    await check("failed insert preserves the last draft and all earlier history", () => noCoreWrites(async () => {
      const before = await drafts();
      await pg.exec("CREATE FUNCTION public.rehearsal_test_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_rehearsal_insert_failure'; END $$; CREATE TRIGGER rehearsal_test_insert_failure BEFORE INSERT ON public.rehearsal_drafts FOR EACH ROW EXECUTE FUNCTION public.rehearsal_test_insert_failure()");
      try { await fails(() => save(newDoc(), second.draft_id), "injected_rehearsal_insert_failure"); }
      finally { await pg.exec("DROP TRIGGER rehearsal_test_insert_failure ON public.rehearsal_drafts; DROP FUNCTION public.rehearsal_test_insert_failure()"); }
      assert.deepEqual(await drafts(), before);
      assert.deepEqual(await read(), [second]);
    }));

    const newerPackDoc = clone(originalPack); newerPackDoc.package_id = randomUUID();
    const newerPack = await persistPack(newerPackDoc, pack.artifact_id);
    await check("pack replacement marks historical drafts superseded without editing their bytes", () => noCoreWrites(async () => {
      assert.deepEqual(await read(), [{ ...second, basis_state: "SUPERSEDED_PACK" }]);
      assert.deepEqual(await save(firstDoc), { ...first, replayed: true, basis_state: "SUPERSEDED_PACK" });
      const before = await drafts();
      await fails(() => save(newDoc(), second.draft_id), "rehearsal_draft_stale_pack_basis");
      assert.deepEqual(await drafts(), before);
    }));
    await check("new proposal may explicitly bind the replacement pack with the correct expected draft", () => noCoreWrites(async () => {
      const doc = newDoc({ note: "Rehearsal proposed against the replacement pack" });
      Object.assign(doc.basis, { artifact_id: newerPack.artifact_id, artifact_version: newerPack.version, package_id: newerPackDoc.package_id, pack_sha256: newerPack.payload_sha256 });
      const saved = await save(doc, second.draft_id);
      assert.equal(saved.version, 3);
      assert.equal(saved.basis_state, "CURRENT_PACK");
      assert.deepEqual(await read(), [saved]);
      assert.equal((await drafts()).length, 3);
    }));
    await check("turning the feature off blocks reopening and historical retries", async () => {
      const before = await drafts();
      await setFlag(false);
      await fails(() => read(), "rehearsal_draft_disabled");
      await fails(() => save(firstDoc), "rehearsal_draft_disabled");
      assert.deepEqual(await drafts(), before);
      await setFlag(true);
    });
    await check("project lifecycle, source/context, review evidence and cash remain unchanged", async () => {
      const project = (await pg.query("SELECT lifecycle_state,current_artifact_id,updated_at FROM public.projects WHERE id=$1", [IDS.project])).rows[0];
      assert.equal(project.lifecycle_state, "draft");
      assert.equal(project.current_artifact_id, null);
      assert.equal(new Date(project.updated_at).toISOString(), "2026-09-05T12:00:00.000Z");
      assert.equal((await pg.query("SELECT payload_canonical_text FROM public.context_bundles WHERE id=$1", [IDS.context])).rows[0].payload_canonical_text, contextText);
      for (const table of ["project_evidence_observations", "project_evidence_observation_requests", "token_wallets", "wallet_transactions"]) assert.equal((await pg.query(`SELECT count(*)::integer AS n FROM public.${table}`)).rows[0].n, 0);
      assert.deepEqual((await pg.query("SELECT value,text_value FROM public.site_settings WHERE key='production_review_evidence_v1'")).rows[0], { value: false, text_value: "off" });
    });
    console.log(`\n${passed} rehearsal-draft database checks passed.`);
    console.log("Scope: disposable PostgreSQL semantics via PGlite, exact disk reopen, and serial CAS conflicts. This is not true two-session concurrency, a deployed Supabase HTTP test, source admission, or screenplay-currentness proof.");
  } finally {
    if (pg) await pg.close().catch(() => undefined);
    if (tempRoot.startsWith(path.join(os.tmpdir(), "qicsw-rehearsal-v1-"))) await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Rehearsal draft database verification failed.");
  console.error(error);
  process.exitCode = 1;
});
