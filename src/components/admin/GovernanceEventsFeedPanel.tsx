import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { ChevronDown, Copy, Download, RotateCcw, Search } from "lucide-react";

interface GovernanceEventRow {
  id: string;
  created_at: string;
  event_type: string;
  event_status: string;
  provider: string | null;
  model_name: string | null;
  routing_reason: string | null;
  entry_id: string | null;
  correlation_id: string | null;
  metadata_json: Record<string, unknown> | null;
}

const APPROVER_KEYS = [
  "admitted_by",
  "decided_by",
  "rolled_back_by",
  "reviewed_by",
  "approved_by",
  "actor_id",
  "user_id",
] as const;

function extractApprover(row: GovernanceEventRow): string | null {
  const m = row.metadata_json ?? {};
  for (const k of APPROVER_KEYS) {
    const v = (m as Record<string, unknown>)[k];
    if (typeof v === "string" && v) return `${k}:${v}`;
  }
  return null;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase();
  if (s.includes("block") || s.includes("reject") || s.includes("fail") || s.includes("error")) return "destructive";
  if (s.includes("warn") || s.includes("pend") || s.includes("escalate")) return "outline";
  if (s.includes("admit") || s.includes("commit") || s.includes("ok") || s.includes("record")) return "secondary";
  return "default";
}

const PAGE_SIZE = 50;

interface Filters {
  search: string;
  eventTypes: string[];
  eventStatus: string;
  approver: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  eventTypes: [],
  eventStatus: "__all__",
  approver: "",
  from: "",
  to: "",
};

