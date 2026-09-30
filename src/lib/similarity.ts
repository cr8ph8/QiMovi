/**
 * Character-level similarity between two strings.
 * Returns a value between 0 and 1.
 */
export function charSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = a.toLowerCase().replace(/\s+/g, " ").trim();
  const nb = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;

  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return matches / longer.length;
}

export interface AiFieldRecord {
  ai_value: string;
  similarity: number;
  is_ai: boolean;
}

export type AiFieldsMap = Record<string, AiFieldRecord>;

/**
 * Check if a field value is still substantially AI-generated.
 * Threshold: 50% similarity.
 */
export function isStillAiGenerated(currentValue: string, originalAiValue: string): boolean {
  return charSimilarity(currentValue, originalAiValue) >= 0.5;
}
