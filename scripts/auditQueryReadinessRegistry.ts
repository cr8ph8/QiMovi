/**
 * Static audit of the QUERY-readiness registry vs. what edge functions
 * actually import from `_shared/queryContract`.
 * ─────────────────────────────────────────────────────────────────
 * Runs at build time (via Vite plugin) and in unit tests. The check is
 * intentionally file-system based — no runtime import of Deno-only edge
 * function code — so it works from Node/Vitest and inside Vite's build.
 *
 * Two directions:
 *   1. Every edge function that wraps its handler with `readOnlyHandler`
 *      MUST be registered in QUERY_READY_ENDPOINTS with
 *      `intent: "read", enforced: true`. Anything else means a route claims
 *      read-only guarantees at runtime but the dashboard / audits don't know
 *      about it — silent drift.
 *   2. Every registry entry marked `enforced: true` MUST have a deployed
 *      function whose source actually calls `readOnlyHandler`. Otherwise the
 *      registry is lying about a guarantee.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { QUERY_READY_ENDPOINTS } from "../src/lib/queryReadiness";

const FUNCTIONS_ROOT = path.resolve(process.cwd(), "supabase/functions");
const IGNORED = new Set(["_shared"]);

/** Detects `readOnlyHandler` usage — import or call — in a function's source. */
function usesReadOnlyHandler(indexTsPath: string): boolean {
  const src = readFileSync(indexTsPath, "utf8");
  // Strip line + block comments so a mention in a doc comment doesn't
  // false-positive the audit.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return /\breadOnlyHandler\b/.test(stripped);
}

function listDeployedFunctions(): string[] {
  if (!existsSync(FUNCTIONS_ROOT)) return [];
  return readdirSync(FUNCTIONS_ROOT).filter((name) => {
    if (IGNORED.has(name)) return false;
    const dir = path.join(FUNCTIONS_ROOT, name);
    if (!statSync(dir).isDirectory()) return false;
    return existsSync(path.join(dir, "index.ts"));
  });
}

export interface RegistryAuditResult {
  /** Functions that call readOnlyHandler but aren't registered as enforced-read. */
  unregisteredEnforced: string[];
  /** Registry entries marked enforced but whose source no longer uses the wrapper. */
  registryOverclaims: string[];
  /** Enforced=true registry entries with no deployed function at all. */
  registryPointsToMissing: string[];
  checkedFunctions: number;
  checkedRegistryEntries: number;
}

export function auditQueryReadinessRegistry(): RegistryAuditResult {
  const deployed = listDeployedFunctions();
  const registryByName = new Map(
    QUERY_READY_ENDPOINTS.map((e) => [e.name, e] as const),
  );

  const enforcedInSource = new Set<string>();
  for (const name of deployed) {
    const p = path.join(FUNCTIONS_ROOT, name, "index.ts");
    if (usesReadOnlyHandler(p)) enforcedInSource.add(name);
  }

  const unregisteredEnforced: string[] = [];
  for (const name of enforcedInSource) {
    const entry = registryByName.get(name);
    if (!entry || entry.intent !== "read" || !entry.enforced) {
      unregisteredEnforced.push(name);
    }
  }

  const registryOverclaims: string[] = [];
  const registryPointsToMissing: string[] = [];
  const deployedSet = new Set(deployed);
  for (const entry of QUERY_READY_ENDPOINTS) {
    if (!(entry.intent === "read" && entry.enforced)) continue;
    if (!deployedSet.has(entry.name)) {
      registryPointsToMissing.push(entry.name);
      continue;
    }
    if (!enforcedInSource.has(entry.name)) {
      registryOverclaims.push(entry.name);
    }
  }

  return {
    unregisteredEnforced: unregisteredEnforced.sort(),
    registryOverclaims: registryOverclaims.sort(),
    registryPointsToMissing: registryPointsToMissing.sort(),
    checkedFunctions: deployed.length,
    checkedRegistryEntries: QUERY_READY_ENDPOINTS.length,
  };
}

/**
 * Human-readable failure message for CI / build output. Returns `null` when
 * the audit passes so callers can `if (msg) throw new Error(msg)`.
 */
export function formatAuditFailure(r: RegistryAuditResult): string | null {
  const problems: string[] = [];
  if (r.unregisteredEnforced.length > 0) {
    problems.push(
      `Edge functions using readOnlyHandler but missing from QUERY_READY_ENDPOINTS (or not marked intent="read" + enforced=true):\n  - ${r.unregisteredEnforced.join(
        "\n  - ",
      )}`,
    );
  }
  if (r.registryOverclaims.length > 0) {
    problems.push(
      `Registry claims enforced=true but the deployed function no longer calls readOnlyHandler:\n  - ${r.registryOverclaims.join(
        "\n  - ",
      )}`,
    );
  }
  if (r.registryPointsToMissing.length > 0) {
    problems.push(
      `Registry has enforced entries for functions that do not exist under supabase/functions/:\n  - ${r.registryPointsToMissing.join(
        "\n  - ",
      )}`,
    );
  }
  if (problems.length === 0) return null;
  return (
    "QUERY-readiness registry audit failed.\n\n" +
    problems.join("\n\n") +
    "\n\nEither register the endpoint in src/lib/queryReadiness.ts (intent: 'read', enforced: true) " +
    "or remove/adjust the stale registry entry.\n"
  );
}
