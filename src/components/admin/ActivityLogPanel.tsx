import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Terminal, Filter, ChevronRight, Pin, Plus, Loader2, Send } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { logAuditEvent } from "@/lib/audit";

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  details: Record<string, any> | null;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  add_tokens: "bg-emerald-500/10 text-emerald-500",
  spend_tokens: "bg-primary/10 text-primary",
  submit_entry: "bg-blue-500/10 text-blue-500",
  delete_entry: "bg-destructive/10 text-destructive",
  update_competition: "bg-amber-500/10 text-amber-500",
  transfer_tokens: "bg-violet-500/10 text-violet-500",
  system_status: "bg-primary/15 text-primary",
  waitlist_signup: "bg-cyan-500/10 text-cyan-500",
  demo_request: "bg-orange-500/10 text-orange-500",
};

export default function ActivityLogPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [pinnedStatus, setPinnedStatus] = useState<AuditRow | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  async function fetchLogs() {
    setLoading(true);
    let query = supabase
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter !== "all") {
      query = query.eq("action", filter);
    }

    const { data } = await query;
    const rows = (data as AuditRow[]) || [];
    setLogs(rows);

    const latestStatus = rows.find((r) => r.action === "system_status") || null;
    if (!latestStatus && filter !== "system_status") {
      const { data: statusData } = await supabase
        .from("audit_log")
        .select("*")
        .eq("action", "system_status")
        .order("created_at", { ascending: false })
        .limit(1);
      setPinnedStatus((statusData as AuditRow[])?.[0] || null);
    } else {
      setPinnedStatus(latestStatus || null);
    }

    setLoading(false);
  }

  useEffect(() => { fetchLogs(); }, [filter]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function handleAddNote() {
    if (!noteText.trim() || !user) return;
    setSubmittingNote(true);
    try {
      await logAuditEvent({
        action: "system_status",
        userId: user.id,
        details: { note: noteText.trim(), added_by: "admin", timestamp: new Date().toISOString() },
      });
      setNoteText("");
      setShowAddNote(false);
      toast({ title: "Note added to Dev Log" });
      fetchLogs();
    } catch (e: any) {
      toast({ title: "Failed to add note", description: e.message, variant: "destructive" });
    }
    setSubmittingNote(false);
  }

  const uniqueActions = [...new Set(logs.map((l) => l.action))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" /> Activity Log
          </h3>
          <p className="text-xs text-muted-foreground">Audit trail of all system actions and admin operations.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAddNote(!showAddNote)} className="text-xs gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Note
          </Button>
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40 h-8 text-xs bg-muted border-border">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActions.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {showAddNote && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">New System Note</p>
          <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="Document system status, decisions, or milestones..." className="bg-muted border-border text-sm" rows={3} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowAddNote(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={handleAddNote} disabled={submittingNote || !noteText.trim()}
              className="text-xs bg-gold-gradient text-primary-foreground gap-1.5">
              {submittingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Post Note
            </Button>
          </div>
        </div>
      )}

      {pinnedStatus && (
        <div className="rounded-xl border border-primary/30 bg-card/80 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Pin className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">Current System Status</span>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">
              {new Date(pinnedStatus.created_at).toLocaleDateString()}{" "}
              {new Date(pinnedStatus.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          {pinnedStatus.details && (
            <div className="space-y-1">
              {pinnedStatus.details.note && <p className="text-sm text-foreground leading-relaxed">{pinnedStatus.details.note}</p>}
              {pinnedStatus.details.phase && (
                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary mt-1">{pinnedStatus.details.phase}</Badge>
              )}
              {pinnedStatus.details.version && (
                <Badge variant="outline" className="text-[10px] font-mono border-border ml-1 mt-1">{pinnedStatus.details.version}</Badge>
              )}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No log entries found.</div>
        ) : (
          <ScrollArea className="h-[600px]">
            <div className="divide-y divide-border/30">
              {logs.map((log) => {
                const colorClass = ACTION_COLORS[log.action] || "bg-muted text-muted-foreground";
                const hasDetails = log.details && Object.keys(log.details).length > 0;
                const isExpanded = expandedIds.has(log.id);

                return (
                  <div key={log.id} className="hover:bg-muted/20 transition-colors">
                    <div
                      className={`px-5 py-3 flex items-start justify-between gap-4 ${hasDetails ? "cursor-pointer" : ""}`}
                      onClick={() => hasDetails && toggleExpanded(log.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {hasDetails && (
                            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          )}
                          <Badge variant="outline" className={`text-[10px] font-mono shrink-0 ${colorClass}`}>{log.action}</Badge>
                          <span className="text-[10px] font-mono text-muted-foreground truncate">
                            {log.user_id ? `user:${log.user_id.slice(0, 8)}…` : "system"}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap shrink-0">
                        {new Date(log.created_at).toLocaleDateString()}{" "}
                        {new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    </div>
                    {hasDetails && isExpanded && (
                      <div className="px-5 pb-3">
                        <pre className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-border/20">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground text-center font-mono">
        Showing latest {logs.length} entries{filter !== "all" ? ` (filtered: ${filter})` : ""}
      </p>
    </div>
  );
}
