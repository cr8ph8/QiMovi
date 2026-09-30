/**
 * Test-only seeded demo entry control panel.
 *
 * Only mounted when VITE_ENABLE_E2E === "true" AND the caller is an admin
 * (route wrapped in <AdminRouteGuard>). Drives the e2e-seed-demo-entry edge
 * function so Playwright can exercise the real grading UI paths against a
 * deterministic, fixed-UUID entry.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const DEMO_COMPETITION_ID = "e2e00000-0000-0000-0000-0000000000c1";
const DEMO_ENTRY_ID = "e2e00000-0000-0000-0000-0000000000e1";

type State = "finalized" | "panel" | "reports" | "none";
type Action = "status" | "seed" | "reset";

interface StatusResponse {
  entry?: { id: string; title: string; status: string } | null;
  scorecard?: {
    source: string;
    total_score: number | null;
    judge_count: number | null;
    panel_model_count: number | null;
    grading_report_count: number | null;
  } | null;
  ok?: boolean;
  action?: string;
  state?: string;
  error?: string;
  detail?: string;
}

export default function E2ESeed() {
  const enabled = import.meta.env.VITE_ENABLE_E2E === "true";
  const [state, setState] = useState<State>("panel");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (action: Action, s?: State) => {
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("e2e-seed-demo-entry", {
        body: { action, state: s ?? state },
      });
      if (error) throw error;
      setStatus(data as StatusResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (enabled) void call("status");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) {
    return (
      <div className="min-h-screen p-8 max-w-2xl mx-auto">
        <Card className="p-6 space-y-2">
          <h1 className="text-xl font-semibold">E2E Seed disabled</h1>
          <p className="text-sm text-muted-foreground">
            Set <code className="font-mono">VITE_ENABLE_E2E=true</code> and the edge-function
            secret <code className="font-mono">E2E_ENABLED=true</code> to use this page.
          </p>
        </Card>
      </div>
    );
  }

  const states: State[] = ["finalized", "panel", "reports", "none"];

  return (
    <div className="min-h-screen p-8 max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">E2E Demo Entry</h1>
        <p className="text-sm text-muted-foreground">
          Test-only. Seeds fixed-UUID competition + entry for Playwright smoke tests
          of the real grading UI paths.
        </p>
      </header>

      <Card className="p-4 space-y-3" data-testid="e2e-seed-panel">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Precedence state:</span>
          {states.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={state === s ? "default" : "outline"}
              onClick={() => setState(s)}
              disabled={busy}
              data-testid={`e2e-state-${s}`}
            >
              {s}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => call("seed")}
            disabled={busy}
            data-testid="e2e-seed-btn"
          >
            {busy ? "Working…" : `Seed / Re-seed (${state})`}
          </Button>
          <Button
            variant="outline"
            onClick={() => call("reset")}
            disabled={busy}
            data-testid="e2e-reset-btn"
          >
            Reset (delete demo rows)
          </Button>
          <Button
            variant="ghost"
            onClick={() => call("status")}
            disabled={busy}
            data-testid="e2e-status-btn"
          >
            Refresh status
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2" data-testid="e2e-status">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Current status
        </h2>
        {error && (
          <div className="text-sm text-destructive" role="alert">
            {error}
          </div>
        )}
        {status?.error && (
          <div className="text-sm text-destructive" role="alert">
            {status.error}
            {status.detail ? ` — ${status.detail}` : ""}
          </div>
        )}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm font-mono">
          <dt className="text-muted-foreground">Competition</dt>
          <dd data-testid="e2e-competition-id">{DEMO_COMPETITION_ID}</dd>
          <dt className="text-muted-foreground">Entry</dt>
          <dd data-testid="e2e-entry-id">{DEMO_ENTRY_ID}</dd>
          <dt className="text-muted-foreground">Entry exists</dt>
          <dd data-testid="e2e-entry-exists">{status?.entry ? "yes" : "no"}</dd>
          <dt className="text-muted-foreground">Entry status</dt>
          <dd>{status?.entry?.status ?? "—"}</dd>
          <dt className="text-muted-foreground">Scorecard source</dt>
          <dd data-testid="e2e-scorecard-source">
            <Badge variant="outline">{status?.scorecard?.source ?? "—"}</Badge>
          </dd>
          <dt className="text-muted-foreground">Total score</dt>
          <dd data-testid="e2e-total-score">
            {status?.scorecard?.total_score ?? "—"}
          </dd>
          <dt className="text-muted-foreground">Panel models</dt>
          <dd>{status?.scorecard?.panel_model_count ?? "—"}</dd>
          <dt className="text-muted-foreground">Reports</dt>
          <dd>{status?.scorecard?.grading_report_count ?? "—"}</dd>
        </dl>
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Next
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/judges">
            <Button variant="secondary" data-testid="e2e-open-judges">
              Open Judges Console →
            </Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          In the Judges Console, filter by competition <code>{DEMO_COMPETITION_ID.slice(0, 8)}</code>
          and click the [E2E] entry to open the scorecard drawer.
        </p>
      </Card>
    </div>
  );
}
