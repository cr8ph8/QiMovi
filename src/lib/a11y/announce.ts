/**
 * Screen-reader announcement helper.
 *
 * Maintains a single off-screen `aria-live` region per politeness level and
 * appends messages to it so assistive tech reads state changes that don't
 * naturally move focus (drawer open/close, inline preview expand/collapse,
 * async status flips, etc.).
 *
 * Radix primitives already announce their own titles/descriptions when they
 * take focus, so use this helper for *ambient* changes — things a keyboard
 * or mouse user sees passively but a screen reader would otherwise miss.
 */

type Politeness = "polite" | "assertive";

const REGION_ID: Record<Politeness, string> = {
  polite: "lovable-sr-live-polite",
  assertive: "lovable-sr-live-assertive",
};

function ensureRegion(politeness: Politeness): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const id = REGION_ID[politeness];
  let el = document.getElementById(id);
  if (el) return el;
  el = document.createElement("div");
  el.id = id;
  el.setAttribute("aria-live", politeness);
  el.setAttribute("aria-atomic", "true");
  el.setAttribute("role", politeness === "assertive" ? "alert" : "status");
  // sr-only equivalent — visually hidden but reachable by AT.
  el.style.cssText =
    "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
  document.body.appendChild(el);
  return el;
}

/**
 * Announce a message to screen readers. Toggles the region's text so the
 * same message announced twice in a row still fires (some AT dedupes on
 * identical content unless the node is re-populated).
 */
export function announce(
  message: string,
  politeness: Politeness = "polite",
): void {
  const el = ensureRegion(politeness);
  if (!el) return;
  // Clear first so identical repeated messages still get spoken.
  el.textContent = "";
  // Use a microtask so the DOM mutation is observed as a real change.
  window.setTimeout(() => {
    el.textContent = message;
  }, 20);
}
