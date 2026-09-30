#!/usr/bin/env node
/**
 * Fails CI if any edge function calls the Lovable AI gateway directly
 * without going through `_shared/ai-router.ts`. This guarantees every
 * AI invocation lands in `ai_usage_log` with model, cost, and policy
 * metadata.
 *
 * Allowlist below covers functions that legitimately need raw access
 * (e.g. health probes that test gateway connectivity itself).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "supabase/functions";
const ALLOW = new Set([
  // Probes raw gateway connectivity by design; logs to ai_usage_log itself.
  "model-health-check",
  // Email infra — the LOVABLE_API_KEY string match is a false positive.
  "auth-email-hook",
  "handle-email-suppression",
  "handle-email-unsubscribe",
  "preview-transactional-email",
  "process-email-queue",
  "send-transactional-email",
]);

const DIRECT_PATTERNS = [
  /ai\.gateway\.lovable\.dev/,
  /\bLOVABLE_API_KEY\b/,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name === "index.ts") out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  const fn = file.split("/").slice(-2, -1)[0];
  if (ALLOW.has(fn)) continue;
  const src = readFileSync(file, "utf8");
  const directHit = DIRECT_PATTERNS.some((re) => re.test(src));
  const usesRouter = /from\s+["'].*_shared\/ai-router/.test(src);
  if (directHit && !usesRouter) {
    offenders.push(fn);
  }
}

if (offenders.length) {
  console.error("❌ AI router bypass detected in edge functions:");
  for (const o of offenders) console.error(`   - ${o}`);
  console.error("\nRoute these calls through `_shared/ai-router.ts → callAI()`");
  console.error("or add the function to the allowlist in scripts/check-ai-router.mjs.");
  process.exit(1);
}

console.log(`✅ AI router coverage OK — no bypassers in ${ROOT}/*/index.ts`);
