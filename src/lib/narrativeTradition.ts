// Shared vocabulary for Western/Eastern narrative tradition awareness.
// See /framework/narrative-traditions for the underlying story math.

export type NarrativeTradition = "causal_western" | "relational_eastern" | "hybrid";

export type StructureModel =
  | "three_act"
  | "hero_journey"
  | "kishotenketsu"
  | "freytag"
  | "harmon_circle"
  | "hybrid";

export const TRADITION_LABELS: Record<NarrativeTradition, string> = {
  causal_western: "Causal (Western)",
  relational_eastern: "Relational (Eastern / Kishōtenketsu)",
  hybrid: "Hybrid",
};

export const TRADITION_SHORT_LABELS: Record<NarrativeTradition, string> = {
  causal_western: "Causal",
  relational_eastern: "Relational",
  hybrid: "Hybrid",
};

export const STRUCTURE_LABELS: Record<StructureModel, string> = {
  three_act: "Three-Act",
  hero_journey: "Hero's Journey",
  kishotenketsu: "Kishōtenketsu (Ki·Shō·Ten·Ketsu)",
  freytag: "Freytag's Pyramid",
  harmon_circle: "Harmon Story Circle",
  hybrid: "Hybrid",
};

export const DEFAULT_TRADITION_WEIGHTS: Record<NarrativeTradition, Record<string, number>> = {
  causal_western: {
    structure_q: 1.0,
    causal_pressure_q: 1.0,
    relational_meaning_q: 0.5,
    pattern_turn_q: 0.5,
    equilibrium_q: 0.5,
    meaning_density_q: 0.5,
  },
  relational_eastern: {
    structure_q: 0.5,
    causal_pressure_q: 0.5,
    relational_meaning_q: 1.0,
    pattern_turn_q: 1.0,
    equilibrium_q: 1.0,
    meaning_density_q: 1.0,
  },
  hybrid: {
    structure_q: 0.85,
    causal_pressure_q: 0.85,
    relational_meaning_q: 0.85,
    pattern_turn_q: 0.85,
    equilibrium_q: 0.85,
    meaning_density_q: 0.85,
  },
};

export function detectDominantTradition(
  causal: number | null | undefined,
  relational: number | null | undefined,
): NarrativeTradition {
  const c = Number(causal ?? 0);
  const r = Number(relational ?? 0);
  if (Math.abs(c - r) < 8) return "hybrid";
  return c > r ? "causal_western" : "relational_eastern";
}
