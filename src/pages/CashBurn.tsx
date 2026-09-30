import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { CashBurnDashboard } from "@/components/cashburn/CashBurnDashboard";
import { Card } from "@/components/ui/card";

const WORKSPACE_SCOPE_ID = "00000000-0000-0000-0000-000000000001";

export default function CashBurn() {
  const { user, isAdmin, loading } = useAuth();

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cash Burn</h1>
          <p className="text-sm text-muted-foreground">Workspace runway, burn rate, scenarios, and milestones.</p>
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !user ? (
          <Card className="p-6 text-sm">Sign in to view cash burn.</Card>
        ) : !isAdmin ? (
          <Card className="p-6 text-sm">Workspace cash burn is restricted to admins. Open a project, screenplay, or franchise to manage its own runway.</Card>
        ) : (
          <CashBurnDashboard scopeType="workspace" scopeId={WORKSPACE_SCOPE_ID} scopeLabel="CanIScreenwrite" />
        )}
      </div>
    </Layout>
  );
}
