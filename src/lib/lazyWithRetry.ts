import { ComponentType, lazy } from "react";

/**
 * Wraps React.lazy with stale-chunk recovery.
 *
 * When a deploy replaces hashed chunk filenames, an old tab still references
 * the old hashes. The dynamic import then fails with "Importing a module
 * script failed" / "Failed to fetch dynamically imported module" and React
 * renders a blank screen.
 *
 * Strategy:
 *  1. On first failure, set a sessionStorage flag and force a hard reload so
 *     the browser fetches the fresh index.html (and therefore fresh chunk
 *     hashes).
 *  2. If the failure repeats after the reload, surface the real error rather
 *     than loop forever.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    const reloadKey = "lovable:chunk-reload";
    try {
      return await factory();
    } catch (err) {
      const alreadyReloaded = sessionStorage.getItem(reloadKey);
      const message = err instanceof Error ? err.message : String(err);
      const looksLikeChunkError =
        /Importing a module script failed|Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk|error loading dynamically imported module/i.test(
          message,
        );

      if (looksLikeChunkError && !alreadyReloaded) {
        sessionStorage.setItem(reloadKey, String(Date.now()));
        window.location.reload();
        // Return a never-resolving promise so React keeps Suspense fallback
        // until the reload swaps the page out.
        return new Promise<{ default: T }>(() => {});
      }

      // Clear the flag once we've successfully gotten past it on a later load.
      throw err;
    }
  });
}

// Clear the reload guard on a successful page load so future stale-chunk
// situations can self-heal again.
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    sessionStorage.removeItem("lovable:chunk-reload");
  });
}
