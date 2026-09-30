// LinearTriagePanel — God Mode tab showing the mirrored Linear ticket queue.
// Reads from `linear_tickets` (admin-only RLS). Realtime subscribed.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Section, SectionTitle, SectionLabel } from "@/components/Section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, RefreshCw, TicketCheck } from "lucide-react";
import { toast } from "sonner";

type Ticket = {
  id: string;
  linear_id: string | null;
  identifier: string | null;
  team_key: string | null;
  title: string;
  state: string | null;
  url: string | null;
  source: string;
  source_table: string | null;
  source_record_id: string | null;
  correlation_id: string | null;
  assignee: string | null;
  labels: string[] | null;
  created_at: string;
  closed_at: string | null;
};

const SOURCE_BADGE: Record<string, string> = {
  submission: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ai_failure: "bg-red-500/15 text-red-300 border-red-500/30",
  support: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  manual: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  governance: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export default function LinearTriagePanel() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("open");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("linear_tickets")
      .select(
        "id, linear_id, identifier, team_key, title, state, url, source, source_table, source_record_id, correlation_id, assignee, labels, created_at, closed_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(`Failed to load tickets: ${error.message}`);
    setRows((data ?? []) as Ticket[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("linear-tickets-triage")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "linear_tickets" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (stateFilter === "open" && r.closed_at) return false;
      if (stateFilter === "closed" && !r.closed_at) return false;
      if (q) {
        const hay = `${r.title} ${r.identifier ?? ""} ${r.correlation_id ?? ""} ${r.assignee ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, sourceFilter, stateFilter]);

  const counts = useMemo(() => {
    const open = rows.filter((r) => !r.closed_at).length;
    const bySource: Record<string, number> = {};
    rows.forEach((r) => {
      if (!r.closed_at) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    });
    return { open, bySource };
  }, [rows]);

  return (
    <Section className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <SectionLabel><TicketCheck className="h-3 w-3 inline mr-1" /> Linear Triage</SectionLabel>
          <SectionTitle>Operational Ticket Queue</SectionTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Mirror of Linear issues created from submissions, AI failures, support, and manual flags.
            Status syncs back via webhook.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
        <div className="rounded border border-border/40 p-2">
          <div className="text-muted-foreground">Open</div>
          <div className="text-lg font-mono">{counts.open}</div>
        </div>
        {(["submission", "ai_failure", "support", "manual", "governance"] as const).map((s) => (
          <div key={s} className="rounded border border-border/40 p-2">
            <div className="text-muted-foreground">{s.replace("_", " ")}</div>
            <div className="text-lg font-mono">{counts.bySource[s] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Search title / identifier / correlation id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-background border border-border/40 rounded px-2 text-sm"
        >
          <option value="all">All sources</option>
          <option value="submission">Submissions</option>
          <option value="ai_failure">AI failures</option>
          <option value="support">Support</option>
          <option value="manual">Manual</option>
          <option value="governance">Governance</option>
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="bg-background border border-border/40 rounded px-2 text-sm"
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="rounded border border-border/40 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-left">
            <tr>
              <th className="p-2">ID</th>
              <th className="p-2">Title</th>
              <th className="p-2">Source</th>
              <th className="p-2">State</th>
              <th className="p-2">Assignee</th>
              <th className="p-2">Age</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {loading ? "Loading…" : "No tickets match these filters."}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const ageMs = Date.now() - new Date(r.created_at).getTime();
              const ageDays = Math.floor(ageMs / 86_400_000);
              const ageLabel = ageDays > 0 ? `${ageDays}d` : `${Math.floor(ageMs / 3_600_000)}h`;
              return (
                <tr key={r.id} className="border-t border-border/20 hover:bg-muted/10">
                  <td className="p-2 font-mono">{r.identifier ?? "—"}</td>
                  <td className="p-2">{r.title}</td>
                  <td className="p-2">
                    <Badge variant="outline" className={`text-[10px] ${SOURCE_BADGE[r.source] ?? ""}`}>
                      {r.source}
                    </Badge>
                  </td>
                  <td className="p-2">{r.state ?? "—"}</td>
                  <td className="p-2">{r.assignee ?? "—"}</td>
                  <td className="p-2 font-mono text-muted-foreground">{ageLabel}</td>
                  <td className="p-2 text-right">
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        Linear <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
