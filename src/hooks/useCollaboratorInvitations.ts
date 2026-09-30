import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { USER_EMAIL_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

export type CollabRole = "viewer" | "reviewer" | "editor" | "owner";
export type CollabInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface CollaboratorInvitationRow {
  id: string;
  entry_id: string;
  invited_by: string;
  email: string;
  role: CollabRole;
  status: CollabInvitationStatus;
  token: string;
  expires_at: string;
  last_sent_at: string | null;
  send_count: number;
  accepted_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  entry_title?: string | null;
}

const ACCEPT_BASE = "https://caniscreenwrite.com/collab/accept";

export function buildAcceptUrl(token: string) {
  return `${ACCEPT_BASE}?token=${encodeURIComponent(token)}`;
}

export async function sendInvitationEmail(params: {
  invitation: CollaboratorInvitationRow;
  inviterName: string;
  entryTitle: string;
}) {
  void params;
  throw new Error(USER_EMAIL_SECURITY_MESSAGE);
}

export function useOwnerCollaboratorInvitations() {
  const [rows, setRows] = useState<CollaboratorInvitationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("collaborator_invitations" as any)
      .select("*, entries:entry_id(title)")
      .eq("invited_by", uid)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Could not load invitations");
      return;
    }
    setRows(
      ((data as any[]) || []).map((r) => ({
        ...r,
        entry_title: r.entries?.title ?? null,
      }))
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resend = async (_invitation: CollaboratorInvitationRow) => {
    toast.warning(USER_EMAIL_SECURITY_MESSAGE);
  };

  const revoke = async (invitation: CollaboratorInvitationRow) => {
    const { error } = await supabase.rpc(
      "revoke_collaborator_invitation" as any,
      { p_invitation_id: invitation.id }
    );
    if (error) {
      toast.error(error.message || "Could not revoke invitation");
      return;
    }
    toast.success(`Revoked invitation for ${invitation.email}`);
    load();
  };

  return { rows, loading, reload: load, resend, revoke };
}
