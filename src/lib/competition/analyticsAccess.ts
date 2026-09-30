// Competition analytics access — judge performance, scoring distributions,
// and analytics exports are restricted to entrants, judges, and operators.
//
// Policy:
//   - operator (admin)            → always allowed
//   - judge (tester role)         → always allowed
//   - entrant (any signed-in user) → allowed (signed-in users are potential
//                                     entrants; per-entry ownership is enforced
//                                     separately by useCompetitionRole)
//   - signed-out visitor          → denied

import { useAuth } from "@/hooks/useAuth";

export interface CompetitionAnalyticsAccess {
  canSeeAnalytics: boolean;
  /** Whether the viewer is allowed to trigger analytics export actions. */
  canExportAnalytics: boolean;
  reason: "operator" | "judge" | "entrant" | "denied";
}

export function useCompetitionAnalyticsAccess(): CompetitionAnalyticsAccess {
  const { user, isAdmin, isTester } = useAuth();

  if (isAdmin) {
    return { canSeeAnalytics: true, canExportAnalytics: true, reason: "operator" };
  }
  if (isTester) {
    return { canSeeAnalytics: true, canExportAnalytics: true, reason: "judge" };
  }
  if (user) {
    return { canSeeAnalytics: true, canExportAnalytics: true, reason: "entrant" };
  }
  return { canSeeAnalytics: false, canExportAnalytics: false, reason: "denied" };
}
