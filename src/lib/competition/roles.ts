// Competition role-based visibility — mirrors the reader system role tiers
// (operator/entrant/judge/reader) and exposes the capabilities relevant to
// scoring, ballots, and artifact export on competition entries.

import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";

export type CompetitionRole = "operator" | "entrant" | "judge" | "reader";

export interface CompetitionCapabilities {
  role: CompetitionRole;
  /** Can view judge scoring panels (grading report, judge feedback, score chart). */
  canSeeJudgeScoring: boolean;
  /** Can view judge ballots / judge configuration data. */
  canSeeBallot: boolean;
  /** Can trigger artifact exports (evidence JSON / PDF certificate). */
  canExportArtifacts: boolean;
  /** Can score or judge (admin-only configuration & ballot edits). */
  canScoreOrJudge: boolean;
  /** Can view governance, provenance, stability internal data. */
  canSeeGovernance: boolean;
}

/**
 * Derive the viewer's role for a given competition entry.
 *  - operator : platform admin
 *  - entrant  : owner of the entry
 *  - judge    : tester role (judging program)
 *  - reader   : anyone else (collaborator, public viewer, signed-out)
 */
export function useCompetitionRole(entryUserId: string | null | undefined): CompetitionCapabilities {
  const { user, isAdmin, isTester } = useAuth();

  return useMemo<CompetitionCapabilities>(() => {
    let role: CompetitionRole = "reader";
    if (isAdmin) role = "operator";
    else if (entryUserId && user && entryUserId === user.id) role = "entrant";
    else if (isTester) role = "judge";

    const privileged = role === "operator" || role === "entrant" || role === "judge";

    return {
      role,
      canSeeJudgeScoring: privileged,
      canSeeBallot: privileged,
      canExportArtifacts: privileged,
      canScoreOrJudge: role === "operator" || role === "judge",
      canSeeGovernance: role === "operator" || role === "entrant",
    };
  }, [entryUserId, user, isAdmin, isTester]);
}
