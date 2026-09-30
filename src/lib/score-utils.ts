/**
 * Score display utility functions — shared across entry detail, reports, and grading surfaces.
 */

/** Text color class based on score percentage */
export function getScoreColor(pct: number): string {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-primary";
  if (pct >= 40) return "text-amber-400";
  return "text-destructive";
}

/** Pill badge color class based on score percentage */
export function getScorePillColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500/15 text-emerald-400";
  if (pct >= 60) return "bg-primary/15 text-primary";
  if (pct >= 40) return "bg-amber-500/15 text-amber-400";
  return "bg-destructive/15 text-destructive";
}

/** Progress bar color class based on score percentage */
export function getBarColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 60) return "bg-primary";
  if (pct >= 40) return "bg-amber-500";
  return "bg-destructive";
}

/** Known model display labels */
export const MODEL_LABELS: Record<string, string> = {
  "google/gemini-3-flash-preview": "Gemini 3 Flash",
  "google/gemini-2.5-flash": "Gemini 2.5 Flash",
  "google/gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
  "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "openai/gpt-5": "GPT-5",
  "openai/gpt-5-mini": "GPT-5 Mini",
  "openai/gpt-5-nano": "GPT-5 Nano",
  "openai/gpt-5.2": "GPT-5.2",
};

/** Report visualization colors (gold, cyan, violet) */
export const REPORT_COLORS = [
  "hsl(42, 78%, 55%)",
  "hsl(190, 80%, 50%)",
  "hsl(270, 70%, 60%)",
];

/** IPQ dimension labels */
export const IPQ_LABELS: Record<string, string> = {
  narrative: "Narrative Quality",
  character_score: "Character Development",
  emotional: "Emotional Impact",
  visual: "Visual Storytelling",
  market: "Market Viability",
  franchise: "Franchise Potential",
  production: "Production Feasibility",
  audience: "Audience Engagement",
};

/** Legacy scoring labels */
export const LEGACY_LABELS: Record<string, string> = {
  originality: "Concept Originality",
  structure: "Narrative Structure",
  character_depth: "Character Depth",
  dialogue: "Dialogue Quality",
  theme: "Theme Clarity",
  emotion: "Emotional Impact",
  format_adherence: "Format Adherence",
};
