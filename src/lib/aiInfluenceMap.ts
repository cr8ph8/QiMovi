/**
 * Maps writer-declared AI influences (free-form labels + ai_fields keys) onto
 * the rubric's dimension keys so we can badge which scored dimensions were
 * touched by AI according to the disclosure.
 */

// Canonical aliases → set of rubric dimension keys it should highlight.
const ALIAS_TO_DIMS: Record<string, string[]> = {
  dialogue: ["dialogue"],
  dialog: ["dialogue"],
  lines: ["dialogue"],
  structure: ["structure", "format_adherence"],
  outline: ["structure"],
  beats: ["structure"],
  plot: ["structure", "narrative"],
  pacing: ["structure", "narrative"],
  narrative: ["narrative", "structure"],
  story: ["narrative", "structure"],
  character: ["character_depth", "character_score"],
  characters: ["character_depth", "character_score"],
  character_depth: ["character_depth"],
  characterization: ["character_depth", "character_score"],
  theme: ["theme"],
  themes: ["theme"],
  thematic: ["theme"],
  emotion: ["emotion", "emotional"],
  emotional: ["emotion", "emotional"],
  tone: ["emotion", "emotional"],
  originality: ["originality"],
  concept: ["originality"],
  premise: ["originality"],
  voice: ["originality", "dialogue"],
  format: ["format_adherence"],
  formatting: ["format_adherence"],
  visual: ["visual"],
  visuals: ["visual"],
  description: ["visual"],
  action: ["visual"],
  market: ["market"],
  marketability: ["market"],
  audience: ["audience", "market"],
  franchise: ["franchise"],
  production: ["production"],
  budget: ["production"],
  logline: ["originality", "market"],
  title: ["originality"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export interface InfluenceMapInput {
  declared_influences?: string[] | null;
  ai_fields?: Record<string, unknown> | null;
}

/**
 * Returns a Set of rubric dimension keys that the disclosure claims AI touched.
 * `dimensionKeys` is the universe of known rubric dim keys (so we only flag real ones).
 */
export function mapInfluencesToDimensions(
  disclosure: InfluenceMapInput | null | undefined,
  dimensionKeys: string[],
): Set<string> {
  const out = new Set<string>();
  if (!disclosure) return out;
  const known = new Set(dimensionKeys);

  const rawLabels: string[] = [];
  (disclosure.declared_influences ?? []).forEach((s) => s && rawLabels.push(s));
  if (disclosure.ai_fields && typeof disclosure.ai_fields === "object") {
    Object.entries(disclosure.ai_fields).forEach(([k, v]) => {
      if (v) rawLabels.push(k);
    });
  }

  rawLabels.forEach((label) => {
    const norm = normalize(label);
    // direct dimension match
    if (known.has(norm)) {
      out.add(norm);
      return;
    }
    // alias match
    const targets = ALIAS_TO_DIMS[norm];
    if (targets) {
      targets.forEach((t) => {
        if (known.has(t)) out.add(t);
      });
      return;
    }
    // substring match against dimension keys (e.g. "character arcs" → character_depth)
    dimensionKeys.forEach((dk) => {
      if (norm.includes(dk) || dk.includes(norm)) out.add(dk);
    });
  });

  return out;
}

/** Inverse: for each AI-influenced dimension, return the labels that mapped to it. */
export function buildInfluenceReverseMap(
  disclosure: InfluenceMapInput | null | undefined,
  dimensions: Array<{ key: string; label: string }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!disclosure) return out;
  const dimKeys = dimensions.map((d) => d.key);
  const known = new Set(dimKeys);

  const rawLabels: string[] = [];
  (disclosure.declared_influences ?? []).forEach((s) => s && rawLabels.push(s));
  if (disclosure.ai_fields && typeof disclosure.ai_fields === "object") {
    Object.entries(disclosure.ai_fields).forEach(([k, v]) => {
      if (v) rawLabels.push(k);
    });
  }

  rawLabels.forEach((label) => {
    const norm = normalize(label);
    const matched = new Set<string>();
    if (known.has(norm)) matched.add(norm);
    (ALIAS_TO_DIMS[norm] ?? []).forEach((t) => known.has(t) && matched.add(t));
    dimKeys.forEach((dk) => {
      if (norm.includes(dk) || dk.includes(norm)) matched.add(dk);
    });
    matched.forEach((dk) => {
      if (!out[dk]) out[dk] = [];
      if (!out[dk].includes(label)) out[dk].push(label);
    });
  });

  return out;
}
