import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Activity, ShieldCheck, Terminal, Copy, AlertTriangle, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";
import type { AuditEntry } from "@/lib/screenplay/versionAudit";
import { triggerLabel } from "@/lib/screenplay/versionAudit";


interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: AuditEntry | null;
  actorLabel?: string;
}

interface AiUsageRow {
  id: string;
  function_name: string | null;
  model_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
  status: string | null;
}

interface GovernanceRow {
  id: string;
  event_type: string | null;
  event_status: string | null;
  created_at: string;
  correlation_id: string | null;
  row_hash: string | null;
  prev_hash: string | null;
}

// Actions that legitimately never produce AI usage or governance rows.
const NON_AI_ACTIONS = new Set(["manual_edit", "import", "restore", "promote_brief"]);
const NON_GOVERNED_ACTIONS = new Set(["manual_edit"]);

function ageSeconds(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

export default function AuditCallChainDialog({ open, onOpenChange, entry, actorLabel }: Props) {
  const [aiUsage, setAiUsage] = useState<AiUsageRow[]>([]);
  const [governance, setGovernance] = useState<GovernanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [govError, setGovError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const runFetch = useCallback(async (correlationId: string) => {
    setLoading(true);
    setAiError(null);
    setGovError(null);
    const [usage, gov] = await Promise.all([
      supabase
        .from("ai_usage_log")
        .select("id, function_name, model_id, prompt_tokens, completion_tokens, created_at, status")
        .eq("correlation_id", correlationId)
        .order("created_at", { ascending: true })
        .limit(50),
      supabase
        .from("governance_events")
        .select("id, event_type, event_status, created_at, correlation_id, row_hash, prev_hash")
        .eq("correlation_id", correlationId)
        .order("created_at", { ascending: true })
        .limit(50),
    ]);
    setAiUsage((usage.data ?? []) as AiUsageRow[]);
    setGovernance((gov.data ?? []) as GovernanceRow[]);
    setAiError(usage.error?.message ?? null);
    setGovError(gov.error?.message ?? null);
    setFetchedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open || !entry?.correlationId) {
      setAiUsage([]);
      setGovernance([]);
      setAiError(null);
      setGovError(null);
      setFetchedAt(null);
      return;
    }
    let cancelled = false;
    const cid = entry.correlationId;
    (async () => {
      await runFetch(cid);
      if (cancelled) {
        setAiUsage([]);
        setGovernance([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, entry?.correlationId, runFetch]);

  const copy = (value: string) => {
    navigator.clipboard?.writeText(value);
    toast.success("Copied");
  };

  const copyDiagnostic = () => {
    if (!entry) return;
    const payload = {
      correlation_id: entry.correlationId,
      version_id: entry.versionId,
      actor_user_id: entry.actorUserId,
      trigger_action: entry.triggerAction,
      trigger_function: entry.triggerFunction,
      created_at: entry.createdAt,
      ai_usage_rows: aiUsage.length,
      governance_rows: governance.length,
      ai_usage_error: aiError,
      governance_error: govError,
      fetched_at: fetchedAt,
    };
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    toast.success("Diagnostic copied");
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Call chain for this change
          </DialogTitle>
          <DialogDescription className="text-xs">
            Every logged event tied to this snapshot's correlation id.
          </DialogDescription>
        </DialogHeader>

        {!entry ? (
          <p className="text-sm text-muted-foreground">No audit entry selected.</p>
        ) : (
          <div className="space-y-4">
            <section className="rounded-lg border border-border/40 bg-card/60 p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] font-mono">
                  {triggerLabel(entry.triggerAction)}
                </Badge>
                {entry.triggerFunction && (
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    {entry.triggerFunction}
                  </Badge>
                )}
                {entry.fromDraftNumber != null && entry.toDraftNumber != null && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    v{entry.fromDraftNumber} → v{entry.toDraftNumber}
                  </Badge>
                )}
              </div>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs font-mono">
                <dt className="text-muted-foreground">Actor</dt>
                <dd className="truncate">
                  {actorLabel || entry.actorUserId}
                  <button className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground" onClick={() => copy(entry.actorUserId)}>
                    <Copy className="h-3 w-3" />
                  </button>
                </dd>
                <dt className="text-muted-foreground">When</dt>
                <dd>{new Date(entry.createdAt).toLocaleString()}</dd>
                <dt className="text-muted-foreground">Version</dt>
                <dd className="truncate">
                  {entry.versionId}
                  <button className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground" onClick={() => copy(entry.versionId)}>
                    <Copy className="h-3 w-3" />
                  </button>
                </dd>
                {entry.correlationId && (
                  <>
                    <dt className="text-muted-foreground">Correlation</dt>
                    <dd className="truncate">
                      {entry.correlationId}
                      <button className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground" onClick={() => copy(entry.correlationId!)}>
                        <Copy className="h-3 w-3" />
                      </button>
                    </dd>
                  </>
                )}
              </dl>
              {Object.keys(entry.triggerMetadata || {}).length > 0 && (
                <details className="text-[11px] font-mono">
                  <summary className="cursor-pointer text-muted-foreground">Trigger metadata</summary>
                  <pre className="mt-1 rounded bg-muted/40 p-2 overflow-x-auto">
                    {JSON.stringify(entry.triggerMetadata, null, 2)}
                  </pre>
                </details>
              )}
            </section>

            <MissingRowsToolbar
              entry={entry}
              loading={loading}
              fetchedAt={fetchedAt}
              onRefresh={() => entry.correlationId && runFetch(entry.correlationId)}
              onCopyDiagnostic={copyDiagnostic}
            />

            <section>
              <div className="flex items-center gap-2 mb-2">
                <Terminal className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  AI usage log
                </span>
                {!loading && aiUsage.length > 0 && (
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {aiUsage.length}
                  </Badge>
                )}
              </div>
              {loading ? (
                <Skeleton className="h-12 w-full" />
              ) : aiError ? (
                <MissingDataCard
                  tone="error"
                  title="Query failed"
                  detail={aiError}
                  hints={[
                    "The ai_usage_log query returned an error before we could check for rows.",
                    "This is usually an RLS/permission problem, not missing data.",
                  ]}
                />
              ) : !entry.correlationId ? (
                <MissingDataCard
                  tone="info"
                  title="No correlation id on this snapshot"
                  hints={[
                    "This version was written without a correlation id, so no AI call can be linked to it.",
                    "Typical for manual edits, imports, and restores — nothing is missing from the log.",
                  ]}
                />
              ) : aiUsage.length === 0 ? (
                <MissingDataCard
                  tone={NON_AI_ACTIONS.has(entry.triggerAction) ? "info" : "warn"}
                  title={
                    NON_AI_ACTIONS.has(entry.triggerAction)
                      ? `No AI usage expected for ${triggerLabel(entry.triggerAction)}`
                      : "No AI usage rows for this correlation id"
                  }
                  correlationId={entry.correlationId}
                  createdAt={entry.createdAt}
                  hints={
                    NON_AI_ACTIONS.has(entry.triggerAction)
                      ? [
                          "This trigger type does not call the AI gateway, so an empty ai_usage_log is correct.",
                        ]
                      : [
                          `Snapshot is ${formatAge(ageSeconds(entry.createdAt))} old — very recent calls may not have flushed yet.`,
                          "The edge function may have failed before writing to ai_usage_log — check function logs by correlation id.",
                          "Check that the caller propagates x-correlation-id downstream to the gateway.",
                        ]
                  }
                />
              ) : (
                <ul className="space-y-1">
                  {aiUsage.map((row) => (
                    <li key={row.id} className="flex items-center justify-between rounded border border-border/30 bg-muted/20 px-2 py-1 text-[11px] font-mono">
                      <span className="truncate">
                        {row.function_name || "—"} · {row.model_id || "—"}
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {(row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0)}t · {row.status || "ok"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Governance events
                </span>
                {!loading && governance.length > 0 && (
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {governance.length}
                  </Badge>
                )}
              </div>
              {loading ? (
                <Skeleton className="h-12 w-full" />
              ) : govError ? (
                <MissingDataCard
                  tone="error"
                  title="Query failed"
                  detail={govError}
                  hints={[
                    "The governance_events query returned an error before we could check for rows.",
                    "This is usually an RLS/permission problem, not missing data.",
                  ]}
                />
              ) : !entry.correlationId ? (
                <MissingDataCard
                  tone="info"
                  title="No correlation id on this snapshot"
                  hints={[
                    "Without a correlation id, no governance event can be tied to this version.",
                  ]}
                />
              ) : governance.length === 0 ? (
                <MissingDataCard
                  tone={NON_GOVERNED_ACTIONS.has(entry.triggerAction) ? "info" : "warn"}
                  title={
                    NON_GOVERNED_ACTIONS.has(entry.triggerAction)
                      ? `No governance event expected for ${triggerLabel(entry.triggerAction)}`
                      : "No governance events for this correlation id"
                  }
                  correlationId={entry.correlationId}
                  createdAt={entry.createdAt}
                  hints={
                    NON_GOVERNED_ACTIONS.has(entry.triggerAction)
                      ? [
                          "Manual edits are not routed through the governance ledger.",
                        ]
                      : [
                          "The action may have short-circuited (policy block, validation failure) before the governance trigger fired.",
                          "Check the audit_log table and the edge function logs filtered by this correlation id.",
                          "If this correlation is older than governance retention, the row may have been rolled off.",
                        ]
                  }
                />
              ) : (
                <ul className="space-y-1">
                  {governance.map((row) => (
                    <li key={row.id} className="rounded border border-border/30 bg-muted/20 px-2 py-1 text-[11px] font-mono">
                      <div className="flex items-center justify-between">
                        <span>{row.event_type || "—"}</span>
                        <span className="text-muted-foreground">{row.event_status || "—"}</span>
                      </div>
                      {row.row_hash && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          hash {row.row_hash.slice(0, 12)}…
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MissingRowsToolbar({
  entry,
  loading,
  fetchedAt,
  onRefresh,
  onCopyDiagnostic,
}: {
  entry: AuditEntry;
  loading: boolean;
  fetchedAt: string | null;
  onRefresh: () => void;
  onCopyDiagnostic: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-muted/10 px-2 py-1.5 text-[10px] font-mono">
      <span className="text-muted-foreground">Diagnostics</span>
      {fetchedAt && (
        <span className="text-muted-foreground/80">· fetched {new Date(fetchedAt).toLocaleTimeString()}</span>
      )}
      <span className="text-muted-foreground/80">· snapshot age {formatAge(ageSeconds(entry.createdAt))}</span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px]"
          disabled={loading || !entry.correlationId}
          onClick={onRefresh}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={onCopyDiagnostic}>
          <Copy className="h-3 w-3 mr-1" />
          Copy diagnostic
        </Button>
      </div>
    </div>
  );
}

function MissingDataCard({
  tone,
  title,
  detail,
  hints,
  correlationId,
  createdAt,
}: {
  tone: "info" | "warn" | "error";
  title: string;
  detail?: string;
  hints?: string[];
  correlationId?: string | null;
  createdAt?: string;
}) {
  const toneClasses =
    tone === "error"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : tone === "warn"
      ? "border-amber-500/40 bg-amber-500/5 text-amber-300"
      : "border-border/40 bg-muted/20 text-muted-foreground";
  const Icon = tone === "error" ? AlertTriangle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div className={`rounded-md border p-2.5 text-[11px] space-y-1.5 ${toneClasses}`}>
      <div className="flex items-start gap-1.5">
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0 flex-1">
          <p className="font-medium leading-snug">{title}</p>
          {detail && (
            <pre className="whitespace-pre-wrap break-all font-mono text-[10px] opacity-90 bg-background/40 rounded px-1.5 py-1">
              {detail}
            </pre>
          )}
          {(correlationId || createdAt) && (
            <dl className="grid grid-cols-[70px_1fr] gap-y-0.5 font-mono text-[10px] opacity-80">
              {correlationId && (
                <>
                  <dt>corr_id</dt>
                  <dd className="truncate">{correlationId}</dd>
                </>
              )}
              {createdAt && (
                <>
                  <dt>ts</dt>
                  <dd>{new Date(createdAt).toISOString()}</dd>
                </>
              )}
            </dl>
          )}
          {hints && hints.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5 text-[10px] opacity-90">
              {hints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

