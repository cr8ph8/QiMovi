import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Clock, Shield, UserPlus, UserMinus, KeyRound, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";

interface AuditEntry {
  id: string;
  action: string;
  user_id: string | null;
  details: any;
  created_at: string;
}

const ACTION_ICONS: Record<string, any> = {
  grant_access: UserPlus,
  revoke_access: UserMinus,
  invite_sent: KeyRound,
  tier_change: ArrowUpDown,
  request_approved: Shield,
  request_denied: Shield,
};

const ACTION_COLORS: Record<string, string> = {
  grant_access: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  revoke_access: "bg-red-500/10 text-red-400 border-red-500/20",
  invite_sent: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  tier_change: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  request_approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  request_denied: "bg-red-500/10 text-red-400 border-red-500/20",
};

const ACCESS_ACTIONS = [
  "grant_access", "revoke_access", "invite_sent", "tier_change",
  "request_approved", "request_denied", "access_granted", "access_revoked",
  "demo_request", "waitlist_signup",
];

export default function AccessChangesLogPanel() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  useEffect(() => {
    fetchLogs();
  }, []);

  async function fetchLogs() {
    setLoading(true);
    const { data } = await supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    // Filter to access-related actions client-side since we can't use IN with .or easily
    const accessLogs = (data || []).filter(
      (l) => ACCESS_ACTIONS.includes(l.action) || l.action.includes("access") || l.action.includes("grant") || l.action.includes("invite") || l.action.includes("tier")
    );
    setLogs(accessLogs);
    setLoading(false);
  }

  const filtered = logs.filter((l) => {
    const matchesAction = actionFilter === "all" || l.action === actionFilter;
    const matchesSearch =
      !search ||
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.user_id?.toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(l.details).toLowerCase().includes(search.toLowerCase());
    return matchesAction && matchesSearch;
  });

  const uniqueActions = [...new Set(logs.map((l) => l.action))];

  function formatAction(action: string) {
    return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function getDetailSummary(entry: AuditEntry): string {
    const d = entry.details;
    if (!d || typeof d !== "object") return "";
    const parts: string[] = [];
    if (d.email) parts.push(d.email);
    if (d.tier) parts.push(`Tier: ${d.tier}`);
    if (d.old_tier && d.new_tier) parts.push(`${d.old_tier} → ${d.new_tier}`);
    if (d.reason) parts.push(d.reason);
    if (d.target_user_id) parts.push(`Target: ${d.target_user_id.slice(0, 8)}…`);
    return parts.join(" · ");
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search log entries…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-background/50"
          />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[180px] bg-background/50">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {uniqueActions.map((a) => (
              <SelectItem key={a} value={a}>{formatAction(a)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{logs.length}</p>
          <p className="text-xs text-muted-foreground">Total Events</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {logs.filter((l) => l.action.includes("grant") || l.action.includes("approved")).length}
          </p>
          <p className="text-xs text-muted-foreground">Grants</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-center">
          <p className="text-2xl font-bold text-red-400">
            {logs.filter((l) => l.action.includes("revoke") || l.action.includes("denied")).length}
          </p>
          <p className="text-xs text-muted-foreground">Revocations</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-center">
          <p className="text-2xl font-bold text-blue-400">
            {logs.filter((l) => l.action.includes("invite")).length}
          </p>
          <p className="text-xs text-muted-foreground">Invites</p>
        </div>
      </div>

      {/* Log list */}
      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">No access change events found.</p>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {filtered.map((entry) => {
            const IconComp = ACTION_ICONS[entry.action] || Clock;
            const colorClass = ACTION_COLORS[entry.action] || "bg-muted/30 text-muted-foreground border-border/30";
            const summary = getDetailSummary(entry);
            return (
              <div
                key={entry.id}
                className="flex items-start gap-3 rounded-lg border border-border/30 bg-card/40 px-4 py-3 hover:bg-card/70 transition-colors"
              >
                <div className={`mt-0.5 rounded-md p-1.5 border ${colorClass}`}>
                  <IconComp className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {formatAction(entry.action)}
                    </Badge>
                    {entry.user_id && (
                      <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                        {entry.user_id.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                  {summary && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{summary}</p>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5">
                  {format(new Date(entry.created_at), "MMM d, HH:mm")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
