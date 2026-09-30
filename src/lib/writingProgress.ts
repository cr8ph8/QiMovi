// Writing progress utilities: word counting, milestone detection, format defaults.
// Pure functions, no AI calls — safe to run on every keystroke.

import type { FountainParseResult } from "@/lib/fountain-parser";

export const FORMAT_TARGET_PAGES: Record<string, number> = {
  vertical: 5,
  micro: 5,
  short: 15,
  pilot_30: 35,
  pilot_60: 60,
  feature: 100,
};

export function targetPagesFor(format: string | null | undefined, override?: number | null): number {
  if (override && override > 0) return override;
  if (format && FORMAT_TARGET_PAGES[format]) return FORMAT_TARGET_PAGES[format];
  return 100;
}

export function countWords(fountain: string): number {
  if (!fountain) return 0;
  // Strip common Fountain markup so it doesn't inflate counts.
  const cleaned = fountain
    .replace(/^Title:.*$/gim, "")
    .replace(/^Author:.*$/gim, "")
    .replace(/^Credit:.*$/gim, "")
    .replace(/^Source:.*$/gim, "")
    .replace(/^Draft date:.*$/gim, "")
    .replace(/^Contact:.*$/gim, "")
    .replace(/^Copyright:.*$/gim, "")
    .replace(/^\s*[=#].*$/gm, "")            // sections / synopses
    .replace(/\[\[[^\]]*\]\]/g, "")           // notes
    .replace(/\/\*[\s\S]*?\*\//g, "")         // boneyard
    .replace(/[*_~]/g, "");                   // emphasis markers
  const tokens = cleaned.match(/\b[\p{L}\p{N}'’\-]+\b/gu);
  return tokens ? tokens.length : 0;
}

export function computeCompletionPct(pageCount: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((pageCount / target) * 100));
}

export type MilestoneKind =
  | "first_words"
  | "act_one"
  | "midpoint"
  | "act_three"
  | "fade_out"
  | "target_reached";

export interface MilestoneCandidate {
  kind: MilestoneKind;
  page_at_detect: number;
}

/**
 * Detect milestone candidates from parsed Fountain. Callers de-duplicate
 * against `writing_milestones` rows already stored for the draft.
 */
export function detectMilestones(
  parsed: FountainParseResult,
  fountain: string,
  targetPages: number,
): MilestoneCandidate[] {
  const out: MilestoneCandidate[] = [];
  const pages = parsed.stats?.pageCount ?? 0;
  const words = countWords(fountain);

  if (words > 0) out.push({ kind: "first_words", page_at_detect: pages });

  // Structural beats based on page progress vs. target.
  if (targetPages > 0) {
    const pct = pages / targetPages;
    if (pct >= 0.25) out.push({ kind: "act_one", page_at_detect: pages });
    if (pct >= 0.5) out.push({ kind: "midpoint", page_at_detect: pages });
    if (pct >= 0.75) out.push({ kind: "act_three", page_at_detect: pages });
    if (pct >= 1) out.push({ kind: "target_reached", page_at_detect: pages });
  }

  if (/\bFADE\s+OUT\b\.?/i.test(fountain)) {
    out.push({ kind: "fade_out", page_at_detect: pages });
  }

  return out;
}
