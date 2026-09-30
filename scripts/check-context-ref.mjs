#!/usr/bin/env node
/**
 * Fails CI if a function in the REQUIRED list calls `callAI(...)` without
 * passing a `context_ref:` argument. Mirrors check-ai-router.mjs.
 *
 * Keep this list in sync with the AI_ROUTER_REQUIRE_CONTEXT_REF edge secret.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = [
  "ai-judge",
  "generate-story-plan",
  "signalcheck-analyze",
  "suggest-rewrites",
  "rewrite-selection",
];

const ROOT = "supabase/functions";
const offenders = [];

for (const fn of REQUIRED) {
  const file = join(ROOT, fn, "index.ts");
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    offenders.push(`${fn} — index.ts missing`);
    continue;
  }
  const usesCallAI = /\bcallAI\s*\(/.test(src);
  const passesContextRef = /context_ref\s*:/.test(src);
  if (usesCallAI && !passesContextRef) {
    offenders.push(`${fn} — calls callAI() but never passes context_ref`);
  }
}

if (offenders.length) {
  console.error("❌ context_ref enforcement failed:");
  for (const o of offenders) console.error(`   - ${o}`);
  console.error("\nResolve a project_id and call buildContentContext() before callAI(),");
  console.error("then pass { bundle_id, payload_hash } as context_ref.");
  process.exit(1);
}

console.log(`✅ context_ref coverage OK across ${REQUIRED.length} required functions`);
