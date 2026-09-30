// Reader system — role-based visibility (presentation only).
// Derives a viewer role for a given entry and the UI capabilities that follow.
//
// Roles:
//   - operator : platform admin (full visibility & controls)
//   - entrant  : the entry owner (full visibility of their own artifacts)
//   - judge    : tester/judge role (read-only across reader surfaces, sees
//                confidential docs but cannot upload/edit)
//   - reader   : anyone else (collaborator, qi-list/public visitor, signed-out)

import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { ReaderEntry } from "@/lib/reader/queries";
import type { ReaderDoc, ReaderAsset } from "@/lib/reader/types";

export type ReaderRole = "operator" | "entrant" | "judge" | "reader";

export interface ReaderCapabilities {
  role: ReaderRole;
  canUpload: boolean;
  canEditEntry: boolean;
  canSeeConfidential: boolean;
  canSeeDeprecated: boolean;
  canSeeOperatorStats: boolean;
  canExportArtifacts: boolean;
  canManageCollaborators: boolean;
  canScoreOrJudge: boolean;
}

export const ROLE_LABEL: Record<ReaderRole, string> = {
  operator: "Operator",
  entrant: "Entrant",
  judge: "Judge",
  reader: "Reader",
};

export const ROLE_TONE: Record<ReaderRole, string> = {
  operator: "bg-destructive/10 text-destructive border-destructive/20",
  entrant: "bg-primary/10 text-primary border-primary/20",
  judge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  reader: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

export const ROLE_DESCRIPTION: Record<ReaderRole, string> = {
  operator: "Full visibility across every artifact, control, and audit signal.",
  entrant: "Owner view — manage uploads, drafts, and confidentiality settings.",
  judge: "Read-only judging access including confidential references.",
  reader: "Reader access — public & shared artifacts only.",
};

export function useReaderRole(entry: ReaderEntry | null | undefined): ReaderCapabilities {
  const { user, isAdmin, isTester } = useAuth();

  return useMemo<ReaderCapabilities>(() => {
    let role: ReaderRole = "reader";
    if (isAdmin) role = "operator";
    else if (entry && user && entry.user_id === user.id) role = "entrant";
    else if (isTester) role = "judge";

    const isOperator = role === "operator";
    const isEntrant = role === "entrant";
    const isJudge = role === "judge";

    return {
      role,
      canUpload: isOperator || isEntrant,
      canEditEntry: isOperator || isEntrant,
      canSeeConfidential: isOperator || isEntrant || isJudge,
      canSeeDeprecated: isOperator || isEntrant,
      canSeeOperatorStats: isOperator,
      canExportArtifacts: isOperator || isEntrant || isJudge,
      canManageCollaborators: isOperator || isEntrant,
      canScoreOrJudge: isOperator || isJudge,
    };
  }, [entry, user, isAdmin, isTester]);
}

/** Filter a list of docs based on viewer capabilities. */
export function filterDocsForRole(docs: ReaderDoc[], caps: ReaderCapabilities): ReaderDoc[] {
  return docs.filter((d) => {
    if (d.confidentiality === "Confidential" && !caps.canSeeConfidential) return false;
    if (d.status === "Deprecated" && !caps.canSeeDeprecated) return false;
    if (d.status === "Draft" && caps.role === "reader") return false;
    return true;
  });
}

/** Filter assets for readers — hide non-approved + expired-rights items. */
export function filterAssetsForRole(assets: ReaderAsset[], caps: ReaderCapabilities): ReaderAsset[] {
  if (caps.role !== "reader") return assets;
  const now = Date.now();
  return assets.filter((a) => {
    if (a.status !== "Approved") return false;
    if (a.usage_rights && new Date(a.usage_rights.expires_at).getTime() < now) return false;
    return true;
  });
}
