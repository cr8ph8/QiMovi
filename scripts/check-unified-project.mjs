#!/usr/bin/env node
/**
 * Smoke-test the unified project lifecycle (Phase 4 Step 1).
 *
 * Picks up to 10 random `entries` rows, asserts each has:
 *   - a matching row in `project_legacy_map`
 *   - a `projects` row with the same owner
 *   - at least one `project_artifacts` row with `is_current = true`
 *
 * Run after `backfill-projects` to validate the read-path mirror.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-unified-project.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const SAMPLE = Number(process.env.SAMPLE_SIZE ?? 10);

const { data: entries, error } = await supabase
  .from("entries")
  .select("id, user_id, title")
  .limit(SAMPLE * 4); // oversample, then random-pick

if (error) {
  console.error("❌ failed to fetch entries:", error.message);
  process.exit(2);
}
if (!entries?.length) {
  console.log("⚠️  no entries to sample — skipping.");
  process.exit(0);
}

const sample = entries
  .sort(() => Math.random() - 0.5)
  .slice(0, Math.min(SAMPLE, entries.length));

const failures = [];
for (const row of sample) {
  const { data: map } = await supabase
    .from("project_legacy_map")
    .select("project_id")
    .eq("source_table", "entries")
    .eq("source_id", row.id)
    .maybeSingle();

  if (!map?.project_id) {
    failures.push({ entry: row.id, reason: "no project_legacy_map row" });
    continue;
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, owner_id")
    .eq("id", map.project_id)
    .maybeSingle();

  if (!project) {
    failures.push({ entry: row.id, reason: "project row missing" });
    continue;
  }
  if (project.owner_id !== row.user_id) {
    failures.push({
      entry: row.id,
      reason: `owner mismatch: entry.user_id=${row.user_id} project.owner_id=${project.owner_id}`,
    });
    continue;
  }

  const { data: artifact } = await supabase
    .from("project_artifacts")
    .select("id, is_current")
    .eq("project_id", project.id)
    .eq("is_current", true)
    .maybeSingle();

  if (!artifact) {
    failures.push({ entry: row.id, reason: "no current artifact" });
  }
}

const ok = sample.length - failures.length;
console.log(`✅ ${ok}/${sample.length} entries pass unified-project smoke test.`);
if (failures.length) {
  console.error(`❌ ${failures.length} failures:`);
  for (const f of failures) console.error(`   - ${f.entry}: ${f.reason}`);
  process.exit(1);
}