export default function GovernanceEventsFeedPanel() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<GovernanceEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);

  // Load distinct type/status options once for the filter dropdowns.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("governance_events")
        .select("event_type, event_status")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!data) return;
      const types = new Set<string>();
      const statuses = new Set<string>();
      for (const r of data) {
        if (r.event_type) types.add(r.event_type as string);
        if (r.event_status) statuses.add(r.event_status as string);
      }
      setTypeOptions([...types].sort());
      setStatusOptions([...statuses].sort());
    })();
  }, []);

  const load = useCallback(async (a: Filters, append = false, cursor?: string) => {
    setLoading(true);
    try {
      let q = supabase
        .from("governance_events")
        .select(
          "id, created_at, event_type, event_status, provider, model_name, routing_reason, entry_id, correlation_id, metadata_json",
        )
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE + 1);

      if (a.eventTypes.length > 0) q = q.in("event_type", a.eventTypes);
      if (a.eventStatus && a.eventStatus !== "__all__") q = q.eq("event_status", a.eventStatus);
      if (a.from) q = q.gte("created_at", new Date(a.from).toISOString());
      if (a.to) q = q.lte("created_at", new Date(a.to).toISOString());
      if (cursor) q = q.lt("created_at", cursor);

      // Free-text: match against event_type OR metadata_json cast to text.
      if (a.search.trim()) {
        const s = a.search.trim().replace(/[%,]/g, "");
        q = q.or(`event_type.ilike.%${s}%,routing_reason.ilike.%${s}%,provider.ilike.%${s}%,model_name.ilike.%${s}%`);
      }

      const { data, error } = await q;
      if (error) throw error;

      let list = (data ?? []) as GovernanceEventRow[];

      // Client-side filter for approver / metadata search — jsonb text search
      // through PostgREST would need an RPC, so we filter locally on the page.
      if (a.approver.trim()) {
        const needle = a.approver.trim().toLowerCase();
        list = list.filter((r) => {
          for (const k of APPROVER_KEYS) {
            const v = (r.metadata_json ?? {})[k];
            if (typeof v === "string" && v.toLowerCase().includes(needle)) return true;
          }
          return false;
        });
      }
      if (a.search.trim()) {
        // Additionally intersect with metadata_json substring matches so search
        // can hit values buried inside metadata (evidence hashes, decisions).
        const needle = a.search.trim().toLowerCase();
        list = list.filter((r) => {
          if (r.event_type?.toLowerCase().includes(needle)) return true;
          if ((r.event_status ?? "").toLowerCase().includes(needle)) return true;
          if ((r.routing_reason ?? "").toLowerCase().includes(needle)) return true;
          try {
            return JSON.stringify(r.metadata_json ?? {}).toLowerCase().includes(needle);
          } catch {
            return false;
          }
        });
      }

      const more = list.length > PAGE_SIZE;
      if (more) list = list.slice(0, PAGE_SIZE);
      setHasMore(more);
      setRows((prev) => (append ? [...prev, ...list] : list));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load governance events");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(applied, false);
  }, [applied, load]);

  const apply = () => {
    setExpanded(new Set());
    setApplied(filters);
  };
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setExpanded(new Set());
  };

  const loadMore = () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    load(applied, true, last.created_at);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = (v: string) => {
    navigator.clipboard.writeText(v).then(() => toast.success("Copied"));
  };

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.info("Nothing to export");
      return;
    }
    const headers = [
      "created_at",
      "event_type",
      "event_status",
      "provider",
      "model_name",
      "routing_reason",
      "entry_id",
      "correlation_id",
      "approver",
      "metadata_json",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.created_at,
          r.event_type,
          r.event_status,
          r.provider ?? "",
          r.model_name ?? "",
          r.routing_reason ?? "",
          r.entry_id ?? "",
          r.correlation_id ?? "",
          extractApprover(r) ?? "",
          r.metadata_json ?? {},
        ]
          .map(escape)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `governance_events_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (applied.search) n++;
    if (applied.eventTypes.length) n++;
    if (applied.eventStatus && applied.eventStatus !== "__all__") n++;
    if (applied.approver) n++;
    if (applied.from) n++;
    if (applied.to) n++;
    return n;
  }, [applied]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Governance Events Feed</span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {rows.length}
              {hasMore ? "+" : ""} rows · {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
            </Badge>
            <Button size="sm" variant="outline" onClick={exportCsv} className="h-7 text-xs">
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="col-span-1 sm:col-span-2 relative">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search event_type, metadata, provider…"
              className="pl-7 h-9 text-xs"
              value={filters.search}
              onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && apply()}
            />
          </div>
          <Select
            value={filters.eventStatus}
            onValueChange={(v) => setFilters((p) => ({ ...p, eventStatus: v }))}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Decision / status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All decisions</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Approver (user id fragment)"
            className="h-9 text-xs"
            value={filters.approver}
            onChange={(e) => setFilters((p) => ({ ...p, approver: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && apply()}
          />
          <Input
            type="datetime-local"
            className="h-9 text-xs"
            value={filters.from}
            onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
          />
          <Input
            type="datetime-local"
            className="h-9 text-xs"
            value={filters.to}
            onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
          />
          <div className="col-span-1 sm:col-span-2 flex flex-wrap gap-1 items-center">
            <span className="text-[10px] uppercase text-muted-foreground mr-1">route:</span>
            {typeOptions.slice(0, 12).map((t) => {
              const active = filters.eventTypes.includes(t);
              return (
                <Badge
                  key={t}
                  variant={active ? "default" : "outline"}
                  className="cursor-pointer text-[10px]"
                  onClick={() =>
                    setFilters((p) => ({
                      ...p,
                      eventTypes: active
                        ? p.eventTypes.filter((x) => x !== t)
                        : [...p.eventTypes, t],
                    }))
                  }
                >
                  {t}
                </Badge>
              );
            })}
          </div>
          <div className="col-span-1 sm:col-span-2 lg:col-span-4 flex gap-2">
            <Button size="sm" onClick={apply} disabled={loading} className="h-8">
              <Search className="h-3 w-3 mr-1" /> Apply
            </Button>
            <Button size="sm" variant="outline" onClick={reset} className="h-8">
              <RotateCcw className="h-3 w-3 mr-1" /> Reset
            </Button>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No governance events match these filters.
          </p>
        ) : (
          <div className="rounded-md border border-border/50 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">When</TableHead>
                  <TableHead>Route (event_type)</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Approver</TableHead>
                  <TableHead>Model / Provider</TableHead>
                  <TableHead className="w-[110px]">Correlation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isOpen = expanded.has(r.id);
                  const approver = extractApprover(r);
                  return (
                    <>
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => toggle(r.id)}>
                        <TableCell className="text-[11px] whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">
                          <div className="flex items-center gap-1">
                            <ChevronDown
                              className={`h-3 w-3 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                            />
                            {r.event_type}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(r.event_status)} className="text-[10px]">
                            {r.event_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                          {approver ? approver.split(":")[1].slice(0, 8) + "…" : "—"}
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">
                          {r.model_name ? `${r.provider ?? "?"} / ${r.model_name}` : "—"}
                        </TableCell>
                        <TableCell>
                          {r.correlation_id ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copy(r.correlation_id!);
                              }}
                              className="font-mono text-[10px] hover:underline flex items-center gap-1"
                            >
                              {r.correlation_id.slice(0, 8)}
                              <Copy className="h-2.5 w-2.5" />
                            </button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={`${r.id}-detail`} className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={6} className="p-0">
                            <Collapsible open={isOpen}>
                              <CollapsibleTrigger asChild>
                                <span className="hidden" />
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="p-3 text-[11px] space-y-2">
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                                    {r.entry_id && (
                                      <span>
                                        entry_id:{" "}
                                        <button
                                          onClick={() => copy(r.entry_id!)}
                                          className="font-mono hover:underline"
                                        >
                                          {r.entry_id.slice(0, 8)}…
                                        </button>
                                      </span>
                                    )}
                                    {r.routing_reason && <span>routing: {r.routing_reason}</span>}
                                    {approver && <span>approver: {approver}</span>}
                                  </div>
                                  <pre className="text-[10px] bg-background/50 p-2 rounded border border-border/40 overflow-x-auto whitespace-pre-wrap break-words">
                                    {JSON.stringify(r.metadata_json ?? {}, null, 2)}
                                  </pre>
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center">
            <Button size="sm" variant="outline" onClick={loadMore} disabled={loading} className="h-8">
              Load more
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
