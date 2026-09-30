/**
 * Deterministic claim extraction for admin publication surfaces
 * (news_articles, changelog_releases, landing_page_config).
 *
 * Hampton PLC rule: Proposal ≠ State. Every material sentence in a
 * candidate publication is a claim that must be admitted (COMMIT / DAMP /
 * WAIVED) before the record can flip to a public status.
 *
 * The extractor is intentionally boring: no LLM, no fuzz. Same input →
 * same output. Both the client (preview) and the edge function (source of
 * truth) run identical logic — a copy of this file lives at
 * `supabase/functions/_shared/claimExtraction.ts`.
 */

export type ClaimKind =
  | "factual"
  | "metric"
  | "offer"
  | "testimonial"
  | "authority"
  | "scarcity"
  | "copy";

export interface ExtractedClaim {
  claim_text: string;
  claim_kind: ClaimKind;
}

export type PublicationSurface =
  | "news_article"
  | "changelog_release"
  | "landing_page";

/** Fields that participate in claim extraction and version hashing, per surface. */
export const GATED_FIELDS: Record<PublicationSurface, string[]> = {
  news_article: ["title", "excerpt", "body"],
  changelog_release: ["title", "summary", "highlights"],
  landing_page: ["section_label", "section_title", "section_description", "cta_text"],
};

const SENT_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"“])/;

const KIND_RULES: Array<{ kind: ClaimKind; test: RegExp }> = [
  { kind: "scarcity", test: /\b(only|last|limited|today|tonight|deadline|expires?|ends?|hurry|remaining)\b/i },
  { kind: "authority", test: /\b(certified|backed by|award|awarded|patent|approved|endorsed|expert|founder|dr\.|professor)\b/i },
  { kind: "testimonial", test: /["“][^"”]{20,}["”]|\bsays?\b|\btold us\b|\btestimonial\b/i },
  { kind: "offer", test: /\$\s?\d|\bfree\b|\bguarantee\b|\brefund\b|\bpayments? of\b|\bshipping\b/i },
  { kind: "metric", test: /\b\d[\d,]*\s?(%|percent|users|writers|entries|scripts|competitions|days|hours|minutes)\b/i },
  { kind: "factual", test: /\b(first|only|best|proven|clinically|guaranteed|leading|world[- ]class|number[- ]one)\b/i },
];

function classify(sentence: string): ClaimKind {
  for (const rule of KIND_RULES) {
    if (rule.test.test(sentence)) return rule.kind;
  }
  return "copy";
}

/** Return true if a sentence carries enough substance to be worth gating. */
function isMaterial(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.length < 12) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  return true;
}

function normalize(text: unknown): string {
  if (text == null) return "";
  if (Array.isArray(text)) return text.map((t) => normalize(t)).join(". ");
  if (typeof text === "object") {
    return Object.values(text as Record<string, unknown>)
      .map((v) => normalize(v))
      .join(". ");
  }
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract claims from a record's gated fields. Deterministic: sentences are
 * ordered by (field-index, sentence-index) and de-duplicated by claim_text.
 */
export function extractClaims(
  surface: PublicationSurface,
  record: Record<string, unknown>,
): ExtractedClaim[] {
  const fields = GATED_FIELDS[surface];
  const seen = new Set<string>();
  const out: ExtractedClaim[] = [];

  for (const field of fields) {
    const text = normalize(record[field]);
    if (!text) continue;
    const sentences = text.split(SENT_SPLIT);
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!isMaterial(sentence)) continue;
      const key = sentence.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ claim_text: sentence, claim_kind: classify(sentence) });
    }
  }
  return out;
}

/**
 * Compute a stable identifier for the current version of a record's gated
 * content. When this changes, new claims re-enter PENDING even if their text
 * happens to match a previously-decided claim.
 */
export function gatedFieldsPayload(
  surface: PublicationSurface,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const fields = GATED_FIELDS[surface];
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = record[f] ?? null;
  return out;
}
