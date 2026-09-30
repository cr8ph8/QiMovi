/**
 * Evidence audit — small facade around `logAuditEvent` for the evidence
 * drawer subsystem so every reveal / view goes through one canonical shape.
 *
 * Rows are written to `public.audit_log` with `action` prefixed by
 * `evidence.` and details describing the surface, the viewer role
 * (operator vs entrant), and any target identifier. The
 * `EvidenceAuditLogPanel` reads back this same prefix.
 *
 * Every helper here is fire-and-forget: audit failures never surface to
 * the caller. Actor ids are attached automatically by `logAuditEvent`.
 */
import { logAuditEvent } from "@/lib/audit";
import type { EvidenceViewerRole } from "@/components/evidence/useEvidenceViewerRole";

export const EVIDENCE_AUDIT_PREFIX = "evidence.";

export type EvidenceAuditAction =
  | "evidence.drawer_view"
  | "evidence.disclosure_reveal"
  | "evidence.link_preview_reveal"
  | "evidence.preview_role_switch"
  | "evidence.action.score"
  | "evidence.action.annotate"
  | "evidence.action.administer"
  | "evidence.action.request_review";

export interface EvidenceAuditContext {
  /** Human title of the evidence surface (e.g. "Publication rollback"). */
  surfaceTitle: string;
  /** Optional stable id for the surface (entry id, claim id, etc.). */
  surfaceId?: string | null;
  viewerRole: EvidenceViewerRole;
  /** Free-form additional details (link kind, disclosure label, etc.). */
  extra?: Record<string, unknown>;
}

export function logEvidenceAudit(
  action: EvidenceAuditAction,
  ctx: EvidenceAuditContext,
): void {
  void logAuditEvent({
    action,
    target: {
      surface_title: ctx.surfaceTitle,
      surface_id: ctx.surfaceId ?? null,
    },
    details: {
      viewer_role: ctx.viewerRole,
      ...(ctx.extra ?? {}),
    },
  });
}
