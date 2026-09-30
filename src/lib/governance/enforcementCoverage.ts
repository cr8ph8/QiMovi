/**
 * Enforcement coverage report.
 * ────────────────────────────
 * Cross-references every edge function under `supabase/functions/` against the
 * QUERY-readiness registry (`QUERY_READY_ENDPOINTS`) and reports:
 *
 *   • enforced          — read routes wrapped in `readOnlyHandler`
 *   • reclassified      — routes explicitly marked as writes/mixed/unenforced
 *   • missing           — deployed functions absent from the registry
 *                         (unreviewed; presumed write until inventoried)
 *
 * The deployed-function inventory is built at bundle time via
 * `import.meta.glob` so we don't have to hand-maintain a mirror list.
 */

import { QUERY_READY_ENDPOINTS, type EndpointEntry } from "@/lib/queryReadiness";

/**
 * Functions we intentionally do NOT consider part of the QUERY boundary
 * inventory. `_shared` is a code-only helper folder; the other names are
 * infrastructure hooks (webhooks, cron, email queue processors) that never
 * expose a read surface and don't belong in the read/write map.
 */
const IGNORED_FUNCTIONS = new Set<string>([
  "_shared",
  "stripe-webhook",
  "linear-webhook",
  "auth-email-hook",
  "process-email-queue",
  "handle-email-suppression",
  "handle-email-unsubscribe",
  "mcp",
]);

/**
 * Deployed edge-function inventory.
 *
 * Kept as an explicit constant because the actual sources live under
 * `supabase/functions/**` and import Deno-only specifiers (`npm:…`) that
 * Vite/Rollup can't resolve at bundle time — `import.meta.glob` on that path
 * breaks the client build. Refresh this list whenever a function is added or
 * removed under `supabase/functions/`.
 */
const DEPLOYED_FUNCTIONS: readonly string[] = [
  "activate-pro-tokens",
  "add-tokens",
  "admit-concept",
  "ai-analyze-reports",
  "ai-compare",
  "ai-judge",
  "auto-audit",
  "backfill-projects",
  "build-context-bundle",
  "bulk-import-entries",
  "chapter-weekly-digest",
  "check-subscription",
  "compute-shield",
  "convert-comment-to-suggestion",
  "create-checkout",
  "e2e-seed-demo-entry",
  "embed-character",
  "ensure-project",
  "export-document",
  "export-evidence-bundle",
  "extract-continuity",
  "extract-stylometrics",
  "fulfill-checkout",
  "generate-artifact",
  "generate-draft-from-concept",
  "generate-logline",
  "generate-preproduction",
  "generate-script",
  "generate-story-plan",
  "generate-title",
  "ingest-brain-dump-file",
  "legal-summary",
  "linear-create-issue",
  "linear-update-issue",
  "list-gate-decisions",
  "log-access-denial",
  "manage-feature-subscription",
  "model-health-check",
  "narrative-gate",
  "news-draft-suggest",
  "news-rss",
  "notify-admin-demo-request",
  "notify-brief-comment",
  "notify-subsystem-alert",
  "notify-trial-application",
  "organize-brain-dump",
  "outline-from-beats",
  "parse-brain-dump-file",
  "parse-screenplay",
  "parse-structured-fields",
  "preview-transactional-email",
  "process-batch",
  "publication-gate",
  "publish-scheduled-news",
  "qframe-analyze-music",
  "qframe-compile-packet",
  "qframe-draft-bible",
  "qframe-export-bundle",
  "qframe-suggest-shots",
  "qframe-tag-asset",
  "rank-variants",
  "read-context-bundle",
  "read-evidence-bundle",
  "read-governance-events",
  "read-protected-authors",
  "renew-subscriptions",
  "rewrite-selection",
  "rollback-character-diamond",
  "scan-protected-author-emulation",
  "screenplay-assist",
  "seed-demo-profiles",
  "seed-filmstack",
  "seed-governance-demo",
  "seed-screenplay-draft",
  "send-transactional-email",
  "signalcheck-analyze",
  "signalcheck-rewrite",
  "spend-tokens",
  "suggest-character-diamond",
  "suggest-metadata",
  "suggest-rewrites",
  "test-canonical-narrative",
  "transfer-tokens",
  "validate-review-ai",
  "verify-character-identity",
  "voice-drift",
  "withdraw-entry",
];

function discoverDeployedFunctions(): string[] {
  return [...DEPLOYED_FUNCTIONS].sort();
}


export interface CoverageReport {
  deployed: string[];
  enforced: EndpointEntry[];
  reclassified: EndpointEntry[];
  missing: string[];
  /** Registered but not present in the deployed set — stale registry entry. */
  stale: EndpointEntry[];
  totals: {
    deployed: number;
    registered: number;
    enforced: number;
    reclassified: number;
    missing: number;
    stale: number;
    coveragePct: number;
    enforcedPct: number;
  };
}

export function computeEnforcementCoverage(): CoverageReport {
  const deployed = discoverDeployedFunctions();
  const deployedSet = new Set(deployed);
  const registeredByName = new Map(
    QUERY_READY_ENDPOINTS.map((e) => [e.name, e] as const),
  );

  const enforced = QUERY_READY_ENDPOINTS.filter(
    (e) => e.intent === "read" && e.enforced,
  );
  const reclassified = QUERY_READY_ENDPOINTS.filter(
    (e) => e.intent !== "read" || !e.enforced,
  );

  const missing = deployed.filter((n) => !registeredByName.has(n));
  const stale = QUERY_READY_ENDPOINTS.filter((e) => !deployedSet.has(e.name));

  const totalDeployed = deployed.length;
  const registered = totalDeployed - missing.length;
  const coveragePct =
    totalDeployed === 0 ? 0 : Math.round((registered / totalDeployed) * 100);
  const enforcedPct =
    totalDeployed === 0 ? 0 : Math.round((enforced.length / totalDeployed) * 100);

  return {
    deployed,
    enforced,
    reclassified,
    missing,
    stale,
    totals: {
      deployed: totalDeployed,
      registered,
      enforced: enforced.length,
      reclassified: reclassified.length,
      missing: missing.length,
      stale: stale.length,
      coveragePct,
      enforcedPct,
    },
  };
}
