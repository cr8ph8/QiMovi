/**
 * Vite plugin: fail the production build when the QUERY-readiness registry
 * has drifted from what edge functions actually enforce. Runs once at
 * `buildStart`. In `serve` (dev) mode it only warns, so a local dev session
 * isn't blocked by a temporary drift, but every real `vite build` — the mode
 * CI uses — hard-fails.
 */

import type { Plugin } from "vite";
import {
  auditQueryReadinessRegistry,
  formatAuditFailure,
} from "../scripts/auditQueryReadinessRegistry";

export function queryReadinessAuditPlugin(): Plugin {
  let isBuild = false;
  return {
    name: "lovable:query-readiness-audit",
    apply: () => true,
    configResolved(config) {
      isBuild = config.command === "build";
    },
    buildStart() {
      try {
        const result = auditQueryReadinessRegistry();
        const failure = formatAuditFailure(result);
        if (!failure) {
          // eslint-disable-next-line no-console
          console.log(
            `[query-readiness-audit] OK · ${result.checkedFunctions} functions, ${result.checkedRegistryEntries} registry entries.`,
          );
          return;
        }
        if (isBuild) {
          this.error(failure);
        } else {
          // eslint-disable-next-line no-console
          console.warn(`[query-readiness-audit] ${failure}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Never let an audit crash silently break the build with an
        // unrelated error trace — surface it explicitly.
        if (isBuild) {
          this.error(`[query-readiness-audit] audit crashed: ${msg}`);
        } else {
          // eslint-disable-next-line no-console
          console.warn(`[query-readiness-audit] audit crashed: ${msg}`);
        }
      }
    },
  };
}
