import { useAuth } from "@/hooks/useAuth";

export type EvidenceViewerRole = "operator" | "judge" | "entrant" | "reader";

export const EVIDENCE_ROLE_LABEL: Record<EvidenceViewerRole, string> = {
  operator: "Operator",
  judge: "Judge",
  entrant: "Entrant",
  reader: "Reader (future public)",
};

export const EVIDENCE_ROLE_DESCRIPTION: Record<EvidenceViewerRole, string> = {
  operator:
    "Full receipt trail, linked PR/spec metadata, hashes, correlation ids, and actor ids.",
  judge:
    "Full receipt trail and linked references — same as operator, without admin controls.",
  entrant:
    "Approved disclosure summary and high-level receipt titles/timestamps. Hashes, correlation ids, actors, and linked references are redacted.",
  reader:
    "Public reader view — only the disclosure banner and evidence hash summary are shown; internal receipts and links are hidden.",
};

/**
 * Derive the viewer's evidence role from auth context.
 *
 * Roles:
 *   - `operator` — admins and internal testers.
 *   - `judge`    — judge role holders.
 *   - `entrant`  — signed-in writers who do not hold operator/judge roles.
 *   - `reader`   — future public reader audience (never derived from auth;
 *                  only reachable via the "Preview as" role switcher).
 *
 * Kept as a hook (not a helper) so any change to how roles are sourced
 * (e.g. server-signed viewer claims) is a one-file swap.
 */
export function useEvidenceViewerRole(): EvidenceViewerRole {
  const { isAdmin, isJudge, isTester } = useAuth();
  if (isAdmin || isTester) return "operator";
  if (isJudge) return "judge";
  return "entrant";
}

