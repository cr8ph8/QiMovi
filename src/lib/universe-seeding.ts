/**
 * Universe seeding utilities — normalises titles and finds franchise matches.
 */

/**
 * Normalise a title for franchise comparison.
 * Strips punctuation, collapses whitespace, lowercases.
 * "After-Life: Blood of Art" → "after life blood of art"
 */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[-–—:]/g, " ")     // hyphens & colons → space
    .replace(/[^\w\s]/g, "")     // strip remaining punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract a franchise prefix from a normalised title.
 * E.g. "after life blood of art" → "after life"
 * Returns the first N words that form a recognisable franchise root.
 */
export function extractFranchisePrefix(normalised: string, maxWords = 2): string {
  return normalised.split(" ").slice(0, maxWords).join(" ");
}

export interface SeedCandidate {
  entry_id: string;
  title: string;
  normalised: string;
  matchType: "strong" | "suggested";
}

/**
 * Given a universe name and a list of user entries, return candidates
 * grouped by match strength.
 *
 * Strong matches: entries whose normalised title starts with the franchise prefix.
 * Suggested matches: entries that share ≥2 words with the prefix but don't start with it.
 */
export function findFranchiseCandidates(
  universeName: string,
  entries: { id: string; title: string }[],
  alreadyLinked: Set<string> = new Set(),
): { strong: SeedCandidate[]; suggested: SeedCandidate[] } {
  const prefix = extractFranchisePrefix(normaliseTitle(universeName));
  const prefixWords = new Set(prefix.split(" "));

  const strong: SeedCandidate[] = [];
  const suggested: SeedCandidate[] = [];

  for (const entry of entries) {
    if (alreadyLinked.has(entry.id)) continue;
    const normalised = normaliseTitle(entry.title);

    if (normalised.startsWith(prefix)) {
      strong.push({ entry_id: entry.id, title: entry.title, normalised, matchType: "strong" });
    } else {
      // Check word overlap for weaker signal
      const words = new Set(normalised.split(" "));
      const overlap = [...prefixWords].filter((w) => words.has(w) && w.length > 2).length;
      if (overlap >= 2) {
        suggested.push({ entry_id: entry.id, title: entry.title, normalised, matchType: "suggested" });
      }
    }
  }

  // Sort strong matches by title
  strong.sort((a, b) => a.title.localeCompare(b.title));
  suggested.sort((a, b) => a.title.localeCompare(b.title));

  return { strong, suggested };
}
