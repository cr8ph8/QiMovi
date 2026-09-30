/**
 * Rewrite Cost Architecture — Tiered Token Pricing
 *
 * Categories operations by computational scope.
 * 1 token = $0.10 (platform standard).
 */

export const REWRITE_COST = {
  MICRO: 1,
  STANDARD: 3,
  EXTENDED: 5,
  STRUCTURAL: 12,
  FULL: 25,
} as const;

export type RewriteTier = keyof typeof REWRITE_COST;

/**
 * Maps every known rewrite operation type to a cost tier.
 * Unknown types fall back to STANDARD (3 tokens) via getRewriteCost().
 */
export const REWRITE_TYPE_MAP: Record<string, RewriteTier> = {
  // ── Tier 1 — Micro Rewrites (1⊘) ──
  rewrite: "MICRO",
  rewrite_line: "MICRO",
  rewrite_sentence: "MICRO",
  tighten_dialogue: "MICRO",
  improve_clarity: "MICRO",
  shorten_text: "MICRO",
  expand: "MICRO",
  expand_text: "MICRO",
  condense: "MICRO",
  punch_up: "MICRO",
  grammar_fix: "MICRO",
  punctuation_fix: "MICRO",
  tone_adjust: "MICRO",
  remove_repetition: "MICRO",
  format_cleanup: "MICRO",
  scene_heading_fix: "MICRO",

  // ── Tier 2 — Standard Rewrites (3⊘) ──
  rewrite_dialogue_block: "STANDARD",
  improve_pacing: "STANDARD",
  enhance_conflict: "STANDARD",
  strengthen_stakes: "STANDARD",
  improve_exposition: "STANDARD",
  improve_subtext: "STANDARD",
  emotional_enhancement: "STANDARD",
  rewrite_scene_segment: "STANDARD",
  rewrite_character_voice: "STANDARD",
  improve_visual_description: "STANDARD",

  // ── Tier 3 — Extended Rewrites (5⊘) ──
  rewrite_scene: "EXTENDED",
  rewrite_story_beat: "EXTENDED",
  rewrite_sequence: "EXTENDED",
  improve_scene_structure: "EXTENDED",
  increase_tension: "EXTENDED",
  rewrite_character_interaction: "EXTENDED",

  // ── Tier 4 — Structural Rewrites (12⊘) ──
  rewrite_scene_alternate: "STRUCTURAL",
  rewrite_for_genre: "STRUCTURAL",
  rewrite_for_budget: "STRUCTURAL",
  rewrite_for_rating: "STRUCTURAL",
  restructure_scene: "STRUCTURAL",
  adjust_character_arc_segment: "STRUCTURAL",
  rewrite_with_constraints: "STRUCTURAL",

  // ── Tier 5 — Full Transformations (25⊘) ──
  rewrite_act: "FULL",
  generate_alternate_scene: "FULL",
  rewrite_multi_scene_sequence: "FULL",
  rewrite_plot_path: "FULL",
  rewrite_story_direction: "FULL",
};
