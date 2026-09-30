import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Brain, Eye, ShieldAlert } from "lucide-react";

type ProbeKind =
  | "injection_self_report"
  | "reflection_probe"
  | "eval_awareness_variant"
  | "workspace_probe_error";

interface ProbeRow {
  id: string;
  created_at: string;
  workspace_probe_kind: ProbeKind;
  workspace_probe_payload: Record<string, unknown> | null;
  correlation_id: string | null;
  entry_id: string | null;
  model_name: string | null;
  routing_reason: string | null;
}

const KIND_META: Record<
  ProbeKind,
  { label: string; icon: typeof Brain; description: string }
> = {
  injection_self_report: {
    label: "Injection self-report",
    icon: ShieldAlert,
    description:
      "Model was asked whether retrieved context tried to instruct it. Advisory only — see workspace paper §5.",
  },
  reflection_probe: {
    label: "Reflection interrupt",
    icon: Brain,
    description:
      "Mid-task reflection: criteria being applied, tradeoff being made, what would change the answer. Workspace paper §7 analog.",
  },
  eval_awareness_variant: {
    label: "Eval-awareness variant",
    icon: Eye,
    description:
      "Neutralized judge prompt variant used for this call. Enables drift measurement across variants (§5 ablation).",
  },
  workspace_probe_error: {
    label: "Probe error",
    icon: AlertTriangle,
    description: "Probe failed to parse. Diagnostic only — parent call was unaffected.",
  },
};

const FILTERS: Array<{ id: "all" | ProbeKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "injection_self_report", label: "Injection" },
  { id: "reflection_probe", label: "Reflection" },
  { id: "eval_awareness_variant", label: "Eval-awareness" },
  { id: "workspace_probe_error", label: "Errors" },
];

export function WorkspaceProbesPanel() {
  const [rows, setRows] = useState<ProbeRow[] | null>(null);
  const [filter, setFilter] = useState<"all" | ProbeKind>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("governance_events")
        .select(
          "id, created_at, workspace_probe_kind, workspace_probe_payload, correlation_id, entry_id, model_name, routing_reason",
        )
        .not("workspace_probe_kind", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as ProbeRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (filter === "all") return rows;
    return rows.filter((r) => r.workspace_probe_kind === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: rows?.length ?? 0,
      injection_self_report: 0,
      reflection_probe: 0,
      eval_awareness_variant: 0,
      workspace_probe_error: 0,
      detected: 0,
    };
    for (const r of rows ?? []) {
      c[r.workspace_probe_kind] = (c[r.workspace_probe_kind] ?? 0) + 1;
      if (
        r.workspace_probe_kind === "injection_self_report" &&
        (r.workspace_probe_payload as any)?.detected === true
      ) {
        c.detected += 1;
      }
    }
    return c;
  }, [rows]);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" aria-hidden />
          Workspace Probes
        </CardTitle>
        <CardDescription>
          Advisory signals grounded in the Anthropic "Verbalizable Representations Form a Global Workspace"
          paper (July 2026). Inference-time surrogates for the J-lens: injection self-report, reflection
          interrupt, and eval-awareness variant selection. See <code>.lovable/research/workspace-paper.md</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "default" : "outline"}
              onClick={() => setFilter(f.id)}
              data-testid={`filter-${f.id}`}
            >
              {f.label}
              <span className="ml-2 text-xs opacity-70">{counts[f.id] ?? 0}</span>
            </Button>
          ))}
          {counts.detected > 0 && (
            <Badge variant="destructive" className="ml-auto">
              {counts.detected} injection detection(s)
            </Badge>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {filtered === null && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {filtered !== null && filtered.length === 0 && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
            No probes recorded yet. Trigger a judge run or an augmented-context AI call to populate this list.
          </div>
        )}

        {filtered !== null && filtered.length > 0 && (
          <ul className="space-y-2">
            {filtered.map((row) => {
              const meta = KIND_META[row.workspace_probe_kind];
              const Icon = meta.icon;
              const payload = row.workspace_probe_payload ?? {};
              const detected =
                row.workspace_probe_kind === "injection_self_report" &&
                (payload as any).detected === true;
              return (
                <li
                  key={row.id}
                  className={`rounded-md border p-3 text-sm ${
                    detected ? "border-destructive/60 bg-destructive/5" : "border-border/60 bg-muted/20"
                  }`}
                  data-testid="probe-row"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          detected ? "text-destructive" : "text-muted-foreground"
                        }`}
                        aria-hidden
                      />
                      <div>
                        <div className="font-medium">{meta.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.routing_reason ?? "unknown"} ·{" "}
                          {new Date(row.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {detected && <Badge variant="destructive">detected</Badge>}
                  </div>
                  <ProbePayload kind={row.workspace_probe_kind} payload={payload} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProbePayload({
  kind,
  payload,
}: {
  kind: ProbeKind;
  payload: Record<string, unknown>;
}) {
  if (kind === "injection_self_report") {
    return (
      <div className="mt-2 space-y-1 text-xs">
        {payload.span ? (
          <div>
            <span className="font-medium">Span:</span> <code>{String(payload.span)}</code>
          </div>
        ) : null}
        {payload.reason ? (
          <div>
            <span className="font-medium">Reason:</span> {String(payload.reason)}
          </div>
        ) : null}
      </div>
    );
  }
  if (kind === "reflection_probe") {
    return (
      <div className="mt-2 space-y-1 text-xs">
        <div>
          <span className="font-medium">Criteria:</span> {String(payload.criteria ?? "—")}
        </div>
        <div>
          <span className="font-medium">Tradeoff:</span> {String(payload.tradeoff ?? "—")}
        </div>
        <div>
          <span className="font-medium">Would change:</span> {String(payload.would_change ?? "—")}
        </div>
      </div>
    );
  }
  if (kind === "eval_awareness_variant") {
    return (
      <div className="mt-2 text-xs">
        <span className="font-medium">Variant:</span> {String(payload.variant_id ?? "?")} ·{" "}
        <span className="font-medium">Hash:</span>{" "}
        <code>{String(payload.prompt_hash ?? "").slice(0, 12)}</code>
      </div>
    );
  }
  return (
    <pre className="mt-2 overflow-auto rounded bg-background/50 p-2 text-xs">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

export default WorkspaceProbesPanel;
