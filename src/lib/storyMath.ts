// Pure, deterministic Story Math helpers.
// Implements the equations documented at /framework/narrative-traditions.
// No side effects — safe to import anywhere (client or edge function via npm:).

export interface SceneSignals {
  deltaPlot?: number;
  deltaCharacter?: number;
  deltaTension?: number;
  deltaMeaning?: number;
  deltaRelationship?: number;
}

/** sceneValue = ΔPlot + ΔCharacter + ΔTension + ΔMeaning + ΔRelationship */
export function sceneValue(s: SceneSignals): number {
  return (
    (s.deltaPlot ?? 0) +
    (s.deltaCharacter ?? 0) +
    (s.deltaTension ?? 0) +
    (s.deltaMeaning ?? 0) +
    (s.deltaRelationship ?? 0)
  );
}

/** tension = stakes · uncertainty · attachment  (each 0..1) */
export function tension(stakes: number, uncertainty: number, attachment: number): number {
  return clamp01(stakes) * clamp01(uncertainty) * clamp01(attachment);
}

/** Western engine: drama = goal · obstacle */
export function drama(goal: number, obstacle: number): number {
  return clamp01(goal) * clamp01(obstacle);
}

/** Eastern engine: meaning = pattern + turn  (capped at 1) */
export function meaning(pattern: number, turn: number): number {
  return Math.min(1, clamp01(pattern) + clamp01(turn));
}

/** Arc gap = |want − need|. Convergence = arc resolves. Divergence = tragedy. */
export function arcGap(want: number, need: number): number {
  return Math.abs(clamp01(want) - clamp01(need));
}

/**
 * storyPower = (W·O·T·S·U·A) + (R·M·E)
 * Western spine + Eastern soul.
 */
export function storyPower(input: {
  want: number;
  obstacle: number;
  stakes: number;
  uncertainty: number;
  attachment: number;
  relationship: number;
  meaning: number;
  equilibrium: number;
}): number {
  const causal =
    clamp01(input.want) *
    clamp01(input.obstacle) *
    clamp01(input.stakes) *
    clamp01(input.uncertainty) *
    clamp01(input.attachment);
  const relational = clamp01(input.relationship) * clamp01(input.meaning) * clamp01(input.equilibrium);
  return causal + relational;
}

/** Diagnostic labels for scene-level flags. */
export interface BeatDiagnostic {
  code:
    | "passenger_scene"
    | "arc_diverging"
    | "weak_ten"
    | "tension_monotonic"
    | "confusion_over_mystery";
  message: string;
}

export function diagnoseBeats(beats: SceneSignals[]): BeatDiagnostic[] {
  const flags: BeatDiagnostic[] = [];
  beats.forEach((b, i) => {
    if (Math.abs(sceneValue(b)) < 0.05) {
      flags.push({
        code: "passenger_scene",
        message: `Beat ${i + 1}: ΔState ≈ 0. Cut, merge, or weaponize.`,
      });
    }
  });
  return flags;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
