import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { History, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  created_at: string;
  details: {
    area?: string;
    entity_id?: string | null;
    label?: string | null;
    before?: unknown;
    after?: unknown;
    diff?: Record<string, { before: unknown; after: unknown }>;
  } | null;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function AreaBadge({ area }: { area?: string }) {
  const color: Record<string, string> = {
    competition_economics: "bg-primary/15 text-primary",
    prize_pool: "bg-amber-500/15 text-amber-500",
    feature_configs: "bg-emerald-500/15 text-emerald-500",
    operational_overhead: "bg-blue-500/15 text-blue-500",
    profit_margins: "bg-violet-500/15 text-violet-500",
  };
  return (
    <Badge variant="outline" className={`font-mono text-[10px] ${area ? color[area] ?? "" : ""}`}>
      {area ?? "unknown"}
    </Badge>
  );
}

/**
 * Admin Economics — Audit Log viewer.
 *
 * Reads `public.audit_log` rows whose `action` is namespaced under
 * `admin_economics.*` and renders the timestamp, acting user, area, and
 * field-level before/after diff for every operator save.
 */
export default function EconomicsAuditLogPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [emailByUser, setEmailByUser] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_log")
      .select("id, user_id, action, created_at, details")
      .like("action", "admin_economics.%")
      .order("created_at", { ascending: false })
      .limit(200);

    const list = (data ?? []) as AuditRow[];
    setRows(list);

    const userIds = Array.from(new Set(list.map((r) => r.user_id).filter(Boolean))) as string[];
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", userIds);
      const map: Record<string, string> = {};
      (profiles ?? []).forEach((p: any) => { if (p?.id && p?.email) map[p.id] = p.email; });
      setEmailByUser(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="font-display flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Economics Change Audit
          </CardTitle>
          <CardDescription>
            Every save inside Admin Economics writes a timestamped row to{" "}
            <code>audit_log</code> with the operator, the area, and full
            before/after values. Read-only, admin-scoped.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No economics changes have been logged yet. Save any pricing, fee, or
            overhead panel and the change will appear here.
          </p>
        ) : (
          <ScrollArea className="h-[520px] pr-3">
            <ul className="space-y-2">
              {rows.map((r) => {
                const isOpen = expanded.has(r.id);
                const diff = r.details?.diff ?? {};
                const diffKeys = Object.keys(diff);
                return (
                  <li key={r.id} className="rounded-md border border-border/50 bg-muted/10">
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      className="w-full flex flex-wrap items-center gap-2 p-3 text-left hover:bg-muted/20"
                    >
                      {isOpen
                        ? <ChevronDown className="h-3 w-3 shrink-0" />
                        : <ChevronRight className="h-3 w-3 shrink-0" />}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      <AreaBadge area={r.details?.area} />
                      {r.details?.label && (
                        <span className="text-xs">{r.details.label}</span>
                      )}
                      {r.details?.entity_id && (
                        <code className="text-[10px] text-muted-foreground truncate max-w-[240px]">
                          {r.details.entity_id}
                        </code>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {r.user_id ? emailByUser[r.user_id] ?? r.user_id.slice(0, 8) : "system"}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        {diffKeys.length} field{diffKeys.length === 1 ? "" : "s"}
                      </Badge>
                    </button>
                    {isOpen && (
                      <div className="border-t border-border/40 p-3 space-y-2">
                        {diffKeys.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No field-level diff recorded.
                          </p>
                        ) : (
                          <div className="grid gap-2">
                            {diffKeys.map((k) => (
                              <div key={k} className="rounded border border-border/40 p-2">
                                <div className="text-[10px] font-mono uppercase text-muted-foreground mb-1">
                                  {k}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <div className="text-[10px] text-destructive/80 mb-0.5">before</div>
                                    <pre className="font-mono text-[11px] bg-destructive/5 rounded p-1 overflow-x-auto max-h-40">
                                      {fmtValue(diff[k].before)}
                                    </pre>
                                  </div>
                                  <div>
                                    <div className="text-[10px] text-emerald-500/80 mb-0.5">after</div>
                                    <pre className="font-mono text-[11px] bg-emerald-500/5 rounded p-1 overflow-x-auto max-h-40">
                                      {fmtValue(diff[k].after)}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
