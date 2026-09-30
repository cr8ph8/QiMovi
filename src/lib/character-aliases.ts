/**
 * Character alias resolution for cross-entry franchise analytics.
 * Maps alternate character names to a canonical identity per universe.
 */

export interface AliasRow {
  canonical_name: string;
  alias_name: string;
}

/**
 * Build a lookup map from DB rows: alias (uppercased) → canonical (uppercased).
 * Also maps canonical → canonical so lookups always succeed.
 */
export function buildAliasMap(aliases: AliasRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of aliases) {
    const canonical = a.canonical_name.trim().toUpperCase();
    const alias = a.alias_name.trim().toUpperCase();
    map.set(alias, canonical);
    // Ensure canonical maps to itself
    if (!map.has(canonical)) map.set(canonical, canonical);
  }
  return map;
}

/**
 * Resolve a character name through the alias map.
 * Returns the canonical name (uppercased) or the original uppercased name if no alias exists.
 */
export function resolveCharacterName(name: string, aliasMap: Map<string, string>): string {
  const normalized = name.replace(/\s*\(.*\)$/, "").trim().toUpperCase();
  return aliasMap.get(normalized) || normalized;
}
