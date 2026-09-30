import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Users } from "lucide-react";
import { InvitationsTable } from "@/components/collaborators/InvitationsTable";
import { useOwnerCollaboratorInvitations } from "@/hooks/useCollaboratorInvitations";

export default function CollaboratorInvitationsPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const { rows, loading, resend, revoke } = useOwnerCollaboratorInvitations();

  useEffect(() => {
    document.title = "Collaborator Invitations · Qi | Can I Screenwrite?";
    supabase.auth.getUser().then(({ data }) => {

      if (!data.user) {
        navigate("/auth?next=/collaborators", { replace: true });
        return;
      }
      setChecking(false);
    });
  }, [navigate]);

  const counts = useMemo(() => {
    const c = { pending: 0, accepted: 0, revoked: 0, expired: 0 };
    rows.forEach((r) => {
      c[r.status]++;
    });
    return c;
  }, [rows]);

  if (checking) return null;

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">


      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-display font-bold tracking-tight">
            Collaborator Invitations
          </h1>
        </div>
        <p className="text-muted-foreground max-w-2xl">
          Every invitation you've sent across your screenplays. Resend, revoke,
          and monitor who has accepted.
        </p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Pending" value={counts.pending} accent="text-primary" />
        <StatCard label="Accepted" value={counts.accepted} accent="text-emerald-500" />
        <StatCard label="Revoked" value={counts.revoked} accent="text-muted-foreground" />
        <StatCard label="Expired" value={counts.expired} accent="text-destructive" />
      </div>

      <Card className="p-4 bg-card/40 border-border/60">
        <InvitationsTable
          rows={rows}
          loading={loading}
          onResend={resend}
          onRevoke={revoke}
        />
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <Card className="p-4 bg-card/40 border-border/60">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-3xl font-display font-bold mt-1 ${accent}`}>{value}</p>
    </Card>
  );
}
